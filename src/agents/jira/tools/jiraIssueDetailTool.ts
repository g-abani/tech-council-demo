import { DynamicStructuredTool } from "langchain";
import { z } from "zod";
import { getJiraService } from "../../../services/external/jiraService.js";

export const jiraIssueDetailTool = new DynamicStructuredTool({
  name: "jira_issue_detail",
  description: "Get detailed information about a specific JIRA issue by its key (e.g., DOTCOM-12345). Returns full details including description, status, assignee, priority, labels, comments, etc.",
  schema: z.object({
    issueKey: z.string().describe("The JIRA issue key (e.g., 'DOTCOM-166263')")
  }) as any,
  returnDirect: true,
  func: async ({ issueKey }: { issueKey: string }) => {
    try {
      // Use the JIRA service to get issue details
      console.log("jira_issue_detail_tool ", issueKey);
      const jiraService = getJiraService();
      const result = await jiraService.getIssueDetail(issueKey);

      if (!result.success) {
        // Map service errors to tool error format
        if (result.error === 'Request failed') {
          // Network or unexpected errors
          return JSON.stringify({
            error: 'Tool execution failed',
            message: result.statusText || 'Unknown error'
          });
        }
        // API, credential, or 404 errors
        return JSON.stringify({
          error: result.error,
          statusText: result.statusText
        });
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

