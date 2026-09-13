/*
 * Local demo data (spec §44).
 * Tasteful, fictional, professional. No lorem ipsum, no real people.
 */

import type { Contact, Conversation, Message } from "./types";

export const DEMO_CONTACTS: Contact[] = [
  {
    id: "sarah",
    name: "Sarah Ahmed",
    cloakId: "@sarah.8K2",
    verification: "verified",
    avatarInitials: "SA",
    about: "Counsel — Northbridge Partners",
    verifiedAt: "2026-08-14",
  },
  {
    id: "daniel",
    name: "Daniel Reed",
    cloakId: "@daniel.Q7M",
    verification: "unverified",
    avatarInitials: "DR",
    about: "Independent researcher",
  },
  {
    id: "maya",
    name: "Maya Chen",
    cloakId: "@maya.T4F",
    verification: "verified",
    avatarInitials: "MC",
    about: "Foundation director",
    verifiedAt: "2026-07-02",
  },
  {
    id: "alex",
    name: "Alex Morgan",
    cloakId: "@alex.R9D",
    verification: "pending",
    avatarInitials: "AM",
    about: "Chief of staff",
  },
];

const HOUR = 3600_000;
const MINUTE = 60_000;

function at(hoursAgo: number, minutesAgo = 0): number {
  return Date.now() - hoursAgo * HOUR - minutesAgo * MINUTE;
}

let messageId = 0;
function msg(partial: Omit<Message, "id">): Message {
  messageId += 1;
  return { id: `m-${messageId}`, ...partial };
}

export const DEMO_CONVERSATIONS: Conversation[] = [
  /* Verified contact, normal chat with a view-once file and @Cloak answer */
  {
    id: "c-sarah",
    contactId: "sarah",
    aiAccess: "allowed",
    persistentMemory: true,
    pinned: true,
    messages: [
      msg({
        conversationId: "c-sarah",
        authorId: "sarah",
        kind: "text",
        body: "The revised terms came through from the other side. I have reviewed the indemnity clause — it is acceptable with the two amendments we discussed.",
        createdAt: at(26),
        status: "read",
      }),
      msg({
        conversationId: "c-sarah",
        authorId: "me",
        kind: "text",
        body: "Good. Keep this between us until the board sees it on Thursday.",
        createdAt: at(25, 40),
        status: "read",
      }),
      msg({
        conversationId: "c-sarah",
        authorId: "sarah",
        kind: "text",
        body: "Of course. Also — dinner with the Kellermans is set for Friday. 8 PM, the usual place. Can you book the table?",
        createdAt: at(4, 12),
        status: "read",
      }),
      msg({
        conversationId: "c-sarah",
        authorId: "me",
        kind: "ai",
        body: "Sarah said dinner is at 8 PM on Friday and asked you to book the table at the usual place.",
        createdAt: at(4, 10),
        status: "read",
        ai: {
          provider: "LocalGemmaProvider",
          model: "Gemma 4 E2B",
          location: "This device",
          cloudUsed: false,
          memoryUploaded: false,
          retrievedItems: 2,
          retrieved: [
            { id: "mem-1", label: "Sarah — dinner Friday, 8 PM", source: "memory" },
            { id: "mem-2", label: "“the usual place” = Le Marais", source: "memory" },
          ],
          route: "local-llm",
        },
      }),
      msg({
        conversationId: "c-sarah",
        authorId: "me",
        kind: "text",
        body: "On it. I will confirm once the table is booked.",
        createdAt: at(4, 8),
        status: "delivered",
      }),
    ],
  },

  /* Ghost Chat with disappearing timer + view-once media */
  {
    id: "c-daniel",
    contactId: "daniel",
    aiAccess: "blocked",
    persistentMemory: false,
    ghost: true,
    ghostTimer: "1h",
    unreadCount: 2,
    messages: [
      msg({
        conversationId: "c-daniel",
        authorId: "daniel",
        kind: "text",
        body: "Draft summary attached. View it once, then decide whether it circulates.",
        createdAt: at(3, 55),
      }),
      msg({
        conversationId: "c-daniel",
        authorId: "daniel",
        kind: "view-once",
        body: "View once",
        fileName: "draft-summary-v3.pdf",
        fileSizeBytes: 244_800,
        createdAt: at(3, 54),
        viewed: false,
      }),
    ],
  },

  /* Group conversation, muted */
  {
    id: "c-group",
    contactId: "maya",
    isGroup: true,
    groupName: "Estate planning — working group",
    groupMemberIds: ["sarah", "maya", "alex"],
    aiAccess: "allowed",
    persistentMemory: false,
    muted: true,
    messages: [
      msg({
        conversationId: "c-group",
        authorId: "maya",
        kind: "text",
        body: "Circulated the structure memo to the three of us only. Comments by Wednesday, please.",
        createdAt: at(30),
        status: "read",
      }),
      msg({
        conversationId: "c-group",
        authorId: "alex",
        kind: "text",
        body: "Will review tomorrow morning. Nothing leaves this group.",
        createdAt: at(29, 30),
        status: "read",
      }),
    ],
  },

  /* Unread normal chat */
  {
    id: "c-maya",
    contactId: "maya",
    aiAccess: "allowed",
    persistentMemory: true,
    unreadCount: 1,
    messages: [
      msg({
        conversationId: "c-maya",
        authorId: "me",
        kind: "text",
        body: "Did the quarterly figures reach you through the secure channel?",
        createdAt: at(8),
        status: "read",
      }),
      msg({
        conversationId: "c-maya",
        authorId: "maya",
        kind: "text",
        body: "They did — verified the fingerprint before opening. I will send my notes this evening.",
        createdAt: at(1, 20),
      }),
    ],
  },

  /* Locked conversation — requires unlock */
  {
    id: "c-alex",
    contactId: "alex",
    aiAccess: "allowed",
    persistentMemory: true,
    locked: true,
    messages: [
      msg({
        conversationId: "c-alex",
        authorId: "system",
        kind: "system",
        body: "This conversation is locked. Unlock to read the message history.",
        createdAt: at(50),
      }),
      msg({
        conversationId: "c-alex",
        authorId: "alex",
        kind: "text",
        body: "Board pack is final. I will hand you the printed copy personally — nothing by email.",
        createdAt: at(49),
        status: "read",
      }),
    ],
  },
];

/* MemoryStore seeds (spec §6 Layer 1) — power deterministic retrieval. */
export interface SeedMemory {
  id: string;
  /** Structured facets used by keyword/structured retrieval. */
  subject: string;
  fact: string;
  sourceConversationId: string;
  createdAt: number;
  tags: string[];
}

export const SEED_MEMORIES: SeedMemory[] = [
  {
    id: "mem-1",
    subject: "Sarah",
    fact: "Sarah said dinner with the Kellermans is on Friday at 8 PM and asked you to book the table.",
    sourceConversationId: "c-sarah",
    createdAt: at(4, 12),
    tags: ["dinner", "sarah", "friday", "reservation", "time"],
  },
  {
    id: "mem-2",
    subject: "Le Marais",
    fact: "“The usual place” for dinners with Sarah refers to Le Marais.",
    sourceConversationId: "c-sarah",
    createdAt: at(120),
    tags: ["dinner", "restaurant", "sarah", "place"],
  },
  {
    id: "mem-3",
    subject: "Board meeting",
    fact: "The board sees the revised terms on Thursday. Alex is preparing the final board pack.",
    sourceConversationId: "c-alex",
    createdAt: at(49),
    tags: ["board", "thursday", "meeting", "terms"],
  },
  {
    id: "mem-4",
    subject: "Maya",
    fact: "Maya verified the secure channel fingerprint before opening the quarterly figures.",
    sourceConversationId: "c-maya",
    createdAt: at(1, 20),
    tags: ["maya", "figures", "quarterly"],
  },
];

export const DEMO_DEVICES = [
  {
    id: "dev-current",
    name: "This browser",
    platform: "Current session",
    addedAt: "Today",
    lastActive: "Active now",
    trusted: true,
    current: true,
  },
  {
    id: "dev-iphone",
    name: "iPhone 15 Pro",
    platform: "iOS 18 · Cloak PWA",
    addedAt: "12 Aug 2026",
    lastActive: "2 hours ago",
    trusted: true,
    current: false,
  },
];

/* ---------- Reserve guest passes (membership update spec §7-§11) ----------
 *
 * Demo allocation for the demo Reserve member (internal type "reserve"): 10 included passes with
 * 2 redeemed, 1 pending (expiring in 4 days), 7 available — mirroring the
 * spec's example states. Redeemed passes are permanently consumed.
 * Seed passes carry no real invitation tokens; passes issued through the
 * membership screen generate real high-entropy tokens (hash-stored).
 */

import type { ReserveGuestPass } from "./types";

const DAY = 24 * HOUR;

export const DEMO_PASS_OWNER = "you";

export const DEMO_GUEST_PASSES: ReserveGuestPass[] = [
  {
    id: "gp-01",
    ownerUserId: DEMO_PASS_OWNER,
    status: "redeemed",
    issuedTo: { name: "Sarah Ahmed", cloakId: "@sarah.8K2" },
    issuedAt: new Date(Date.now() - 21 * DAY).toISOString(),
    redeemedAt: new Date(Date.now() - 20 * DAY).toISOString(),
    redeemedByUserId: "sarah",
    note: "Invited via cloak_id",
  },
  {
    id: "gp-02",
    ownerUserId: DEMO_PASS_OWNER,
    status: "redeemed",
    issuedTo: { name: "Maya Chen", cloakId: "@maya.T4F" },
    issuedAt: new Date(Date.now() - 12 * DAY).toISOString(),
    redeemedAt: new Date(Date.now() - 11 * DAY).toISOString(),
    redeemedByUserId: "maya",
    note: "Invited via secure_link",
  },
  {
    id: "gp-03",
    ownerUserId: DEMO_PASS_OWNER,
    status: "issued",
    issuedTo: { name: "Daniel Reed", cloakId: "@daniel.Q7M" },
    issuedAt: new Date(Date.now() - 3 * DAY).toISOString(),
    expiresAt: new Date(Date.now() + 4 * DAY).toISOString(),
    note: "Invited via secure_link",
  },
  ...Array.from({ length: 7 }, (_, i) => ({
    id: `gp-${String(i + 4).padStart(2, "0")}`,
    ownerUserId: DEMO_PASS_OWNER,
    status: "available" as const,
  })),
];
