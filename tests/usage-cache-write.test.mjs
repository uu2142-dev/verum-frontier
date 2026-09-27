// OpenAI cache-write accounting for gpt-5.6-sol receipts.
// Run: npm test  (Node 24+ imports lib/*.ts directly — no build step, no deps)
//
// Billing rule under test, pinned from OpenAI's own docs (read 2026-09-27):
//   developers.openai.com/api/docs/guides/prompt-caching
//     "For GPT-5.6 and later, cache writes cost 1.25× the standard, uncached
//      input-token rate." Implicit caching is the default on both APIs
//     (prompt_cache_options.mode "Defaults to `implicit`" —
//      developers.openai.com/api/reference/resources/responses/methods/create
//      and developers.openai.com/api/reference/resources/chat).
//   Fields: Responses usage.input_tokens_details.cache_write_tokens;
//           Chat Completions usage.prompt_tokens_details.cache_write_tokens.
//   The guide's "Calculate input cost" function is the oracle below: written
//   tokens sit INSIDE input_tokens, disjoint from cached_tokens.
//   developers.openai.com/api/docs/pricing — gpt-5.6-sol $4.00 input,
//     $0.40 cached input, $5.00 cache writes (Standard, short context).
// xAI documents no cache-write field or charge
// (docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing),
// so its receipts must not change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatCompletionsUsage, responsesUsage } from "../lib/usage.ts";
import { buildReceipt, getModel } from "../lib/pricing.ts";

const NOW = new Date("2026-09-27T12:00:00Z");
const SOL = getModel("gpt-5.6-sol");
const GROK = getModel("grok-4.5");
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} !== ${expected}`);

// OpenAI's documented input-cost formula (prompt-caching guide, "Monitor cache
// performance"), ported as the oracle the receipt must agree with.
function openaiInputCost(usage, inputPricePerMillion, cacheInputMultiplier = 0.1, cacheWriteMultiplier = 1.25) {
  const inputTokens = usage.input_tokens;
  const cachedTokens = usage.input_tokens_details.cached_tokens;
  const cacheWriteTokens = usage.input_tokens_details.cache_write_tokens;
  const ordinaryInputTokens = inputTokens - cachedTokens - cacheWriteTokens;
  const weighted = ordinaryInputTokens + cachedTokens * cacheInputMultiplier + cacheWriteTokens * cacheWriteMultiplier;
  return (weighted * inputPricePerMillion) / 1_000_000;
}

// The usage objects in OpenAI's API reference examples, verbatim (all zero).
const REF_RESPONSES = {
  input_tokens: 0,
  input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
  output_tokens: 0,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 0,
};
const REF_CHAT = {
  completion_tokens: 0,
  prompt_tokens: 0,
  total_tokens: 0,
  completion_tokens_details: {
    accepted_prediction_tokens: 0, audio_tokens: 0, reasoning_tokens: 0, rejected_prediction_tokens: 0, text_tokens: 0,
  },
  prompt_tokens_details: { audio_tokens: 0, cache_write_tokens: 0, cached_tokens: 0, image_tokens: 0, text_tokens: 0 },
};

// A second conversation turn in the documented shape: 1,800 tokens read from the
// cache, the next 1,200 written to it, 500 past the breakpoint billed plainly.
const TURN_RESPONSES = {
  input_tokens: 3500,
  input_tokens_details: { cache_write_tokens: 1200, cached_tokens: 1800 },
  output_tokens: 400,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 3900,
};
const TURN_CHAT = {
  completion_tokens: 400,
  prompt_tokens: 3500,
  total_tokens: 3900,
  completion_tokens_details: { reasoning_tokens: 0 },
  prompt_tokens_details: { cache_write_tokens: 1200, cached_tokens: 1800 },
};
const TURN_USAGE = { inputTokens: 3500, outputTokens: 400, cachedInputTokens: 1800, cacheWriteTokens: 1200 };

test("reference examples (all zero) parse to zeros with no cacheWriteTokens field", () => {
  const zero = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  assert.deepEqual(responsesUsage(REF_RESPONSES, "openai"), zero);
  assert.deepEqual(chatCompletionsUsage(REF_CHAT, "openai"), zero);
});

test("OpenAI Responses: input_tokens_details.cache_write_tokens → cacheWriteTokens", () => {
  assert.deepEqual(responsesUsage(TURN_RESPONSES, "openai"), TURN_USAGE);
});

test("OpenAI Chat Completions: prompt_tokens_details.cache_write_tokens → cacheWriteTokens", () => {
  assert.deepEqual(chatCompletionsUsage(TURN_CHAT, "openai"), TURN_USAGE);
});

test("gpt-5.6-sol receipt bills written tokens at $5.00/M and matches OpenAI's formula", () => {
  for (const r of [
    buildReceipt(SOL, responsesUsage(TURN_RESPONSES, "openai"), 0, NOW),
    buildReceipt(SOL, chatCompletionsUsage(TURN_CHAT, "openai"), 0, NOW),
  ]) {
    assert.equal(r.uncachedInputTokens, 500);
    assert.equal(r.cachedInputTokens, 1800);
    assert.equal(r.cacheWriteTokens, 1200);
    assert.equal(r.cacheRatePerM, 0.4);      // published cached-input rate
    assert.equal(r.cacheWriteRatePerM, 5);   // published cache-write rate
    // 500 × $4/M + 1,800 × $0.40/M + 1,200 × $5/M + 400 × $20/M
    //   = 0.002 + 0.00072 + 0.006 + 0.008 = $0.01672
    close(r.directUsd, openaiInputCost(TURN_RESPONSES, 4) + 400 * 20 / 1_000_000, "oracle");
    close(r.directUsd, 0.01672, "directUsd");
    close(r.totalUsd, 0.01672 * 1.2, "totalUsd");
  }
  // Before the fix the 1,200 written tokens billed at $4/M: $0.01552, which is
  // $0.0012 (1,200 × $1/M, the 0.25× premium) under what OpenAI charges.
  const old = buildReceipt(SOL, { inputTokens: 3500, outputTokens: 400, cachedInputTokens: 1800 }, 0, NOW);
  close(old.directUsd, 0.01552, "pre-fix directUsd");
});

// The guide's worked multiples: "Writing a prefix once and fully reusing it once
// costs 1.35× its ordinary input cost, compared with 2× ... across ten requests,
// one write and nine full reads cost 2.15×, compared with 10× without caching."
test("receipts reproduce the guide's 1.35× and 2.15× write-then-read multiples", () => {
  const P = 10_000;
  const ordinary = P * 4 / 1_000_000; // $0.04: the prefix once at the plain input rate
  const write = { input_tokens: P, input_tokens_details: { cache_write_tokens: P, cached_tokens: 0 }, output_tokens: 0, total_tokens: P };
  const read = { input_tokens: P, input_tokens_details: { cache_write_tokens: 0, cached_tokens: P }, output_tokens: 0, total_tokens: P };
  const cost = u => buildReceipt(SOL, responsesUsage(u, "openai"), 0, NOW).directUsd;
  close(cost(write) + cost(read), 1.35 * ordinary, "one write + one read");
  close(cost(write) + 9 * cost(read), 2.15 * ordinary, "one write + nine reads");
});

test("xAI: a cache_write_tokens field is ignored on both APIs — receipts unchanged", () => {
  const xaiResponses = {
    input_tokens: 125, input_tokens_details: { cached_tokens: 98, cache_write_tokens: 27 },
    output_tokens: 48, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 173,
  };
  const xaiChat = {
    prompt_tokens: 125, completion_tokens: 48, total_tokens: 173,
    prompt_tokens_details: { text_tokens: 125, audio_tokens: 0, image_tokens: 0, cached_tokens: 98, cache_write_tokens: 27 },
    completion_tokens_details: { reasoning_tokens: 0 },
  };
  const expected = { inputTokens: 125, outputTokens: 48, cachedInputTokens: 98 };
  assert.deepEqual(responsesUsage(xaiResponses, "xai"), expected);
  assert.deepEqual(chatCompletionsUsage(xaiChat, "xai"), expected);
  const r = buildReceipt(GROK, chatCompletionsUsage(xaiChat, "xai"), 0, NOW);
  assert.equal(r.cacheWriteTokens, 0);
  // 27 fresh × $2/M + 98 cached × $0.30/M + 48 out × $6/M
  close(r.directUsd, 0.000054 + 0.0000294 + 0.000288, "grok directUsd");
});

test("malformed cache_write_tokens is read as zero, never NaN", () => {
  for (const bad of ["1200", -5, NaN, null, Infinity]) {
    const u = { ...TURN_RESPONSES, input_tokens_details: { cached_tokens: 1800, cache_write_tokens: bad } };
    assert.deepEqual(responsesUsage(u, "openai"), { inputTokens: 3500, outputTokens: 400, cachedInputTokens: 1800 });
  }
});
