/**
 * Detect likely network / transport failures (e.g. Ollama not running) vs application errors.
 * Used for graceful fallback to Azure when local LLM is unreachable.
 */

/** Collect message strings from Error and nested `cause` (e.g. MiddlewareError chains). */
export function collectErrorMessages(err: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  if (err instanceof Error) {
    out.push(err.message);
    if (err.cause !== undefined) collectErrorMessages(err.cause, out, depth + 1);
  } else if (typeof err === "string") {
    out.push(err);
  }
  return out;
}

/** True when failure is likely unreachable local HTTP (Ollama, etc.), not auth or bad request. */
export function isLikelyLlmTransportFailure(err: unknown): boolean {
  const parts = collectErrorMessages(err).join(" ").toLowerCase();
  return (
    parts.includes("fetch failed") ||
    parts.includes("econnrefused") ||
    parts.includes("enotfound") ||
    parts.includes("etimedout") ||
    parts.includes("socket") ||
    parts.includes("network")
  );
}
