import { createAgent } from "langchain";
// import { summarizationMiddleware } from "langchain";  // Disabled for performance testing
import { llm } from "../../services/llm.js";
import { jiraTeamSearchTool } from "./tools/jiraTeamSearchTool.js";
import { jiraIssueDetailTool } from "./tools/jiraIssueDetailTool.js";
import { jiraMyIssueSearchTool } from "./tools/jiraMyIssueSearchTool.js";
import { jiraAssigneeSearchTool } from "./tools/jiraAssigneeSearchTool.js";
import { MemorySaver } from "@langchain/langgraph";
//import { z } from "zod";



//const checkpointer = new MemorySaver();
/*const checkpointer = await RedisSaver.fromUrl(
    "redis://localhost:6379",
    {
        defaultTTL: 60, // TTL in minutes
        refreshOnRead: false
    }
);*/
// Manual message trimming middleware (commented out - causes routing error)
// const trimMessagesMiddleware = createMiddleware({
//   name: "TrimMessages",
//   beforeModel: async (state) => {
//     const maxMessages = 40;
//     if (state.messages && state.messages.length > maxMessages) {
//       console.log(`[Middleware] Trimming messages: ${state.messages.length} -> ${maxMessages}`);
//       return { ...state, messages: state.messages.slice(-maxMessages) };
//     }
//     return state;
//   },
// });

const tools = [jiraTeamSearchTool, jiraIssueDetailTool, jiraMyIssueSearchTool, jiraAssigneeSearchTool];
const toolNames = tools.map(tool => tool.name).join(", ");
const jiraAgent = createAgent({
  model: llm,
  tools,
  //checkpointer,
  // Using summarizationMiddleware with NO config - any config causes routing error
  // Default behavior: triggers on token threshold, uses main model for summarization
  // middleware: [summarizationMiddleware],  // DISABLED for performance testing
  //responseFormat: JiraResponse,
  systemPrompt: `You are a JIRA expert assistant with ${toolNames}. Return tool results as raw JSON only—no markdown or text. Format: {"hasJIRADetail": true, "data": [...]}`,
});

export default jiraAgent;