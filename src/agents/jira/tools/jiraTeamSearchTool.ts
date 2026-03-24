import { DynamicStructuredTool } from "langchain";
import { z } from "zod";
import { getJiraService } from "../../../services/external/jiraService.js";
import { zOptionalBooleanDefault, zOptionalString } from "../../../utils/zodFromLlm.js";


//returnDirect: true
export const jiraTeamSearchTool = new DynamicStructuredTool({
  name: "jira_team_search",
  description: "Search for JIRA issues by team name. ONLY use this when you have a SPECIFIC team name (e.g., 'Vendors', 'Merch', 'Engineering', 'GWP'). DO NOT use if user hasn't provided a team name - ask for it first instead. By default returns open issues only, unless user specifically asks for 'all' issues. Can filter by status (e.g., 'To Do', 'In Development').",
  schema: z.object({
    teamName: z.string().describe("The SPECIFIC team name (e.g., 'Vendors', 'Merch', 'Engineering'). Must be a team name, not a full sentence."),
    includeAllStatuses: zOptionalBooleanDefault(false).describe(
      "Set to true if user asks for 'all' issues including Done/Closed/Resolved. Default is false (open issues only)."
    ),
    status: zOptionalString.describe(
      "Optional status to filter by (e.g., 'To Do', 'In Development', 'In Progress', 'Done')"
    ),
  }) as any,
  returnDirect: true,
  func: async ({ teamName, includeAllStatuses = false, status }: { teamName: string; includeAllStatuses?: boolean; status?: string }) => {
    try {
      // Validate team name format
      const invalidPatterns = [
        /show/i,
        /my/i,
        /issues?/i,
        /team issues/i,
        /jira/i,
        /what|how|when|where|why/i,
      ];

      const isInvalidTeamName = invalidPatterns.some(pattern => pattern.test(teamName));
      if (isInvalidTeamName) {
        return JSON.stringify({
          error: "Invalid team name provided",
          message: "Please provide a specific team name (e.g., 'Vendors', 'Merch', 'Engineering')",
          providedInput: teamName,
          requiresClarification: true
        });
      }

      // Use the JIRA service to search for team issues
      const jiraService = getJiraService();
      const result = await jiraService.searchTeamIssues(teamName, 10, includeAllStatuses, status);

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
        return JSON.stringify({
          hasJIRADetail: false,
          message: `No issues found for team ${teamName}.`,
          teamName: teamName,
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
} );