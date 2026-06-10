import { describe, it, expect } from "vitest";
import { configSchema, toneWeight } from "../src/config.js";

describe("toneWeight", () => {
  it("ranks calm at zero", () => {
    expect(toneWeight("calm")).toBe(0);
  });
  it("climbs annoyed < agitated < hostile", () => {
    expect(toneWeight("annoyed")).toBeLessThan(toneWeight("agitated"));
    expect(toneWeight("agitated")).toBeLessThan(toneWeight("hostile"));
  });
  it("annoyed is above calm", () => {
    expect(toneWeight("annoyed")).toBeGreaterThan(toneWeight("calm"));
  });
});

describe("configSchema", () => {
  it("fills every default from empty input", () => {
    const c = configSchema.parse({});
    expect(c.enabled).toBe(true);
    expect(c.triggers.minTone).toBe("annoyed");
    expect(c.vault.author).toBe("solo-leveling");
    expect(c.vault.stateDirName).toBe(".solo-leveling");
    expect(c.recap.enabled).toBe(true);
    expect(c.recap.writePurgeScript).toBe(true);
    expect(c.diagnostics.verbose).toBe(false);
  });

  it("keeps custom values", () => {
    const c = configSchema.parse({
      enabled: false,
      triggers: { minTone: "hostile", modelOverride: "deepseek/deepseek-v4-flash" },
      vault: { author: "me" },
      recap: { writePurgeScript: false },
      diagnostics: { verbose: true },
    });
    expect(c.enabled).toBe(false);
    expect(c.triggers.minTone).toBe("hostile");
    expect(c.triggers.modelOverride).toBe("deepseek/deepseek-v4-flash");
    expect(c.vault.author).toBe("me");
    expect(c.recap.writePurgeScript).toBe(false);
    expect(c.diagnostics.verbose).toBe(true);
  });

  it("rejects an unknown tone", () => {
    expect(() => configSchema.parse({ triggers: { minTone: "calm" } })).toThrow();
    expect(() => configSchema.parse({ triggers: { minTone: "furious" } })).toThrow();
  });

  it("rejects an empty stateDirName", () => {
    expect(() => configSchema.parse({ vault: { stateDirName: "" } })).toThrow();
  });
});
