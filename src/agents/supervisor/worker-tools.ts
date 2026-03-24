import { z } from "zod";
import { tool, type StructuredTool } from "langchain";
import { interrupt, task } from "@langchain/langgraph";
import { createResearchAgent, createCalculatorAgent } from "../workers.js";
import jiraAgent, { createJiraAgent } from "../jira/jira-agent.js";
import { azureSearchTool } from "./supervisor-tools/azure-search.js";
import { sendEmailDemoTool } from "../../poc/sendEmailDemoTool.js";
import { memberLookupTool } from "../../poc/memberLookupTool.js";
import { llm } from "../../services/llm.js";
import { isLikelyLlmTransportFailure } from "../../poc/llmTransportErrors.js";

function jiraSubAgentModelLabel(which: "ollama" | "azure"): string {
  if (which === "ollama") {
    const m =
      process.env.JIRA_OLLAMA_MODEL?.trim() ||
      process.env.OLLAMA_MODEL?.trim() ||
      "llama3.2";
    const b = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    return `Ollama model=${m} baseUrl=${b}`;
  }
  const dep = process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME || "gpt-4o";
  return `Azure OpenAI deployment=${dep} (gpt-4o)`;
}

/**
 * Create tools that wrap worker agents
 * This is the key pattern: workers are exposed as tools to the supervisor
 */
export function createWorkerTools(): StructuredTool[] {
  const researchAgent = createResearchAgent();
  const calculatorAgent = createCalculatorAgent();

  /** Lazy Azure JIRA agent when Ollama is down (same tools + prompt as default). */
  let jiraAgentAzure: ReturnType<typeof createJiraAgent> | null = null;
  function getJiraAgentAzure() {
    if (!jiraAgentAzure) {
      jiraAgentAzure = createJiraAgent(llm);
    }
    return jiraAgentAzure;
  }

  /**
   * Durable task for research agent only — wraps the invocation so that
   * on resume after HITL interrupt, the checkpointed result is returned
   * without re-executing.
   */
  const runResearchAgent = task("runResearchAgent", async (query: string) => {
    console.log(`[Supervisor] Delegating to Research Agent: ${query}`);
    const startTime = Date.now();

    const result = await researchAgent.invoke({
      messages: [{ role: "user", content: query }],
    });

    console.log(`[Supervisor] Research Agent completed in ${Date.now() - startTime}ms`);

    const lastMessage = result.messages[result.messages.length - 1];
    if (lastMessage.text) return lastMessage.text;
    if (lastMessage.content) {
      return typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    }
    return JSON.stringify(lastMessage);
  });

  // Wrap JIRA agent as a tool
  const jiraAgentTool = tool(
    async (input: { query?: string }) => {
      let query = typeof input.query === "string" ? input.query.trim() : "";
      /** Models sometimes emit `{}` or omit `query`; avoid empty user turns to the sub-agent. */
      if (!query) {
        console.warn(
          "[Supervisor] delegate_to_jira_agent: empty or missing query — using fallback text"
        );
        query = "Show my JIRA issues";
      }

      const startTime = Date.now();
      console.log(
        `[Supervisor] Delegating to JIRA Agent: ${query} (trying ${jiraSubAgentModelLabel("ollama")})`
      );

      const invokePayload = {
        messages: [{ role: "user" as const, content: query }],
      };

      let result: Awaited<ReturnType<typeof jiraAgent.invoke>>;
      let jiraLlmUsed: "ollama" | "azure" = "ollama";
      try {
        result = await jiraAgent.invoke(invokePayload);
      } catch (err) {
        if (isLikelyLlmTransportFailure(err)) {
          console.warn(
            `[JIRA Agent] Ollama unreachable; retrying with ${jiraSubAgentModelLabel("azure")}`
          );
          jiraLlmUsed = "azure";
          result = await getJiraAgentAzure().invoke(invokePayload);
        } else {
          throw err;
        }
      }

      const elapsedTime = Date.now() - startTime;
      console.log(
        `[Supervisor] JIRA Agent completed in ${elapsedTime}ms (llm=${jiraSubAgentModelLabel(jiraLlmUsed)})`
      );

      // Extract token usage from all AI messages in the sub-agent response
      let subAgentTokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
      for (const msg of result.messages) {
        const msgType = (msg as any)._getType?.() || (msg as any).type;
        const usage = (msg as any).usage_metadata;
        if (msgType === "ai" && usage) {
          subAgentTokens.input_tokens += usage.input_tokens || 0;
          subAgentTokens.output_tokens += usage.output_tokens || 0;
          subAgentTokens.total_tokens += usage.total_tokens || 0;
        }
      }

      // Extract the final response from the agent
      const messages = result.messages;
      const lastMessage = messages[messages.length - 1];

      let response = '';
      if (lastMessage.text) {
        response = lastMessage.text;
      } else if (lastMessage.content) {
        if (typeof lastMessage.content === 'string') {
          response = lastMessage.content;
        } else {
          response = JSON.stringify(lastMessage.content);
        }
      } else {
        response = JSON.stringify(lastMessage);
      }

      return JSON.stringify({
        __agentResponse: true,
        agent: "jira",
        content: response,
        tokens: subAgentTokens
      });
    },
    {
      name: "delegate_to_jira_agent",
      description: "Delegates a task to the JIRA Agent for searching JIRA issues, getting issue details, or finding team-specific issues. Use this when you need to interact with JIRA - search for issues by team name, get issue details by key, or search user's assigned issues. The JIRA Agent has access to JIRA API tools.",
      returnDirect: true,
      schema: z.object({
        query: z
          .string()
          .min(
            1,
            "Always pass the user's JIRA request verbatim (e.g. Show my JIRA tickets). Do not call with empty arguments."
          )
          .describe(
            "The JIRA-related question or task to delegate to the JIRA Agent (e.g., 'Show me Vendors team issues', 'Get details for PROJ-123', 'Show my open issues')"
          ),
      }),
    }
  );

  // Research agent with human-in-the-loop + durable execution
  const researchAgentTool = tool(
    async ({ query }: { query: string }) => {
      // Human-in-the-loop: pause for approval before running research.
      // interrupt() is a LangGraph primitive — NOT wrapped in task().
      const approval = interrupt({
        action: "delegate_to_research_agent",
        query,
        message: `Approve research query: "${query}"`,
      });

      if (approval?.action !== "approve") {
        return "Research cancelled by user.";
      }

      const finalQuery = approval.query ?? query;

      // Side-effect wrapped in task() for durable execution
      return await runResearchAgent(finalQuery);
    },
    {
      name: "delegate_to_research_agent",
      description: "Delegates a task to the Research Agent for information lookup, fact-checking, or text analysis. Use this when you need to research information, look up facts, or analyze text content. The Research Agent has access to research and text analysis tools.",
      returnDirect: true,
      schema: z.object({
        query: z.string().describe("The research question or task to delegate to the Research Agent"),
      }),
    }
  );

  /**
   * Mock destructive tool — Step 4 HITL demo.
   * Does NOT call interrupt(); `humanInTheLoopMiddleware` pauses before execution.
   */
  const deleteConfidentialRecordTool = tool(
    async ({ recordId }: { recordId: string }) => {
      const id = String(recordId ?? "").trim() || "unknown";
      console.log(`[Supervisor] delete_confidential_record (mock) approved — recordId=${id}`);
      return JSON.stringify({
        ok: true,
        deletedRecordId: id,
        note: "Demo only — no datastore was modified.",
      });
    },
    {
      name: "delete_confidential_record",
      description:
        "Deletes a confidential record by ID. DESTRUCTIVE — requires human approval via the UI before execution. Use only when the user explicitly asks to delete a confidential record.",
      returnDirect: true,
      schema: z.object({
        recordId: z.string().describe("Identifier of the confidential record to delete"),
      }),
    }
  );

  // Wrap calculator agent as a tool
  const calculatorAgentTool = tool(
    async ({ query }: { query: string }) => {
      const startTime = Date.now();
      console.log(`[Supervisor] Delegating to Calculator Agent: ${query}`);

      const result = await calculatorAgent.invoke({
        messages: [{ role: "user", content: query }],
      });

      const elapsedTime = Date.now() - startTime;
      console.log(`[Supervisor] Calculator Agent completed in ${elapsedTime}ms`);

      const messages = result.messages;
      const lastMessage = messages[messages.length - 1];

      let response = '';
      if (lastMessage.text) {
        response = lastMessage.text;
      } else if (lastMessage.content) {
        response = typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      } else {
        response = JSON.stringify(lastMessage);
      }

      return response;
    },
    {
      name: "delegate_to_calculator_agent",
      description: "Delegates a task to the Calculator Agent for mathematical computations, arithmetic operations, or numerical analysis. Use this when you need to perform calculations, solve math problems, or work with numbers.",
      returnDirect: true,
      schema: z.object({
        query: z.string().describe("The mathematical problem or calculation task to delegate to the Calculator Agent"),
      }),
    }
  );

  return [
    jiraAgentTool,
    researchAgentTool,
    calculatorAgentTool,
    sendEmailDemoTool,
    azureSearchTool,
    memberLookupTool,
    deleteConfidentialRecordTool,
  ];
}
