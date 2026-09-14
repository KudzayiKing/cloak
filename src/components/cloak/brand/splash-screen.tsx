"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CloakLogoImage } from "@/components/cloak/brand/CloakLogo";

/*
 * Splash screen (user feedback rounds 5 + 9). Every cold start shows the
 * new Cloak logo artwork and the wordmark decoding itself — letters
 * cycle through cipher glyphs and settle left to right, like a decryption
 * routine running. Phase changes live in timer callbacks — never
 * synchronously — and reduced-motion users get a calm, static wordmark.
 */

const WORDMARK = "Cloak";

/* ASCII-only glyph pool: every character is covered by the EB Garamond
   latin subset loaded via next/font, so scrambled glyphs never fall back
   to another font mid-decode. */
const CIPHER_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=<>";

/* Letter i settles at 350ms + 130ms per position — fully decoded well
   before the splash starts fading at 1500ms, leaving a beat of calm. */
const resolveAt = (index: number) => 350 + index * 130;

function CipherWordmark({ text }: { text: string }) {
  /* Initial state is the final text — deterministic on the server, so
     hydration matches; the scramble only starts in a client effect. */
  const [frame, setFrame] = useState<{
    chars: string[];
    resolved: number;
  }>(() => ({ chars: text.split(""), resolved: text.length }));
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    if (reduced) return;

    const chars = text.split("");
    const startedAt = performance.now();
    intervalRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      let pending = false;
      const next = chars.map((ch, i) => {
        if (elapsed >= resolveAt(i)) return ch;
        pending = true;
        return CIPHER_GLYPHS[(Math.random() * CIPHER_GLYPHS.length) | 0];
      });
      setFrame({
        chars: next,
        resolved: chars.filter((_, i) => elapsed >= resolveAt(i)).length,
      });
      if (!pending) {
        window.clearInterval(intervalRef.current ?? undefined);
        intervalRef.current = null;
      }
    }, 55);

    return () => {
      window.clearInterval(intervalRef.current ?? undefined);
      intervalRef.current = null;
    };
  }, [text]);

  return (
    <span className="relative inline-block">
      {/* Invisible final wordmark reserves the exact layout box so the
          scrambling glyphs never resize or shift the splash layout. */}
      <span className="invisible" aria-hidden="true">
        {text}
      </span>
      <span className="absolute inset-0" aria-hidden="true">
        {frame.chars.map((ch, i) => (
          <span
            key={i}
            className={i < frame.resolved ? "opacity-100" : "opacity-40"}
          >
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}

export function SplashScreen() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible");

  useEffect(() => {
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const fadeAt = reduced ? 400 : 1500;
    const fade = window.setTimeout(() => setPhase("fading"), fadeAt);
    const gone = window.setTimeout(() => setPhase("gone"), fadeAt + 600);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 z-[200] flex flex-col items-center justify-center bg-cloak-bg transition-opacity duration-500",
        phase === "fading" ? "pointer-events-none opacity-0" : "opacity-100"
      )}
    >
      <div className="flex w-full flex-col items-center text-center">
        <span className="cloak-message-in grid h-24 w-24 place-items-center">
          <CloakLogoImage size={96} className="block -translate-x-1" />
        </span>
        <span className="cloak-wordmark cloak-message-in mt-5 block leading-none text-3xl text-cloak-text">
          <CipherWordmark text={WORDMARK} />
        </span>
      </div>
    </div>
  );
}
