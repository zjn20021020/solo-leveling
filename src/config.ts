import { z } from "zod";
import type { Tone } from "./types.js";

/**
 * Runtime config schema. The host hands plugin config in as an untyped bag;
 * zod parses it and supplies defaults so an empty `{}` is fully valid.
 */
export const configSchema = z.object({
  enabled: z.boolean().default(true),

  triggers: z
    .object({
      /** Optional "provider/model" override for the plugin's own model calls. */
      modelOverride: z.string().optional(),
      /** Lowest tone that, on its own, warrants a retrospective. */
      minTone: z.enum(["annoyed", "agitated", "hostile"]).default("annoyed"),
    })
    .default({ minTone: "annoyed" }),

  vault: z
    .object({
      /** Value written to each skill's `owner` frontmatter field. */
      author: z.string().default("solo-leveling"),
      /** Folder (under the skills root) holding the registry + scripts. */
      stateDirName: z.string().min(1).default(".solo-leveling"),
    })
    .default({ author: "solo-leveling", stateDirName: ".solo-leveling" }),

  recap: z
    .object({
      enabled: z.boolean().default(true),
      writePurgeScript: z.boolean().default(true),
    })
    .default({ enabled: true, writePurgeScript: true }),

  diagnostics: z
    .object({
      verbose: z.boolean().default(false),
    })
    .default({ verbose: false }),
});

export type SoloConfig = z.infer<typeof configSchema>;

export const fallbackConfig: SoloConfig = configSchema.parse({});

/**
 * Map a tone to a comparable rank so thresholds can be expressed as a single
 * `minTone`. "calm" is 0; the ladder climbs from there.
 */
export function toneWeight(tone: Tone): number {
  switch (tone) {
    case "hostile":
      return 3;
    case "agitated":
      return 2;
    case "annoyed":
      return 1;
    default:
      return 0;
  }
}
