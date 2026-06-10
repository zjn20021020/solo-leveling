import { randomUUID } from "node:crypto";
import type { EmbeddedRunner, FrictionReading, Journal, Tone } from "./types.js";
import { readReplyText } from "./util/reply-text.js";
import { parseEmbeddedObject } from "./util/json-carve.js";

/**
 * The friction scan. It looks only at what the user said this turn and asks a
 * model to grade two things: how many corrections were issued, and how heated
 * the wording was. Assistant replies are not shown — the verdict rests purely
 * on the user's own words.
 *
 * The scan errs toward calm/zero: ambiguity resolves downward, because a false
 * positive here costs a wasted distillation pass and possibly a junk skill.
 */
export async function scanFriction(input: {
  utterance: string;
  run: EmbeddedRunner;
  homeDir: string;
  workspaceDir: string;
  timeoutMs: number;
  provider?: string;
  model?: string;
  journal: Journal;
}): Promise<FrictionReading> {
  const blank: FrictionReading = {
    correctionCount: 0,
    tone: "calm",
    evidenceQuotes: [],
    correctionGist: "",
  };

  if (!input.utterance.trim()) return blank;

  const began = Date.now();
  try {
    const reply = await input.run({
      sessionId: `solo-leveling/friction/${randomUUID()}`,
      runId: randomUUID(),
      sessionFile: `${input.homeDir}/sessions/sl-friction-${randomUUID()}.jsonl`,
      workspaceDir: input.workspaceDir,
      prompt: composeFrictionPrompt(input.utterance),
      timeoutMs: input.timeoutMs,
      provider: input.provider,
      model: input.model,
    });

    const reading = decodeFriction(readReplyText(reply));
    if (!reading) {
      input.journal.flag("friction scan: reply could not be decoded");
      return blank;
    }

    input.journal.note(
      `friction scan done (${Date.now() - began}ms): corrections=${reading.correctionCount}, tone=${reading.tone}`,
    );
    return reading;
  } catch (err) {
    input.journal.flag(
      `friction scan failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return blank;
  }
}

function composeFrictionPrompt(utterance: string): string {
  return [
    "You grade one conversation turn from the USER's side only. You never see the",
    "assistant's replies, so judge strictly from the user's wording. Emit a single",
    "JSON object and nothing else — no prose, no code fences.",
    "",
    "Grade two independent dimensions:",
    "",
    "[1] corrections — an integer count of distinct moments where the user states",
    "the prior output was wrong/incomplete/off, or hands over a corrected version.",
    'Cues: "that\'s wrong", "no, it should be", "redo it", "不对", "错了", "应该是",',
    '"你理解错了", "重新弄". Cap at one per user message even if phrased many ways.',
    "",
    "[2] tone — the single most heated register present, from this ladder:",
    '  • "calm"     — neutral, polite, or no negativity.',
    '  • "annoyed"  — mild impatience or dissatisfaction ("not quite", "再看看").',
    '  • "agitated" — clear exasperation, repetition, raised voice',
    '                 ("已经说了好几遍", "怎么还不对", "I already told you").',
    '  • "hostile"  — insults or open anger aimed at the assistant',
    '                 ("你这个蠢货", "真的服了", "useless").',
    "When torn between two rungs, choose the calmer one.",
    "",
    "Also return:",
    "  • quotes — up to 8 short verbatim fragments backing the tone (empty if calm).",
    "  • gist — one short sentence on what the user wanted fixed (empty if nothing).",
    "",
    "Respond with exactly this JSON shape:",
    '{ "corrections": <int>=0>, "tone": "calm|annoyed|agitated|hostile",',
    '  "quotes": [<string>...], "gist": "<string>" }',
    "",
    "USER turn:",
    utterance,
  ].join("\n");
}

/**
 * Decode the friction JSON. Exported for direct unit testing without a live
 * model.
 */
export function decodeFriction(raw: string): FrictionReading | null {
  const obj = parseEmbeddedObject(raw);
  if (!obj) return null;

  const corrections = obj.corrections;
  const count =
    typeof corrections === "number" && corrections >= 0 ? Math.trunc(corrections) : 0;

  const quotes = Array.isArray(obj.quotes)
    ? obj.quotes.filter((q): q is string => typeof q === "string").slice(0, 8)
    : [];

  const gist = typeof obj.gist === "string" ? obj.gist.trim().slice(0, 300) : "";

  return {
    correctionCount: count,
    tone: asTone(obj.tone),
    evidenceQuotes: quotes,
    correctionGist: gist,
  };
}

function asTone(value: unknown): Tone {
  return value === "annoyed" || value === "agitated" || value === "hostile"
    ? value
    : "calm";
}
