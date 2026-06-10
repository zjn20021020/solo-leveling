import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EmbeddedRunner, Journal } from "./types.js";
import type { SkillRegistry } from "./registry.js";
import type { SkillVault } from "./vault.js";
import { readReplyText } from "./util/reply-text.js";

/**
 * Build the "what did I learn" recap shown on the first turn of a session.
 *
 * It asks the registry which skills are newer than the last recap marker,
 * reads their bodies from the vault, has a model phrase a short digest, and
 * optionally drops a purge script the user can run to delete any of them.
 * Returns the digest text to surface in the conversation, or null when there
 * is nothing fresh to report.
 */
export async function buildRecap(input: {
  registry: SkillRegistry;
  vault: SkillVault;
  run: EmbeddedRunner;
  stateDir: string;
  homeDir: string;
  workspaceDir: string;
  timeoutMs: number;
  provider?: string;
  model?: string;
  enabled: boolean;
  writePurgeScript: boolean;
  journal: Journal;
}): Promise<string | null> {
  const now = () => new Date().toISOString();

  if (!input.enabled) {
    input.journal.trace?.("recap disabled by config");
    return null;
  }

  input.registry.prepare();

  // First session ever: seed the marker, show nothing.
  if (!input.registry.hasRecapMarker()) {
    input.journal.trace?.("no recap marker yet — seeding and staying quiet");
    input.registry.markRecapShown(now());
    return null;
  }

  const fresh = input.registry.freshSinceLastRecap();
  if (fresh.length === 0) {
    input.journal.trace?.("nothing new since last recap");
    input.registry.markRecapShown(now());
    return null;
  }

  input.journal.note(`recap: ${fresh.length} skill(s) learned since last time`);

  // Pull bodies that are still readable.
  const dossier: Array<{ slug: string; text: string }> = [];
  for (const rec of fresh) {
    try {
      dossier.push({ slug: rec.slug, text: input.vault.fetch(rec.slug) });
    } catch (err) {
      input.journal.flag(
        `recap: '${rec.slug}' unreadable — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (dossier.length === 0) {
    input.registry.markRecapShown(now());
    return null;
  }

  const digest = await phraseDigest({
    dossier,
    run: input.run,
    homeDir: input.homeDir,
    workspaceDir: input.workspaceDir,
    timeoutMs: input.timeoutMs,
    provider: input.provider,
    model: input.model,
    journal: input.journal,
  });

  let purgePath: string | null = null;
  if (input.writePurgeScript) {
    try {
      purgePath = dropPurgeScript(dossier.map((d) => d.slug), input.vault.skillsRoot, input.stateDir);
      input.journal.note(`recap: purge script at ${purgePath}`);
    } catch (err) {
      input.journal.flag(
        `recap: could not write purge script — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  input.registry.markRecapShown(now());

  if (purgePath) {
    return `${digest}\n\n想删掉其中某条新学的经验?运行下面的脚本(把要保留的行注释掉即可):\n${purgePath}`;
  }
  return digest;
}

async function phraseDigest(input: {
  dossier: Array<{ slug: string; text: string }>;
  run: EmbeddedRunner;
  homeDir: string;
  workspaceDir: string;
  timeoutMs: number;
  provider?: string;
  model?: string;
  journal: Journal;
}): Promise<string> {
  const fallback = `本次会话前新学了 ${input.dossier.length} 条经验(自动摘要未能生成)。`;

  const sections = input.dossier
    .map((d, i) => `(${i + 1}) slug=${d.slug}\n${d.text}`)
    .join("\n\n— — —\n\n");

  const prompt = [
    "Below are skill notes Solo Leveling has learned since the user last checked.",
    'Each note follows a "when this applies / what missed / the approach" shape.',
    "Write a short digest the user will read at the top of a new session.",
    "",
    "Match the language of the notes (mostly Chinese → write Chinese).",
    "Shape it like:",
    "",
    "  自上次以来新学了 N 条经验:",
    "  1. [slug] 一句话:什么情况下、该怎么做",
    "  2. ...",
    "",
    "Stay terse and concrete. No fences, no extra sections.",
    "",
    sections,
  ].join("\n");

  try {
    const reply = await input.run({
      sessionId: `solo-leveling/recap/${randomUUID()}`,
      runId: randomUUID(),
      sessionFile: `${input.homeDir}/sessions/sl-recap-${randomUUID()}.jsonl`,
      workspaceDir: input.workspaceDir,
      prompt,
      timeoutMs: input.timeoutMs,
      provider: input.provider,
      model: input.model,
    });
    return readReplyText(reply) || fallback;
  } catch (err) {
    input.journal.flag(
      `recap digest failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fallback;
  }
}

/**
 * Write a shell script that deletes the given skill directories. Lines are
 * individually commentable so the user can keep a subset.
 */
function dropPurgeScript(slugs: string[], skillsRoot: string, stateDir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15);
  const scriptPath = path.join(stateDir, `purge_${stamp}.sh`);

  const lines = [
    "#!/usr/bin/env bash",
    "# Solo Leveling — remove freshly learned skills.",
    "# Comment any line whose skill you'd rather keep, then run this file.",
    "set -e",
    "",
  ];
  for (const slug of slugs) {
    lines.push(`rm -rf ${shellQuote(path.join(skillsRoot, slug))}   # ${slug}`);
  }

  fs.writeFileSync(scriptPath, lines.join("\n") + "\n", "utf8");
  try {
    fs.chmodSync(scriptPath, 0o755);
  } catch {
    /* chmod is best-effort on some platforms */
  }
  return scriptPath;
}

function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}
