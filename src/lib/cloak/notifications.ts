/*
 * Notification content rules (user feedback round 4).
 *
 * While Cloaq Mode is on, notifications hide BOTH the message preview and
 * the sender name — every notification leaves this pipeline, so the
 * restriction cannot be bypassed by a caller forgetting to check state.
 */

import type { PreviewVisibility } from "./types";
import { BRAND } from "./config";

export interface NotificationPayload {
  title: string;
  body: string;
}

/** What a notification for an incoming message is allowed to show. */
export function notificationForIncomingMessage(options: {
  senderName: string;
  body: string;
  cloakMode: boolean;
  previews: PreviewVisibility;
}): NotificationPayload {
  /* Cloaq Mode: no sender name, no message preview — enforced. */
  if (options.cloakMode) {
    return { title: BRAND.name, body: "New message" };
  }

  switch (options.previews) {
    case "name-and-message":
      return { title: options.senderName, body: options.body };
    case "name-only":
      return { title: options.senderName, body: "Sent you a message" };
    case "off":
      return { title: BRAND.name, body: "New message" };
    default:
      return { title: BRAND.name, body: "New message" };
  }
}
