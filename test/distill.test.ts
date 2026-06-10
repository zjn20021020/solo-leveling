import { describe, it, expect } from "vitest";
import { decodeLesson } from "../src/distill.js";
import type { SkillRecord } from "../src/types.js";

const noJournal = { note: () => {}, flag: () => {}, trace: () => {} };

const catalogue: SkillRecord[] = [
  { slug: "read-before-write", summary: "read first", bornAt: "2026-01-01", touchedAt: "2026-01-01" },
  { slug: "confirm-deletes", summary: "ask first", bornAt: "2026-01-02", touchedAt: "2026-01-02" },
];

const goodBody =
  "## When this applies\n\nWhen editing files.\n\n## What missed\n\nOverwrote.\n\n## Approach\n\nRead then edit.";

describe("decodeLesson — skip", () => {
  it("decodes skip", () => {
    const p = decodeLesson(JSON.stringify({ mode: "skip", rationale: "one-off" }), catalogue, noJournal);
    expect(p.mode).toBe("skip");
    if (p.mode === "skip") expect(p.rationale).toBe("one-off");
  });

  it("treats an unknown mode as skip", () => {
    const p = decodeLesson(JSON.stringify({ mode: "nuke", rationale: "x" }), catalogue, noJournal);
    expect(p.mode).toBe("skip");
  });

  it("skips when no JSON present", () => {
    expect(decodeLesson("nope", catalogue, noJournal).mode).toBe("skip");
    expect(decodeLesson("", catalogue, noJournal).mode).toBe("skip");
  });
});

describe("decodeLesson — new", () => {
  it("decodes a valid new lesson", () => {
    const raw = JSON.stringify({
      mode: "new",
      slug: "verify-output",
      summary: "double check",
      body: goodBody,
      rationale: "recurring",
    });
    const p = decodeLesson(raw, catalogue, noJournal);
    expect(p.mode).toBe("new");
    if (p.mode !== "new") return;
    expect(p.slug).toBe("verify-output");
    expect(p.summary).toBe("double check");
  });

  it("kebab-cases a messy slug", () => {
    const raw = JSON.stringify({ mode: "new", slug: "Verify_Output!!", summary: "s", body: goodBody, rationale: "" });
    const p = decodeLesson(raw, catalogue, noJournal);
    if (p.mode !== "new") throw new Error("expected new");
    expect(p.slug).toMatch(/^[a-z0-9-]+$/);
    expect(p.slug).toBe("verify-output");
  });

  it("strips an accidental frontmatter block from the body", () => {
    const withFm = `---\nname: x\n---\n\n${goodBody}`;
    const raw = JSON.stringify({ mode: "new", slug: "fm", summary: "s", body: withFm, rationale: "" });
    const p = decodeLesson(raw, catalogue, noJournal);
    if (p.mode !== "new") throw new Error("expected new");
    expect(p.body.startsWith("---")).toBe(false);
  });

  it("skips when slug is empty after normalisation", () => {
    const raw = JSON.stringify({ mode: "new", slug: "###", summary: "s", body: goodBody, rationale: "" });
    expect(decodeLesson(raw, catalogue, noJournal).mode).toBe("skip");
  });

  it("skips when body is too thin", () => {
    const raw = JSON.stringify({ mode: "new", slug: "ok", summary: "s", body: "tiny", rationale: "" });
    expect(decodeLesson(raw, catalogue, noJournal).mode).toBe("skip");
  });

  it("skips when summary is missing", () => {
    const raw = JSON.stringify({ mode: "new", slug: "ok", summary: "", body: goodBody, rationale: "" });
    expect(decodeLesson(raw, catalogue, noJournal).mode).toBe("skip");
  });
});

describe("decodeLesson — revise", () => {
  it("decodes a revise for a known slug", () => {
    const raw = JSON.stringify({
      mode: "revise",
      slug: "read-before-write",
      summary: "read first, always",
      body: goodBody,
      rationale: "more detail",
    });
    const p = decodeLesson(raw, catalogue, noJournal);
    expect(p.mode).toBe("revise");
    if (p.mode === "revise") expect(p.slug).toBe("read-before-write");
  });

  it("downgrades a revise of an unknown slug to new", () => {
    const raw = JSON.stringify({
      mode: "revise",
      slug: "does-not-exist",
      summary: "s",
      body: goodBody,
      rationale: "",
    });
    expect(decodeLesson(raw, catalogue, noJournal).mode).toBe("new");
  });
});
