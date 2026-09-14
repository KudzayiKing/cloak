export interface CloakReactionOption {
  id: string;
  label: string;
  src: string;
}

const REACTION_ASSET_VERSION = "2026-09-reactions-v4";

function reactionAsset(file: string): string {
  return `/reactions/${file}.webp?v=${REACTION_ASSET_VERSION}`;
}

export const CLOAK_REACTIONS: CloakReactionOption[] = [
  { id: "thumbs_up", label: "Agree", src: reactionAsset("thumbs_up") },
  { id: "heart", label: "Heart", src: reactionAsset("heart") },
  { id: "laugh", label: "Laugh", src: reactionAsset("laugh") },
  { id: "eyes", label: "Watching", src: reactionAsset("eyes") },
  { id: "secure", label: "Secure", src: reactionAsset("secure") },
  { id: "thinking", label: "Thinking", src: reactionAsset("thinking") },
  { id: "fire", label: "Fire", src: reactionAsset("fire") },
  { id: "ok", label: "OK", src: reactionAsset("ok") },
  { id: "hush", label: "Quiet", src: reactionAsset("hush") },
  { id: "shocked", label: "Shocked", src: reactionAsset("shocked") },
  { id: "calm", label: "Calm", src: reactionAsset("calm") },
  { id: "sad", label: "Sad", src: reactionAsset("sad") },
  { id: "no", label: "No", src: reactionAsset("no") },
  { id: "face_palm", label: "Face palm", src: reactionAsset("face_palm") },
];

export const CLOAK_REACTION_IDS = new Set(CLOAK_REACTIONS.map((r) => r.id));

export function reactionById(id: string): CloakReactionOption | undefined {
  return CLOAK_REACTIONS.find((r) => r.id === id);
}
