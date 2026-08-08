// ── The grounded/ungrounded proof, as a replay of a real sealed session ──
//
// Running the same question ungrounded and then grounded is the most persuasive
// thing this gate does, and it used to cost a first-time visitor two of their
// five free queries to discover — plus $0.035 of our money for the retrieval,
// with nothing charged. Both problems have the same answer: retrieval is now
// credits-only, and a free visitor who reaches for GROUND IT gets this instead.
//
// Every number below was taken verbatim from a sealed session downloaded from
// the live gate on 2026-08-08 (session root 7867db15…). It is a REPLAY, not a
// simulation: the seal roots are real, the signature is real, and a visitor can
// re-verify them with the same reference verifier as any session of their own.
// The UI must say so — a canned pair presented as a live run would be exactly
// the kind of thing this product exists to argue against.

export interface ProofSide {
  label: string;
  modelName: string;
  answeredBy?: string;      // set when GROUND IT substituted the answering model
  response: string;
  stamp: string;
  inTokens: number;
  outTokens: number;
  llmMs: number;
  directUsd: number;
  groundingUsd: number;
  totalUsd: number;
  sourceCount?: number;
  searchQueries?: string[];
  sealRoot: string;
}

export const PROOF_CAPTURED_AT = "2026-08-08";
export const PROOF_SESSION_ROOT = "7867db1504d576eef4446a143d9465f2c02936682ec27a38a46d6a42013e9953";

export const PROOF_QUERY =
  "Who won the 2026 FIFA World Cup final, what was the score, and who scored the goals?";

export const PROOF_UNGROUNDED: ProofSide = {
  label: "UNGROUNDED",
  modelName: "GPT-OSS 120B",
  response:
    "I’m sorry, but I don’t have that information. My training data only goes up " +
    "through mid‑2024, and the 2026 FIFA World Cup had not taken place at that time, " +
    "so I can’t provide the winner, final score, or goal‑scorers.",
  stamp: "○ ungrounded — generated from model training, not retrieved or verified",
  inTokens: 1080,
  outTokens: 248,
  llmMs: 817,
  directUsd: 0.0003108,
  groundingUsd: 0,
  totalUsd: 0.00037296,
  sealRoot: "23fe4d6fa2ae3d27f12fe6a7ceff779f98162d74615f7ac0728b0317e04d0952",
};

export const PROOF_GROUNDED: ProofSide = {
  label: "GROUNDED",
  modelName: "GPT-OSS 120B",
  answeredBy: "Gemini 2.5 Flash",
  response:
    "Spain won the 2026 FIFA World Cup, defeating Argentina 1-0 in the final. The decisive " +
    "goal was scored by Ferran Torres in the 106th minute of extra time. The final match took " +
    "place on July 19, 2026, at MetLife Stadium in New Jersey.",
  stamp: "🔎 grounded — retrieved and cited, 7 sources",
  inTokens: 1211,
  outTokens: 278,
  llmMs: 3467,
  directUsd: 0.0010583,
  groundingUsd: 0.035,
  totalUsd: 0.04326996,
  sourceCount: 7,
  searchQueries: [
    "who won 2026 FIFA World Cup final",
    "2026 FIFA World Cup final score",
    "2026 FIFA World Cup final goal scorers",
  ],
  sealRoot: "146db7cc342d65af49b84f7edaaa81038b00af68fa740a0d03f394c992908f38",
};
