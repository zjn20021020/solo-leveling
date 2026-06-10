import { describe, it, expect } from "vitest";
import { decodeFriction } from "../src/friction.js";

describe("decodeFriction", () => {
  it("decodes a well-formed reading", () => {
    const raw = JSON.stringify({
      corrections: 2,
      tone: "agitated",
      quotes: ["已经说了好几遍", "怎么还不对"],
      gist: "用户要 kebab-case",
    });
    const r = decodeFriction(raw)!;
    expect(r.correctionCount).toBe(2);
    expect(r.tone).toBe("agitated");
    expect(r.evidenceQuotes).toHaveLength(2);
    expect(r.correctionGist).toBe("用户要 kebab-case");
  });

  it("carves JSON out of fenced prose", () => {
    const raw = "```json\n" + JSON.stringify({ corrections: 1, tone: "annoyed", quotes: [], gist: "" }) + "\n```";
    const r = decodeFriction(raw)!;
    expect(r.correctionCount).toBe(1);
    expect(r.tone).toBe("annoyed");
  });

  it("defaults an unknown tone to calm", () => {
    const r = decodeFriction(JSON.stringify({ corrections: 0, tone: "FURIOUS", quotes: [], gist: "" }))!;
    expect(r.tone).toBe("calm");
  });

  it("coerces a non-numeric correction count to 0", () => {
    const r = decodeFriction(JSON.stringify({ corrections: "lots", tone: "calm", quotes: [], gist: "" }))!;
    expect(r.correctionCount).toBe(0);
  });

  it("truncates a fractional count toward zero", () => {
    const r = decodeFriction(JSON.stringify({ corrections: 2.9, tone: "calm", quotes: [], gist: "" }))!;
    expect(r.correctionCount).toBe(2);
  });

  it("caps quotes at 8", () => {
    const quotes = Array.from({ length: 12 }, (_, i) => `q${i}`);
    const r = decodeFriction(JSON.stringify({ corrections: 0, tone: "hostile", quotes, gist: "" }))!;
    expect(r.evidenceQuotes).toHaveLength(8);
  });

  it("clamps the gist to 300 chars", () => {
    const r = decodeFriction(JSON.stringify({ corrections: 0, tone: "calm", quotes: [], gist: "z".repeat(400) }))!;
    expect(r.correctionGist.length).toBe(300);
  });

  it("returns null when no JSON is present", () => {
    expect(decodeFriction("nothing here")).toBeNull();
    expect(decodeFriction("")).toBeNull();
  });
});
