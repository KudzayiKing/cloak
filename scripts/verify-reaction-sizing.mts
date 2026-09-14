/*
 * Guards the reaction emoji sizing rules.
 *
 * Two things have to stay true, and neither is enforced by the type system:
 *
 *  1. The emoji rendered on a message (ReactionRow in message-bubble.tsx) and
 *     the emoji rendered in the picker (MessageActionSheet) must be the SAME
 *     size. They were allowed to drift before (h-7 vs h-7 with a different
 *     button box), which made the picker look like a different product from
 *     the thing it produces.
 *  2. The picker strip must not show a scrollbar. The strip is `overflow-x-auto`
 *     and 15 reactions are always wider than a phone, so a rail would be
 *     permanently visible on the most-used surface in the app.
 *
 * The `.cloak-scroll-hidden` class is asserted to actually EXIST in globals.css,
 * because a typo'd class name is a silent no-op — the strip would keep its
 * scrollbar and nothing would fail.
 *
 * Run: node_modules/.bin/tsx scripts/verify-reaction-sizing.mts
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

const root = process.cwd();
const bubble = readFileSync(
  join(root, "src/components/cloak/messaging/message-bubble.tsx"),
  "utf8"
);
const sheet = readFileSync(
  join(root, "src/components/cloak/messaging/message-action-sheet.tsx"),
  "utf8"
);
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

/** The className of the <img> tag whose attributes contain `needle`. */
function classAfter(src: string, needle: string): string {
  for (const tag of src.matchAll(/<img\b[^>]*\/>/g)) {
    if (!tag[0].includes(needle)) continue;
    const cls = tag[0].match(/className="([^"]*)"/);
    return cls ? cls[1] : "";
  }
  return "";
}

/** The className of the element that scrolls the picker strip. */
function stripClass(src: string): string {
  const m = src.match(/className="([^"]*overflow-x-auto[^"]*)"/);
  return m ? m[1] : "";
}

/** Reads the number out of an `h-N` utility. */
function sizeOf(cls: string): string | null {
  const m = cls.match(/\bh-(\d+)\b/);
  return m ? m[1] : null;
}

/* ---------- 1. the two emoji render at the same size ---------- */

const chatEmoji = classAfter(bubble, "src={option.src}");
const pickerEmoji = classAfter(sheet, "src={reaction.src}");

check("chat reaction emoji found", chatEmoji.length > 0, true);
check("picker reaction emoji found", pickerEmoji.length > 0, true);

check("chat emoji is h-9", sizeOf(chatEmoji), "9");
check("picker emoji is h-9", sizeOf(pickerEmoji), "9");

check(
  "chat and picker emoji use the identical class",
  chatEmoji,
  pickerEmoji
);
check(
  "emoji box is square (h and w match) in chat",
  chatEmoji.match(/\bw-(\d+)\b/)?.[1],
  sizeOf(chatEmoji)
);
check(
  "emoji box is square (h and w match) in picker",
  pickerEmoji.match(/\bw-(\d+)\b/)?.[1],
  sizeOf(pickerEmoji)
);

/* ---------- 2. the boxes around those emoji still fit them ---------- */

// The chat chip is the tappable pill: its height must not clip the emoji.
const chatChip = bubble.match(/className=\{cn\(\s*"inline-flex h-(\d+)/)?.[1];
check("chat chip found", Boolean(chatChip), true);
check(
  "chat chip is tall enough for the emoji",
  Number(chatChip) >= Number(sizeOf(chatEmoji)),
  true
);

// The picker button must keep padding around the emoji, or the hover ring
// touches the artwork.
const pickerButton = sheet.match(
  /className="grid h-(\d+) w-(\d+) shrink-0/
);
check("picker button found", Boolean(pickerButton), true);
check("picker button is square", pickerButton?.[1], pickerButton?.[2]);
check(
  "picker button is larger than the emoji (padding preserved)",
  Number(pickerButton?.[1]) > Number(sizeOf(pickerEmoji)),
  true
);

/* ---------- 3. the picker strip hides its scrollbar ---------- */

const strip = stripClass(sheet);
check("picker strip scrolls horizontally", strip.includes("overflow-x-auto"), true);
check("picker strip opts out of the scrollbar", strip.includes("cloak-scroll-hidden"), true);

// A class that does not exist is a silent no-op — assert it is really defined.
const block = css.match(/\.cloak-scroll-hidden\s*\{([^}]*)\}/)?.[1] ?? "";
check(".cloak-scroll-hidden is defined in globals.css", block.length > 0, true);
check(
  "  ... sets scrollbar-width: none (Firefox)",
  /scrollbar-width:\s*none/.test(block),
  true
);
check(
  "  ... sets -ms-overflow-style: none (legacy Edge)",
  /-ms-overflow-style:\s*none/.test(block),
  true
);
check(
  "  ... hides the WebKit scrollbar",
  /\.cloak-scroll-hidden::-webkit-scrollbar\s*\{[^}]*display:\s*none/.test(css),
  true
);
// The hidden variant must not disable scrolling itself.
check("picker strip is not overflow-hidden", strip.includes("overflow-hidden"), false);

/* ---------- report ---------- */

for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.label}${c.pass ? "" : `  [${c.detail}]`}`);
}
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n=== ${checks.length - failed}/${checks.length} reaction-sizing checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
