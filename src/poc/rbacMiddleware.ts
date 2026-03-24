/**
 * Step 2 — RBAC: least-privilege tool filtering (deck POC 2).
 * Uses createMiddleware + wrapModelCall; role comes from runtime context on invoke/stream.
 */

import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";
import { z } from "zod";

export const USER_ROLES = ["viewer", "editor", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Tool names from createWorkerTools() — keep in sync with worker-tools.ts */
const TOOL = {
  search: "azure_search_qna",
  member: "lookup_member",
  jira: "delegate_to_jira_agent",
  research: "delegate_to_research_agent",
  calculator: "delegate_to_calculator_agent",
  sendEmail: "send_email_demo",
} as const;
// `delete_confidential_record` is admin-only (implicit via case "admin": return true; not listed for editor/viewer)

/**
 * Resolves runtime/API role. Unknown or missing values default to **viewer** (least privilege),
 * so missing LangGraph `context.userRole` never escalates to full tool access.
 */
export function parseUserRole(value: unknown): UserRole {
  if (value === "viewer" || value === "editor" || value === "admin") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "viewer" || v === "editor" || v === "admin") return v;
  }
  return "viewer";
}

/**
 * viewer: internal read/search only (no JIRA, no sub-agents that broaden blast radius)
 * editor: search + JIRA + calculator (no open-ended research delegation)
 * admin: all tools (includes destructive delete_confidential_record + HITL)
 */
function allowTool(role: UserRole, toolName: string): boolean {
  switch (role) {
    case "viewer":
      return toolName === TOOL.search || toolName === TOOL.member;
    case "editor":
      return (
        toolName === TOOL.search ||
        toolName === TOOL.member ||
        toolName === TOOL.jira ||
        toolName === TOOL.calculator ||
        toolName === TOOL.sendEmail
      );
    case "admin":
      return true;
    default:
      return false;
  }
}

const rbacContextSchema = z.object({
  userRole: z.enum(["viewer", "editor", "admin"]).optional(),
});

export const rbacToolFilterMiddleware: AgentMiddleware = createMiddleware({
  name: "RBACToolFilter",
  contextSchema: rbacContextSchema,
  wrapModelCall: (request, handler) => {
    const ctx = request.runtime.context as { userRole?: UserRole } | undefined;
    const role = parseUserRole(ctx?.userRole);

    const tools = request.tools ?? [];
    const filtered = tools.filter((t) =>
      allowTool(role, String((t as { name?: unknown }).name ?? ""))
    );

    console.log(
      `[RBAC] role=${role} → ${filtered.length}/${tools.length} tools (${filtered.map((t) => String((t as { name?: unknown }).name ?? "")).join(", ") || "none"})`
    );

    if (filtered.length === 0) {
      return new AIMessage({
        content: `No tools are available for role "${role}". Try a different role or contact an admin.`,
      });
    }

    /**
     * Base system prompt still lists JIRA/research/etc. Models (especially Ollama) may emit
     * JSON-shaped text for tools that are not bound. Reinforce allowed tool names per role.
     */
    const allowedNames = filtered
      .map((t) => String((t as { name?: unknown }).name ?? ""))
      .filter(Boolean)
      .join(", ");
    const constraint =
      `\n\n[ROLE CONSTRAINT] Effective role: "${role}". ` +
      `You may ONLY invoke these tools: ${allowedNames}. ` +
      `Do not output JSON, fake tool calls, or parameters for tools you do not have (e.g. delegate_to_jira_agent when it is not listed). ` +
      `If the user asks for JIRA, research, or other restricted actions and you lack the tool, reply in plain language and suggest allowed alternatives.`;

    const systemMessage = request.systemMessage.concat(
      new SystemMessage(constraint)
    );

    return handler({ ...request, tools: filtered, systemMessage });
  },
});

export function isRbacEnabled(): boolean {
  return process.env.SECURE_AGENT_RBAC !== "false";
}
