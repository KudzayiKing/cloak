import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createNearbyIdentityProof,
  verifyNearbyIdentityProof,
} from "../src/lib/crypto/e2ee-orchestrator";
import { generateIdentityKeyPair } from "../src/lib/crypto/e2ee";
import {
  closeNearby,
  nearbyState,
  parseNearbySignal,
  TransportManager,
  type EncryptedEnvelope,
  type MessageTransport,
} from "../src/lib/cloak/transports";

type Check = { label: string; pass: boolean; detail?: string };
const checks: Check[] = [];
function check(label: string, actual: unknown, expected: unknown) {
  checks.push({ label, pass: actual === expected, detail: `got ${String(actual)}, want ${String(expected)}` });
}

const root = process.cwd();
const dagger = readFileSync(join(root, "src/lib/cloak/dagger.ts"), "utf8");
const worker = readFileSync(join(root, "public/sw.js"), "utf8");
const store = readFileSync(join(root, "src/stores/cloak-store.ts"), "utf8");
const cache = readFileSync(join(root, "src/lib/cloak/message-cache.ts"), "utf8");
const bubble = readFileSync(join(root, "src/components/cloak/messaging/message-bubble.tsx"), "utf8");
const sidebar = readFileSync(join(root, "src/components/cloak/messaging/chat-sidebar.tsx"), "utf8");
const mobileMenu = readFileSync(join(root, "src/components/cloak/navigation/mobile-header-menu.tsx"), "utf8");
const appShell = readFileSync(join(root, "src/components/cloak/navigation/app-shell.tsx"), "utf8");
const nearbyPage = readFileSync(join(root, "src/components/cloak/messaging/nearby-page.tsx"), "utf8");
const serverConversations = readFileSync(join(root, "src/lib/cloak/server/conversations.ts"), "utf8");

const message: EncryptedEnvelope = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  conversationId: "conversation-1",
  senderUserId: "user-1",
  createdAt: 1,
  kind: "text",
  ciphertext: "cloak-e2ee-envelope",
};
let internetAvailable = true;
let internetCalls = 0;
let nearbyCalls = 0;
const transport = (id: string, type: "internet" | "nearby", available: () => boolean, count: () => void): MessageTransport => ({
  id,
  type,
  async isAvailable() { return available(); },
  async sendEncryptedEnvelope(envelope) {
    check(`${type} receives the same stable envelope ID`, envelope.id, message.id);
    count();
    return { accepted: true, delivered: true };
  },
});

async function main() {
  const local = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
      removeItem: (key: string) => local.delete(key),
    },
  });
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  local.set("cloak-identity-alice", JSON.stringify({ publicKeyB64: alice.publicKeyB64, privateJwk: alice.privateKeyJwk }));
  local.set("cloak-identity-bob", JSON.stringify({ publicKeyB64: bob.publicKeyB64, privateJwk: bob.privateKeyJwk }));
  const proof = await createNearbyIdentityProof("alice", bob.publicKeyB64, "session-a", "transcript/proof-from-host");
  check("known contact can verify the ECDH identity proof", proof ? await verifyNearbyIdentityProof("bob", alice.publicKeyB64, "session-a", "transcript/proof-from-host", proof) : false, true);
  check("identity proof cannot be reflected across transcript roles", proof ? await verifyNearbyIdentityProof("bob", alice.publicKeyB64, "session-a", "transcript/proof-from-guest", proof) : false, false);
  check("wrong contact identity cannot verify the proof", proof ? await verifyNearbyIdentityProof("bob", (await generateIdentityKeyPair()).publicKeyB64, "session-a", "transcript/proof-from-host", proof) : false, false);

  const manager = new TransportManager();
  manager.register(transport("nearby", "nearby", () => true, () => { nearbyCalls += 1; }));
  manager.register(transport("internet", "internet", () => internetAvailable, () => { internetCalls += 1; }));

  check("internet is preferred when available", (await manager.preferred())?.type, "internet");
  internetAvailable = false;
  check("Nearby is selected when internet is unavailable", (await manager.preferred())?.type, "nearby");
  const delivered = await manager.deliver(message);
  check("delivery reports the selected route", delivered?.transport, "nearby");
  check("one logical event is sent on one route", internetCalls + nearbyCalls, 1);
  check("Nearby delivery preserves the full encrypted envelope", nearbyCalls, 1);

  const valid = JSON.stringify({ version: 1, kind: "offer", sessionId: "opaque", expiresAt: Date.now() + 1000, description: { type: "offer", sdp: "temporary" } });
  check("current session code parses", parseNearbySignal(valid).kind, "offer");
  let externalRouteRejected = false;
  try { parseNearbySignal(JSON.stringify({ version: 1, kind: "offer", sessionId: "opaque", expiresAt: Date.now() + 1000, description: { type: "offer", sdp: "a=candidate:1 1 udp 1 203.0.113.1 9 typ relay\r\n" } })); }
  catch { externalRouteRejected = true; }
  check("non-host WebRTC routes are rejected", externalRouteRejected, true);
  let expiredRejected = false;
  try { parseNearbySignal(JSON.stringify({ version: 1, kind: "offer", sessionId: "opaque", expiresAt: Date.now() - 1, description: { type: "offer", sdp: "temporary" } })); }
  catch { expiredRejected = true; }
  check("expired session code is rejected", expiredRejected, true);
  check("Dagger closes the Nearby session during key destruction", /closeNearby\(\)/.test(dagger), true);
  check("offline root can load its cached application shell", /cache\.match\("\/"\)/.test(worker) && /cache\.add\("\/"\)/.test(worker), true);
  check("the message store uses the shared transport manager", /transportManager\.deliver\(/.test(store), true);
  check("offline or locally connected sends skip online key-directory waits", /if \(networkMaintenanceAvailable\) await syncConversationKeys/.test(store), true);
  check("retryable internet failures fall back to Nearby with the same event", /classifySendFailure\(res\.status\) === "retryable"[\s\S]{0,120}?tryNearby\(\)/.test(store) && /signal: timeoutSignal\(5_000\)/.test(store), true);
  check("group membership IDs come from active server participations", /groupMemberIds: conv\.isGroup \? active\.map\(\(member\) => member\.userId\)/.test(serverConversations), true);
  check("group Nearby sends are limited to authenticated connected active members", /authorizedRecipientIds = nearbyConversation\?\.isGroup[\s\S]{0,300}?connectedPeerIds\.has\(userId\)/.test(store) && /!memberIds\?\.includes\(myUserId\)/.test(store), true);
  check("group Nearby reception checks cached membership for sender and receiver", /activeMemberIds\?\.includes\(myUserId\) \|\| !activeMemberIds\.includes\(envelope\.senderUserId\)/.test(store), true);
  check("Nearby fanout reports successful member acknowledgements", /new Set\(peers\.filter\([\s\S]{0,120}?results\[index\]/.test(readFileSync(join(root, "src/lib/cloak/transports.ts"), "utf8")), true);
  check("group Nearby bubbles show partial direct-delivery count", /Nearby · \$\{message\.nearbyDeliveredTo\?\.length[\s\S]{0,100}?nearbyRecipientCount/.test(bubble), true);
  check("Nearby messages persist sync-pending state", /message\.syncPending \? \{ syncPending: true \}/.test(cache), true);
  check("server synchronization preserves the Nearby route label", /function retainNearbyRoute\([\s\S]{0,220}?syncPending: false/.test(store), true);
  check("outgoing Nearby messages have a delivery indicator", /Delivered directly nearby/.test(bubble), true);
  check("Nearby is linked from the mobile overflow menu", /onClick=\{handleNearby\}[\s\S]{0,250}?WifiCogIcon/.test(mobileMenu), true);
  check("Nearby is linked between desktop notifications and settings", /NotificationsBell variant="rail"[\s\S]*?label: "Nearby"[\s\S]*?label: "Settings"/.test(appShell), true);
  check("Nearby is removed from the chat list and has no deploy-time feature flag", !/Nearby messaging/.test(sidebar) && !/NEXT_PUBLIC_NEARBY_MESSAGING_ENABLED/.test(sidebar + nearbyPage), true);
  closeNearby();
  check("connection teardown returns the transport to idle", nearbyState().status, "idle");

  for (const result of checks) console.log(`${result.pass ? "✓" : "✗"} ${result.label}${result.pass ? "" : ` (${result.detail})`}`);
  const failed = checks.filter((result) => !result.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} Nearby checks passed.`);
  if (failed.length) process.exitCode = 1;
}

void main();
