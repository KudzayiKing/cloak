/*
 * Cloak runtime configuration.
 *
 * Everything an operator needs to change lives here or in environment
 * variables — no secrets belong in this file or the client bundle (spec §35).
 */

/* ---------- Membership pricing (single source of truth) ----------
 *
 * The commercial model (pricing & membership update spec §1, §66):
 *
 *   Cloaq Private          $499      one-time individual membership
 *   Cloaq Reserve          $2,500    one-time higher-assurance membership
 *                                    incl. 10 Cloaq Private membership grants
 *   Cloaq Private Circle   from $10,000      consultative
 *   Cloaq Office           from $15,000/year organizational, annual
 *   Cloaq Sovereign        custom            private deployment
 *
 * Reserve Concierge ($5,000) is an optional Reserve service, not a primary plan.
 *
 * Naming (owner decision, 2026-09): the $2,500 tier is "Reserve" everywhere —
 * display AND internal type ("reserve"). The old "black" vocabulary is fully
 * retired; no persisted client state ever depended on it.
 */
export const MEMBERSHIP_NAMES = {
  private: "Cloaq Private",
  reserve: "Cloaq Reserve",
  privateCircle: "Cloaq Private Circle",
  office: "Cloaq Office",
  sovereign: "Cloaq Sovereign",
} as const;

export const CLOAK_PRICING = {
  private: {
    amount: 499,
    currency: "USD",
    billing: "one_time",
  },
  reserve: {
    amount: 2500,
    currency: "USD",
    billing: "one_time",
    includedPrivatePasses: 10,
  },
  privateCircle: {
    startingAt: 10000,
    currency: "USD",
    billing: "custom",
  },
  office: {
    startingAt: 15000,
    currency: "USD",
    billing: "annual",
  },
  sovereign: {
    billing: "custom",
  },
  reserveConcierge: {
    amount: 5000,
    currency: "USD",
    billing: "one_time",
  },
} as const;

/** Pending Reserve guest invitations expire after this many days (spec §13). */
export const RESERVE_GUEST_INVITE_EXPIRY_DAYS = 7;

/** Acquisition mode is configurable — never hardwire scarcity (spec §34). */
export const ACCESS_ACQUISITION_MODE: "direct_purchase" | "request_access" | "invite_only" =
  "direct_purchase";

/** "$499" / "$2,500" / "$10,000" — display formatting for whole USD amounts. */
export function formatUSD(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export const BRAND = {
  name: "Cloaq",
  uppercaseName: "CLOAQ",
  baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://cloaq.app",
  ai: "Cloaq Intelligence",
  cloakMode: "Cloaq Mode",
  ghostChat: "Ghost Chat",
  cloakId: "Cloaq ID",
  membership: "Membership",
  cloakPrivate: "Cloaq Private",
  cloakReserve: MEMBERSHIP_NAMES.reserve,
  securityCentre: "Security Centre",
  tagline: "Private communications. Private intelligence.",
} as const;

export const APP_URL = BRAND.baseUrl;

export function appUrl(path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalized, APP_URL).toString();
}

/* ---------- Security audit status (review spec §7) ----------
 *
 * Public copy must reflect reality. Never claim an audit that does not
 * exist. Allowed values and their public wording:
 *
 *   not_started -> not shown as a trust item
 *   planned     -> "Independent security assessment — Planned"
 *   in_progress -> "Independent security assessment — In progress"
 *   completed   -> "Independently assessed — View report"
 */
export type SecurityAuditStatus = "not_started" | "planned" | "in_progress" | "completed";

export const SECURITY_AUDIT_STATUS: SecurityAuditStatus = "planned";

/*
 * Model manifest configuration (spec §3, §49).
 *
 * Model artifacts live in the owner's Cloudflare R2 bucket and are delivered
 * via a public custom domain or short-lived authorized URLs produced by
 * backend logic. The browser never receives R2 access keys.
 *
 * Provide URLs through environment variables:
 *   NEXT_PUBLIC_CLOAK_MODEL_GEMMA_URL
 *   NEXT_PUBLIC_CLOAK_MODEL_EMBEDDING_URL
 *   NEXT_PUBLIC_CLOAK_MODEL_TRANSLATION_URL
 *
 * Required R2/custom-domain CORS for the Cloak origin when fetching directly:
 *   AllowedOrigins: https://<cloak-origin>
 *   AllowedMethods: GET
 *   AllowedHeaders: Range, If-Match
 *   ExposeHeaders:  Content-Length, Content-Range, ETag
 */
export interface ModelManifestConfig {
  gemma: ModelManifestEntry;
  embedding?: ModelManifestEntry;
  translation?: ModelManifestEntry;
}

export interface ModelManifestEntry {
  id: string;
  displayName: string;
  url?: string;
  sizeBytes?: number;
  version?: string;
  sha256?: string;
}

export const MODEL_MANIFEST: ModelManifestConfig = {
  gemma: {
    id: "gemma-4-e2b-it-qat",
    displayName: "Gemma 4 E2B IT QAT",
    /* Owner-provided R2 artifact (Sep 2026). The env var still wins so a
       different artifact can be swapped in without a code change. */
    url:
      process.env.NEXT_PUBLIC_CLOAK_MODEL_GEMMA_URL ??
      "https://pub-610daaff40ac42f18aa2de55bc3970b2.r2.dev/models/gemma-4-E2B-it-web.litertlm",
    // Content-Length verified via HEAD (2,008,432,640 bytes).
    sizeBytes: 2_008_432_640,
    version: "1.0.0",
  },
  embedding: {
    id: "embedding-gemma-web",
    displayName: "EmbeddingGemma",
    /* Artifact is a folder of ONNX files; the exact public URL is pending
       from the owner — left unset until then (honest state in the UI). */
    url: process.env.NEXT_PUBLIC_CLOAK_MODEL_EMBEDDING_URL,
    sizeBytes: 320_000_000,
    version: "1.0.0",
  },
  translation: {
    id: "translategemma-4b-it-int8-web",
    displayName: "TranslateGemma 4B IT (int8, web)",
    /* Owner-provided R2 artifact, MediaPipe LLM Inference web format
       (.task). Powers the long-press message translation — the model runs
       in the browser via WebGPU and is cached on-device (OPFS). */
    url:
      process.env.NEXT_PUBLIC_CLOAK_MODEL_TRANSLATION_URL ??
      "https://pub-610daaff40ac42f18aa2de55bc3970b2.r2.dev/models/translategemma-4b-it-int8-web.task",
    // Content-Length verified via HEAD (3,896,377,344 bytes).
    sizeBytes: 3_896_377_344,
    version: "1.0.0",
  },
};

/** Cloud fallback is a consent-gated, explicit opt-in — never silent (spec §7). */
export const CLOUD_FALLBACK_DEFAULT = false;

/** The orchestrator handles these intents deterministically before any LLM call. */
export const ORCHESTRATOR_TRIGGER = "@Cloaq";

export const SUPPORTED_PLATFORMS = [
  {
    platform: "iOS",
    detail: "Add to Home Screen from the Share menu",
  },
  {
    platform: "Android",
    detail: "Install from the Chrome install prompt",
  },
  {
    platform: "Desktop",
    detail: "Install from the address bar in Chromium browsers",
  },
] as const;
