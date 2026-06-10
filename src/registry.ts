import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SkillRecord, Journal } from "./types.js";

/**
 * On-disk shape of the registry index.
 */
interface RegistryFile {
  version: number;
  /** Slug → record, for skills this plugin has authored or revised. */
  entries: Record<string, SkillRecord>;
  /** ISO timestamp of the last recap the user was shown. */
  lastRecapAt: string | null;
}

const REGISTRY_VERSION = 1;
const REGISTRY_FILENAME = "index.json";

/**
 * SkillRegistry is the single source of truth for which skills Solo Leveling
 * has authored and when. It deliberately avoids scanning the skills directory
 * or parsing SKILL.md frontmatter to answer "what do we know" — that state
 * lives here, in one JSON file, loaded once and mutated in place.
 *
 * The registry only tracks plugin-authored skills; hand-written user skills
 * are intentionally invisible to it.
 */
export class SkillRegistry {
  private readonly filePath: string;
  private cache: RegistryFile | null = null;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, REGISTRY_FILENAME);
  }

  /** Ensure the parent directory exists. */
  prepare(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  private read(): RegistryFile {
    if (this.cache) return this.cache;

    let loaded: RegistryFile;
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      loaded = {
        version: typeof parsed.version === "number" ? parsed.version : REGISTRY_VERSION,
        entries: isRecordMap(parsed.entries) ? parsed.entries : {},
        lastRecapAt: typeof parsed.lastRecapAt === "string" ? parsed.lastRecapAt : null,
      };
    } catch {
      loaded = { version: REGISTRY_VERSION, entries: {}, lastRecapAt: null };
    }

    this.cache = loaded;
    return loaded;
  }

  private flush(): void {
    if (!this.cache) return;
    this.prepare();
    fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2) + "\n", "utf8");
  }

  /** Every tracked skill, newest-first by birth time. */
  list(): SkillRecord[] {
    const { entries } = this.read();
    return Object.values(entries).sort((a, b) => b.bornAt.localeCompare(a.bornAt));
  }

  /** Is this slug already tracked? */
  knows(slug: string): boolean {
    return slug in this.read().entries;
  }

  /** Record a freshly authored skill. */
  enroll(slug: string, summary: string, when: string): void {
    const reg = this.read();
    reg.entries[slug] = { slug, summary, bornAt: when, touchedAt: when };
    this.flush();
  }

  /** Update an existing record after a revision (keeps original bornAt). */
  amend(slug: string, summary: string, when: string): void {
    const reg = this.read();
    const prior = reg.entries[slug];
    reg.entries[slug] = {
      slug,
      summary,
      bornAt: prior?.bornAt ?? when,
      touchedAt: when,
    };
    this.flush();
  }

  /** Drop a record (e.g. when a write was aborted). */
  forget(slug: string): void {
    const reg = this.read();
    if (slug in reg.entries) {
      delete reg.entries[slug];
      this.flush();
    }
  }

  /**
   * Skills authored or revised since the last recap was shown. When no recap
   * has ever been shown, returns nothing and silently seeds the marker so the
   * very first session doesn't dump the entire backlog.
   */
  freshSinceLastRecap(): SkillRecord[] {
    const reg = this.read();
    if (reg.lastRecapAt === null) {
      return [];
    }
    const cutoff = reg.lastRecapAt;
    return this.list().filter((rec) => rec.touchedAt > cutoff);
  }

  /** Stamp the recap marker to now. */
  markRecapShown(when: string): void {
    const reg = this.read();
    reg.lastRecapAt = when;
    this.flush();
  }

  /** Whether a recap marker has ever been set. */
  hasRecapMarker(): boolean {
    return this.read().lastRecapAt !== null;
  }
}

/** Resolve the default skills root when the host doesn't hand us one. */
export function defaultSkillsRoot(): string {
  return path.join(os.homedir(), ".openclaw", "skills");
}

function isRecordMap(value: unknown): value is Record<string, SkillRecord> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
