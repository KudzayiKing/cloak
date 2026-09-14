export interface CloakReactionOption {
  id: string;
  label: string;
  src: string;
}

export const CLOAK_REACTIONS: CloakReactionOption[] = [
  { id: "thumbs_up", label: "Agree", src: "/reactions/thumbs_up.webp" },
  { id: "heart", label: "Heart", src: "/reactions/heart.webp" },
  { id: "laugh", label: "Laugh", src: "/reactions/laugh.webp" },
  { id: "eyes", label: "Watching", src: "/reactions/eyes.webp" },
  { id: "secure", label: "Secure", src: "/reactions/secure.webp" },
  { id: "salute", label: "Salute", src: "/reactions/salute.webp" },
  { id: "thinking", label: "Thinking", src: "/reactions/thinking.webp" },
  { id: "fire", label: "Fire", src: "/reactions/fire.webp" },
  { id: "ok", label: "OK", src: "/reactions/ok.webp" },
  { id: "hush", label: "Quiet", src: "/reactions/hush.webp" },
  { id: "shocked", label: "Shocked", src: "/reactions/shocked.webp" },
  { id: "calm", label: "Calm", src: "/reactions/calm.webp" },
  { id: "sad", label: "Sad", src: "/reactions/sad.webp" },
  { id: "no", label: "No", src: "/reactions/no.webp" },
  { id: "face_palm", label: "Face palm", src: "/reactions/face_palm.webp" },
];

export const CLOAK_REACTION_IDS = new Set(CLOAK_REACTIONS.map((r) => r.id));

export function reactionById(id: string): CloakReactionOption | undefined {
  return CLOAK_REACTIONS.find((r) => r.id === id);
}
