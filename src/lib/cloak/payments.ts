/*
 * Direct settlement payment domain (USDC direct-settlement spec §4, §14-§18,
 * §30, §38, §52, §53, §65).
 *
 * Primary individual settlement rail: native USDC on Solana.
 * Base is architecturally represented but DISABLED until its verifier is
 * implemented and tested (spec §31). TRON is intentionally absent (§33).
 *
 * This module is client-safe: it contains only PUBLIC receiving details.
 * Treasury private keys, seeds, and RPC secrets never live here (§65) —
 * server-only configuration belongs in the verify route / environment.
 *
 * Token identifiers were verified against Circle's public USDC contract
 * address documentation on 2026-09-16. Re-check during payment incidents,
 * network additions, or verifier changes.
 */

export type SettlementMethod =
  | "usdc_solana"
  | "usdc_base"
  | "bank_transfer"
  | "invoice"
  | "contract";

export type SettlementNetwork = "solana" | "base";

export interface SupportedPaymentAsset {
  id: string;
  symbol: "USDC";
  network: SettlementNetwork;
  /** EIP-155 chain id — Base only. */
  chainId?: number;
  /** Native Circle-issued USDC identifier (SPL mint / EVM contract). */
  tokenAddressOrMint: string;
  decimals: number;
  enabled: boolean;
  recommended?: boolean;
}

/* Native Circle-issued USDC, Solana mainnet. Never accept lookalike tokens
 * (§4, §32). */
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* Native Circle-issued USDC, Base mainnet. DISABLED — bridged USDbC and
 * wrapped variants are never accepted (spec §31-§32). */
export const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const SUPPORTED_PAYMENT_ASSETS: SupportedPaymentAsset[] = [
  {
    id: "usdc-solana",
    symbol: "USDC",
    network: "solana",
    tokenAddressOrMint: SOLANA_USDC_MINT,
    decimals: 6,
    enabled: true,
    recommended: true,
  },
  {
    id: "usdc-base",
    symbol: "USDC",
    network: "base",
    chainId: 8453,
    tokenAddressOrMint: BASE_USDC_CONTRACT,
    decimals: 6,
    enabled: false,
  },
];

/** Public treasury receiving address (spec §65: public receiving details may
 *  be sent to the client; keys and seeds never). */
export const TREASURY_ADDRESS = "Ee2B86BwFTixe7QzKAySFvViZ5AyjFCjcpQz5uMAxYaQ";

/** Static marketing QR distributed by Cloak — address only, never enough for
 *  automated membership activation without a request reference. */
export const TREASURY_QR_SRC = "/usdc-solana-qr.webp";

/* ---------- Pricing / SKU map (spec §1, §52, §53) ----------
 * Server derives amounts from SKUs — the client never supplies an amount.
 * USDC uses 6 decimals; authoritative math uses atomic integer strings (§38):
 *   499 USDC  = 499000000
 *   2500 USDC = 2500000000
 */
export type IndividualMembershipSku = "private" | "reserve";

export const MEMBERSHIP_SKUS: Record<
  IndividualMembershipSku,
  { membership: IndividualMembershipSku; atomicUsdcAmount: string }
> = {
  private: { membership: "private", atomicUsdcAmount: "499000000" },
  reserve: { membership: "reserve", atomicUsdcAmount: "2500000000" },
};

/** Payment requests expire (spec §15). */
export const PAYMENT_REQUEST_EXPIRY_MINUTES = 30;

/* ---------- Formatting (atomic-string safe, no floats — §38) ---------- */

/** "499000000" -> "499" · "2500000000" -> "2,500". Pure string math. */
export function formatUsdcFromAtomic(atomic: string): string {
  const digits = atomic.replace(/^0+(?=\d)/, "").padStart(7, "0");
  const whole = digits.slice(0, digits.length - 6).replace(/^0+(?=\d)/, "");
  const frac = digits.slice(digits.length - 6).replace(/0+$/, "");
  const grouped = Number(whole).toLocaleString("en-US");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Display amount for a SKU, e.g. "499" or "2,500". */
export function skuDisplayAmount(sku: IndividualMembershipSku): string {
  return formatUsdcFromAtomic(MEMBERSHIP_SKUS[sku].atomicUsdcAmount);
}

/* ---------- Payment URIs and explorer links (spec §17) ---------- */

/** Base58 (Bitcoin alphabet) — encodes the 32-byte Solana Pay reference key.
 *  Small, dependency-free, used server-side when building payment requests. */
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const digit of digits) out += BASE58_ALPHABET[digit];
  /* Leading zero bytes encode as "1"s. */
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out = "1" + out;
  return out;
}

/** Solana Pay transfer request URI — opens a pre-filled transfer in a
 *  compatible wallet: solana:<recipient>?amount=<ui>&spl-token=<mint>
 *  [&reference=<pubkey>] — the reference key embeds server attribution into
 *  the transaction itself (spec §16 Option B) when the payer's wallet
 *  honors it. Automated activation requires the reference key; address-only
 *  transfers must be reviewed manually because the treasury account is public. */
export function solanaPayUri(amountUi: string, reference?: string): string {
  const params = new URLSearchParams({ amount: amountUi, "spl-token": SOLANA_USDC_MINT });
  if (reference) params.set("reference", reference);
  return `solana:${TREASURY_ADDRESS}?${params.toString()}`;
}

/** Human-readable transaction view on Solscan (public explorer). */
export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

/** Solscan account view for the treasury (public explorer). */
export function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${address}`;
}

/** Solana transaction signatures are base58, 64-88 chars. */
export function isValidTxSignature(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value.trim());
}
