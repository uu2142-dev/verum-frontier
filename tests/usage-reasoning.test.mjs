// Reasoning-token accounting for the OpenAI-shaped APIs (OpenAI + xAI).
// Run: npm test  (Node 24+ imports lib/*.ts directly — no build step, no deps)
//
// Billing rule under test, pinned from each provider's docs (2026-09-27):
//   xAI    — output_tokens / completion_tokens EXCLUDE reasoning, and reasoning
//            bills at the output rate, so billed output = visible + reasoning.
//            docs.x.ai/developers/rest-api-reference/inference/responses
//            docs.x.ai/developers/rest-api-reference/inference/chat-completions
//            docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing
//   OpenAI — output_tokens / completion_tokens already INCLUDE reasoning, so it
//            must never be added again.
//            developers.openai.com/api/docs/guides/token-counting
//            developers.openai.com/api/docs/guides/reasoning
// The usage objects below are the providers' own documented examples, verbatim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { billedOutputTokens, chatCompletionsUsage, responsesUsage } from "../lib/usage.ts";
import { buildReceipt, getModel } from "../lib/pricing.ts";

const NOW = new Date("2026-09-27T12:00:00Z");
const GROK = getModel("grok-4.5");
const SOL = getModel("gpt-5.6-sol");
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} !== ${expected}`);

// xAI POST /v1/responses response example.
const XAI_RESPONSES = {
  input_tokens: 32,
  input_tokens_details: { cached_tokens: 8 },
  output_tokens: 9,
  output_tokens_details: { reasoning_tokens: 110 },
  total_tokens: 151,
  num_sources_used: 0,
  num_server_side_tools_used: 0,
};

// xAI POST /v1/chat/completions response example.
const XAI_CHAT = {
  prompt_tokens: 32,
  completion_tokens: 9,
  total_tokens: 135,
  prompt_tokens_details: { text_tokens: 32, audio_tokens: 0, image_tokens: 0, cached_tokens: 6 },
  completion_tokens_details: {
    reasoning_tokens: 94, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0,
  },
  num_sources_used: 0,
};

// xAI deferred chat completion example — no reasoning.
const XAI_CHAT_NO_REASONING = {
  prompt_tokens: 31,
  completion_tokens: 11,
  total_tokens: 42,
  prompt_tokens_details: { text_tokens: 31, audio_tokens: 0, image_tokens: 0, cached_tokens: 0 },
  completion_tokens_details: {
    reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0,
  },
};

// xAI GET /v1/responses/{id} example — Responses surface, chat-shaped field names.
const XAI_RESPONSES_CHAT_SHAPED = {
  prompt_tokens: 32,
  completion_tokens: 9,
  total_tokens: 151,
  prompt_tokens_details: { text_tokens: 32, audio_tokens: 0, image_tokens: 0, cached_tokens: 8 },
  completion_tokens_details: {
    reasoning_tokens: 110, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0,
  },
  num_sources_used: 0,
};

// OpenAI reasoning guide, Responses usage example.
const OPENAI_RESPONSES = {
  input_tokens: 75,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 1186,
  output_tokens_details: { reasoning_tokens: 1024 },
  total_tokens: 1261,
};

// The same counts under Chat Completions names — the token-counting guide says
// Chat reports that same all-inclusive total as completion_tokens.
const OPENAI_CHAT = {
  prompt_tokens: 75,
  completion_tokens: 1186,
  total_tokens: 1261,
  prompt_tokens_details: { cached_tokens: 0 },
  completion_tokens_details: { reasoning_tokens: 1024 },
};

test("xAI Responses: reasoning is added to the visible output", () => {
  assert.deepEqual(responsesUsage(XAI_RESPONSES, "xai"), {
    inputTokens: 32, outputTokens: 119, cachedInputTokens: 8, reasoningTokens: 110,
  });
});

test("xAI Chat Completions: reasoning is added to the visible output", () => {
  assert.deepEqual(chatCompletionsUsage(XAI_CHAT, "xai"), {
    inputTokens: 32, outputTokens: 103, cachedInputTokens: 6, reasoningTokens: 94,
  });
});

test("xAI Responses with chat-shaped field names parses the same", () => {
  assert.deepEqual(responsesUsage(XAI_RESPONSES_CHAT_SHAPED, "xai"), responsesUsage(XAI_RESPONSES, "xai"));
});

test("no reasoning: output unchanged and no reasoningTokens field", () => {
  assert.deepEqual(chatCompletionsUsage(XAI_CHAT_NO_REASONING, "xai"), {
    inputTokens: 31, outputTokens: 11, cachedInputTokens: 0,
  });
});

test("OpenAI Responses: reasoning already in output_tokens is not double-counted", () => {
  assert.deepEqual(responsesUsage(OPENAI_RESPONSES, "openai"), {
    inputTokens: 75, outputTokens: 1186, cachedInputTokens: 0, reasoningTokens: 1024,
  });
});

test("OpenAI Chat Completions: reasoning already in completion_tokens is not double-counted", () => {
  assert.deepEqual(chatCompletionsUsage(OPENAI_CHAT, "openai"), {
    inputTokens: 75, outputTokens: 1186, cachedInputTokens: 0, reasoningTokens: 1024,
  });
});

test("guard: never adds reasoning when total = input + output and reasoning ⊆ output", () => {
  for (const input of [0, 1, 75, 10_000]) {
    for (const output of [1, 9, 1186, 4096]) {
      for (const reasoning of [1, Math.floor(output / 2), output]) {
        assert.equal(billedOutputTokens(input, output, reasoning, input + output), output);
      }
    }
  }
});

test("guard: without total_tokens, adds reasoning only when it cannot be part of output", () => {
  assert.equal(billedOutputTokens(32, 9, 110, null), 119);   // 110 > 9: must be separate
  assert.equal(billedOutputTokens(75, 1186, 1024, null), 1186); // could be included: trust as reported
});

test("missing or malformed usage yields zeros, not NaN", () => {
  const zero = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  assert.deepEqual(chatCompletionsUsage(undefined, "openai"), zero);
  assert.deepEqual(responsesUsage(null, "openai"), zero);
  assert.deepEqual(responsesUsage({ output_tokens: "9", output_tokens_details: { reasoning_tokens: -5 } }, "openai"), zero);
});

test("grok-4.5 receipt bills reasoning at the output rate and shows the split", () => {
  const r = buildReceipt(GROK, responsesUsage(XAI_RESPONSES, "xai"), 0, NOW);
  // 24 fresh in × $2/M + 8 cached × $0.30/M + (9 + 110) out × $6/M
  //   = 0.000048 + 0.0000024 + 0.000714 = $0.0007644
  close(r.directUsd, 0.0007644, "directUsd");
  close(r.totalUsd, 0.0007644 * 1.2, "totalUsd");
  assert.equal(r.usage.outputTokens, 119);
  assert.equal(r.usage.reasoningTokens, 110);
  // Before the fix the same call billed only the 9 visible tokens: $0.0001044,
  // 7.3× less than xAI charges.
  const old = buildReceipt(GROK, { inputTokens: 32, outputTokens: 9, cachedInputTokens: 8 }, 0, NOW);
  close(old.directUsd, 0.0001044, "pre-fix directUsd");
});

test("gpt-5.6-sol receipt is unchanged by the fix", () => {
  const r = buildReceipt(SOL, responsesUsage(OPENAI_RESPONSES, "openai"), 0, NOW);
  // 75 in × $4/M + 1186 out × $20/M = 0.0003 + 0.02372 = $0.02402
  close(r.directUsd, 0.02402, "directUsd");
});
