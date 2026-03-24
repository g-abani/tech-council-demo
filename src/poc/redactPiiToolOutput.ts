/**
 * In-tool PII redaction for `returnDirect` tools.
 *
 * LangChain `piiMiddleware` applies `applyToToolResults` inside `beforeModel`. After a
 * **returnDirect** tool, the graph routes to END without another `beforeModel`, so tool
 * content never passes through that middleware. This helper mirrors the redact strategy
 * placeholders (`[REDACTED_EMAIL]`, etc.) when output DLP is on.
 */

import { isOutputDlpEnabled } from "./outputDlp.js";

/** Align with `pii.js` EMAIL_PATTERN / CREDIT_CARD_PATTERN / SSN. */
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;

export function redactPiiInToolOutputText(text: string): string {
  if (!isOutputDlpEnabled()) return text;
  return text
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(SSN, "[REDACTED_SSN_PATTERN]")
    .replace(CARD, "[REDACTED_CREDIT_CARD]");
}
