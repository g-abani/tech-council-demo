/**
 * Dummy “send email” tool — logs only, no SMTP.
 * Resolves recipient via Step 1 email hash vault (`getEmailByHashToken`).
 */

import { tool } from "langchain";
import { z } from "zod";
import { emailHash8, getEmailByHashToken } from "./piiEmailHashVault.js";

export const sendEmailDemoTool = tool(
  async ({
    email_hash_token,
    subject,
    body,
  }: {
    email_hash_token: string;
    subject?: string;
    body: string;
  }) => {
    const resolved = getEmailByHashToken(email_hash_token);
    if (!resolved) {
      return (
        "Could not send: no stored email for that token. " +
        "Ask the user to include their address in a message first, and ensure the email hash vault is enabled (SECURE_AGENT_EMAIL_HASH_VAULT=true)."
      );
    }

    // Demo only — do not log raw PII in production.
    console.log(
      `[send_email_demo] DEMO send — subject=${subject ?? "(none)"}, bodyLength=${body.length}`
    );
    console.log("resolved email", resolved);
    const hash = emailHash8(resolved);
    const preview = body.length > 120 ? `${body.slice(0, 120)}…` : body;

    /** Plain text so the chat UI shows a normal message, not a JSON blob. */
    return [
      "Email sent (demo — no real mail transport).",
      "",
      `To (pseudonym): <email_hash:${hash}>`,
      `Subject: ${subject?.trim() ? subject : "(none)"}`,
      "",
      `Body: ${preview}`,
    ].join("\n");
  },
  {
    name: "send_email_demo",
    returnDirect: true,
    description:
      "DEMO ONLY: Pretend to send an email. Pass the exact recipient token from the conversation (e.g. <email_hash:xxxxxxxx>) after the user gave an email — raw addresses are redacted for the model. Does not use SMTP.",
    schema: z.object({
      email_hash_token: z
        .string()
        .describe(
          "Recipient token as shown in messages, e.g. <email_hash:a1b2c3d4>, or the 8-character hex hash alone."
        ),
      subject: z.string().optional().describe("Email subject line."),
      body: z.string().describe("Email body (plain text)."),
    }),
  }
);
