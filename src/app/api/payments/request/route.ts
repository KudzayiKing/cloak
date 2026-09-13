import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  base58Encode,
  MEMBERSHIP_SKUS,
  PAYMENT_REQUEST_EXPIRY_MINUTES,
  skuDisplayAmount,
  solanaPayUri,
  TREASURY_ADDRESS,
  type IndividualMembershipSku,
} from "@/lib/cloak/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/payments/request — open a payment request (settlement spec
 * §14-§17). The server derives the exact amount from the SKU map (§53 — the
 * client never supplies a payable amount), mints a unique 32-byte reference
 * key (§16 Option B) that rides along in the Solana Pay URI, and stamps a
 * 30-minute expiry (§15). The response also carries a request-scoped QR
 * (the Solana Pay URI pre-fills amount + token + reference in a scanning
 * wallet). If QR generation fails, the Solana Pay URI is still returned
 * so the request reference stays available for verification.
 */

interface RequestBody {
  sku?: string;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }
  const sku =
    body.sku === "private" || body.sku === "reserve" ? (body.sku as IndividualMembershipSku) : null;
  if (!sku) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  /* Fresh state: settle stale awaiting_payment requests as expired so the
   * expiry view never lies about what is still payable. */
  await db.paymentRequest.updateMany({
    where: {
      status: "awaiting_payment",
      expiresAt: { lte: new Date() },
      ...(user ? { userId: user.id } : { userId: null }),
    },
    data: { status: "expired" },
  });

  if (user) {
    const full = await db.user.findUnique({
      where: { id: user.id },
      select: { membershipTier: true },
    });
    if (full?.membershipTier) {
      return NextResponse.json(
        {
          ok: false,
          error: "already_member",
          message: "This account already holds an active membership.",
        },
        { status: 409 }
      );
    }
  }

  const skuRow = MEMBERSHIP_SKUS[sku];
  const amountDisplay = skuDisplayAmount(sku);
  const reference = base58Encode(new Uint8Array(await crypto.getRandomValues(new Uint8Array(32))));
  const expiresAt = new Date(Date.now() + PAYMENT_REQUEST_EXPIRY_MINUTES * 60 * 1000);

  const created = await db.paymentRequest.create({
    data: {
      userId: user?.id ?? null,
      sku,
      amountAtomic: skuRow.atomicUsdcAmount,
      reference,
      expiresAt,
    },
  });

  const payUri = solanaPayUri(amountDisplay.replace(/,/g, ""), reference);
  let payQrDataUrl: string | null = null;
  try {
    payQrDataUrl = await QRCode.toDataURL(payUri, {
      margin: 1,
      width: 512,
      errorCorrectionLevel: "M",
    });
  } catch {
    payQrDataUrl = null; // the static treasury QR + copyable address remain the fallback
  }

  return NextResponse.json({
    ok: true,
    request: {
      id: created.id,
      sku,
      reference,
      amountAtomic: skuRow.atomicUsdcAmount,
      amountDisplay,
      address: TREASURY_ADDRESS,
      payUri,
      payQrDataUrl,
      expiresAt: expiresAt.getTime(),
    },
  });
}
