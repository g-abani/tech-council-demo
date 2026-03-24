/**
 * Supervisor dynamic routing via `wrapModelCall` (LangChain pattern).
 * @see https://docs.langchain.com/oss/javascript/langchain/middleware/custom#dynamic-model-selection
 *
 * 1. **Intent:** If the latest user text looks JIRA-related → **Ollama** (`initChatModel("ollama:…")`).
 * 2. **Size:** Otherwise → **Azure OpenAI** — `large` vs `small` by message count (like
 *    `initChatModel("…gpt-4.1")` vs `…mini` in the docs); here we bind to the same deployments as
 *    `src/services/llm.ts` via `initChatModel("azure_openai:…")`.
 *
 * `initChatModel` is async; models are loaded once and cached (first supervisor model call may await).
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createMiddleware, initChatModel, type AgentMiddleware } from "langchain";
import { parseUserRole, type UserRole } from "./rbacMiddleware.js";
import { isLikelyLlmTransportFailure } from "./llmTransportErrors.js";

/** On unless explicitly `SECURE_AGENT_DYNAMIC_MODEL=false`. */
export function isDynamicModelEnabled(): boolean {
  return process.env.SECURE_AGENT_DYNAMIC_MODEL !== "false";
}

function parseMessageThreshold(): number {
  const raw = process.env.SECURE_AGENT_DYNAMIC_MODEL_MESSAGE_THRESHOLD;
  const n = raw ? Number.parseInt(raw, 10) : 10;
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

/** JIRA-ish: issue keys, common JIRA words, on-prem style project refs. */
const JIRA_INTENT_REGEXES: RegExp[] = [
  /\b[A-Z][A-Z0-9]{1,9}-\d+\b/, // PROJ-123
  /\b(jira|ticket|issue|epic|story|bug|sprint|board|backlog|assignee|reporter|transition)\b/i,
  /\bproj-\d+\b/i,
];

/**
 * Exported for tests / tooling — inspects the **last human** message only.
 * @param text — lowercased plain text from the last user turn
 */
export function detectJiraIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return JIRA_INTENT_REGEXES.some((re) => re.test(t));
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && "text" in c) {
          return String((c as { text?: string }).text ?? "");
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

function extractLastUserText(messages: unknown[] | undefined): string {
  if (!messages?.length) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { getType?: () => string; content?: unknown };
    if (typeof m?.getType === "function" && m.getType() === "human") {
      return messageContentToString(m.content).toLowerCase();
    }
  }
  return "";
}

type RoutingModels = {
  large: BaseChatModel;
  small: BaseChatModel;
  jira: BaseChatModel;
};

let routingModelsPromise: Promise<RoutingModels> | null = null;

/**
 * Lazy singleton — mirrors `llm` / `slm` / JIRA Ollama env, using `initChatModel` per LangChain universal API.
 */
export function getSupervisorRoutingModels(): Promise<RoutingModels> {
  if (!routingModelsPromise) {
    routingModelsPromise = loadSupervisorRoutingModels();
  }
  return routingModelsPromise;
}

async function loadSupervisorRoutingModels(): Promise<RoutingModels> {
  const jiraName =
    process.env.JIRA_OLLAMA_MODEL?.trim() ||
    process.env.OLLAMA_MODEL?.trim() ||
    "llama3.2";
  const jiraTemp = Number(process.env.JIRA_OLLAMA_TEMPERATURE ?? 0);

  const [large, small, jira] = await Promise.all([
    initChatModel(`azure_openai:gpt-4o`, {
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
      temperature: 0,
      maxRetries: 2,
    }),
    initChatModel(`azure_openai:gpt-4o-mini`, {
      azureOpenAIApiKey: process.env.AZURE_OPENAI_SLM_API_KEY || process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiInstanceName:
        process.env.AZURE_OPENAI_SLM_API_INSTANCE_NAME || process.env.AZURE_OPENAI_API_INSTANCE_NAME,
      azureOpenAIApiDeploymentName: "gpt-4.1-mini",
      azureOpenAIApiVersion: "2025-01-01-preview",
      temperature: 0,
      maxRetries: 2,
    }),
    initChatModel(`ollama:${jiraName}`, {
      baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
      temperature: Number.isFinite(jiraTemp) ? jiraTemp : 0,
    }),
  ]);

  return { large, small, jira };
}

/**
 * `wrapModelCall`: set `request.model` from JIRA intent + message count before the inner handler runs.
 * **Viewer** role: never route the supervisor to Ollama for "JIRA" intent — RBAC strips JIRA tools, and
 * Ollama often emits JSON text instead of valid tool calls. Use Azure so tool binding matches.
 */
export function createDynamicModelMiddleware(): AgentMiddleware {
  const threshold = parseMessageThreshold();
  const modelsPromise = getSupervisorRoutingModels();

  return createMiddleware({
    name: "DynamicModelMiddleware",
    wrapModelCall: async (request, handler) => {
      const { large, small, jira } = await modelsPromise;
      const n = request.messages?.length ?? 0;
      const lastUser = extractLastUserText(request.messages as unknown[]);
      const jiraIntent = detectJiraIntent(lastUser);

      const ctx = request.runtime.context as { userRole?: UserRole } | undefined;
      const role = parseUserRole(ctx?.userRole);
      /** JIRA-like user text → Ollama only when role may use JIRA tools (not viewer). */
      const useJiraOllama = jiraIntent && role !== "viewer";

      let model: BaseChatModel;
      if (useJiraOllama) {
        model = jira;
      } else {
        model = n > threshold ? large : small;
      }

      if (process.env.SECURE_AGENT_DYNAMIC_MODEL_DEBUG === "true") {
        const branch = useJiraOllama
          ? "ollama(jira)"
          : n > threshold
            ? "azure-large"
            : "azure-small";
        console.log(
          `[DynamicModel] messages=${n} threshold=${threshold} intent=${branch} role=${role} jiraIntent=${jiraIntent} lastUserLen=${lastUser.length}`
        );
      }

      const azureFallback = n > threshold ? large : small;

      try {
        return await handler({
          ...request,
          model,
        });
      } catch (err) {
        // JIRA intent uses Ollama; if it is not running, `fetch` fails — retry once on Azure.
        if (useJiraOllama && model === jira && isLikelyLlmTransportFailure(err)) {
          console.warn(
            "[DynamicModel] Ollama unreachable for supervisor JIRA route; falling back to Azure (start Ollama or set SECURE_AGENT_DYNAMIC_MODEL=false)."
          );
          return await handler({
            ...request,
            model: azureFallback,
          });
        }
        throw err;
      }
    },
  });
}
