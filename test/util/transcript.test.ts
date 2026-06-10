import { describe, it, expect } from "vitest";
import {
  latestUserUtterance,
  renderTranscript,
} from "../../src/util/transcript.js";
import type { RawMessage } from "../../src/types.js";

const m = (role: string, content: string): RawMessage => ({ role, content });
const blocks = (role: string, parts: Array<Record<string, unknown>>): RawMessage => ({
  role,
  content: parts,
});

describe("latestUserUtterance", () => {
  it("returns the trailing user block only", () => {
    const msgs = [
      m("user", "first turn"),
      m("assistant", "reply"),
      m("user", "second turn"),
    ];
    expect(latestUserUtterance(msgs)).toBe("second turn");
  });

  it("joins consecutive trailing user messages", () => {
    const msgs = [
      m("assistant", "hi"),
      m("user", "part one"),
      m("user", "part two"),
    ];
    const out = latestUserUtterance(msgs);
    expect(out).toContain("part one");
    expect(out).toContain("part two");
  });

  it("stops at the assistant boundary", () => {
    const msgs = [
      m("user", "old"),
      m("assistant", "wall"),
      m("user", "new"),
    ];
    expect(latestUserUtterance(msgs)).toBe("new");
  });

  it("reads block-array text content", () => {
    const msgs = [blocks("user", [{ type: "text", text: "blocky" }])];
    expect(latestUserUtterance(msgs)).toBe("blocky");
  });

  it("drops toolCall blocks", () => {
    const msgs = [
      blocks("user", [
        { type: "text", text: "keep" },
        { type: "toolCall", text: "drop" },
      ]),
    ];
    expect(latestUserUtterance(msgs)).toBe("keep");
  });

  it("returns empty when there is no user message", () => {
    expect(latestUserUtterance([m("assistant", "hi")])).toBe("");
  });
});

describe("renderTranscript", () => {
  it("tags each line with its role", () => {
    const out = renderTranscript([m("user", "hi"), m("assistant", "yo")]);
    expect(out).toContain("<user> hi");
    expect(out).toContain("<assistant> yo");
  });

  it("skips empty and roleless messages", () => {
    const msgs: RawMessage[] = [
      { content: "no role" },
      m("user", "   "),
      m("user", "real"),
    ];
    const out = renderTranscript(msgs);
    expect(out).not.toContain("no role");
    expect(out.trim()).toBe("<user> real");
  });

  it("keeps newest messages and elides older ones past budget", () => {
    const msgs: RawMessage[] = [];
    for (let i = 0; i < 50; i++) msgs.push(m("user", `msg ${i} ${"x".repeat(500)}`));
    const out = renderTranscript(msgs, 1200);
    expect(out).toContain("elided");
    // Newest message must survive.
    expect(out).toContain("msg 49");
    // Oldest must be gone.
    expect(out).not.toContain("msg 0 ");
  });

  it("always keeps at least the newest message even if oversized", () => {
    const msgs = [m("user", "y".repeat(5000))];
    const out = renderTranscript(msgs, 100);
    expect(out).toContain("yyyy");
  });

  it("adds no elision notice when everything fits", () => {
    const out = renderTranscript([m("user", "a"), m("assistant", "b")], 9999);
    expect(out).not.toContain("elided");
  });

  it("returns empty string for empty input", () => {
    expect(renderTranscript([])).toBe("");
  });
});
