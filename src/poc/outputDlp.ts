/**
 * Step 3 — Output DLP audit (deck POC 3)
 *
 * PII redaction on assistant + tool messages is handled by the **same** `piiMiddleware`
 * instances as Step 1 (`src/poc/inputSafety.ts` → `sharedPiiMiddlewares`) so we never
 * register `piiMiddleware("email")` twice (ReactAgent rejects duplicates).
 *
 * This module: minimal JSONL audit after each model completion.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BaseMessage } from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";

const AUDIT_DIR = join(process.cwd(), "logs");
const AUDIT_FILE = join(AUDIT_DIR, "output-dlp-audit.jsonl");

export function isOutputDlpEnabled(): boolean {
  return process.env.SECURE_AGENT_OUTPUT_DLP !== "false";
}

function lastAiText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as BaseMessage & {
      _getType?: () => string;
      type?: string;
      text?: string;
    };
    const t = m._getType?.() ?? m.type;
    if (t === "ai" || t === "assistant") {
      if (typeof m.text === "string" && m.text.length > 0) return m.text;
      const c = m.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return JSON.stringify(c);
      return JSON.stringify(c ?? "");
    }
  }
  return "";
}

/**
 * Runs after the model step; logs a truncated snapshot of the last AI message.
 */
export const outputDlpAuditMiddleware: AgentMiddleware = createMiddleware({
  name: "OutputDlpAudit",
  afterModel: (state) => {
    const preview = lastAiText(state.messages as BaseMessage[]).slice(0, 480);
    const record = {
      ts: new Date().toISOString(),
      event: "OUTPUT_DLP_AUDIT",
      preview,
    };
    const line = `${JSON.stringify(record)}\n`;
    try {
      mkdirSync(AUDIT_DIR, { recursive: true });
      appendFileSync(AUDIT_FILE, line, "utf8");
    } catch (e) {
      console.warn("[OUTPUT_DLP_AUDIT] file append failed:", e);
    }
    console.log("[OUTPUT_DLP_AUDIT]", record);
    return;
  },
});

export function outputDlpMiddlewares(): AgentMiddleware[] {
  return isOutputDlpEnabled() ? [outputDlpAuditMiddleware] : [];
}

export { AUDIT_FILE };
