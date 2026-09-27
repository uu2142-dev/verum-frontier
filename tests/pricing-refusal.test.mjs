// Receipt math for provider-declined turns (Anthropic refusals).
// Run: npm test  (Node 24+ imports lib/pricing.ts directly — no build step, no deps)
//
// Billing rule under test, pinned in lib/pricing.ts from
// platform.claude.com/docs/en/build-with-claude/refusals-and-fallback (2026-09-27):
// a refusal before any output is billed only for bio / frontier_llm /
// reasoning_extraction; any other category, or null, is not billed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLED_PREOUTPUT_REFUSAL_CATEGORIES,
  buildDeclinedReceipt,
  buildReceipt,
  getModel,
  providerBillsRefusal,
} from "../lib/pricing.ts";

const NOW = new Date("2026-09-27T12:00:00Z");
const FABLE = getModel("claude-fable-5");
// Shape of Anthropic's documented refusal example: 412 in, 0 out, empty content.
const USAGE = { inputTokens: 412, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 };

function assertNotCharged(category) {
  const r = buildDeclinedReceipt(FABLE, USAGE, category, NOW);
  assert.equal(r.directUsd, 0);
  assert.equal(r.groundingUsd, 0);
  assert.equal(r.infraUsd, 0);
  assert.equal(r.supportUsd, 0);
  assert.deepEqual(r.supportSplit, { server: 0, development: 0, steward: 0, reserve: 0 });
  assert.equal(r.totalUsd, 0);
  assert.equal(r.chargedUsd, 0);
  // The reported counts stay visible, labeled as reported rather than billed.
  assert.deepEqual(r.usage, USAGE);
  assert.equal(r.uncachedInputTokens, 412);
  assert.deepEqual(r.refusal, {
    category,
    providerBilled: false,
    usageLabel: "reported, not billed by provider",
  });
  return r;
}

function assertCharged(category) {
  const r = buildDeclinedReceipt(FABLE, USAGE, category, NOW);
  const normal = buildReceipt(FABLE, USAGE, 0, NOW);
  // Exactly the ordinary cost-plus receipt, plus the refusal block.
  const { refusal, ...rest } = r;
  assert.deepEqual(rest, normal);
  // 412 input tokens × $10/M = $0.00412 direct; × 1.20 cost-plus = $0.004944.
  assert.equal(r.directUsd, 0.00412);
  assert.ok(Math.abs(r.totalUsd - 0.004944) < 1e-9, `totalUsd ${r.totalUsd}`);
  assert.deepEqual(refusal, {
    category,
    providerBilled: true,
    usageLabel: "billed by provider — pre-output refusal in a billed category",
  });
  return r;
}

test("the billed set matches Anthropic's table as pinned 2026-09-27", () => {
  assert.deepEqual([...BILLED_PREOUTPUT_REFUSAL_CATEGORIES].sort(), ["bio", "frontier_llm", "reasoning_extraction"]);
});

test("cyber refusal before output: $0 charged", () => { assertNotCharged("cyber"); });
test("general_harms refusal before output: $0 charged", () => { assertNotCharged("general_harms"); });
test("null-category refusal before output: $0 charged", () => { assertNotCharged(null); });
test("bio refusal before output: charged as usual", () => { assertCharged("bio"); });
test("reasoning_extraction refusal before output: charged as usual", () => { assertCharged("reasoning_extraction"); });
test("frontier_llm refusal before output: charged as usual", () => { assertCharged("frontier_llm"); });

test("a category not in the pinned table is treated as unbilled (gate absorbs, never over-charges)", () => {
  assertNotCharged("some_future_category");
});

test("a refusal carrying output tokens is billed in any category (mid-output rule)", () => {
  const usage = { inputTokens: 412, outputTokens: 30 };
  assert.equal(providerBillsRefusal("cyber", 30), true);
  const r = buildDeclinedReceipt(FABLE, usage, "cyber", NOW);
  const { refusal, ...rest } = r;
  assert.deepEqual(rest, buildReceipt(FABLE, usage, 0, NOW));
  assert.equal(refusal.providerBilled, true);
  assert.match(refusal.usageLabel, /declined after output began/);
});

test("an answered turn's receipt carries no refusal block (RECEIPT leaf shape unchanged)", () => {
  const r = buildReceipt(FABLE, { inputTokens: 412, outputTokens: 200 }, 0, NOW);
  assert.equal("refusal" in r, false);
});
