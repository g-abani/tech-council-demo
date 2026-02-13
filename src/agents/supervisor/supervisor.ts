/**
 * Supervisor Agent Implementation
 * Demonstrates the supervisor pattern for multi-agent orchestration
 * Context engineering: Supervisor coordinates worker agents as tools
 */

import { z } from "zod";
import { createAgent, createMiddleware, summarizationMiddleware, contextEditingMiddleware, ClearToolUsesEdit } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { llm, slm } from "../../services/llm.js";
import { createWorkerTools } from "./worker-tools.js";
import { createAzureModel } from "../../config/model.js";
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
const summarizationModel = createAzureModel(0.3, "gpt-4.1-mini");
const supervisor = createAgent({
  model: llm,  // Use shared LLM from services/llm.js
  tools: workerTools,
  checkpointer,  // Add checkpointer for memory
  middleware: [
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
    - jira_agent: for JIRA issues, tickets, team queries
    - research_agent: for general facts, external info, or text analysis
    - calculator_agent: for math and calculations
    PREFER azure_search_qna over research_agent for any company/project/tool-specific questions.
    Return agent responses EXACTLY—no additions, formatting, or commentary.
    Simple questions: answer directly. Multiple tasks: delegate sequentially.
    You are a transparent router, not a narrator.`.trim(),
});

export default supervisor;

