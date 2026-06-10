/**
 * Locate and extract the first complete JSON object embedded in arbitrary text.
 *
 * Models frequently wrap JSON in prose, code fences, or trailing commentary.
 * A greedy `/\{[\s\S]*\}/` match breaks when more than one object is present
 * (it spans from the first `{` to the last `}`). Instead we walk the string
 * tracking brace depth and string state, returning the substring that closes
 * the first balanced object.
 *
 * Returns null when no balanced object is found.
 */
export function carveJsonObject(text: string): string | null {
  if (!text) return null;

  const opening = text.indexOf("{");
  if (opening < 0) return null;

  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let cursor = opening; cursor < text.length; cursor++) {
    const ch = text[cursor];

    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        insideString = false;
      }
      continue;
    }

    if (ch === '"') {
      insideString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(opening, cursor + 1);
      }
    }
  }

  return null;
}

/**
 * Convenience: carve + JSON.parse in one step. Returns null on any failure so
 * callers can branch without try/catch noise.
 */
export function parseEmbeddedObject(text: string): Record<string, unknown> | null {
  const carved = carveJsonObject(text);
  if (!carved) return null;
  try {
    const value = JSON.parse(carved) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
