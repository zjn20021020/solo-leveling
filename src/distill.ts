import { randomUUID } from "node:crypto";
import type {
  EmbeddedRunner,
  FrictionReading,
  Journal,
  LessonPlan,
  SkillRecord,
} from "./types.js";
import { readReplyText } from "./util/reply-text.js";
import { parseEmbeddedObject } from "./util/json-carve.js";

const MIN_BODY_CHARS = 50;
const MAX_SLUG_CHARS = 64;

/**
 * The distiller. Given the conversation transcript, the friction reading, and
 * the catalogue of skills already on record, it decides in one model call
 * whether the episode is worth keeping and — if so — writes the lesson body.
 *
 * Output language follows the conversation: a Chinese exchange yields a Chinese
 * lesson, an English one yields English.
 */
export async function distillLesson(input: {
  transcript: string;
  reading: FrictionReading;
  catalogue: SkillRecord[];
  run: EmbeddedRunner;
  homeDir: string;
  workspaceDir: string;
  timeoutMs: number;
  provider?: string;
  model?: string;
  journal: Journal;
}): Promise<LessonPlan> {
  const began = Date.now();
  try {
    const reply = await input.run({
      sessionId: `solo-leveling/distill/${randomUUID()}`,
      runId: randomUUID(),
      sessionFile: `${input.homeDir}/sessions/sl-distill-${randomUUID()}.jsonl`,
      workspaceDir: input.workspaceDir,
      prompt: composeDistillPrompt(input.transcript, input.reading, input.catalogue),
      timeoutMs: input.timeoutMs,
      provider: input.provider,
      model: input.model,
    });

    const plan = decodeLesson(readReplyText(reply), input.catalogue, input.journal);
    input.journal.note(
      `distill done (${Date.now() - began}ms): mode=${plan.mode}`,
    );
    return plan;
  } catch (err) {
    input.journal.flag(
      `distill failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { mode: "skip", rationale: "distiller error" };
  }
}

function composeDistillPrompt(
  transcript: string,
  reading: FrictionReading,
  catalogue: SkillRecord[],
): string {
  const known =
    catalogue.length > 0
      ? catalogue.map((s) => `• ${s.slug} — ${s.summary}`).join("\n")
      : "• (none yet)";

  const readout = [
    `corrections: ${reading.correctionCount}`,
    `tone: ${reading.tone}`,
    `evidence: ${JSON.stringify(reading.evidenceQuotes)}`,
    `gist: ${reading.correctionGist || "(none)"}`,
  ].join("\n");

  return [
    "A friction episode just occurred: the user pushed back or got heated. Your",
    "job is to decide whether there is a durable, reusable lesson here and, if so,",
    "write it. Reply with one JSON object only — no fences, no commentary.",
    "",
    "## Friction readout",
    readout,
    "",
    "## Lessons already on record",
    known,
    "",
    "## Conversation",
    transcript,
    "",
    "## Decide one of three modes",
    '  • "new"    — a reusable lesson exists and no record above covers it.',
    '  • "revise" — a record above covers this ground but is wrong/incomplete',
    "               given what just happened; rewrite it in full.",
    '  • "skip"   — nothing durable (a one-off, a typo, already covered well).',
    "",
    "Hold a high bar. Only keep lessons likely to recur across future sessions.",
    "",
    "## When new or revise, write the body in the conversation's language",
    "Use this section skeleton (NO YAML frontmatter — body only):",
    "",
    "  ## 何时适用 / When this applies",
    "  <the recurring situation that should trigger this lesson>",
    "",
    "  ## 上次的偏差 / What missed last time",
    "  <what the assistant did that drew the correction or frustration>",
    "",
    "  ## 应当如何 / The approach that worked",
    "  <the concrete, step-wise approach the user accepted>",
    "",
    "Match the language to the conversation (Chinese exchange → Chinese body).",
    "",
    "## JSON shapes",
    'new:    { "mode": "new", "slug": "<kebab-case, unused>", "summary": "<one line>",',
    '          "body": "<markdown body>", "rationale": "<short why>" }',
    'revise: { "mode": "revise", "slug": "<an existing slug>", "summary": "<one line>",',
    '          "body": "<full rewritten body>", "rationale": "<short why>" }',
    'skip:   { "mode": "skip", "rationale": "<short why>" }',
    "",
    "Rules: slug is lowercase letters/digits/hyphens only; body carries no",
    "frontmatter; keep the body tight — it is a lesson, not a manual.",
  ].join("\n");
}

/**
 * Decode the distiller's JSON into a LessonPlan. Exported for direct testing.
 */
export function decodeLesson(
  raw: string,
  catalogue: SkillRecord[],
  journal: Journal,
): LessonPlan {
  const obj = parseEmbeddedObject(raw);
  if (!obj) return { mode: "skip", rationale: "distiller returned no JSON" };

  const mode = obj.mode;
  if (mode === "skip") {
    return { mode: "skip", rationale: str(obj.rationale) || "nothing worth keeping" };
  }
  if (mode !== "new" && mode !== "revise") {
    return { mode: "skip", rationale: `unrecognised mode: ${String(mode)}` };
  }

  const slug = kebab(str(obj.slug));
  const summary = str(obj.summary).replace(/\s+/g, " ").trim();
  const body = dropFrontmatter(str(obj.body).trim());
  const rationale = str(obj.rationale);

  if (!slug) return { mode: "skip", rationale: "missing a usable slug" };
  if (!summary) return { mode: "skip", rationale: "missing a summary" };
  if (body.length < MIN_BODY_CHARS) return { mode: "skip", rationale: "body too thin" };

  const onRecord = new Set(catalogue.map((s) => s.slug));

  // A revise that points at an unknown slug is really a new lesson.
  if (mode === "revise" && !onRecord.has(slug)) {
    journal.note(`distill: revise target '${slug}' is unknown — treating as new`);
    return { mode: "new", slug, summary, body, rationale };
  }

  return { mode, slug, summary, body, rationale };
}

/** Strip a stray frontmatter block the model may have prepended. */
function dropFrontmatter(body: string): string {
  if (!body.startsWith("---")) return body;
  const close = body.indexOf("\n---", 3);
  if (close < 0) return body;
  return body.slice(close + 4).replace(/^\s*\n/, "");
}

/** Normalise an arbitrary string into a kebab-case slug. */
function kebab(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/g, "");
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
