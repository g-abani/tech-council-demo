import { z } from "zod";
import { tool } from "langchain";
import { interrupt, task } from "@langchain/langgraph";
import { createResearchAgent, createCalculatorAgent } from "../workers.js";
import jiraAgent from "../jira/jira-agent.js";
import { azureSearchTool } from "./supervisor-tools/azure-search.js";

/**
 * Create tools that wrap worker agents
 * This is the key pattern: workers are exposed as tools to the supervisor
 */
export function createWorkerTools() {
  const researchAgent = createResearchAgent();
  const calculatorAgent = createCalculatorAgent();

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
    async ({ query }: { query: string }) => {
      const startTime = Date.now();
      console.log(`[Supervisor] Delegating to JIRA Agent: ${query}`);

      const result = await jiraAgent.invoke({
        messages: [{ role: "user", content: query }],
      });

      const elapsedTime = Date.now() - startTime;
      console.log(`[Supervisor] JIRA Agent completed in ${elapsedTime}ms`);

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
        query: z.string().describe("The JIRA-related question or task to delegate to the JIRA Agent (e.g., 'Show me Vendors team issues', 'Get details for PROJ-123', 'Show my open issues')"),
      })
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

  return [jiraAgentTool, researchAgentTool, calculatorAgentTool, azureSearchTool];
}
