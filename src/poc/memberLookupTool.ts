/**
 * Looks up demo rows from PostgreSQL `members` (PII).
 * With `returnDirect: true`, LangGraph skips a final `beforeModel` pass, so `piiMiddleware`
 * may not redact tool results — we apply the same redact placeholders when output DLP is on.
 */

import { tool } from "langchain";
import { z } from "zod";
import { findMembersByFirstName, isMembersDbConfigured } from "../services/membersDb.js";
import { redactPiiInToolOutputText } from "./redactPiiToolOutput.js";

function formatMember(m: {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  credit_card_number: string;
  ssn: string;
}): string {
  return [
    `Member ID: ${m.id}`,
    `Name: ${m.first_name} ${m.last_name}`,
    `Email: ${m.email}`,
    `Credit card: ${m.credit_card_number}`,
    `SSN: ${m.ssn}`,
  ].join("\n");
}

export const memberLookupTool = tool(
  async ({ firstName }: { firstName: string }) => {
    if (!isMembersDbConfigured()) {
      return (
        "Member lookup is not configured. Set DATABASE_URL or POSTGRES_URL and run scripts/members.sql to create the members table and seed data."
      );
    }

    const name = firstName.trim();
    if (!name) {
      return "Provide a first name to look up (e.g. Abani, Sandeep, Amit).";
    }

    try {
      const rows = await findMembersByFirstName(name);
      if (rows.length === 0) {
        return `No members found with first name "${name}".`;
      }
      const raw = rows.map(formatMember).join("\n\n---\n\n");
      return redactPiiInToolOutputText(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[lookup_member]", msg);
      return `Member lookup failed: ${msg}`;
    }
  },
  {
    name: "lookup_member",
    returnDirect: true,
    description:
      "Look up internal member profile details from the PostgreSQL members database by first name. Use when the user asks to find member details, profile, or PII for a person by their first name (e.g. Abani, Sandeep, Amit). Returns email, card, SSN — output is redacted by security middleware when enabled.",
    schema: z.object({
      firstName: z
        .string()
        .describe("First name to search (e.g. Abani, Sandeep, Amit). Case-insensitive."),
    }),
  }
);
