"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { AppShell } from "@/components/cloak/navigation/app-shell";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/cloak/shared/primitives";
import {
  acceptNearbyAnswer,
  acceptNearbyOffer,
  authenticateNearbyPeer,
  closeNearby,
  closeNearbySession,
  createNearbyOffer,
  nearbyState,
  parseNearbySignal,
  subscribeNearby,
  type NearbyState,
} from "@/lib/cloak/transports";
import { ArrowLeftIcon, CheckIcon, CopyIcon, LoaderCircleIcon, LockIcon, QrCodeIcon, WifiIcon } from "@animateicons/react/lucide";
import { navigate } from "@/hooks/use-hash-route";
import { useCloakStore } from "@/stores/cloak-store";
import { myIdentityInfo } from "@/lib/crypto/e2ee-orchestrator";

type Flow = "start" | "network" | "ready" | "join";

export function NearbyPage() {
  const [flow, setFlow] = useState<Flow>("start");
  const [signal, setSignal] = useState("");
  const [qr, setQr] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [state, setState] = useState<NearbyState>(nearbyState());
  const conversations = useCloakStore((store) => store.conversations);
  const contacts = useCloakStore((store) => store.contacts);
  const authUser = useCloakStore((store) => store.auth.user);
  const setActiveConversation = useCloakStore((store) => store.setActiveConversation);
  const blockedUsers = useCloakStore((store) => store.blockedUsers);
  const [targetConversationId, setTargetConversationId] = useState("");
  const [targetPeerUserId, setTargetPeerUserId] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [networkStep, setNetworkStep] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const authenticatingSession = useRef<string | null>(null);

  const trustedConversations = useMemo(() => conversations.filter((conversation) => {
    if (conversation.ghost) return false;
    const memberIds = conversation.isGroup ? conversation.groupMemberIds : [conversation.contactId];
    if (!memberIds?.length || (conversation.isGroup && authUser && !memberIds.includes(authUser.id))) return false;
    return memberIds.some((memberId) => {
      if (memberId === authUser?.id || blockedUsers.some((entry) => entry.userId === memberId)) return false;
      const contact = contacts.find((candidate) => candidate.id === memberId);
      return contact?.verification === "verified" && !!contact.identityPublicKey;
    });
  }), [conversations, contacts, blockedUsers, authUser]);
  const targetConversation = trustedConversations.find((conversation) => conversation.id === targetConversationId) ?? trustedConversations[0];
  const targetMembers = targetConversation
    ? (targetConversation.isGroup ? targetConversation.groupMemberIds ?? [] : [targetConversation.contactId])
      .filter((memberId) => memberId !== authUser?.id && !blockedUsers.some((entry) => entry.userId === memberId))
      .map((memberId) => contacts.find((contact) => contact.id === memberId))
      .filter((contact): contact is NonNullable<typeof contact> => !!contact && contact.verification === "verified" && !!contact.identityPublicKey)
    : [];
  const targetContact = targetMembers.find((contact) => contact.id === targetPeerUserId) ?? targetMembers[0];

  useEffect(() => subscribeNearby(setState), []);
  useEffect(() => {
    if (!targetConversation && trustedConversations[0]) setTargetConversationId(trustedConversations[0].id);
  }, [targetConversation, trustedConversations]);
  useEffect(() => {
    if (targetContact && !targetMembers.some((contact) => contact.id === targetPeerUserId)) setTargetPeerUserId(targetContact.id);
  }, [targetContact, targetMembers, targetPeerUserId]);
  useEffect(() => {
    if (!state.expiresAt) return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((state.expiresAt! - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [state.expiresAt]);

  useEffect(() => {
    if (!(["connecting", "authenticating"].includes(state.status)) || !state.expiresAt) return;
    const remaining = state.expiresAt - Date.now();
    if (remaining <= 0) {
      if (state.sessionId) closeNearbySession(state.sessionId);
      setError("This session code expired. Start a new Nearby session.");
      return;
    }
    const timer = window.setTimeout(() => {
      if (["connecting", "authenticating"].includes(nearbyState().status)) {
        if (state.sessionId) closeNearbySession(state.sessionId);
        setError("This session code expired. Start a new Nearby session.");
      }
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [state.status, state.expiresAt]);

  useEffect(() => {
    if (state.status !== "authenticating" || !state.sessionId || !targetConversation || !authUser) return;
    if (authenticatingSession.current === state.sessionId) return;
    authenticatingSession.current = state.sessionId;
    void (async () => {
      const ownIdentity = await myIdentityInfo(authUser.id);
      const peerPublicKeyB64 = targetConversation.peerIdentityPublicKey ?? targetContact?.identityPublicKey;
      const peerVerified = targetConversation.peerVerification === "verified" || targetContact?.verification === "verified";
      if (!ownIdentity || !peerPublicKeyB64 || !peerVerified) {
        setError("This contact is not available for offline verification on this device.");
        if (state.sessionId) closeNearbySession(state.sessionId);
        return;
      }
      try {
        await authenticateNearbyPeer({
          conversationId: targetConversation.id,
          myUserId: authUser.id,
          peerUserId: targetContact.id,
          myPublicKeyB64: ownIdentity.publicKeyB64,
          peerPublicKeyB64,
        });
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Nearby identity verification failed.");
        if (state.sessionId) closeNearbySession(state.sessionId);
      }
    })();
  }, [state.status, state.sessionId, targetConversation, targetContact, authUser]);

  useEffect(() => {
    if (!camera || !videoRef.current || !navigator.mediaDevices?.getUserMedia) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const run = async () => {
      try {
        const Detector = (window as Window & { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (!Detector) throw new Error("QR scanning is not supported here. Paste the connection code instead.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new Detector({ formats: ["qr_code"] });
        const scan = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) {
              setInput(codes[0].rawValue);
              setCamera(false);
              return;
            }
          } catch { /* wait for the next frame */ }
          frame = requestAnimationFrame(() => void scan());
        };
        void scan();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Camera access is unavailable.");
        setCamera(false);
      }
    };
    void run();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [camera]);

  async function showQr(code: string) {
    setSignal(code);
    setQr(await QRCode.toDataURL(code, { width: 300, margin: 2, color: { dark: "#121212", light: "#ffffff" } }));
  }

  async function createSession() {
    if (!targetConversation || !targetContact) { setError("Choose a verified member of this conversation first."); return; }
    setError(""); setBusy(true);
    try { const code = await createNearbyOffer(); await showQr(code); setFlow("ready"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start a Nearby session."); }
    finally { setBusy(false); }
  }

  async function joinSession(raw = input) {
    if (!targetConversation || !targetContact) { setError("Choose a verified member of this conversation first."); return; }
    setError(""); setBusy(true);
    try {
      const answer = await acceptNearbyOffer(raw.trim());
      await showQr(answer);
      setFlow("ready");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join this session."); }
    finally { setBusy(false); }
  }

  async function applyReply(raw = input) {
    setError(""); setBusy(true);
    try { parseNearbySignal(raw.trim()); await acceptNearbyAnswer(raw.trim()); setInput(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not verify this reply."); }
    finally { setBusy(false); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); } catch { setError("Copy is unavailable. Select and copy the connection code manually."); }
  }

  const connected = state.status === "connected";

  return (
    <AppShell active="/app/messages">
      <div className="cloak-scroll h-full overflow-y-auto pt-[var(--cloak-top-chrome-h)] md:pt-0">
        <main className="mx-auto max-w-2xl px-5 pb-[var(--cloak-bottom-clearance)] pt-6 md:px-8 md:py-8">
          <button onClick={() => navigate("/app/messages")} className="mb-6 inline-flex items-center gap-2 text-sm text-cloak-text-muted hover:text-cloak-text">
            <ArrowLeftIcon size={15} /> Messages
          </button>
          <div className="mb-6 flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-cloak-gold/25 bg-cloak-gold-soft/20 text-cloak-gold"><WifiIcon size={21} /></span>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-cloak-gold">Nearby</p>
              <h1 className="cloak-display mt-1 text-3xl font-medium text-cloak-text">Stay connected when the internet is unavailable.</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-cloak-text-secondary">Connect verified people in an existing conversation over the same Wi-Fi or phone hotspot. For groups, create a separate direct connection to each member who is nearby.</p>
            </div>
          </div>

          {typeof window === "undefined" || !("RTCPeerConnection" in window) ? (
            <Surface className="p-5"><p className="font-medium text-cloak-text">This browser cannot start a Nearby connection.</p><p className="mt-2 text-sm text-cloak-text-secondary">Use a current browser with WebRTC support, or continue when internet access is available.</p></Surface>
          ) : connected && flow !== "network" ? (
            <Surface className="p-6">
              <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-cloak-success/10 text-cloak-success"><CheckIcon size={18} /></span><div><h2 className="font-medium text-cloak-text">Connected Nearby</h2><p className="text-sm text-cloak-text-secondary">{state.connectedPeers?.filter((peer) => peer.conversationId === targetConversation?.id).length ?? 1} verified member connection(s) · {targetConversation?.groupName ?? targetContact?.name ?? "conversation"}</p></div></div>
              <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">Text messages use the conversation’s existing end-to-end encryption key. Nearby sends directly to connected members and show partial delivery; messages synchronize to the rest of the group when internet returns.</p>
              <label className="mt-4 block text-sm text-cloak-text-secondary">Connect another verified member
                <select value={targetPeerUserId} onChange={(event) => setTargetPeerUserId(event.target.value)} className="mt-2 w-full rounded-xl border border-cloak-border bg-cloak-bg p-3 text-sm text-cloak-text">
                  {targetMembers.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{state.connectedPeers?.some((peer) => peer.conversationId === targetConversation?.id && peer.userId === contact.id) ? " · connected" : ""}</option>)}
                </select>
              </label>
              <Button className="mt-4 w-full" disabled={!targetConversation || !targetContact} onClick={() => { setError(""); setFlow("network"); setNetworkStep(2); }}>Create another member connection</Button>
              <Button className="mt-5 w-full" onClick={() => { if (targetConversation) setActiveConversation(targetConversation.id); navigate("/app/messages"); }}>Open Messages</Button>
              <Button variant="outline" className="mt-5 border-cloak-border text-cloak-text" onClick={() => { closeNearby(); setFlow("start"); setSignal(""); setQr(""); }}>End local connection</Button>
            </Surface>
          ) : flow === "start" ? (
            <Surface className="space-y-4 p-5">
              <h2 className="text-base font-medium text-cloak-text">How do you want to connect?</h2>
              <p className="text-sm leading-relaxed text-cloak-text-secondary">Both people select the same conversation and each selects the other member. Your identity is checked against the verified contact key before that peer link is trusted.</p>
              <label className="block text-sm text-cloak-text-secondary">Verified conversation
                <select value={targetConversation?.id ?? ""} onChange={(event) => setTargetConversationId(event.target.value)} className="mt-2 w-full rounded-xl border border-cloak-border bg-cloak-bg p-3 text-sm text-cloak-text" disabled={!trustedConversations.length}>
                  {trustedConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.groupName ?? contacts.find((contact) => contact.id === conversation.contactId)?.name ?? "Verified conversation"}</option>)}
                </select>
              </label>
              <label className="block text-sm text-cloak-text-secondary">Member to connect
                <select value={targetContact?.id ?? ""} onChange={(event) => setTargetPeerUserId(event.target.value)} className="mt-2 w-full rounded-xl border border-cloak-border bg-cloak-bg p-3 text-sm text-cloak-text" disabled={!targetMembers.length}>
                  {targetMembers.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
                </select>
              </label>
              {!trustedConversations.length && <p className="text-xs text-cloak-warning">No cached conversation with a verified, unblocked member is available.</p>}
              <Button disabled={!targetConversation} className="w-full justify-start bg-cloak-gold/15 text-cloak-text hover:bg-cloak-gold/20" onClick={() => setFlow("network")}><WifiIcon size={16} /> Create Nearby Session</Button>
              <Button disabled={!targetConversation} variant="outline" className="w-full justify-start border-cloak-border text-cloak-text" onClick={() => setFlow("join")}><QrCodeIcon size={16} /> Join Nearby Session</Button>
            </Surface>
          ) : flow === "network" ? (
            <Surface className="p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-cloak-gold">Step 1 of 3</p>
              <h2 className="mt-2 text-lg font-medium text-cloak-text">Create a local network</h2>
              <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">Turn on Personal Hotspot or connect everyone to the same local Wi-Fi. Cellular data is not required. On iPhone, look under Settings → Personal Hotspot. On Android, look under Settings → Hotspot or tethering; menu names vary.</p>
              {networkStep === 1 ? <Button className="mt-5 w-full bg-cloak-gold/15 text-cloak-text hover:bg-cloak-gold/20" onClick={() => setNetworkStep(2)}>I&apos;ve created the network</Button> : <><p className="mt-5 text-[10px] uppercase tracking-[0.18em] text-cloak-gold">Step 2 of 3</p><p className="mt-2 text-sm text-cloak-text-secondary">Ask the people you want to connect with to join the same Wi-Fi or hotspot. Continue when they are connected.</p><Button className="mt-4 w-full" disabled={busy} onClick={() => void createSession()}>{busy ? <LoaderCircleIcon size={15} className="animate-spin" /> : null} Create Nearby Session</Button></>}
              <p className="mt-3 text-xs text-cloak-text-muted">The short-lived connection code contains temporary peer setup data. It does not include a password, conversation, or private encryption key.</p>
            </Surface>
          ) : flow === "join" ? (
            <Surface className="p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-cloak-gold">Join a session</p>
              <h2 className="mt-2 text-lg font-medium text-cloak-text">Join the same Wi-Fi, then scan the host&apos;s code.</h2>
              {camera && <video ref={videoRef} muted playsInline className="mt-4 aspect-video w-full rounded-xl bg-black object-cover" />}
              <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={4} placeholder="Connection code appears here, or paste it" className="mt-4 w-full rounded-xl border border-cloak-border bg-cloak-bg p-3 font-mono text-[11px] text-cloak-text" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" className="border-cloak-border text-cloak-text" onClick={() => { setError(""); setCamera((v) => !v); }}>{camera ? "Stop camera" : "Scan QR code"}</Button>
                <Button disabled={busy || !input.trim()} onClick={() => void joinSession()}>{busy ? <LoaderCircleIcon size={15} className="animate-spin" /> : null} Continue</Button>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-cloak-text-muted">Only scan a code from someone you intend to connect with. Being on the same Wi-Fi does not make a person trusted.</p>
            </Surface>
          ) : (
            <Surface className="p-5">
              <div className="flex items-center justify-between"><p className="text-[10px] uppercase tracking-[0.18em] text-cloak-gold">Step 3 of 3</p><p className="text-xs tabular-nums text-cloak-text-muted">Code expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p></div>
              <h2 className="mt-2 text-lg font-medium text-cloak-text">{state.status === "connected" ? "Connected Nearby" : state.role === "guest" ? "Show this reply to the session host" : "Nearby Session Ready"}</h2>
              <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{state.role === "guest" ? "Ask the person who created the session to scan this reply code." : "Ask the other person to scan this code. They will show a reply code for you to scan."}</p>
              {qr && <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-3"><img src={qr} alt="Temporary Cloak Dagger Nearby connection QR code" className="h-60 w-60" /></div>}
              <div className="mt-4 flex flex-wrap justify-center gap-2">{state.role === "guest" && <Button variant="outline" className="border-cloak-border text-cloak-text" onClick={() => void copy(signal)}><CopyIcon size={14} /> Copy connection code</Button>}{state.role === "host" && <Button variant="outline" className="border-cloak-border text-cloak-text" onClick={() => { setInput(""); setError(""); setCamera((v) => !v); }}>{camera ? "Stop camera" : "Scan reply code"}</Button>}</div>
              {state.role === "host" && <><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={3} placeholder="Scan the reply code or paste it here" className="mt-3 w-full rounded-xl border border-cloak-border bg-cloak-bg p-3 font-mono text-[11px] text-cloak-text" /><Button className="mt-2" disabled={busy || !input.trim()} onClick={() => void applyReply()}>{busy ? <LoaderCircleIcon size={15} className="animate-spin" /> : null} Verify reply code</Button></>}
              {camera && <video ref={videoRef} muted playsInline className="mt-4 aspect-video w-full rounded-xl bg-black object-cover" />}
              {state.status === "connecting" && <p className="mt-4 flex items-center justify-center gap-2 text-sm text-cloak-text-secondary"><LoaderCircleIcon size={14} className="animate-spin" /> Connecting on the local network…</p>}
              {state.status === "authenticating" && <p className="mt-4 flex items-center justify-center gap-2 text-sm text-cloak-text-secondary"><LoaderCircleIcon size={14} className="animate-spin" /> Verifying Cloak Dagger identity…</p>}
              {seconds === 0 && state.status !== "connected" && <Button variant="outline" className="mt-3 w-full border-cloak-border text-cloak-text" onClick={() => { closeNearby(); setFlow("start"); setQr(""); setSignal(""); }}>Session expired · start again</Button>}
              <p className="mt-4 flex items-center justify-center gap-2 text-xs text-cloak-text-muted"><LockIcon size={13} /> Verified contact identity · Cloak Dagger E2EE · local Wi-Fi is an untrusted transport</p>
              <Button variant="outline" className="mt-5 w-full border-cloak-border text-cloak-text" onClick={() => { closeNearby(); setFlow("start"); setSignal(""); setQr(""); setInput(""); }}>End session</Button>
            </Surface>
          )}
          {error && <p role="alert" className="mt-3 rounded-xl border border-cloak-danger/30 bg-cloak-danger/5 p-3 text-sm text-cloak-danger">{error}</p>}
          <p className="mt-5 text-center text-xs leading-relaxed text-cloak-text-muted">Nearby group delivery is direct peer-to-peer, one connected member at a time. Only members in the cached group membership snapshot can connect. Offline removals cannot take effect on devices that have not received the update yet.</p>
        </main>
      </div>
    </AppShell>
  );
}
