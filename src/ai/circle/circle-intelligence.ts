/*
 * Circle Intelligence (groups & circles spec §64-§67) — client-side,
 * local-first. The server never answers content questions because it
 * CANNOT: message bodies are client-encrypted envelopes. Every source
 * here is a conversation the signed-in user can already open, so the
 * authorization boundary is structural:
 *
 *   §64  AI permissions never expand messaging permissions.
 *   §65  Deterministic metadata queries are answered WITHOUT Gemma.
 *   §66  Reasoning queries retrieve ONLY from allowed groups, rank the
 *        context, then run the local provider (never cloud silently).
 *   §67  Circle search sees only groups the user belongs to; hidden
 *        groups are never named in hints or results.
 */

import type { CircleDetail, Message } from "@/lib/cloak/types";
import { LocalGemmaProvider } from "@/ai/providers/inference/LocalGemmaProvider";

export interface CircleAskResult {
  route: "deterministic" | "retrieval-only" | "local-llm" | "unavailable";
  answer: string;
  /** Group names the answer drew from (never hidden ones — impossible by
   *  construction: the caller only supplies groups the user is in). */
  sources: string[];
}

export interface CircleScopeGroup {
  id: string;
  title: string;
  /** The viewer's own messages for this group (already decrypted). */
  messages: Message[];
}

const localGemma = new LocalGemmaProvider();

/* ---------- Deterministic metadata queries (§65) ---------- */

/** Answers metadata questions straight from circle/group structures.
 *  Returns null when the query is not a recognized metadata ask. */
export function answerCircleMetadata(
  query: string,
  circle: Pick<CircleDetail, "name" | "groups" | "hiddenGroupCount">,
  loadMembers?: (groupId: string) => Promise<{ name: string; role: string }[] | null>
): Promise<CircleAskResult | null> {
  const q = query.toLowerCase().trim();
  const myGroups = circle.groups.filter((g) => g.isMember);
  const nameOf = (g: { title: string }) => g.title;

  const wantsGroupList = /which groups|what groups|my groups|groups am i in|groups do i have/.test(q);
  const wantsCircleList = /which circles|what circles|circles am i in|how many circles/.test(q);
  const memberCountAsk = q.match(/how many (people|members|members are|people are)[^.]*\b(?:in|of)\s+([a-z0-9 '&-]+)/);
  const adminAsk = q.match(/who('| i)?s (the )?(admin|owner|organizer)(?:\s+of|\s+in)?\s+([a-z0-9 '&-]+)/);

  if (wantsCircleList) {
    return Promise.resolve({
      route: "deterministic",
      answer: `You are in ${circle.name}.`,
      sources: [],
    });
  }

  if (wantsGroupList) {
    if (myGroups.length === 0) {
      return Promise.resolve({
        route: "deterministic",
        answer:
          circle.hiddenGroupCount > 0
            ? `You are not in any groups of ${circle.name} yet. Other groups in this Circle are not shared with you.`
            : `You are not in any groups of ${circle.name} yet.`,
        sources: [],
      });
    }
    const suffix =
      circle.hiddenGroupCount > 0
        ? ` (${circle.hiddenGroupCount} other group${circle.hiddenGroupCount === 1 ? "" : "s"} in this Circle are not shared with you.)`
        : "";
    return Promise.resolve({
      route: "deterministic",
      answer: `In ${circle.name} you are in: ${myGroups.map(nameOf).join(", ")}.${suffix}`,
      sources: myGroups.map(nameOf),
    });
  }

  if (memberCountAsk) {
    const target = findGroup(memberCountAsk[2] ?? "", myGroups);
    if (target) {
      return Promise.resolve({
        route: "deterministic",
        answer: `${target.title} has ${target.memberCount} member${target.memberCount === 1 ? "" : "s"}.`,
        sources: [target.title],
      });
    }
    return Promise.resolve({
      route: "deterministic",
      answer: `I can only see member counts for groups you belong to.`,
      sources: [],
    });
  }

  if (adminAsk && loadMembers) {
    const target = findGroup(adminAsk[4] ?? "", myGroups);
    if (target) {
      return loadMembers(target.id).then((members) => {
        if (!members) {
          return {
            route: "deterministic" as const,
            answer: `You can only see this for groups you belong to.`,
            sources: [],
          };
        }
        const leads = members.filter((m) => m.role === "owner" || m.role === "admin");
        return {
          route: "deterministic" as const,
          answer: leads.length
            ? `${target.title}: ${leads.map((m) => `${m.name} (${m.role})`).join(", ")}`
            : `${target.title} has no admin yet.`,
          sources: [target.title],
        };
      });
    }
    return Promise.resolve({
      route: "deterministic",
      answer: `I can only see roles inside groups you belong to.`,
      sources: [],
    });
  }

  return Promise.resolve(null);
}

function findGroup(fragment: string, groups: { title: string; id: string; memberCount: number }[]) {
  const frag = fragment.trim().replace(/[?.!]/g, "").trim();
  if (!frag) return undefined;
  return groups.find((g) => g.title.toLowerCase() === frag) ??
    groups.find((g) => frag.includes(g.title.toLowerCase()) || g.title.toLowerCase().includes(frag));
}

/* ---------- Reasoning queries (§66) ---------- */

/** Retrieval window: "this week" and everything else — the client holds a
 *  bounded local window anyway, so a fixed recent window is honest. */
const RECENCY_MS = 7 * 24 * 3600 * 1000;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
}

interface RankedMessage {
  group: CircleScopeGroup;
  message: Message;
  score: number;
}

/** Rank a group's messages against the query terms. */
function rankMessages(query: string, group: CircleScopeGroup, since: number): RankedMessage[] {
  const terms = tokenize(query);
  return group.messages
    .filter((m) => m.kind === "text" && m.createdAt >= since)
    .map((m) => {
      const msgTerms = tokenize(m.body);
      let overlap = 0;
      for (const t of terms) if (msgTerms.has(t)) overlap += 1;
      return { group, message: m, score: overlap };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.message.createdAt - a.message.createdAt);
}

export async function answerCircleReasoning(
  query: string,
  scope: CircleScopeGroup[]
): Promise<CircleAskResult> {
  const since = Date.now() - RECENCY_MS;
  const ranked = scope.flatMap((g) => rankMessages(query, g, since)).slice(0, 12);

  if (ranked.length === 0) {
    return {
      route: "retrieval-only",
      answer:
        "I found nothing relevant in the groups you can open for this Circle (last 7 days). " +
        "Retrieval only ever uses sources you are a member of (spec §66).",
      sources: [],
    };
  }

  const sources = [...new Set(ranked.map((r) => r.group.title))];
  const context = ranked.map(
    (r) => `[${r.group.title}] ${new Date(r.message.createdAt).toLocaleString()} — ${r.message.authorName ?? "member"}: ${r.message.body}`
  );

  /* Route 1 — synthesis genuinely required: local Gemma only, never a
     silent cloud fallback (§66/§7). */
  const status = await localGemma.status();
  if (status === "ready") {
    const result = await localGemma.generate({ prompt: query, context });
    return {
      route: "local-llm",
      answer: result.text,
      sources,
    };
  }

  /* Route 2 — local model unavailable: answer retrieval-only with the
     ranked excerpts and say so honestly (§90: cloud stays explicit). */
  const excerpts = ranked
    .slice(0, 5)
    .map((r) => `• [${r.group.title}] ${r.message.authorName ?? "member"}: ${r.message.body}`)
    .join("\n");
  return {
    route: "unavailable",
    answer:
      `Local Gemma is not ready (${status}), so I cannot synthesize an answer — and I will not send this to the cloud without your explicit consent.\n\n` +
      `Most relevant messages I found locally:\n${excerpts}`,
    sources,
  };
}

/* ---------- Circle search (§67) ---------- */

export interface CircleSearchHit {
  groupId: string;
  groupTitle: string;
  snippet: string;
  authorName?: string;
  createdAt: number;
}

/** Search ONLY the caller-provided scope (groups the user is in). Hidden
 *  group names can never appear because they are never passed in. */
export function searchCircle(query: string, scope: CircleScopeGroup[]): CircleSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = tokenize(q);
  const since = Date.now() - RECENCY_MS;
  const hits: CircleSearchHit[] = [];
  for (const group of scope) {
    for (const m of group.messages) {
      if (m.kind !== "text") continue;
      if (m.createdAt < since) continue;
      const body = m.body.toLowerCase();
      if (!body.includes(q) && ![...terms].some((t) => body.includes(t))) continue;
      const idx = body.indexOf(q);
      const start = idx >= 0 ? Math.max(0, idx - 40) : 0;
      const snippet =
        (start > 0 ? "…" : "") +
        m.body.slice(start, start + 120) +
        (start + 120 < m.body.length ? "…" : "");
      hits.push({
        groupId: group.id,
        groupTitle: group.title,
        snippet,
        authorName: m.authorName,
        createdAt: m.createdAt,
      });
    }
  }
  return hits
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30);
}
