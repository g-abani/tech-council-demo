/**
 * Supervisor Agent Implementation
 * Demonstrates the supervisor pattern for multi-agent orchestration
 * Context engineering: Supervisor coordinates worker agents as tools
 */

import { z } from "zod";
import {
  createAgent,
  createMiddleware,
  summarizationMiddleware,
  contextEditingMiddleware,
  ClearToolUsesEdit,
  type CreateAgentParams,
} from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { llm, slm } from "../../services/llm.js";
import { createWorkerTools } from "./worker-tools.js";
import { createChatModel } from "../../config/model.js";
import { inputSafetyMiddlewares, isInputGuardEnabled } from "../../poc/inputSafety.js";
import { isRbacEnabled, rbacToolFilterMiddleware } from "../../poc/rbacMiddleware.js";
import { isOutputDlpEnabled, outputDlpMiddlewares } from "../../poc/outputDlp.js";
import { hitlMiddlewares, isHitlEnabled } from "../../poc/hitlMiddleware.js";
import {
  createDynamicModelMiddleware,
  isDynamicModelEnabled,
} from "../../poc/dynamicModelMiddleware.js";

const contextSchema = z.object({
  userName: z.string(),
});
/**
 * Simple logging middleware for model output
 */
const loggingMiddleware = createMiddleware({
  name: "LoggingMiddleware",
  afterModel: (state) => {
    const lastMsg = state.messages[state.messages.length - 1] as any;
    const content = typeof lastMsg?.content === "string"
      ? lastMsg.content.substring(0, 150)
      : JSON.stringify(lastMsg?.content).substring(0, 150);
    console.log(`📤 [Model Output]: ${content}${content?.length >= 150 ? '...' : ''}\n`);
    return;
  },
});

const loggingMiddleware2 = createMiddleware({
  name: "DebugLogging",
  beforeModel: (state) => {
    console.log("🔍 BEFORE MODEL - Messages:", state.messages.length, 
                "Tokens (approx):", state.messages.map(m => m.content?.length || 0).reduce((a, b) => a + b, 0));
    return;
  },
  afterModel: (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    console.log(`Model returned: ${lastMessage.content}`);
    return;
  }
});

/**
 * Create the Supervisor Agent with Memory and Summarization
 * Context engineering: Clear orchestration logic and delegation strategy
 * Uses checkpointer for conversation state management
 * Uses summarization middleware to prevent token overflow
 */

const workerTools = createWorkerTools();
// Create memory checkpointer for conversation persistence
const checkpointer = new MemorySaver();
const workerNames = workerTools.map(workerTools => workerTools.name).join(", ");
const summarizationModel = createChatModel(0.3, "gpt-4.1-mini");

/** Step 1 POC: input injection block + LangChain piiMiddleware (see docs/SECURE-AGENT-POC.md). Disable with SECURE_AGENT_INPUT_GUARD=false */
const secureInputMiddleware = isInputGuardEnabled() ? inputSafetyMiddlewares() : [];

/** Step 2 POC: role-based tool filtering. Disable with SECURE_AGENT_RBAC=false */
const rbacMiddleware = isRbacEnabled() ? [rbacToolFilterMiddleware] : [];

/** Step 3 POC: output PII redaction + JSONL audit. Disable with SECURE_AGENT_OUTPUT_DLP=false */
const outputDlpMiddleware = isOutputDlpEnabled() ? outputDlpMiddlewares() : [];

/** Step 4 POC: humanInTheLoopMiddleware for destructive tools. Disable with SECURE_AGENT_HITL=false */
const hitlMw = isHitlEnabled() ? hitlMiddlewares() : [];

/**
 * Hybrid routing (`wrapModelCall`): JIRA-like user text → Ollama (`initChatModel("ollama:…")`);
 * otherwise Azure large vs small by message count (`initChatModel("azure_openai:…")`).
 * Disable with SECURE_AGENT_DYNAMIC_MODEL=false — base model stays `llm` with no routing middleware.
 */
const dynamicModelMw = isDynamicModelEnabled() ? [createDynamicModelMiddleware()] : [];

const supervisor = createAgent({
  /** Dynamic off: `llm`. Dynamic on: default `slm`; middleware overrides per intent + thread length. */
  model: isDynamicModelEnabled() ? slm : llm,
  tools: workerTools,
  checkpointer,  // Add checkpointer for memory
  middleware: [
    ...secureInputMiddleware,
    ...rbacMiddleware,
    ...dynamicModelMw,
    ...hitlMw,
    ...outputDlpMiddleware,
    loggingMiddleware2,
    contextEditingMiddleware({
      edits: [
        new ClearToolUsesEdit({
          triggerTokens: 2000,      // Lower threshold for demo (default is 100K)
          keep: { messages: 3 },    // Keep 3 most recent tool results
          clearToolInputs: false,   // Keep tool call arguments for context
          excludeTools: [],         // No tools excluded from clearing
          placeholder: "[cleared]", // Placeholder for cleared results
        }),
      ],
      tokenCountMethod: "approx", // Use approximate counting for speed
    }),
    summarizationMiddleware({
      model: summarizationModel,
      trigger: { tokens: 2000 },
      keep: { messages: 5 },
      summaryPrefix: "📝 Summary:",
    }),
  ],
  systemPrompt: `You are a Supervisor Agent coordinating a team of specialized worker agents ${workerNames}. 
    Route queries to:
    - azure_search_qna: for internal/company knowledge (Milo, Feds, Project Stream, Adobe tools, setup guides, internal docs)
    - lookup_member: for demo member profiles in PostgreSQL by first name (Abani, Sandeep, Amit); PII redacted on output when output DLP is on
    - jira_agent: for JIRA issues, tickets, team queries
    - research_agent: for general facts, external info, or text analysis
    - calculator_agent: for math and calculations
    - send_email_demo: (demo) when user asks to send email and gave an address — use the <email_hash:…> token from the message as recipient (Step 1 hash vault); no real SMTP
    - delete_confidential_record: (admin only, destructive) mock deletion by record ID — triggers human approval in the UI before running
    PREFER azure_search_qna over research_agent for any company/project/tool-specific questions.
    Return agent responses EXACTLY—no additions, formatting, or commentary.
    Simple questions: answer directly. Multiple tasks: delegate sequentially.
    You are a transparent router, not a narrator.`.trim(),
} satisfies CreateAgentParams) as any;

export default supervisor;

