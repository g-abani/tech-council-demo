/**
 * Step 1 — Input safety (POC)
 * - Prompt injection: block before LLM via wrapModelCall (deck-style heuristics).
 * - PII: one `piiMiddleware` per type for input and/or output (LangChain forbids duplicate types).
 */

import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { isOutputDlpEnabled } from "./outputDlp.js";
import {
  createMiddleware,
  piiMiddleware,
  type AgentMiddleware,
} from "langchain";
import {
  createEmailHashVaultMiddleware,
  isEmailHashVaultEnabled,
} from "./piiEmailHashVault.js";

/** Central list — tweak for your talk; keep patterns readable (KISS). */
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|all|above)\s+instructions?/i,
  /disregard\s+(the\s+)?(system|developer)/i,
  /you\s+are\s+now\s+(a\s+)?DAN/i,
  /jailbreak/i,
];

function lastHumanText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const t = (m as { _getType?: () => string })._getType?.() ?? (m as { type?: string }).type;
    if (t === "human") {
      const c = (m as { content?: unknown }).content;
      return typeof c === "string" ? c : JSON.stringify(c);
    }
  }
  return "";
}

/**
 * Blocks the model call when a prompt-injection heuristic matches.
 * Returns a fixed assistant message instead of calling the LLM.
 */
export const promptInjectionBlockingMiddleware: AgentMiddleware =
  createMiddleware({
    name: "PromptInjectionBlock",
    wrapModelCall: async (request, handler) => {
      const text = lastHumanText(request.messages as BaseMessage[]);
      for (const re of INJECTION_PATTERNS) {
        const copy = new RegExp(re.source, re.flags);
        if (copy.test(text)) {
          return new AIMessage({
            content:
              "Request blocked by input guard: possible prompt-injection pattern detected.",
          });
        }
      }
      return handler(request);
    },
  });

/**
 * Single registration per PII type: ReactAgent throws if `piiMiddleware("email")` appears twice.
 * Input surfaces ↔ Step 1; output + tool results ↔ Step 3 (same middleware, different flags).
 */
function sharedPiiMiddlewares(): AgentMiddleware[] {
  const inputOn = isInputGuardEnabled();
  const outputOn = isOutputDlpEnabled();
  if (!inputOn && !outputOn) return [];

  /** When hash vault is on + input guard on, match LangChain sample: hash emails so tools can resolve via vault. */
  const emailStrategy =
    isEmailHashVaultEnabled() && inputOn ? "hash" : "redact";

  return [
    piiMiddleware("email", {
      strategy: emailStrategy,
      applyToInput: inputOn,
      applyToOutput: outputOn,
      applyToToolResults: outputOn,
    }),
    piiMiddleware("ssn_pattern", {
      detector: /\b\d{3}-\d{2}-\d{4}\b/g,
      strategy: "redact",
      applyToInput: inputOn,
      applyToOutput: outputOn,
      applyToToolResults: outputOn,
    }),
    piiMiddleware("credit_card", {
      strategy: "redact",
      applyToInput: inputOn,
      applyToOutput: outputOn,
      applyToToolResults: outputOn,
    }),
  ];
}

/**
 * Order: injection → (optional) email hash vault **before** PII hash → shared PII.
 * Vault must run before `piiMiddleware("email", { strategy: "hash" })` so raw addresses are stored.
 */
export function inputSafetyMiddlewares(): AgentMiddleware[] {
  const injection = isInputGuardEnabled()
    ? [promptInjectionBlockingMiddleware]
    : [];
  const vault =
    isEmailHashVaultEnabled() && isInputGuardEnabled()
      ? [createEmailHashVaultMiddleware()]
      : [];
  return [...injection, ...vault, ...sharedPiiMiddlewares()];
}

export function isInputGuardEnabled(): boolean {
  return process.env.SECURE_AGENT_INPUT_GUARD !== "false";
}
