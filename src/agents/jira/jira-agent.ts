import { createAgent } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Runnable } from "@langchain/core/runnables";
import { getJiraOllamaModel } from "../../poc/jiraOllamaModel.js";
import { jiraTeamSearchTool } from "./tools/jiraTeamSearchTool.js";
import { jiraIssueDetailTool } from "./tools/jiraIssueDetailTool.js";
import { jiraMyIssueSearchTool } from "./tools/jiraMyIssueSearchTool.js";
import { jiraAssigneeSearchTool } from "./tools/jiraAssigneeSearchTool.js";

const tools = [
  jiraTeamSearchTool,
  jiraIssueDetailTool,
  jiraMyIssueSearchTool,
  jiraAssigneeSearchTool,
];
const toolNames = tools.map((t) => t.name).join(", ");

function jiraSystemPrompt(): string {
  return `You are a JIRA expert assistant with ${toolNames}. Return tool results as raw JSON only—no markdown or text. Format: {"hasJIRADetail": true, "data": [...]}`;
}

/** Build a JIRA worker agent on the given chat model (Ollama for on-prem, Azure as fallback). */
export function createJiraAgent(model: BaseChatModel): Runnable {
  return createAgent({
    model,
    tools,
    systemPrompt: jiraSystemPrompt(),
  }) as unknown as Runnable;
}

/** Default: Ollama — `worker-tools` retries with Azure when Ollama is unreachable. */
const jiraLlm = getJiraOllamaModel();
const jiraAgent: Runnable = createJiraAgent(jiraLlm);
export default jiraAgent;
