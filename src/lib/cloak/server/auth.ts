import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

/* ---------- Password hashing (scrypt) ---------- */

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
  })) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = (await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
      N: SCRYPT_COST,
    })) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/* ---------- Sessions ---------- */

export const SESSION_COOKIE = "cloak_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function canBindDeviceToUser(userId: string, deviceId: string): Promise<boolean> {
  const revoked = await db.deviceRevocation
    .findUnique({ where: { deviceId } })
    .catch(() => null);
  if (revoked) return false;
  const existing = await db.device
    .findUnique({ where: { id: deviceId }, select: { userId: true } })
    .catch(() => null);
  return !existing || existing.userId === userId;
}

async function refreshDeviceCredential(
  userId: string,
  deviceId: string,
  deviceName?: string,
  deviceToken?: string
): Promise<boolean> {
  if (!(await canBindDeviceToUser(userId, deviceId))) return false;
  if (!deviceToken) return true;
  await db.device.upsert({
    where: { id: deviceId },
    update: { tokenHash: hashToken(deviceToken), name: deviceName, lastSeenAt: new Date() },
    create: { id: deviceId, userId, name: deviceName, tokenHash: hashToken(deviceToken) },
  }).catch(() => undefined);
  return true;
}

export async function createSession(
  userId: string,
  deviceId?: string,
  deviceName?: string,
  deviceToken?: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const bindDevice = deviceId
    ? await refreshDeviceCredential(userId, deviceId, deviceName, deviceToken)
    : false;
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      deviceId: bindDevice ? deviceId : null,
      deviceName: bindDevice ? deviceName || null : null,
    },
  });
  return { token, expiresAt };
}

/** Bind (or re-bind) a deviceId + credential to the caller's session —
 *  used by bootstrap for sessions created before the registry existed. */
export async function bindSessionDevice(
  req: NextRequest,
  deviceId: string,
  deviceName?: string,
  deviceToken?: string
): Promise<boolean> {
  const session = await sessionFromRequest(req);
  if (!session) return false;
  if (session.deviceId && session.deviceId !== deviceId) return true; // already bound — never steal
  const deviceNameToStore = session.deviceName ?? deviceName ?? null;
  const canBind = await refreshDeviceCredential(
    session.userId,
    deviceId,
    deviceNameToStore ?? undefined,
    deviceToken
  );
  if (!canBind) return false;
  await db.session
    .update({
      where: { id: session.id },
      data: { deviceId, deviceName: deviceNameToStore },
    })
    .catch(() => undefined);
  return true;
}

export const DEVICE_ID_HEADER = "x-cloak-device-id";
export const DEVICE_TOKEN_HEADER = "x-cloak-device-token";

export interface DeviceAuthContext {
  device: { id: string; userId: string; name: string | null; revokedAt: Date | null };
  revoked: boolean;
}

/** Device-scoped authentication (dagger codex §19): the hashed device
 *  token identifies the INSTALL, not the user session — it keeps working
 *  after a Remote Dagger destroys the device's sessions, so the target can
 *  fetch its queued local-wipe command on reconnect. */
export async function authenticateDevice(req: NextRequest): Promise<DeviceAuthContext | null> {
  const deviceId = req.headers.get(DEVICE_ID_HEADER);
  const deviceToken = req.headers.get(DEVICE_TOKEN_HEADER);
  if (!deviceId || !deviceToken) return null;
  const device = await db.device.findUnique({ where: { id: deviceId } });
  if (!device) return null;
  /* Verify: SHA-256(provided token) must equal the stored hash. */
  const providedHash = Buffer.from(hashToken(deviceToken));
  const storedHash = Buffer.from(device.tokenHash);
  if (providedHash.length !== storedHash.length || !timingSafeEqual(providedHash, storedHash)) {
    return null;
  }
  const revokedRow = await db.deviceRevocation
    .findUnique({ where: { deviceId } })
    .catch(() => null);
  void db.device
    .update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
  return {
    device: {
      id: device.id,
      userId: device.userId,
      name: device.name,
      revokedAt: revokedRow?.revokedAt ?? null,
    },
    revoked: !!revokedRow,
  };
}

async function sessionFromRequest(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return db.session.findUnique({ where: { tokenHash: hashToken(token) } });
}

export interface SessionUser {
  id: string;
  handle: string;
  displayName: string;
  about: string | null;
  membershipTier: string | null;
  membershipOrigin: string | null;
  membershipGrantedAt: Date | null;
}

/** Resolve the current user from the session cookie, or null.
 *  Dagger enforcement (codex §16): a session whose device has been revoked
 *  (Dagger or manual revoke) is deleted on sight — the device can no longer
 *  refresh a session, fetch messages, or query account AI data. */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    void db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (session.deviceId) {
    const revoked = await db.deviceRevocation
      .findUnique({ where: { deviceId: session.deviceId } })
      .catch(() => null);
    if (revoked) {
      void db.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
  }
  /* Sliding freshness stamp — never blocks the request. */
  void db.session
    .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return {
    id: session.user.id,
    handle: session.user.handle,
    displayName: session.user.displayName,
    about: session.user.about,
    membershipTier: session.user.membershipTier,
    membershipOrigin: session.user.membershipOrigin,
    membershipGrantedAt: session.user.membershipGrantedAt,
  };
}

export async function destroySession(req: NextRequest): Promise<void> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  await db.session
    .deleteMany({ where: { tokenHash: hashToken(token) } })
    .catch(() => undefined);
}

export interface ServerDevice {
  deviceId: string;
  name: string;
  addedAt: string;
  lastActive: string;
  current: boolean;
}

/** Trusted-devices list (dagger codex §24): active sessions grouped by
 *  bound deviceId. Legacy sessions without a binding surface as their own
 *  un-manageable entry so the count stays honest. */
export async function listDevices(req: NextRequest): Promise<ServerDevice[]> {
  const session = await sessionFromRequest(req);
  if (!session) return [];
  const sessions = await db.session.findMany({
    where: { userId: session.userId, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
  });
  const byDevice = new Map<string, { name: string; addedAt: Date; lastActive: Date; sessionIds: string[] }>();
  const unbound: { addedAt: Date; lastActive: Date }[] = [];
  for (const s of sessions) {
    if (s.deviceId) {
      const existing = byDevice.get(s.deviceId);
      if (existing) {
        existing.lastActive = existing.lastActive.getTime() > s.lastUsedAt.getTime() ? existing.lastActive : s.lastUsedAt;
        existing.sessionIds.push(s.id);
      } else {
        byDevice.set(s.deviceId, {
          name: s.deviceName ?? "Unrecognized device",
          addedAt: s.createdAt,
          lastActive: s.lastUsedAt,
          sessionIds: [s.id],
        });
      }
    } else {
      unbound.push({ addedAt: s.createdAt, lastActive: s.lastUsedAt });
    }
  }
  const devices: ServerDevice[] = [...byDevice.entries()].map(([deviceId, d]) => ({
    deviceId,
    name: d.name,
    addedAt: d.addedAt.toISOString(),
    lastActive: d.lastActive.toISOString(),
    current: deviceId === session.deviceId,
  }));
  unbound.forEach((u, i) =>
    devices.push({
      deviceId: `legacy-${session.id}-${i}`,
      name: "Unrecognized device",
      addedAt: u.addedAt.toISOString(),
      lastActive: u.lastActive.toISOString(),
      current: false,
    })
  );
  return devices;
}

/* ---------- Cookie helpers ---------- */

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return req.nextUrl.protocol === "https:";
}

/* ---------- Login rate limiting (per IP, in-memory) ---------- */

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function clearLoginRateLimit(ip: string): void {
  attempts.delete(ip);
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/* ---------- Dev account seeding (idempotent) ---------- */

const DEV_PASSWORD = "vault-key-9x";
const DEV_ACCOUNTS = [
  { handle: "aurora", displayName: "Aurora", about: "Cloak member" },
  { handle: "blake", displayName: "Blake", about: "Cloak member" },
  { handle: "charlie", displayName: "Charlie", about: "Cloak member" },
];

/**
 * Ensures the dev test identities exist with the shared dev passphrase and
 * aurora+blake share a seeded conversation. Runs on login/me only when dev
 * activation is enabled — upserts are no-ops once every account exists.
 */
export async function ensureDevAccounts(): Promise<void> {
  if (process.env.CLOAK_ALLOW_DEV_ACTIVATION !== "1") return;
  try {
    const passwordHash = await hashPassword(DEV_PASSWORD);
    const users: { id: string }[] = [];
    let missing = false;
    for (const account of DEV_ACCOUNTS) {
      const existing = await db.user.findUnique({ where: { handle: account.handle } });
      if (!existing) missing = true;
      const user = await db.user.upsert({
        where: { handle: account.handle },
        update: {},
        create: { ...account, passwordHash },
      });
      users.push(user);
    }
    if (!missing) return; // fully seeded — skip the conversation probe below

    const candidates = await db.conversation.findMany({
      where: {
        isGroup: false,
        participations: { some: { userId: users[0].id } },
      },
      include: { participations: true },
    });
    const existingConv = candidates.find(
      (c) =>
        c.participations.length === 2 &&
        c.participations.some((p) => p.userId === users[1].id)
    );
    if (existingConv) return;

    const now = Date.now();
    const conversation = await db.conversation.create({
      data: { isGroup: false },
    });
    for (const user of users) {
      await db.participation.create({
        data: { conversationId: conversation.id, userId: user.id },
      });
    }
    await db.message.createMany({
      data: [
        {
          conversationId: conversation.id,
          authorId: users[0].id,
          body: "Aurora here. Cloak is live.",
          createdAt: new Date(now - 1000 * 60 * 6),
        },
        {
          conversationId: conversation.id,
          authorId: users[1].id,
          body: "Blake confirmed. Keys look good on my side.",
          createdAt: new Date(now - 1000 * 60 * 4),
        },
      ],
    });
  } catch {
    /* Seeding must never break auth — the login route reports real errors. */
  }
}
