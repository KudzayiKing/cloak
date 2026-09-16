/*
 * Ensures user-facing AI copy is branded as Cloaq AI. Internal provider names
 * and artifact identifiers may still exist in implementation files; they must
 * not leak through UI copy, demo processing details, or model status messages.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Check = { label: string; pass: boolean; detail?: string };
const checks: Check[] = [];
const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function stripInternalIdentifiers(src: string): string {
  return src
    .replace(/MODEL_MANIFEST\.gemma/g, "")
    .replace(/modelManifest\.gemma/g, "")
    .replace(/LocalGemmaProvider/g, "")
    .replace(/LocalGemmaStatus/g, "");
}

function check(label: string, pass: boolean, detail?: string) {
  checks.push({ label, pass, detail });
}

const uiFiles = [
  "src/app/layout.tsx",
  "src/app/globals.css",
  "src/components/cloak/marketing/intelligence-page.tsx",
  "src/components/cloak/marketing/home-sections-a.tsx",
  "src/components/cloak/marketing/home-sections-b.tsx",
  "src/components/cloak/marketing/product-mockup.tsx",
  "src/components/cloak/marketing/download-page.tsx",
  "src/components/cloak/marketing/pricing-page.tsx",
  "src/components/cloak/marketing/security-page.tsx",
  "src/components/cloak/messaging/chat-sidebar.tsx",
  "src/components/cloak/messaging/message-bubble.tsx",
  "src/components/cloak/messaging/message-composer.tsx",
  "src/components/cloak/messaging/conversation-security-panel.tsx",
  "src/components/cloak/settings/settings-page.tsx",
  "src/components/cloak/security/security-pages.tsx",
  "src/components/cloak/navigation/MarketingFooter.tsx",
  "src/lib/cloak/demo-data.ts",
  "src/ai/orchestrator/CloakOrchestrator.ts",
  "src/ai/models/modelManager.ts",
];

const forbidden = [
  /\bGemma\b/i,
  /Cloaq Intelligence/i,
  /Cloak Intelligence/i,
  /TranslateGemma/i,
  /EmbeddingGemma/i,
  /LocalGemmaProvider/i,
  /CloudGemmaProvider/i,
];

for (const file of uiFiles) {
  const body = stripInternalIdentifiers(stripComments(read(file)));
  const hits = forbidden
    .filter((pattern) => pattern.test(body))
    .map((pattern) => String(pattern));
  check(`${file} has no old AI brand names`, hits.length === 0, hits.join(", "));
}

const config = read("src/lib/cloak/config.ts");
check("public Cloaq AI env var exists", /NEXT_PUBLIC_CLOAQ_AI_MODEL_URL/.test(config));
check("Cloaq AI is the public display name", /displayName:\s*"Cloaq AI"/.test(config));

for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.label}${c.pass ? "" : `  [${c.detail}]`}`);
}
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n=== ${checks.length - failed}/${checks.length} AI copy checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
