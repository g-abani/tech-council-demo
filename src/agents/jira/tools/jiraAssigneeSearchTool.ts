import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getJiraService } from "../../../services/external/jiraService.js";
import { zOptionalString } from "../../../utils/zodFromLlm.js";

export const jiraAssigneeSearchTool = new DynamicStructuredTool({
  name: "jira_assignee_search",
  description: "Search for JIRA issues by assignee's name. Use this when the user wants to see issues assigned to a specific person by their display name (e.g., 'John Doe', 'Jane Smith', 'Gunjan'). Returns up to 10 most recent issues. Can filter by status (e.g., 'To Do', 'In Development').",
  returnDirect: true,
  schema: z.object({
    assigneeName: z.string().describe("The assignee's display name (e.g., 'John Doe', 'Jane Smith', 'Gunjan', 'Tiwari'). Can be single name or full name as it appears in JIRA."),
    status: zOptionalString.describe(
      "Optional status to filter by (e.g., 'To Do', 'In Development', 'In Progress', 'Done')"
    ),
  }) as any,
  func: async ({ assigneeName, status }: { assigneeName: string; status?: string }) => {
    try {
      // Validate assignee name format
      const trimmedName = assigneeName.trim();

      if (!trimmedName || trimmedName.length < 2) {
        return JSON.stringify({
          error: "Invalid assignee name",
          message: "Please provide a valid name (e.g., 'John Doe', 'Gunjan', 'Jane Smith')",
          providedInput: assigneeName,
          requiresClarification: true
        });
      }

      // Check for invalid patterns (sentences or queries instead of names)
      const invalidPatterns = [
        /show/i,
        /issues?/i,
        /jira/i,
        /assigned to/i,
        /what|how|when|where|why/i,
      ];

      const isInvalidName = invalidPatterns.some(pattern => pattern.test(trimmedName));
      if (isInvalidName) {
        return JSON.stringify({
          error: "Invalid assignee name provided",
          message: "Please provide just the assignee's name (e.g., 'John Doe', 'Jane Smith', 'James'), not a question or sentence",
          providedInput: assigneeName,
          requiresClarification: true
        });
      }

      // Use the JIRA service to search by assignee name
      const jiraService = getJiraService();
      const result = await jiraService.searchByAssigneeName(trimmedName, 10, status);

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
          message: `No issues found for ${trimmedName}`,
          assigneeName: trimmedName,
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