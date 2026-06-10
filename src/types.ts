/**
 * Shared type surface for the Solo Leveling plugin.
 *
 * Conversation messages arrive from the OpenClaw runtime as a loosely-typed
 * union. Rather than depend on the runtime's exact variant shapes, we treat
 * each entry as an opaque bag and pluck fields as needed.
 */

export type RawMessage = Record<string, unknown>;

/**
 * How heated the user sounded this turn. Ordered from neutral to openly
 * hostile; `toneWeight()` maps these to a comparable rank.
 */
export type Tone = "calm" | "annoyed" | "agitated" | "hostile";

/**
 * What the friction scan extracted from the user's turn. Two independent
 * channels: how many corrections were issued, and how heated the wording was.
 */
export interface FrictionReading {
  /** Number of distinct times the user flagged the assistant as wrong. */
  correctionCount: number;
  /** Strongest emotional register detected across the user's messages. */
  tone: Tone;
  /** Verbatim snippets that justify the tone classification. */
  evidenceQuotes: string[];
  /** One-line gist of what the user wanted fixed. */
  correctionGist: string;
}

/** A skill entry as tracked in the registry index. */
export interface SkillRecord {
  slug: string;
  summary: string;
  /** ISO timestamp when first authored. */
  bornAt: string;
  /** ISO timestamp of the most recent revision (equals bornAt if never revised). */
  touchedAt: string;
}

/** The plan produced by the distiller after weighing a friction reading. */
export type LessonPlan =
  | { mode: "skip"; rationale: string }
  | {
      mode: "new";
      slug: string;
      summary: string;
      body: string;
      rationale: string;
    }
  | {
      mode: "revise";
      slug: string;
      summary: string;
      body: string;
      rationale: string;
    };

/** What actually landed on disk after executing a LessonPlan. */
export type WriteOutcome =
  | { status: "passed"; rationale: string }
  | { status: "authored"; slug: string }
  | { status: "revised"; slug: string }
  | { status: "aborted"; rationale: string };

/** Logger surface; a subset of what api.logger provides. */
export interface Journal {
  trace?: (line: string) => void;
  note: (line: string) => void;
  flag: (line: string) => void;
}

/** What a single embedded-agent invocation resolves to (text in several shapes). */
export interface AgentReply {
  text?: string;
  content?: string;
  output?: string;
  meta?: { finalAssistantVisibleText?: string };
  payloads?: Array<{ text?: string; isReasoning?: boolean; isError?: boolean }>;
}

/** The narrow embedded-agent capability the plugin relies on. */
export type EmbeddedRunner = (spec: {
  sessionId: string;
  runId: string;
  sessionFile: string;
  workspaceDir: string;
  prompt: string;
  timeoutMs: number;
  provider?: string;
  model?: string;
}) => Promise<AgentReply>;
