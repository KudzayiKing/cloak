"use client";

/*
 * Starts the one-time Cloaq AI artifact install when the product is opened as
 * an installed PWA. It is deliberately quiet: the model card subscribes to the
 * same manager if the user wants progress, while messaging remains usable.
 */

import { useEffect } from "react";
import { modelManager } from "@/ai/models/modelManager";

function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function AutoModelInstall() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!isStandalonePwa()) return;

    let cancelled = false;
    void modelManager.probe().then((snapshot) => {
      if (cancelled) return;
      if (snapshot.state === "not-installed") {
        void modelManager.install();
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
