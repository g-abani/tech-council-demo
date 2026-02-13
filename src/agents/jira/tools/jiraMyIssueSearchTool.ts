import { DynamicStructuredTool } from "langchain";
import { z } from "zod";
import { getJiraService } from "../../../services/external/jiraService.js";

export const jiraMyIssueSearchTool = new DynamicStructuredTool({
  name: "jira_my_issue_search",
  description: "Search for the current user's recent JIRA issues. Returns the 5 most recent issues assigned to the current user. By DEFAULT returns all open issues (To Do, In Development, In Progress). ONLY use status parameter when user EXPLICITLY mentions a specific status like 'my Done issues' or 'my To Do tasks'.",
  schema: z.object({
    userid: z.string().default("behera").describe("JIRA userid to search issues for"),
    status: z.string().default("").describe("Optional status to filter by. ONLY use if user explicitly mentions a status (e.g., 'my Done issues', 'my To Do tasks'). Leave empty for general queries like 'show my tickets'."),
  }),
  returnDirect: true,
  func: async (
    { userid, status }: { userid?: string; status?: string }
  ) => {
    try {
      // Get userid from state if not provided
      if (!userid) {
        userid = 'behera';
      }

      // Use the JIRA service to search for user issues
      const jiraService = getJiraService();
      console.log(`[JIRA Tool] Searching for user issues for user: ${userid} with status: ${status}`);
      const result = await jiraService.searchUserIssues(userid, 5, status);

      if (!result.success) {
        // Map service errors to tool error format
        if (result.error === 'Request failed') {
          // Network or unexpected errors
          return JSON.stringify({
            error: 'Tool execution failed',
            message: result.statusText || 'Unknown error'
          });
        }
        // API or credential errors
        return JSON.stringify({
          error: result.error,
          statusText: result.statusText
        });
      }

      // Check if no issues were found
      if (!result.data || result.data.length === 0) {
        const statusFilter = status ? ` with status "${status}"` : '';
        return JSON.stringify({
          hasJIRADetail: false,
          message: `No issues found assigned to you${statusFilter}.`,
          issueCount: 0
        }, null, 2);
      }

      return JSON.stringify({ hasJIRADetail: true, data: result.data }, null, 2);

    } catch (error: any) {
      console.error('[JIRA Tool] Unexpected error:', error);
      return JSON.stringify({
        error: 'Tool execution failed',
        message: error.message || 'Unknown error',
        stack: error.stack
      });
    }
  }
} as any);

