"use client";

const MESSAGE_SOUND_PATH = "/audio/cloak_dagger_sfx.mp3";
let messageSound: HTMLAudioElement | null = null;

/** Play the configured in-app sound for a newly received message. */
export function playIncomingMessageSound(): void {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;

  try {
    messageSound ??= new Audio(MESSAGE_SOUND_PATH);
    messageSound.volume = 0.45;
    messageSound.currentTime = 0;
    void messageSound.play().catch(() => {
      /* Browsers may block audio until the user interacts with the page. */
    });
  } catch {
    /* A missing/unsupported audio device should not interrupt message sync. */
  }
}
