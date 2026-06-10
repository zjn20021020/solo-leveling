import type { RawMessage } from "../types.js";

/**
 * Default character budget for the transcript handed to the distiller. A
 * single ceiling rather than per-message head/tail windows: we walk backward
 * from the newest message and stop once the budget is spent.
 */
const DEFAULT_CONTEXT_BUDGET = 12_000;

/** Read the role tag off a raw message; empty string if absent. */
function roleOf(message: RawMessage): string {
  const role = message.role;
  return typeof role === "string" ? role : "";
}

/**
 * Flatten a message's content into plain text. Content may be a string or an
 * array of typed blocks; tool-call blocks carry no human-readable prose and
 * are dropped.
 */
function textOf(message: RawMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as Record<string, unknown>;
    if (typed.type === "toolCall") continue;
    const text = typed.text ?? typed.thinking;
    if (typeof text === "string" && text) chunks.push(text);
  }
  return chunks.join("\n");
}

/**
 * Pull the user's wording from the latest turn, verbatim.
 *
 * A "turn" is the trailing run of user messages — everything the user said
 * since the assistant last spoke. We scan from the end, collecting user
 * messages, and stop at the first non-user message we hit.
 */
export function latestUserUtterance(messages: RawMessage[]): string {
  const collected: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = roleOf(messages[i]);
    if (role === "user") {
      const text = textOf(messages[i]).trim();
      if (text) collected.unshift(text);
    } else if (collected.length > 0) {
      // We've walked past the current turn's user block.
      break;
    }
  }
  return collected.join("\n\n");
}

/**
 * Render a transcript for the distiller by walking backward from the newest
 * message and including whole messages until the character budget is reached.
 * Older messages are dropped wholesale (no mid-message truncation), and a
 * leading notice records how many were elided.
 */
export function renderTranscript(
  messages: RawMessage[],
  budget: number = DEFAULT_CONTEXT_BUDGET,
): string {
  const kept: string[] = [];
  let spent = 0;
  let included = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const role = roleOf(messages[i]);
    if (!role) continue;
    const text = textOf(messages[i]).trim();
    if (!text) continue;

    const line = `<${role}> ${text}`;
    // Always include at least the most recent message, even if oversized.
    if (kept.length > 0 && spent + line.length > budget) break;

    kept.unshift(line);
    spent += line.length;
    included++;
  }

  if (kept.length === 0) return "";

  const total = countRenderable(messages);
  const dropped = total - included;
  const preamble =
    dropped > 0 ? `(earlier ${dropped} message(s) elided for length)\n\n` : "";

  return preamble + kept.join("\n\n");
}

function countRenderable(messages: RawMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (roleOf(m) && textOf(m).trim()) n++;
  }
  return n;
}
