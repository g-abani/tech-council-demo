/**
 * Step 1 — Email hash vault (POC)
 * Mirrors LangChain `piiMiddleware` hash strategy: `sha256(email).slice(0, 8)` → token `<email_hash:xxxxxxxx>`.
 * Raw addresses are stored **before** PII middleware replaces them, so tools can resolve by hash.
 *
 * Demo: in-memory Map only. Production: use Redis / a secrets vault; do not log raw emails in prod.
 */

import { HumanMessage } from "@langchain/core/messages";
import { sha256 } from "@langchain/core/utils/hash";
import { createMiddleware, type AgentMiddleware } from "langchain";

/** Same pattern as `node_modules/langchain/dist/agents/middleware/pii.js` (EMAIL_PATTERN). */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** hash → original email (demo store — replace with Redis in production). */
const hashToEmail = new Map<string, string>();

export function isEmailHashVaultEnabled(): boolean {
  return process.env.SECURE_AGENT_EMAIL_HASH_VAULT === "true";
}

/** Must match LangChain `applyHashStrategy` for type `email`. */
export function emailHash8(email: string): string {
  return sha256(email).slice(0, 8);
}

/**
 * Record every email in plain text so `send_email_demo` can resolve `<email_hash:…>` later.
 */
export function storeEmailsFromPlainText(text: string): void {
  const re = new RegExp(EMAIL_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const addr = m[0];
    const h = emailHash8(addr);
    hashToEmail.set(h, addr);
  }
}

/**
 * Resolve 8-char hex (or full `<email_hash:xxxxxxxx>` token) to the stored address.
 */
export function getEmailByHashToken(token: string): string | undefined {
  const trimmed = token.trim();
  const bracket = trimmed.match(/<email_hash:([a-f0-9]{8})>/i);
  const h = bracket ? bracket[1]!.toLowerCase() : /^[a-f0-9]{8}$/i.test(trimmed) ? trimmed.toLowerCase() : undefined;
  if (!h) return undefined;
  return hashToEmail.get(h);
}

/** For tests / debugging only — do not expose in APIs. */
export function clearEmailHashVault(): void {
  hashToEmail.clear();
}

/**
 * Runs **before** `piiMiddleware("email", { strategy: "hash" })`: captures raw addresses from the last human turn.
 * Must be registered **immediately before** the shared PII middlewares in the agent.
 */
export function createEmailHashVaultMiddleware(): AgentMiddleware {
  return createMiddleware({
    name: "EmailHashVault",
    beforeModel: async (state) => {
      const messages = state.messages;
      if (!messages?.length) return;
      let lastHumanIdx: number | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (HumanMessage.isInstance(messages[i])) {
          lastHumanIdx = i;
          break;
        }
      }
      if (lastHumanIdx === null) return;
      const hm = messages[lastHumanIdx] as HumanMessage;
      const content =
        typeof hm.content === "string" ? hm.content : JSON.stringify(hm.content ?? "");
      storeEmailsFromPlainText(content);
    },
  });
}
