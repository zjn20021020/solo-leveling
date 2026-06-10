import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SkillVault, inspect } from "../src/vault.js";

const GOOD_BODY =
  "## When this applies\n\nEditing files.\n\n## What missed\n\nOverwrote a file.\n\n## Approach\n\nRead, then edit minimally.";

// ── inspect ──────────────────────────────────────────────────────────────────

describe("inspect", () => {
  const valid = `---\nname: my-skill\ndescription: a test\nowner: solo-leveling\n---\n\n${GOOD_BODY}`;

  it("passes a well-formed file", () => {
    expect(inspect(valid, "my-skill")).toBeNull();
  });

  it("rejects content without frontmatter", () => {
    expect(inspect("## just a heading\n\nlots of words here to pass length", "my-skill")).toMatch(/frontmatter/i);
  });

  it("rejects unterminated frontmatter", () => {
    expect(inspect("---\nname: my-skill\ndescription: x\n\nbody", "my-skill")).toMatch(/frontmatter/i);
  });

  it("rejects a missing name", () => {
    expect(inspect(`---\ndescription: x\nowner: o\n---\n\n${GOOD_BODY}`, "my-skill")).toMatch(/name/i);
  });

  it("rejects a name/slug mismatch", () => {
    expect(inspect(`---\nname: other\ndescription: x\n---\n\n${GOOD_BODY}`, "my-skill")).toMatch(/disagrees/);
  });

  it("rejects a missing description", () => {
    expect(inspect(`---\nname: my-skill\nowner: o\n---\n\n${GOOD_BODY}`, "my-skill")).toMatch(/description/i);
  });

  it("rejects a too-thin body", () => {
    expect(inspect(`---\nname: my-skill\ndescription: x\n---\n\nhi`, "my-skill")).toMatch(/thin/i);
  });

  it("tolerates a quoted description", () => {
    const c = `---\nname: my-skill\ndescription: "has: a colon"\n---\n\n${GOOD_BODY}`;
    expect(inspect(c, "my-skill")).toBeNull();
  });
});

// ── SkillVault ───────────────────────────────────────────────────────────────

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sl-vault-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const vault = () => new SkillVault(root, "solo-leveling");

describe("SkillVault.commit (new)", () => {
  it("writes a SKILL.md and reports ok", () => {
    const r = vault().commit({ slug: "alpha", summary: "first", body: GOOD_BODY });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(root, "alpha", "SKILL.md"))).toBe(true);
  });

  it("embeds the frontmatter fields", () => {
    const v = vault();
    v.commit({ slug: "beta", summary: "my summary", body: GOOD_BODY });
    const raw = v.fetch("beta");
    expect(raw).toContain("name: beta");
    expect(raw).toContain("description: my summary");
    expect(raw).toContain("owner: solo-leveling");
  });

  it("leaves no staging files behind", () => {
    const v = vault();
    v.commit({ slug: "gamma", summary: "s", body: GOOD_BODY });
    const entries = fs.readdirSync(path.join(root, "gamma"));
    expect(entries).toEqual(["SKILL.md"]);
  });

  it("refuses to commit a body that fails inspection", () => {
    const r = vault().commit({ slug: "thin", summary: "s", body: "x" });
    expect(r.ok).toBe(false);
  });
});

describe("SkillVault.commit (replace)", () => {
  it("atomically replaces an existing file", () => {
    const v = vault();
    v.commit({ slug: "delta", summary: "old", body: GOOD_BODY });
    const r = v.commit({ slug: "delta", summary: "new", body: GOOD_BODY });
    expect(r.ok).toBe(true);
    expect(v.fetch("delta")).toContain("description: new");
  });

  it("leaves the original intact when the replacement fails inspection", () => {
    const v = vault();
    v.commit({ slug: "epsilon", summary: "keep", body: GOOD_BODY });
    const before = v.fetch("epsilon");
    const r = v.commit({ slug: "epsilon", summary: "s", body: "tiny" });
    expect(r.ok).toBe(false);
    expect(v.fetch("epsilon")).toBe(before); // untouched
  });
});

describe("SkillVault.has / fetch / discard", () => {
  it("has() reflects existence", () => {
    const v = vault();
    expect(v.has("zeta")).toBe(false);
    v.commit({ slug: "zeta", summary: "s", body: GOOD_BODY });
    expect(v.has("zeta")).toBe(true);
  });

  it("discard removes the directory", () => {
    const v = vault();
    v.commit({ slug: "eta", summary: "s", body: GOOD_BODY });
    v.discard("eta", { note: () => {}, flag: () => {} });
    expect(v.has("eta")).toBe(false);
  });
});
