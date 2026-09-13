import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { entitlementForUser, ensureReservePasses, grantMembership } from "@/lib/cloak/server/membership-server";
import {
  MEMBERSHIP_SKUS,
  SOLANA_USDC_MINT,
  TREASURY_ADDRESS,
  solscanTxUrl,
  type IndividualMembershipSku,
} from "@/lib/cloak/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Direct settlement verification (USDC direct-settlement spec §36-§38, §53,
 * §57, §80).
 *
 * This is the server-side payment authenticator. The client submits a
 * transaction signature for ITS OWN open PaymentRequest; the server
 * independently verifies it against a Solana RPC node — the same public
 * ledger data Solscan presents, read programmatically (§36: RPC/indexer
 * abstraction, swappable).
 *
 * Verified invariants (§37):
 *   - a payment request is open, unexpired, and owned by the caller
 *   - transaction exists on mainnet and did not fail
 *   - confirmation/finality policy met (confirmed or finalized)
 *   - correct native USDC mint (allowlisted — never "symbol === USDC")
 *   - correct recipient (treasury) and exact amount (SKU-derived)
 *   - Solana Pay reference belongs to THIS request (§16 Option B
 *     attribution). Address-only transfers are not auto-activated because
 *     the public treasury account cannot safely prove request ownership.
 *   - signature not already consumed for a membership — enforced by the
 *     MembershipClaim UNIQUE(signature) constraint in the database (§57).
 *     Server restarts can never re-admit a spent transaction.
 *
 * On an exact payment the route runs claim issuance + entitlement grant in
 * ONE database transaction: PaymentRequest -> confirmed, MembershipClaim ->
 * created once (auto-redeemed to the authenticated account), User row ->
 * tier written. Reserve additionally provisions the 10 guest-pass slots.
 *
 * Secrets: RPC endpoint comes from the server environment. Nothing here is
 * exposed to the browser bundle.
 */

export type PaymentVerifyStatus =
  | "confirmed"
  | "underpaid"
  | "overpaid"
  | "wrong_asset"
  | "wrong_recipient"
  | "wrong_reference"
  | "missing_reference"
  | "already_used"
  | "not_found"
  | "failed"
  | "confirming"
  | "expired"
  | "rpc_unavailable"
  | "bad_request";

interface VerifyRequestBody {
  requestId?: string;
  signature?: string;
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
}

function rpcEndpoint(): string {
  return process.env.SOLANA_RPC_ENDPOINT ?? "https://api.mainnet-beta.solana.com";
}

class RpcInvalidParam extends Error {}

class RpcUnavailable extends Error {}

async function getTransaction(signature: string) {
  const res = await fetch(rpcEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ],
    }),
  });
  if (!res.ok) throw new RpcUnavailable(`rpc_http_${res.status}`);
  const json = (await res.json()) as {
    result?: unknown;
    error?: { code?: number; message?: string };
  };
  if (json.error) {
    /* Public RPC nodes answer unknown signatures with an error object, not
     * result:null — map the documented codes precisely (§80: malformed hash,
     * RPC failure are distinct states). */
    if (json.error.code === -32007) return null; // "Transaction signature not found"
    if (json.error.code === -32602) throw new RpcInvalidParam(json.error.message); // "Invalid param"
    throw new RpcUnavailable(json.error.message ?? "rpc_error");
  }
  return json.result as SolanaTx | null;
}

interface SolanaTx {
  transaction?: {
    message?: {
      accountKeys?: ({ pubkey: string } | string)[];
      instructions?: { program?: string; programId?: string; data?: string; memo?: string }[];
    };
  };
  meta?: {
    err?: unknown;
    /** Legacy status field — present even when confirmationStatus is
     *  omitted; { Ok: ... } means the transaction succeeded in a
     *  block already included at the queried commitment. */
    status?: { Ok?: unknown; Err?: unknown };
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  confirmationStatus?: "processed" | "confirmed" | "finalized";
}

/** The Solana Pay reference keys embedded in the transaction, if any
 *  (jsonParsed accountKeys + memo instruction payloads). */
function extractedReferences(tx: SolanaTx): string[] {
  const refs: string[] = [];
  const keys = tx.transaction?.message?.accountKeys ?? [];
  for (const key of keys) {
    const pubkey = typeof key === "string" ? key : key.pubkey;
    if (pubkey) refs.push(pubkey);
  }
  for (const ix of tx.transaction?.message?.instructions ?? []) {
    if (ix.program === "spl-memo" || ix.program === "memo") {
      if (ix.data) refs.push(ix.data);
      if (ix.memo) refs.push(ix.memo);
    }
  }
  return refs;
}

/** Sum of atomic-unit deltas for post balances matching mint + owner.
 *  BigInt only — no floating point touches payment logic (spec §38). */
function receivedAtomic(
  pre: TokenBalance[],
  post: TokenBalance[],
  mint: string,
  owner: string
): bigint {
  const preByIndex = new Map(pre.map((b) => [b.accountIndex, b]));
  let total = BigInt(0);
  for (const entry of post) {
    if (entry.mint !== mint || entry.owner !== owner) continue;
    const before = preByIndex.get(entry.accountIndex);
    const beforeAmt = BigInt(before?.uiTokenAmount?.amount ?? "0");
    const afterAmt = BigInt(entry.uiTokenAmount?.amount ?? "0");
    if (afterAmt > beforeAmt) total += afterAmt - beforeAmt;
  }
  return total;
}

function anyUsdcMoved(pre: TokenBalance[], post: TokenBalance[]): boolean {
  const preByIndex = new Map(pre.map((b) => [b.accountIndex, b]));
  return post.some((entry) => {
    if (entry.mint !== SOLANA_USDC_MINT) return false;
    const before = preByIndex.get(entry.accountIndex);
    const beforeAmt = BigInt(before?.uiTokenAmount?.amount ?? "0");
    return BigInt(entry.uiTokenAmount?.amount ?? "0") > beforeAmt;
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  let body: VerifyRequestBody = {};
  try {
    body = (await req.json()) as VerifyRequestBody;
  } catch {
    body = {};
  }

  const requestId = (body.requestId ?? "").trim();
  const signature = (body.signature ?? "").trim();

  if (!requestId || !signature) {
    return NextResponse.json(
      { status: "bad_request" as PaymentVerifyStatus, message: "Invalid verification request." },
      { status: 400 }
    );
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    return NextResponse.json(
      { status: "bad_request" as PaymentVerifyStatus, message: "Malformed transaction signature." },
      { status: 400 }
    );
  }

  /* The request must exist, belong to the caller, and still be payable. */
  const paymentRequest = await db.paymentRequest.findUnique({ where: { id: requestId } });
  if (!paymentRequest || paymentRequest.userId !== user.id) {
    return NextResponse.json(
      { status: "bad_request" as PaymentVerifyStatus, message: "Unknown payment request." },
      { status: 400 }
    );
  }
  if (paymentRequest.status === "confirmed") {
    return NextResponse.json({
      status: "already_used" as PaymentVerifyStatus,
      message: "This payment request has already been settled.",
      solscanUrl: paymentRequest.signature ? solscanTxUrl(paymentRequest.signature) : undefined,
    });
  }
  if (paymentRequest.status !== "awaiting_payment" || paymentRequest.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({
      status: "expired" as PaymentVerifyStatus,
      message: "This payment request expired. Restart the request, then pay again.",
    });
  }

  /* Duplicate consumption across ALL requests (spec §57) — DB-backed, so a
   * server restart cannot re-admit a spent transaction. */
  const spent = await db.membershipClaim.findUnique({ where: { signature } });
  if (spent) {
    return NextResponse.json({
      status: "already_used" as PaymentVerifyStatus,
      message: "This transaction has already been used for a membership.",
      solscanUrl: solscanTxUrl(signature),
    });
  }

  /* Amount is server-derived from the SKU map — never client-supplied (§53). */
  const sku = paymentRequest.sku as IndividualMembershipSku;
  const skuRow = MEMBERSHIP_SKUS[sku];
  if (!skuRow) {
    return NextResponse.json(
      { status: "bad_request" as PaymentVerifyStatus, message: "Unknown SKU on the payment request." },
      { status: 400 }
    );
  }
  const requiredAtomic = BigInt(skuRow.atomicUsdcAmount);

  let tx: SolanaTx | null;
  try {
    tx = await getTransaction(signature);
  } catch (err) {
    if (err instanceof RpcInvalidParam) {
      return NextResponse.json(
        {
          status: "bad_request" as PaymentVerifyStatus,
          message: "Malformed transaction signature.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        status: "rpc_unavailable" as PaymentVerifyStatus,
        message: "The Solana network is not reachable right now. Try again shortly.",
      },
      { status: 502 }
    );
  }

  if (!tx) {
    return NextResponse.json({
      status: "not_found" as PaymentVerifyStatus,
      message:
        "No transaction found for this signature yet. If you just paid, wait a few seconds and verify again.",
      solscanUrl: solscanTxUrl(signature),
    });
  }

  if (tx.meta?.err) {
    return NextResponse.json({
      status: "failed" as PaymentVerifyStatus,
      message: "This transaction failed on the Solana network.",
      solscanUrl: solscanTxUrl(signature),
    });
  }

  /* Finality policy (§37). Some RPC responses omit the top-level
   * confirmationStatus — meta.status.Ok then proves the transaction landed
   * successfully in a block at the queried (confirmed) commitment. */
  const statusOk =
    tx.confirmationStatus === "confirmed" ||
    tx.confirmationStatus === "finalized" ||
    (!tx.confirmationStatus && !!tx.meta?.status && "Ok" in tx.meta.status);

  if (!statusOk) {
    return NextResponse.json({
      status: "confirming" as PaymentVerifyStatus,
      message: "Payment detected — still confirming on the network.",
      solscanUrl: solscanTxUrl(signature),
    });
  }

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  const usdcMoved = anyUsdcMoved(pre, post);
  const received = receivedAtomic(pre, post, SOLANA_USDC_MINT, TREASURY_ADDRESS);

  const payload = {
    solscanUrl: solscanTxUrl(signature),
    requiredAtomic: requiredAtomic.toString(),
  };

  if (received === BigInt(0)) {
    return NextResponse.json({
      ...payload,
      status: (usdcMoved ? "wrong_recipient" : "wrong_asset") as PaymentVerifyStatus,
      message: usdcMoved
        ? "USDC was received, but not at the Cloak treasury address for this request."
        : "No native USDC on Solana was found in this transaction.",
    });
  }

  /* Reference-key attribution (§16 Option B): automated activation requires
   * THIS request's reference key in the transaction. A public treasury
   * address + exact amount is not enough proof of request ownership. */
  const refs = extractedReferences(tx);
  if (refs.length === 0) {
    return NextResponse.json({
      ...payload,
      status: "missing_reference" as PaymentVerifyStatus,
      message:
        "This transaction did not include the payment request reference. Automated activation requires the request-specific Solana Pay reference.",
      solscanUrl: solscanTxUrl(signature),
    });
  }
  if (!refs.includes(paymentRequest.reference)) {
    return NextResponse.json({
      ...payload,
      status: "wrong_reference" as PaymentVerifyStatus,
      message:
        "This transaction belongs to a different payment request. Verify the signature copied from the transaction you paid for this checkout.",
      solscanUrl: solscanTxUrl(signature),
    });
  }

  if (received < requiredAtomic) {
    return NextResponse.json({
      ...payload,
      status: "underpaid" as PaymentVerifyStatus,
      receivedAtomic: received.toString(),
      message:
        "Payment received. The amount is lower than required. Membership has not been activated.",
    });
  }

  if (received > requiredAtomic) {
    return NextResponse.json({
      ...payload,
      status: "overpaid" as PaymentVerifyStatus,
      receivedAtomic: received.toString(),
      message: "Payment received above the requested amount. Your payment is being reviewed.",
    });
  }

  /* Exact payment — claim issuance + entitlement in one atomic transaction
   * (spec §57: payment confirmed -> claim issued once; claim redeemed ->
   * entitlement granted once). The UNIQUE(signature) constraint is the
   * race-proof idempotency guard. */
  const tier = skuRow.membership;
  try {
    const entitlement = await db.$transaction(async (txDb) => {
      await txDb.paymentRequest.update({
        where: { id: paymentRequest.id, status: "awaiting_payment" },
        data: { status: "confirmed", signature },
      });
      await txDb.membershipClaim.create({
        data: {
          signature,
          sku,
          membership: tier,
          status: "redeemed",
          paymentRequestId: paymentRequest.id,
          redeemedByUserId: user.id,
          redeemedAt: new Date(),
        },
      });
      await grantMembership(txDb, user.id, tier, "direct_usdc");
      if (tier === "reserve") {
        await ensureReservePasses(txDb, user.id);
      }
      const updated = await txDb.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          membershipTier: true,
          membershipOrigin: true,
          membershipGrantedAt: true,
        },
      });
      return entitlementForUser(updated);
    });

    return NextResponse.json({
      ...payload,
      status: "confirmed" as PaymentVerifyStatus,
      message: "Payment confirmed.",
      entitlement,
    });
  } catch (err) {
    /* The signature raced into a claim from another request — it is spent. */
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({
        status: "already_used" as PaymentVerifyStatus,
        message: "This transaction has already been used for a membership.",
        solscanUrl: solscanTxUrl(signature),
      });
    }
    console.error("[payments/verify] settlement failed:", err);
    return NextResponse.json(
      {
        status: "rpc_unavailable" as PaymentVerifyStatus,
        message: "The payment could not be settled. Nothing was charged twice — try again.",
      },
      { status: 500 }
    );
  }
}
