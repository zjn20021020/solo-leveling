import type { AgentReply } from "../types.js";

/**
 * Collapse an embedded-agent reply down to its assistant text.
 *
 * The runtime surfaces the answer in one of several places depending on
 * version. We probe them in order of preference and return the first
 * non-blank hit, assembling from the payload stream when that's all there is.
 */
export function readReplyText(reply: AgentReply): string {
  const candidates: Array<string | undefined> = [
    reply.text,
    reply.meta?.finalAssistantVisibleText,
    assemblePayloads(reply),
    reply.content,
    reply.output,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return "";
}

/** Stitch together the visible (non-reasoning, non-error) payload chunks. */
function assemblePayloads(reply: AgentReply): string | undefined {
  if (!Array.isArray(reply.payloads)) return undefined;

  const visible = reply.payloads
    .filter((chunk) => chunk.isReasoning !== true && chunk.isError !== true)
    .map((chunk) => chunk.text ?? "");

  const joined = visible.join("").trim();
  return joined || undefined;
}
