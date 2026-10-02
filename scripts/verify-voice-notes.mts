/*
 * Guards the voice-note feature.
 *
 * The bug this exists to prevent is the one that shipped: the composer had a mic
 * button with the right `aria-label` and a plausible tooltip, and NOTHING behind
 * it. A dead control is invisible to a type check and to a source scan that only
 * looks for the label — so these checks assert the wiring, not the presence of a
 * button.
 *
 * Four contracts, each of which has failed in a different way somewhere:
 *
 *  1. The mic is WIRED. An `aria-label="Record a voice note"` with no `onClick`
 *     is exactly the reported defect, so the click handler is asserted directly.
 *  2. The transport is the existing one. A voice note is an attachment: bytes
 *     stay in IndexedDB and only an envelope travels. The duration therefore has
 *     to ride the envelope, or the recipient is told nothing about the note.
 *  3. The waveform is measured and themed. `decodeAudioData` produces the peaks;
 *     the bars are sized from Cloak's own tokens rather than a foreign palette.
 *  4. The clock is shared. The composer counts up while recording and the bubble
 *     reads back — one formatter, or the two drift.
 *  5. The HOST grants the microphone. `Permissions-Policy: microphone=()` is an
 *     empty allowlist and denies the feature to this document itself, so the
 *     browser rejects before prompting and no browser setting can help. The mic
 *     then looks broken while every check above still passes.
 *
 * Run: node_modules/.bin/tsx scripts/verify-voice-notes.mts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ---------- helpers ---------- */

type Check = { label: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  checks.push({
    label,
    pass: actual === expected,
    detail: `got ${String(actual)}, want ${String(expected)}`,
  });
}

/* Comments are stripped because these files carry prose describing the very
   defects being asserted against — a comment quoting `aria-label="Record a
   voice note"` would otherwise satisfy the check on its own. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const composer = stripComments(read("src/components/cloak/messaging/message-composer.tsx"));
const bubble = stripComments(read("src/components/cloak/messaging/message-bubble.tsx"));
const storage = stripComments(read("src/lib/cloak/attachment-storage.ts"));
const store = stripComments(read("src/stores/cloak-store.ts"));
const utils = stripComments(read("src/lib/cloak/utils.ts"));
const css = stripComments(read("src/app/globals.css"));
const messageRoute = stripComments(
  read("src/app/api/conversations/[id]/messages/route.ts")
);
const nextConfig = stripComments(read("next.config.ts"));

/* ------------------------- 1. the mic is wired --------------------------- */

check(
  "the mic button starts a recording",
  /aria-label="Record a voice note"[\s\S]{0,400}?onClick=\{\(\) => void startRecording\(\)\}/.test(
    composer
  ),
  true
);
check(
  "the composer actually opens the microphone",
  /navigator\.mediaDevices\??\.getUserMedia\(\{\s*audio: true\s*\}\)/.test(composer),
  true
);
check(
  "the composer constructs a MediaRecorder",
  /new MediaRecorder\(stream/.test(composer),
  true
);
check(
  "the mic button no longer claims voice notes are missing",
  /Voice notes arrive with the secure transport layer/.test(composer),
  false
);
check(
  "a permission failure is reported instead of swallowed",
  /setRecordError\(describeMicFailure\(error\)\)/.test(composer),
  true
);
check(
  "an insecure origin is diagnosed, not blamed on the user",
  /isSecureContext/.test(composer),
  true
);
check(
  "a Permissions-Policy block is diagnosed apart from a user denial",
  /allowsFeature\("microphone"\)/.test(composer),
  true
);
check(
  "the microphone is released on unmount",
  /aliveRef\.current = false[\s\S]{0,220}releaseStream\(\)/.test(composer),
  true
);

/* ----------------- 1b. the host actually grants the microphone ------------ */

/*
 * `microphone=()` is an EMPTY allowlist: it denies the feature to every origin
 * INCLUDING this document. The browser then rejects getUserMedia with
 * NotAllowedError before it can prompt, and because the block is document-level
 * no browser setting can override it — so the user is told to go to settings
 * that cannot possibly help. Asserted against next.config.ts because that is
 * the single source of the header.
 */
check(
  "the app origin grants itself the microphone",
  /Permissions-Policy[\s\S]{0,140}?microphone=\(self\)/.test(nextConfig),
  true
);
check(
  "the empty microphone allowlist is not reintroduced",
  /microphone=\(\)/.test(nextConfig),
  false
);
check(
  "camera stays closed while calls are deferred",
  /camera=\(\)/.test(nextConfig),
  true
);

/* Safari has no webm, so a webm-only candidate list silently fails there. */
check(
  "an mp4 container fallback is offered for Safari",
  /"audio\/mp4"/.test(composer),
  true
);

/* -------------------- 2. the transport is the existing one ---------------- */

check(
  "the API still accepts the voice message kind",
  /"voice"/.test(messageRoute),
  true
);
check(
  "a voice note is stored through the attachment path",
  /saveLocalAttachment\(file, conversationId, \{[\s\S]{0,80}durationSec: options\?\.durationSec/.test(
    store
  ),
  true
);
check(
  "audio mime is routed to the voice kind",
  /file\.type\.startsWith\("audio\/"\)[\s\S]{0,60}\? "voice"/.test(store),
  true
);
check(
  "the envelope carries the duration",
  /durationSec\?: number;/.test(storage),
  true
);
check(
  "the duration survives a round trip through parse",
  /durationSec: Math\.max\(0, Math\.round\(parsed\.durationSec\)\)/.test(storage),
  true
);
check(
  "hydration keeps the duration on the message",
  (store.match(/voiceDurationSec: envelope\.durationSec/g) ?? []).length,
  2
);

/* ------------------- 3. the waveform is measured and themed --------------- */

check(
  "the bubble renders the real player",
  /kind === "voice"[\s\S]{0,600}?<VoiceNotePlayer message=\{message\} \/>/.test(bubble),
  true
);
check(
  "the waveform is decoded from the audio, not faked",
  /decodeAudioData\(await blob\.arrayBuffer\(\)\)/.test(bubble),
  true
);
check(
  "peaks are cached so a poll tick does not re-decode",
  /voicePeakCache\.set\(attachmentId, normalised\)/.test(bubble),
  true
);
check(
  "the played part of the waveform uses the gold token",
  /played \? "bg-cloak-gold" : "bg-cloak-text-muted\/40"/.test(bubble),
  true
);
check(
  "the player states when the bytes are on the sender's device",
  /Stored on sender device/.test(bubble),
  true
);
/* The old shell rendered `{voiceDurationSec ?? 0}:00`, so a 12s note read
   "12:00" — an hour-long note. The shared clock replaces it. */
check(
  "the old minutes:00 duration format is gone",
  /\{message\.voiceDurationSec \?\? 0\}:00/.test(bubble),
  false
);

/* --------------------------- 4. the clock is shared ---------------------- */

check(
  "one duration formatter is defined",
  (utils.match(/export function formatVoiceClock/g) ?? []).length,
  1
);
check(
  "the composer imports the shared formatter",
  /import \{ formatVoiceClock \} from "@\/lib\/cloak\/utils"/.test(composer),
  true
);
check(
  "the bubble imports the shared formatter",
  /import \{ formatTime, formatVoiceClock \} from "@\/lib\/cloak\/utils"/.test(bubble),
  true
);
check(
  "the composer does not define its own formatter",
  /export function formatVoiceClock/.test(composer),
  false
);

/* ------------------------- 5. the live indicator ------------------------- */

check(
  "the recording indicator is animated in the stylesheet",
  /\.cloak-rec-pulse \{[\s\S]{0,120}animation: cloak-rec-pulse/.test(css),
  true
);
check(
  "the indicator respects reduced motion",
  /prefers-reduced-motion: reduce\) \{[\s\S]{0,120}\.cloak-rec-pulse \{[\s\S]{0,60}animation: none/.test(
    css
  ),
  true
);

/* -------------------------------- report --------------------------------- */

for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.label}${c.pass ? "" : `  [${c.detail}]`}`);
}
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n=== ${checks.length - failed}/${checks.length} voice-note checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
