"use client";

import { createNearbyIdentityProof, verifyNearbyIdentityProof } from "@/lib/crypto/e2ee-orchestrator";

/**
 * Message transport contract. Message bodies handed to transports must already
 * be Cloak Dagger E2EE envelopes; a transport never receives plaintext or keys.
 * The relay and native transports are reserved for later implementations.
 */
export type TransportType = "internet" | "nearby" | "relay" | "native-nearby";

export interface EncryptedEnvelope {
  id: string;
  conversationId: string;
  senderUserId: string;
  createdAt: number;
  kind: string;
  ciphertext: string;
  /** Routing hint only. The sender store derives this from a server membership snapshot. */
  recipientUserIds?: string[];
}

export interface MessageTransport {
  readonly id: string;
  readonly type: TransportType;
  isAvailable(): Promise<boolean>;
  sendEncryptedEnvelope(envelope: EncryptedEnvelope): Promise<{
    accepted: boolean;
    delivered: boolean;
    deliveredUserIds?: string[];
    failedUserIds?: string[];
  }>;
}

/**
 * Select one route for an envelope. The caller owns message IDs and sync
 * reconciliation; the manager never retries the same event on a second route
 * after an ambiguous result, which avoids accidental duplicate delivery.
 */
export class TransportManager {
  private readonly transports = new Map<string, MessageTransport>();

  register(transport: MessageTransport) { this.transports.set(transport.id, transport); }
  unregister(id: string) { this.transports.delete(id); }

  async preferred(): Promise<MessageTransport | null> {
    const priority: TransportType[] = ["internet", "nearby", "relay", "native-nearby"];
    for (const type of priority) {
      for (const transport of this.transports.values()) {
        if (transport.type === type && await transport.isAvailable()) return transport;
      }
    }
    return null;
  }

  async deliver(envelope: EncryptedEnvelope): Promise<{
    transport: TransportType;
    accepted: boolean;
    delivered: boolean;
    deliveredUserIds?: string[];
    failedUserIds?: string[];
  } | null> {
    const route = await this.preferred();
    if (!route) return null;
    const result = await route.sendEncryptedEnvelope(envelope);
    return { transport: route.type, ...result };
  }
}

export interface NearbySignal {
  version: 1;
  kind: "offer" | "answer";
  sessionId: string;
  expiresAt: number;
  description: RTCSessionDescriptionInit;
}

const SESSION_TTL_MS = 8 * 60 * 1000;
const CHANNEL_NAME = "cloakdagger-nearby-v1";
const listeners = new Set<(state: NearbyState) => void>();
const envelopeListeners = new Set<(envelope: EncryptedEnvelope, peerUserId: string, sessionId: string) => void>();
const packetListeners = new Set<(packet: Record<string, unknown>) => void>();
const packetBuffer: Record<string, unknown>[] = [];
const pendingAcks = new Map<string, (accepted: boolean) => void>();

export interface NearbyState {
  status: "idle" | "connecting" | "authenticating" | "connected" | "failed";
  role?: "host" | "guest";
  sessionId?: string;
  conversationId?: string;
  peerUserId?: string;
  connectedPeers?: Array<{ conversationId: string; userId: string }>;
  expiresAt?: number;
  error?: string;
}

type NearbySession = {
  peer: RTCPeerConnection;
  channel: RTCDataChannel | null;
  role: "host" | "guest";
  expiresAt: number;
};
type AuthenticatedNearbyPeer = {
  sessionId: string;
  conversationId: string;
  userId: string;
  channel: RTCDataChannel;
};
const sessions = new Map<string, NearbySession>();
const authenticatedPeers = new Map<string, AuthenticatedNearbyPeer>();
let activeSessionId: string | null = null;
let current: NearbyState = { status: "idle" };

function publishSession(next: NearbyState) {
  publish({ ...next, connectedPeers: [...authenticatedPeers.values()].map(({ conversationId, userId }) => ({ conversationId, userId })) });
}

function publish(next: NearbyState) {
  current = next;
  for (const listener of listeners) listener(current);
}

export function nearbyState(): NearbyState {
  return current;
}

export function subscribeNearby(listener: (state: NearbyState) => void) {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}

function makePeer(role: "host" | "guest", sessionId: string, expiresAt: number) {
  const prior = sessions.get(sessionId);
  prior?.channel?.close();
  prior?.peer.close();
  if (typeof RTCPeerConnection === "undefined") throw new Error("This browser cannot create a secure local connection.");
  // No STUN/TURN service: V1 uses direct host candidates only and does not
  // depend on a PWA acting as an HTTP or WebSocket server.
  const peer = new RTCPeerConnection({ iceServers: [] });
  sessions.set(sessionId, { peer, channel: null, role, expiresAt });
  activeSessionId = sessionId;
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected" && activeSessionId === sessionId) publishSession({ status: "authenticating", role, expiresAt, sessionId });
    if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
      authenticatedPeers.delete(sessionId);
      sessions.delete(sessionId);
      if (peer.connectionState !== "closed" && activeSessionId === sessionId) publishSession({ status: "failed", role, expiresAt, sessionId, error: "The local connection was lost. Start a new session to try again." });
    }
  };
  peer.ondatachannel = (event) => bindChannel(sessionId, event.channel);
  return peer;
}

function bindChannel(sessionId: string, next: RTCDataChannel) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.channel = next;
  next.onopen = () => {
    if (activeSessionId === sessionId) publishSession({ status: "authenticating", role: session.role, expiresAt: session.expiresAt, sessionId });
  };
  next.onclose = () => {
    authenticatedPeers.delete(sessionId);
    sessions.delete(sessionId);
    if (activeSessionId === sessionId) publishSession({ status: "failed", role: session.role, expiresAt: session.expiresAt, sessionId, error: "The local connection was closed." });
  };
  next.onmessage = (event) => {
    if (typeof event.data !== "string" || event.data.length > 1_000_000) return;
    try {
      const packet = JSON.parse(event.data) as Record<string, unknown>;
      if (packet.type === "ack" && typeof packet.id === "string") {
        const key = `${sessionId}:${packet.id}`;
        const resolve = pendingAcks.get(key);
        if (resolve) { pendingAcks.delete(key); resolve(packet.accepted === true); }
        return;
      }
      const authenticated = authenticatedPeers.get(sessionId);
      if (packetListeners.size) for (const listener of packetListeners) listener({ ...packet, nearbyPeerUserId: authenticated?.userId });
      else if (packetBuffer.length < 32) packetBuffer.push(packet);
      if (packet.type !== "envelope") return;
      const envelope = packet.envelope as Partial<EncryptedEnvelope> | undefined;
      if (!envelope || typeof envelope.id !== "string" || typeof envelope.conversationId !== "string" || typeof envelope.senderUserId !== "string" || typeof envelope.createdAt !== "number" || typeof envelope.kind !== "string" || typeof envelope.ciphertext !== "string") return;
      // Transport parsing is not authorization. Consumers must verify the
      // sender identity and conversation access before persisting or rendering.
      if (!authenticated) return;
      for (const listener of envelopeListeners) listener(envelope as EncryptedEnvelope, authenticated.userId, sessionId);
    } catch {
      // Ignore malformed peer data; never log QR material or packet contents.
    }
  };
}

export function subscribeNearbyEnvelopes(listener: (envelope: EncryptedEnvelope, peerUserId: string, sessionId: string) => void) {
  envelopeListeners.add(listener);
  return () => { envelopeListeners.delete(listener); };
}

export function subscribeNearbyPackets(listener: (packet: Record<string, unknown>) => void) {
  packetListeners.add(listener);
  for (const packet of packetBuffer.splice(0)) listener(packet);
  return () => { packetListeners.delete(listener); };
}

function waitForPacket(type: string, sessionId: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { unsubscribe(); reject(new Error("Nearby identity verification timed out.")); }, timeoutMs);
    const unsubscribe = subscribeNearbyPackets((packet) => {
      if (packet.type !== type || packet.sessionId !== sessionId) return;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(packet);
    });
  });
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes));
}

/** Authenticate the other account against its already-known contact key. */
export async function authenticateNearbyPeer(input: {
  conversationId: string;
  myUserId: string;
  peerUserId: string;
  myPublicKeyB64: string;
  peerPublicKeyB64: string;
}): Promise<void> {
  if (current.status !== "authenticating" || !current.sessionId || !current.role) throw new Error("The local peer connection is not ready.");
  const sessionId = current.sessionId;
  const role = current.role;
  const nonce = randomNonce();
  const hello = { type: "hello", sessionId, conversationId: input.conversationId, userId: input.myUserId, publicKeyB64: input.myPublicKeyB64, nonce };
  const remoteHelloPromise = waitForPacket("hello", sessionId);
  if (!sendNearbyPacket(hello)) throw new Error("The local peer connection closed during verification.");
  const remoteHello = await remoteHelloPromise;
  if (remoteHello.conversationId !== input.conversationId || remoteHello.userId !== input.peerUserId || remoteHello.publicKeyB64 !== input.peerPublicKeyB64 || typeof remoteHello.nonce !== "string") {
    throw new Error("This device is not the verified contact for the selected conversation.");
  }
  const ownHello = hello;
  const hostHello = role === "host" ? ownHello : remoteHello;
  const guestHello = role === "guest" ? ownHello : remoteHello;
  const transcript = JSON.stringify([
    sessionId,
    input.conversationId,
    hostHello.userId,
    hostHello.publicKeyB64,
    hostHello.nonce,
    guestHello.userId,
    guestHello.publicKeyB64,
    guestHello.nonce,
  ]);
  /* The ECDH proof key is symmetric. Bind each proof to its sender role so a
     valid host proof cannot be reflected back as the guest's proof. */
  const proofTranscript = (role: "host" | "guest") => JSON.stringify([transcript, `proof-from-${role}`]);
  const proof = await createNearbyIdentityProof(input.myUserId, input.peerPublicKeyB64, sessionId, proofTranscript(role));
  if (!proof) throw new Error("This device could not prove its Cloak Dagger identity.");
  const remoteProofPromise = waitForPacket("identity-proof", sessionId);
  if (!sendNearbyPacket({ type: "identity-proof", sessionId, userId: input.myUserId, proof })) throw new Error("The local peer connection closed during verification.");
  const remoteProof = await remoteProofPromise;
  const remoteRole = role === "host" ? "guest" : "host";
  if (remoteProof.userId !== input.peerUserId || typeof remoteProof.proof !== "string" || !(await verifyNearbyIdentityProof(input.myUserId, input.peerPublicKeyB64, sessionId, proofTranscript(remoteRole), remoteProof.proof))) {
    throw new Error("Cloak Dagger identity verification failed.");
  }
  if (!markNearbyAuthenticated(input.conversationId, input.peerUserId)) throw new Error("Nearby identity verification could not be completed.");
}

export function sendNearbyPacket(packet: Record<string, unknown>): boolean {
  const channel = activeSessionId ? sessions.get(activeSessionId)?.channel : null;
  if (!channel || channel.readyState !== "open") return false;
  channel.send(JSON.stringify(packet));
  return true;
}

export function markNearbyAuthenticated(conversationId: string, peerUserId: string) {
  if (current.status !== "authenticating" || !current.sessionId) return false;
  const session = sessions.get(current.sessionId);
  if (!session?.channel || session.channel.readyState !== "open") return false;
  authenticatedPeers.set(current.sessionId, { sessionId: current.sessionId, conversationId, userId: peerUserId, channel: session.channel });
  publishSession({ ...current, status: "connected", conversationId, peerUserId });
  return true;
}

export async function sendNearbyEnvelope(envelope: EncryptedEnvelope, recipientUserIds?: string[], timeoutMs = 12_000) {
  const allowed = recipientUserIds ? new Set(recipientUserIds) : null;
  const peers = [...authenticatedPeers.values()].filter((entry) =>
    entry.conversationId === envelope.conversationId && entry.channel.readyState === "open" && (!allowed || allowed.has(entry.userId))
  );
  const results = await Promise.all(peers.map((entry) => new Promise<boolean>((resolve) => {
    const key = `${entry.sessionId}:${envelope.id}`;
    const timer = window.setTimeout(() => { pendingAcks.delete(key); resolve(false); }, timeoutMs);
    pendingAcks.set(key, (accepted) => { window.clearTimeout(timer); resolve(accepted); });
    try { entry.channel.send(JSON.stringify({ type: "envelope", envelope })); }
    catch { window.clearTimeout(timer); pendingAcks.delete(key); resolve(false); }
  })));
  const deliveredUserIds = [...new Set(peers.filter((_, index) => results[index]).map((entry) => entry.userId))];
  const attempted = new Set(peers.map((entry) => entry.userId));
  return {
    accepted: peers.length > 0,
    delivered: deliveredUserIds.length > 0,
    deliveredUserIds,
    failedUserIds: [...attempted].filter((id) => !deliveredUserIds.includes(id)),
  };
}

export function acknowledgeNearbyEnvelope(id: string, accepted: boolean, sessionId: string) {
  const connection = authenticatedPeers.get(sessionId);
  if (connection?.channel.readyState === "open") connection.channel.send(JSON.stringify({ type: "ack", id, accepted }));
}

async function settledDescription(pc: RTCPeerConnection) {
  // ICE gathering is deliberately completed before showing the QR, since the
  // QR is the out-of-band signaling path and there is no online signaling host.
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Local connection setup took too long. Try again on the same Wi-Fi.")), 25_000);
    if (pc.iceGatheringState === "complete") {
      window.clearTimeout(timeout);
      resolve();
      return;
    }
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        window.clearTimeout(timeout);
        resolve();
      }
    }, { once: false });
  });
}

function encodeSignal(signal: NearbySignal) {
  return JSON.stringify(signal);
}

export function parseNearbySignal(raw: string): NearbySignal {
  if (raw.length > 20_000) throw new Error("This connection code is too large to use safely.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("That connection code could not be read."); }
  const signal = value as Partial<NearbySignal>;
  if (signal.version !== 1 || !["offer", "answer"].includes(signal.kind ?? "") || typeof signal.sessionId !== "string" || typeof signal.expiresAt !== "number" || !signal.description?.type || !signal.description.sdp) {
    throw new Error("That is not a Cloak Dagger Nearby connection code.");
  }
  if (signal.description.type !== signal.kind || typeof signal.description.sdp !== "string") {
    throw new Error("The connection code does not match its session type.");
  }
  // Nearby V1 is direct local networking only. Reject server-reflexive and
  // TURN candidates so a pasted code cannot silently route via an external
  // address or relay service. Browsers may use opaque mDNS names for hosts.
  const candidates = signal.description.sdp.split(/\r?\n/).filter((line) => line.startsWith("a=candidate:"));
  if (candidates.some((line) => !/\btyp host\b/.test(line))) {
    throw new Error("This session includes a non-local network route and cannot be used by Nearby.");
  }
  if (signal.expiresAt <= Date.now()) throw new Error("This connection code has expired. Ask the session host for a new one.");
  return signal as NearbySignal;
}

export async function createNearbyOffer(): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const pc = makePeer("host", sessionId, expiresAt);
  bindChannel(sessionId, pc.createDataChannel(CHANNEL_NAME, { ordered: true }));
  publishSession({ status: "connecting", role: "host", sessionId, expiresAt });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await settledDescription(pc);
  if (!pc.localDescription) throw new Error("Could not prepare a Nearby session.");
  return encodeSignal({ version: 1, kind: "offer", sessionId, expiresAt, description: pc.localDescription.toJSON() });
}

export async function acceptNearbyOffer(raw: string): Promise<string> {
  const signal = parseNearbySignal(raw);
  if (signal.kind !== "offer") throw new Error("Scan the session host's offer code first.");
  const pc = makePeer("guest", signal.sessionId, signal.expiresAt);
  publishSession({ status: "connecting", role: "guest", sessionId: signal.sessionId, expiresAt: signal.expiresAt });
  await pc.setRemoteDescription(signal.description);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await settledDescription(pc);
  if (!pc.localDescription) throw new Error("Could not prepare a Nearby reply.");
  return encodeSignal({ version: 1, kind: "answer", sessionId: signal.sessionId, expiresAt: signal.expiresAt, description: pc.localDescription.toJSON() });
}

export async function acceptNearbyAnswer(raw: string): Promise<void> {
  const signal = parseNearbySignal(raw);
  if (signal.kind !== "answer") throw new Error("Scan the reply code from the person joining.");
  const peer = sessions.get(signal.sessionId)?.peer;
  if (!peer || current.role !== "host" || !current.expiresAt || signal.sessionId !== activeSessionId || signal.expiresAt !== current.expiresAt) {
    throw new Error("This reply does not match the active Nearby session.");
  }
  await peer.setRemoteDescription(signal.description);
}

export function closeNearby() {
  for (const resolve of pendingAcks.values()) resolve(false);
  pendingAcks.clear();
  packetBuffer.length = 0;
  for (const session of sessions.values()) {
    session.channel?.close();
    session.peer.close();
  }
  sessions.clear();
  authenticatedPeers.clear();
  activeSessionId = null;
  publishSession({ status: "idle" });
}

/** Close one pairing attempt or peer link without dropping the rest of a group mesh. */
export function closeNearbySession(sessionId: string) {
  const session = sessions.get(sessionId);
  const wasActive = activeSessionId === sessionId;
  for (const [key, resolve] of pendingAcks) {
    if (!key.startsWith(`${sessionId}:`)) continue;
    pendingAcks.delete(key);
    resolve(false);
  }
  authenticatedPeers.delete(sessionId);
  sessions.delete(sessionId);
  session?.channel?.close();
  session?.peer.close();
  if (!wasActive) {
    publishSession(current);
    return;
  }
  const remainingPeer = [...authenticatedPeers.values()].at(-1);
  if (remainingPeer) {
    const remainingSession = sessions.get(remainingPeer.sessionId);
    activeSessionId = remainingPeer.sessionId;
    publishSession({
      status: "connected",
      role: remainingSession?.role,
      sessionId: remainingPeer.sessionId,
      expiresAt: remainingSession?.expiresAt,
      conversationId: remainingPeer.conversationId,
      peerUserId: remainingPeer.userId,
    });
    return;
  }
  activeSessionId = null;
  publishSession({ status: "idle" });
}

export const nearbyTransport: MessageTransport = {
  id: "cloakdagger-nearby-webrtc",
  type: "nearby",
  async isAvailable() { return authenticatedPeers.size > 0; },
  async sendEncryptedEnvelope(envelope) {
    return sendNearbyEnvelope(envelope, envelope.recipientUserIds);
  },
};

export const RELAY_TRANSPORT_RESERVED: MessageTransport = {
  id: "cloakdagger-local-relay",
  type: "relay",
  async isAvailable() { return false; },
  async sendEncryptedEnvelope() { return { accepted: false, delivered: false }; },
};

/** Shared local route manager used by the message store. Internet delivery
 * remains the existing authenticated message API; when that API is offline,
 * this manager selects an already-authenticated local transport. */
export const transportManager = new TransportManager();
transportManager.register(nearbyTransport);

export const NEARBY_SESSION_TTL_MS = SESSION_TTL_MS;
