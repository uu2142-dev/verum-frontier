// The in-browser verifier (lib/sealVerify.ts) recomputes each exchange's TIMING
// leaf over the PROVIDER's model name, which it looks up from the exported
// display id in its own append-only map. A model missing from that map makes a
// genuine record read as tampered. This keeps the map in step with the price
// sheet: every model the gate serves, or ever served, must map to the exact
// providerModel the gate hashed.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_MODELS, RETIRED_MODELS } from "../lib/pricing.ts";
import { PROVIDER_MODEL } from "../lib/sealVerify.ts";

test("every live model is in the verifier map with its providerModel", () => {
  for (const m of ALL_MODELS) {
    assert.equal(PROVIDER_MODEL[m.id], m.providerModel, `lib/sealVerify.ts PROVIDER_MODEL is missing or wrong for live model ${m.id}`);
  }
});

test("every retired model stays in the verifier map, so its sealed sessions still verify", () => {
  for (const m of RETIRED_MODELS) {
    assert.equal(PROVIDER_MODEL[m.id], m.providerModel, `lib/sealVerify.ts PROVIDER_MODEL is missing or wrong for retired model ${m.id}`);
  }
});

test("every retired model's successor is a live model", () => {
  const live = new Set(ALL_MODELS.map(m => m.id));
  for (const m of RETIRED_MODELS) {
    if (m.successorId) assert.ok(live.has(m.successorId), `${m.id} names successor ${m.successorId}, which is not live`);
  }
});
