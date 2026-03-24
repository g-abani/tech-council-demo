/**
 * Step 4 — HITL: LangChain `humanInTheLoopMiddleware` intercepts selected tool calls
 * before execution (see docs/SECURE-AGENT-POC.md). Paired with `delete_confidential_record`
 * in worker-tools.ts (no internal `interrupt()` — middleware owns the pause).
 */

import { humanInTheLoopMiddleware, type AgentMiddleware } from "langchain";

export function isHitlEnabled(): boolean {
  return process.env.SECURE_AGENT_HITL !== "false";
}

/** Middleware factory output for createAgent */
export function hitlMiddlewares(): AgentMiddleware[] {
  return [
    humanInTheLoopMiddleware({
      interruptOn: {
        delete_confidential_record: {
          allowedDecisions: ["approve", "reject"],
          description:
            "⛔ DESTRUCTIVE (demo) — Delete confidential record. Approve only if you intend to run this tool.",
        },
      },
      descriptionPrefix: "Human approval required",
    }),
  ];
}
