import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SkillRegistry } from "../src/registry.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-reg-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const reg = () => new SkillRegistry(dir);

describe("SkillRegistry basics", () => {
  it("starts empty", () => {
    expect(reg().list()).toEqual([]);
  });

  it("enrolls and recalls a skill", () => {
    const r = reg();
    r.enroll("alpha", "first skill", "2026-01-01T00:00:00Z");
    expect(r.knows("alpha")).toBe(true);
    const list = r.list();
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe("alpha");
    expect(list[0].summary).toBe("first skill");
  });

  it("persists across instances (same dir)", () => {
    reg().enroll("beta", "s", "2026-01-01T00:00:00Z");
    const fresh = new SkillRegistry(dir);
    expect(fresh.knows("beta")).toBe(true);
  });

  it("amend keeps the original bornAt but moves touchedAt", () => {
    const r = reg();
    r.enroll("gamma", "v1", "2026-01-01T00:00:00Z");
    r.amend("gamma", "v2", "2026-02-01T00:00:00Z");
    const rec = r.list().find((x) => x.slug === "gamma")!;
    expect(rec.summary).toBe("v2");
    expect(rec.bornAt).toBe("2026-01-01T00:00:00Z");
    expect(rec.touchedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("forget drops a record", () => {
    const r = reg();
    r.enroll("delta", "s", "2026-01-01T00:00:00Z");
    r.forget("delta");
    expect(r.knows("delta")).toBe(false);
  });

  it("lists newest-first by bornAt", () => {
    const r = reg();
    r.enroll("old", "s", "2026-01-01T00:00:00Z");
    r.enroll("new", "s", "2026-03-01T00:00:00Z");
    r.enroll("mid", "s", "2026-02-01T00:00:00Z");
    expect(r.list().map((x) => x.slug)).toEqual(["new", "mid", "old"]);
  });
});

describe("SkillRegistry recap markers", () => {
  it("has no marker initially", () => {
    expect(reg().hasRecapMarker()).toBe(false);
  });

  it("freshSinceLastRecap returns nothing before any marker is set", () => {
    const r = reg();
    r.enroll("a", "s", "2026-01-01T00:00:00Z");
    expect(r.freshSinceLastRecap()).toEqual([]);
  });

  it("returns only skills touched after the marker", () => {
    const r = reg();
    r.enroll("before", "s", "2026-01-01T00:00:00Z");
    r.markRecapShown("2026-01-15T00:00:00Z");
    r.enroll("after", "s", "2026-02-01T00:00:00Z");

    const fresh = r.freshSinceLastRecap();
    expect(fresh.map((x) => x.slug)).toEqual(["after"]);
  });

  it("a revision after the marker counts as fresh", () => {
    const r = reg();
    r.enroll("x", "v1", "2026-01-01T00:00:00Z");
    r.markRecapShown("2026-01-15T00:00:00Z");
    r.amend("x", "v2", "2026-02-01T00:00:00Z");
    expect(r.freshSinceLastRecap().map((s) => s.slug)).toEqual(["x"]);
  });

  it("marker advances so the same skill isn't reported twice", () => {
    const r = reg();
    r.enroll("x", "s", "2026-02-01T00:00:00Z");
    r.markRecapShown("2026-02-02T00:00:00Z");
    expect(r.freshSinceLastRecap()).toEqual([]);
  });

  it("survives a corrupt index file by resetting", () => {
    fs.writeFileSync(path.join(dir, "index.json"), "{ broken json", "utf8");
    const r = new SkillRegistry(dir);
    expect(r.list()).toEqual([]);
    expect(r.hasRecapMarker()).toBe(false);
  });
});
