import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Journal } from "./types.js";

/**
 * SkillVault owns the filesystem side of skills: composing SKILL.md content and
 * committing it durably.
 *
 * Durability strategy is write-to-temp-then-rename. A new file is staged at a
 * sibling `.tmp` path, validated, then atomically renamed into place. This
 * means a failed or malformed write never leaves a half-written SKILL.md, and
 * a revision that fails validation never touches the live file at all — there
 * is nothing to "roll back" because the original was never opened for writing.
 */
export class SkillVault {
  constructor(
    readonly skillsRoot: string,
    private readonly author: string,
  ) {}

  private skillDir(slug: string): string {
    return path.join(this.skillsRoot, slug);
  }

  private skillFile(slug: string): string {
    return path.join(this.skillDir(slug), "SKILL.md");
  }

  /** Does a SKILL.md already exist for this slug? */
  has(slug: string): boolean {
    return fs.existsSync(this.skillFile(slug));
  }

  /** Read the raw SKILL.md text. Throws if absent. */
  fetch(slug: string): string {
    return fs.readFileSync(this.skillFile(slug), "utf8");
  }

  /**
   * Commit a SKILL.md (new or replacement) atomically.
   *
   * Returns `{ ok }` or `{ ok: false, why }`. On failure nothing is left
   * behind: the temp file is removed and any live file is untouched.
   */
  commit(params: {
    slug: string;
    summary: string;
    body: string;
  }): { ok: true } | { ok: false; why: string } {
    const dir = this.skillDir(params.slug);
    const target = this.skillFile(params.slug);
    const staging = path.join(dir, `.SKILL.md.${randomUUID()}.staging`);

    const content = compose(params.slug, params.summary, this.author, params.body);

    const flaw = inspect(content, params.slug);
    if (flaw) return { ok: false, why: flaw };

    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(staging, content, "utf8");
      // Atomic swap into place — replaces any existing file in one syscall.
      fs.renameSync(staging, target);
      return { ok: true };
    } catch (err) {
      // Best-effort cleanup of the staging file.
      try {
        fs.rmSync(staging, { force: true });
      } catch {
        /* ignore */
      }
      return { ok: false, why: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Remove a skill's directory entirely. */
  discard(slug: string, journal: Journal): void {
    try {
      fs.rmSync(this.skillDir(slug), { recursive: true, force: true });
    } catch (err) {
      journal.flag(
        `vault: could not discard '${slug}' — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Build SKILL.md text from its parts. The YAML frontmatter block is emitted
 * with a fixed three-field layout; the description is single-line and quoted
 * only when it contains YAML-significant characters.
 */
function compose(slug: string, summary: string, author: string, body: string): string {
  const head = [
    "---",
    `name: ${slug}`,
    `description: ${yamlScalar(summary)}`,
    `owner: ${author}`,
    "---",
  ].join("\n");
  return `${head}\n\n${body.trimEnd()}\n`;
}

/** Quote a scalar only if it would otherwise be ambiguous YAML. */
function yamlScalar(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const needsQuote = /[:#\-?,[\]{}&*!|>'"%@`]/.test(flat);
  if (!needsQuote) return flat;
  return `"${flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Validate composed SKILL.md content. Returns a reason string when the content
 * is malformed, or null when it passes. Frontmatter is matched as a single
 * block via regex rather than parsed line by line.
 */
export function inspect(content: string, expectedSlug: string): string | null {
  const block = content.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return "missing or unterminated YAML frontmatter";

  const front = block[1];
  const nameLine = front.match(/^name:[ \t]*(.+)$/m);
  const descLine = front.match(/^description:[ \t]*(.+)$/m);

  if (!nameLine) return "frontmatter has no name field";
  const declaredName = nameLine[1].trim().replace(/^["']|["']$/g, "");
  if (declaredName !== expectedSlug) {
    return `frontmatter name '${declaredName}' disagrees with slug '${expectedSlug}'`;
  }
  if (!descLine || !descLine[1].trim()) return "frontmatter has no description";

  const afterFront = content.slice(block[0].length).trim();
  if (afterFront.length < 30) return "skill body is too thin to be useful";

  return null;
}
