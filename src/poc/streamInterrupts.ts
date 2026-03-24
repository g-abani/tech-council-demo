/**
 * Human-in-the-loop: derive pending interrupts from **streamed** graph chunks.
 * LangGraph emits `values.__interrupt__` on the stream when `interrupt()` runs; after resume
 * it may emit an empty array to clear. Relying only on `getState().tasks[].interrupts` is unsafe
 * — those entries can linger after resume and cause duplicate interrupt SSE + UI cards.
 */

import { INTERRUPT } from "@langchain/langgraph";

export function normalizeInterruptPayloads(raw: unknown[]): unknown[] {
  return raw
    .map((item) => {
      if (item && typeof item === "object" && item !== null && "value" in item) {
        return (item as { value: unknown }).value;
      }
      return item;
    })
    .filter((v) => v != null);
}

/** Folded across all chunks of one `graph.stream()` / `supervisor.stream()` call. */
export type StreamInterruptFold = {
  /** True if any chunk included the `__interrupt__` channel (even when cleared to []). */
  sawInterruptChannel: boolean;
  /** Latest non-empty interrupt payloads, or null if cleared or never set. */
  pendingInterrupts: unknown[] | null;
};

export function createStreamInterruptFold(): StreamInterruptFold {
  return { sawInterruptChannel: false, pendingInterrupts: null };
}

/**
 * Update fold from one stream chunk. Later chunks override earlier ones; empty `__interrupt__`
 * clears pending.
 */
export function foldStreamInterruptChunk(fold: StreamInterruptFold, chunk: unknown): void {
  if (!chunk || typeof chunk !== "object") return;
  const c = chunk as Record<string, unknown>;
  if (!(INTERRUPT in c)) return;
  fold.sawInterruptChannel = true;
  const arr = c[INTERRUPT];
  if (!Array.isArray(arr)) return;
  if (arr.length === 0) {
    fold.pendingInterrupts = null;
    return;
  }
  fold.pendingInterrupts = normalizeInterruptPayloads(arr);
}
