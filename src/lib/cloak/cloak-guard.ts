/*
 * Cloaq Mode protection (user feedback round 4).
 *
 * Turning Cloaq Mode OFF can require verification: a device PIN or the
 * platform biometric authenticator (WebAuthn user verification — Face ID,
 * Touch ID, Windows Hello). Turning it ON never requires verification.
 *
 * Design notes:
 * - The PIN is stored only as a SHA-256 hex hash, never in plain text.
 * - Biometric enrollment stores only the credential ID; the private key
 *   never leaves the device authenticator. Verification is a local
 *   WebAuthn get() assertion with userVerification: "required".
 * - This is deliberately client-side: Cloaq Mode is a device-local
 *   privacy control, not an identity system.
 */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

/** 4–8 digits. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

/** SHA-256 hex hash, or null when the platform lacks Web Crypto. */
export async function sha256Hex(input: string): Promise<string | null> {
  const g = typeof globalThis !== "undefined" ? globalThis : undefined;
  const cryptoObj = g && "crypto" in g ? (g as { crypto?: Crypto }).crypto : undefined;
  if (!cryptoObj?.subtle) return null;
  const data = new TextEncoder().encode(input);
  const digest = await cryptoObj.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa === "function") {
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Whether a platform biometric authenticator (with user verification) exists. */
export async function biometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !("PublicKeyCredential" in window)) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export type BiometricEnrollResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string };

/** Register a platform credential for Cloaq Mode verification. */
export async function enrollBiometric(): Promise<BiometricEnrollResult> {
  try {
    if (typeof window === "undefined" || !window.isSecureContext) {
      return { ok: false, error: "Biometrics require a secure (https) context." };
    }
    if (!(await biometricAvailable())) {
      return {
        ok: false,
        error: "No biometric authenticator is available on this device or browser.",
      };
    }
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "Cloaq" },
        user: {
          id: randomBytes(16),
          name: "cloak-local-user",
          displayName: "Cloak user",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
        timeout: 60_000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;

    if (!credential) return { ok: false, error: "Enrollment was cancelled." };
    return { ok: true, credentialId: toBase64Url(new Uint8Array(credential.rawId)) };
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "NotAllowedError"
        ? "Enrollment was cancelled or timed out."
        : "This device could not complete biometric enrollment.";
    return { ok: false, error: message };
  }
}

/** Verify against the enrolled platform credential (local user verification). */
export async function verifyBiometric(credentialId: string): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !window.isSecureContext) return false;
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: window.location.hostname,
        allowCredentials: [{ id: fromBase64Url(credentialId), type: "public-key" }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}
