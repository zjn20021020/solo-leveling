import { describe, it, expect } from "vitest";
import { readReplyText } from "../../src/util/reply-text.js";

describe("readReplyText", () => {
  it("prefers a non-blank top-level text", () => {
    expect(readReplyText({ text: "hello" })).toBe("hello");
  });

  it("falls back to meta.finalAssistantVisibleText", () => {
    expect(readReplyText({ meta: { finalAssistantVisibleText: "final" } })).toBe("final");
  });

  it("assembles visible payloads when text is absent", () => {
    const reply = {
      payloads: [
        { text: "alpha" },
        { text: "beta" },
      ],
    };
    expect(readReplyText(reply)).toBe("alphabeta");
  });

  it("skips reasoning and error payloads", () => {
    const reply = {
      payloads: [
        { text: "think", isReasoning: true },
        { text: "boom", isError: true },
        { text: "real" },
      ],
    };
    expect(readReplyText(reply)).toBe("real");
  });

  it("falls back to content then output", () => {
    expect(readReplyText({ content: "c" })).toBe("c");
    expect(readReplyText({ output: "o" })).toBe("o");
  });

  it("ignores blank text and moves to the next candidate", () => {
    expect(readReplyText({ text: "   ", content: "c" })).toBe("c");
  });

  it("returns empty string when nothing usable exists", () => {
    expect(readReplyText({})).toBe("");
    expect(readReplyText({ payloads: [] })).toBe("");
  });
});
