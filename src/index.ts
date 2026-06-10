import path from "node:path";

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import { configSchema, toneWeight, type SoloConfig } from "./config.js";
import { scanFriction } from "./friction.js";
import { distillLesson } from "./distill.js";
import { buildRecap } from "./recap.js";
import { SkillRegistry, defaultSkillsRoot } from "./registry.js";
import { SkillVault, inspect } from "./vault.js";
import { latestUserUtterance, renderTranscript } from "./util/transcript.js";
import type {
  RawMessage,
  LessonPlan,
  EmbeddedRunner,
  Journal,
  WriteOutcome,
} from "./types.js";

const ID = "solo-leveling";

// Sessions that have already received their recap this gateway lifetime.
const recappedSessions = new Set<string>();

export default definePluginEntry({
  id: ID,
  name: "Solo Leveling",
  description:
    "Notices when a conversation goes sideways — corrections, exasperation — and quietly banks the lesson as a reusable skill.",
  configSchema: buildConfigSchemaAdapter,
  register(api: OpenClawPluginApi) {
    const cfg = loadConfig(api);
    const journal = makeJournal(api, cfg.diagnostics.verbose);

    if (!cfg.enabled) {
      journal.note("disabled by config; no hooks attached.");
      return;
    }

    const run = bindRunner(api);
    if (!run) {
      journal.flag("runEmbeddedAgent is not exposed by the runtime; staying dormant.");
      return;
    }

    const skillsRoot = resolveSkillsRoot(api) ?? defaultSkillsRoot();
    const stateDir = path.join(skillsRoot, cfg.vault.stateDirName);
    const registry = new SkillRegistry(stateDir);
    const vault = new SkillVault(skillsRoot, cfg.vault.author);

    // First turn of a session → surface the recap as appended context.
    api.on(
      "before_prompt_build",
      async (event: Record<string, unknown>) => {
        try {
          const sid = pickSessionId(event);
          if (!sid || recappedSessions.has(sid)) return;
          recappedSessions.add(sid);

          const dirs = resolveDirs(api);
          if (!dirs) {
            journal.trace?.("recap: agent dirs unavailable; skipping.");
            return;
          }

          const { provider, model } = pickModel(api, cfg.triggers.modelOverride);
          const digest = await buildRecap({
            registry,
            vault,
            run,
            stateDir,
            homeDir: dirs.homeDir,
            workspaceDir: dirs.workspaceDir,
            timeoutMs: dirs.timeoutMs,
            provider,
            model,
            enabled: cfg.recap.enabled,
            writePurgeScript: cfg.recap.writePurgeScript,
            journal,
          });

          if (digest) return { appendContext: digest };
        } catch (err) {
          journal.flag(`recap hook threw: ${describe(err)}`);
        }
      },
      { priority: 10 },
    );

    // End of every turn → look for friction, maybe bank a lesson.
    api.on(
      "agent_end",
      async (event: Record<string, unknown>) => {
        try {
          await onTurnEnd({ event, cfg, journal, run, registry, vault, api });
        } catch (err) {
          journal.flag(`turn-end hook threw: ${describe(err)}`);
        }
      },
      { priority: 10 },
    );

    journal.note("attached hooks: before_prompt_build, agent_end.");
  },
});

/** End-of-turn pipeline: scan friction → distil → commit → index. */
async function onTurnEnd(ctx: {
  event: Record<string, unknown>;
  cfg: SoloConfig;
  journal: Journal;
  run: EmbeddedRunner;
  registry: SkillRegistry;
  vault: SkillVault;
  api: OpenClawPluginApi;
}): Promise<void> {
  const { event, cfg, journal, run, registry, vault, api } = ctx;

  const messages = pluckMessages(event);
  if (!messages) {
    journal.trace?.("no messages on event (is allowConversationAccess set?).");
    return;
  }

  const utterance = latestUserUtterance(messages);
  if (!utterance.trim()) {
    journal.trace?.("turn had no user text; nothing to scan.");
    return;
  }

  const dirs = resolveDirs(api);
  if (!dirs) {
    journal.flag("agent dirs unavailable; skipping retrospective.");
    return;
  }

  const { provider, model } = pickModel(api, cfg.triggers.modelOverride);

  const reading = await scanFriction({
    utterance,
    run,
    homeDir: dirs.homeDir,
    workspaceDir: dirs.workspaceDir,
    timeoutMs: dirs.timeoutMs,
    provider,
    model,
    journal,
  });

  const toneTriggers = toneWeight(reading.tone) >= toneWeight(cfg.triggers.minTone);
  const correctionTriggers = reading.correctionCount >= 1;
  if (!toneTriggers && !correctionTriggers) {
    journal.trace?.("no friction worth banking this turn.");
    return;
  }

  journal.note(
    `friction warrants review — tone=${reading.tone}, corrections=${reading.correctionCount}`,
  );

  const plan = await distillLesson({
    transcript: renderTranscript(messages),
    reading,
    catalogue: registry.list(),
    run,
    homeDir: dirs.homeDir,
    workspaceDir: dirs.workspaceDir,
    timeoutMs: dirs.timeoutMs,
    provider,
    model,
    journal,
  });

  enactPlan({ plan, registry, vault, journal });
}

/** Apply a LessonPlan to the vault + registry. */
function enactPlan(ctx: {
  plan: LessonPlan;
  registry: SkillRegistry;
  vault: SkillVault;
  journal: Journal;
}): WriteOutcome {
  const { plan, registry, vault, journal } = ctx;
  const stamp = new Date().toISOString();

  if (plan.mode === "skip") {
    journal.trace?.(`distiller skipped: ${plan.rationale}`);
    return { status: "passed", rationale: plan.rationale };
  }

  if (plan.mode === "new") {
    const slug = freeSlug(vault, plan.slug);
    const committed = vault.commit({ slug, summary: plan.summary, body: plan.body });
    if (!committed.ok) {
      journal.flag(`author '${slug}' failed: ${committed.why}`);
      return { status: "aborted", rationale: committed.why };
    }
    registry.prepare();
    registry.enroll(slug, plan.summary, stamp);
    journal.note(`authored skill '${slug}'.`);
    return { status: "authored", slug };
  }

  // revise — vault.commit atomically replaces; the live file is never at risk.
  const committed = vault.commit({
    slug: plan.slug,
    summary: plan.summary,
    body: plan.body,
  });
  if (!committed.ok) {
    journal.flag(`revise '${plan.slug}' failed: ${committed.why}`);
    return { status: "aborted", rationale: committed.why };
  }
  registry.prepare();
  registry.amend(plan.slug, plan.summary, stamp);
  journal.note(`revised skill '${plan.slug}'.`);
  return { status: "revised", slug: plan.slug };
}

/** Find an unused slug by appending an ordinal when needed. */
function freeSlug(vault: SkillVault, desired: string): string {
  if (!vault.has(desired)) return desired;
  for (let n = 2; n < 100; n++) {
    const candidate = `${desired}-${n}`;
    if (!vault.has(candidate)) return candidate;
  }
  return `${desired}-x`;
}

// ── runtime glue ─────────────────────────────────────────────────────────────

function pluckMessages(event: Record<string, unknown>): RawMessage[] | null {
  const spots: unknown[] = [
    event.messages,
    (event.result as Record<string, unknown> | undefined)?.messages,
    (event.ctx as Record<string, unknown> | undefined)?.messages,
  ];
  for (const spot of spots) {
    if (Array.isArray(spot)) return spot as RawMessage[];
  }
  return null;
}

function pickSessionId(event: Record<string, unknown>): string {
  const direct = event.sessionId;
  if (typeof direct === "string" && direct) return direct;
  const nested = (event.ctx as Record<string, unknown> | undefined)?.sessionId;
  return typeof nested === "string" ? nested : "";
}

function bindRunner(api: OpenClawPluginApi): EmbeddedRunner | null {
  const fn = api?.runtime?.agent?.runEmbeddedAgent;
  if (typeof fn !== "function") return null;
  return ((spec) => fn.call(api.runtime.agent, spec)) as EmbeddedRunner;
}

interface ResolvedDirs {
  homeDir: string;
  workspaceDir: string;
  timeoutMs: number;
}

function resolveDirs(api: OpenClawPluginApi): ResolvedDirs | null {
  const homeDir = api?.runtime?.agent?.resolveAgentDir?.(api.config);
  const workspaceDir = api?.runtime?.agent?.resolveAgentWorkspaceDir?.(api.config);
  const timeoutMs = api?.runtime?.agent?.resolveAgentTimeoutMs?.(api.config) ?? 120_000;
  if (typeof homeDir !== "string" || !homeDir) return null;
  if (typeof workspaceDir !== "string" || !workspaceDir) return null;
  return { homeDir, workspaceDir, timeoutMs };
}

function resolveSkillsRoot(api: OpenClawPluginApi): string | undefined {
  try {
    const home = api?.runtime?.agent?.resolveAgentDir?.(api.config);
    if (typeof home === "string" && home.trim()) {
      return path.join(home, "skills");
    }
  } catch {
    /* fall through to default */
  }
  return undefined;
}

/**
 * Decide which provider/model the plugin's own calls should use. The embedded
 * runner falls back to openai with no hint, which breaks setups that only
 * configured another provider — so we read the agent's primary model and pass
 * it explicitly. An explicit config override wins.
 */
function pickModel(
  api: OpenClawPluginApi,
  override: string | undefined,
): { provider?: string; model?: string } {
  if (override && override.trim()) return cleaveRef(override.trim());

  try {
    const cfg = api?.config as Record<string, unknown> | undefined;
    const primary = (((cfg?.agents as any)?.defaults?.model)?.primary) as unknown;
    if (typeof primary === "string" && primary.trim()) {
      return cleaveRef(primary.trim());
    }
  } catch {
    /* fall through */
  }

  const provider = api?.runtime?.agent?.defaults?.provider;
  const model = api?.runtime?.agent?.defaults?.model;
  return {
    provider: typeof provider === "string" ? provider : undefined,
    model: typeof model === "string" ? model : undefined,
  };
}

function cleaveRef(ref: string): { provider?: string; model?: string } {
  const slash = ref.indexOf("/");
  if (slash > 0 && slash < ref.length - 1) {
    return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
  }
  return { model: ref };
}

function loadConfig(api: OpenClawPluginApi): SoloConfig {
  const raw = (api?.pluginConfig ?? {}) as Record<string, unknown>;
  const parsed = configSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  api?.logger?.warn?.(`Solo Leveling: config invalid, using defaults — ${parsed.error.message}`);
  return configSchema.parse({});
}

function buildConfigSchemaAdapter() {
  return {
    safeParse(value: unknown) {
      const parsed = configSchema.safeParse((value ?? {}) as Record<string, unknown>);
      if (parsed.success) return { success: true as const, data: parsed.data };
      return {
        success: false as const,
        error: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.filter(
              (s): s is string | number => typeof s === "string" || typeof s === "number",
            ),
            message: issue.message,
          })),
        },
      };
    },
    jsonSchema: { type: "object" } as Record<string, unknown>,
  };
}

function makeJournal(api: OpenClawPluginApi, verbose: boolean): Journal {
  const base = api?.logger;
  return {
    trace: verbose ? (line: string) => (base?.debug ? base.debug(tag(line)) : base?.info?.(tag(line))) : undefined,
    note: (line: string) => base?.info?.(tag(line)),
    flag: (line: string) => (base?.warn ? base.warn(tag(line)) : console.warn(tag(line))),
  };
}

function tag(line: string): string {
  return `Solo Leveling | ${line}`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.stack || err.message : String(err);
}

// Keep `inspect` reachable for downstream tooling/tests that import from index.
export { inspect };
