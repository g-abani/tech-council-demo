import dotenv from "dotenv";
import { getIMSTokenProvider } from "./imsTokenProvider.js";

dotenv.config();

export interface JiraCredentials {
  username: string;
  password: string;
  baseUrl: string;
  apiKey: string;
  imsClientId: string;
  imsClientSecret: string;
  imsClientCode: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  updated: string;
  team?: string;  // Optional team field for team searches
}

export interface JiraIssueDetail {
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  assignee: string;
  reporter: string;
  created: string;
  updated: string;
  labels: string[];
  components: string[];
  issueType: string;
  project: string;
  commentCount: number;
}

export interface JiraSearchOptions {
  jql: string;
  maxResults?: number;
}

export interface JiraServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusText?: string;
}

/**
 * JIRA Service - Handles all JIRA API interactions
 */
export class JiraService {
  private credentials: JiraCredentials;

  constructor(credentials?: Partial<JiraCredentials>) {
    // Load credentials from environment or provided values
    this.credentials = {
      username: credentials?.username || process.env.JIRA_USERNAME || '',
      password: credentials?.password || process.env.JIRA_PASSWORD || '',
      baseUrl: credentials?.baseUrl || process.env.IPAAS_JIRA_BASE_URL || 'https://ipaasapi.adobe-services.com',
      apiKey: credentials?.apiKey || process.env.IPAAS_JIRA_API_KEY || '',
      imsClientId: credentials?.imsClientId || process.env.JIRA_IMS_CLIENT_ID || '',
      imsClientSecret: credentials?.imsClientSecret || process.env.JIRA_IMS_CLIENT_SECRET || '',
      imsClientCode: credentials?.imsClientCode || process.env.JIRA_IMS_CLIENT_CODE || '',
    };
  }

  /**
   * Validate that all required credentials are present
   */
  private validateCredentials(): boolean {
    return !!(
      this.credentials.username &&
      this.credentials.password &&
      this.credentials.apiKey
    );
  }

  /**
   * Get IMS token for authentication
   */
  private async getIMSToken(): Promise<string> {
    const provider = getIMSTokenProvider({
      clientId: this.credentials.imsClientId,
      clientSecret: this.credentials.imsClientSecret,
      clientCode: this.credentials.imsClientCode,
    });
    return await provider.token();
  }

  /**
   * Make a request to the JIRA API
   */
  private async makeRequest<T>(
    endpoint: string,
    method: string = 'GET',
    body?: any
  ): Promise<JiraServiceResponse<T>> {
    try {
      // Validate credentials
      if (!this.validateCredentials()) {
        return {
          success: false,
          error: 'JIRA credentials not configured',
        };
      }

      // Get IMS token
      let imsToken: string;
      try {
        imsToken = await this.getIMSToken();
      } catch (error: any) {
        console.error('[JIRA Service] IMS token error:', error);
        return {
          success: false,
          error: `Failed to get IMS token: ${error.message}`,
        };
      }

      // Make the request
      const url = `${this.credentials.baseUrl}${endpoint}`;
      const requestInit: RequestInit = {
        method,
        headers: {
          'Accept': 'application/json',
          'Authorization': imsToken,
          'Username': this.credentials.username,
          'Password': this.credentials.password,
          'api_key': this.credentials.apiKey,
          'Content-Type': 'application/json',
        },
      };

      if (body) {
        requestInit.body = JSON.stringify(body);
      }

      const response = await fetch(url, requestInit);

      if (!response.ok) {
        console.error(`[JIRA Service] API error: ${response.status}`);
        return {
          success: false,
          error: `JIRA API error: ${response.status}`,
          statusText: response.statusText,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data: data as T,
      };
    } catch (error: any) {
      console.error('[JIRA Service] Unexpected error:', error);
      return {
        success: false,
        error: 'Request failed',
        statusText: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Search for JIRA issues using JQL
   */
  async searchIssues(options: JiraSearchOptions): Promise<JiraServiceResponse<JiraIssue[]>> {
    const { jql, maxResults = 5 } = options;
    const endpoint = `/jira/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`;

    const response = await this.makeRequest<any>(endpoint);

    if (!response.success) {
      return response;
    }

    // Transform the response to a simpler format
    const issues: JiraIssue[] = response.data?.issues?.map((issue: any) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      assignee: issue.fields.assignee?.displayName || 'Unassigned',
      updated: issue.fields.updated,
    })) || [];

    return {
      success: true,
      data: issues,
    };
  }

  /**
   * Search for issues assigned to a specific user
   */
  async searchUserIssues(userId: string, maxResults: number = 5, status?: string): Promise<JiraServiceResponse<JiraIssue[]>> {
    let jql = `project=DOTCOM AND assignee=${userId}`;

    if (status) {
      jql += ` AND status="${status}"`;
    }

    jql += ` ORDER BY updated DESC`;

    return await this.searchIssues({ jql, maxResults });
  }

  /**
   * Search for issues by team name (using custom field cf[12900])
   * @param teamName - The team name to search for
   * @param maxResults - Maximum number of results (default: 10)
   * @param includeAllStatuses - If true, includes all statuses. If false, excludes Done/Closed/Resolved (default: false)
   * @param status - Optional specific status to filter by (e.g., "To Do", "In Development")
   */
  async searchTeamIssues(teamName: string, maxResults: number = 10, includeAllStatuses: boolean = false, status?: string): Promise<JiraServiceResponse<JiraIssue[]>> {
    // Build JQL query based on status filter
    let jql = `project=DOTCOM AND cf[12900]=${teamName}`;

    // If specific status is provided, use it
    if (status) {
      jql += ` AND status="${status}"`;
    } else if (!includeAllStatuses) {
      jql += ` AND status NOT IN ("Done", "Closed", "Resolved")`;
    }

    jql += ` ORDER BY updated DESC`;

    const endpoint = `/jira/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`;

    const response = await this.makeRequest<any>(endpoint);

    if (!response.success) {
      return response;
    }

    // Transform the response to include team field from customfield_12900
    const issues: JiraIssue[] = response.data?.issues?.map((issue: any) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      assignee: issue.fields.assignee?.displayName || 'Unassigned',
      updated: issue.fields.updated,
      team: issue.fields.customfield_12900?.value || 'No team',
    })) || [];

    return {
      success: true,
      data: issues,
    };
  }

  /**
   * Search for issues by assignee name (display name)
   */
  async searchByAssigneeName(assigneeName: string, maxResults: number = 10, status?: string): Promise<JiraServiceResponse<JiraIssue[]>> {
    let jql = `project=DOTCOM AND assignee in ("${assigneeName}")`;

    if (status) {
      jql += ` AND status="${status}"`;
    }

    jql += ` ORDER BY updated DESC`;
    return await this.searchIssues({ jql, maxResults });
  }

  /**
   * Search issues by time range (e.g., updated in last week/month)
   * @param timeRange - Time range in JQL format (e.g., "1w" for 1 week, "1M" for 1 month, "2w" for 2 weeks)
   * @param maxResults - Maximum number of results to return
   */
  async searchByTimeRange(
    timeRange: string,
    maxResults: number = 10
  ): Promise<JiraServiceResponse<JiraIssue[]>> {
    const jql = `project=DOTCOM AND updated >= -${timeRange} ORDER BY updated DESC`;

    return await this.searchIssues({ jql, maxResults });
  }

  /**
   * Search user's own issues by time range
   * @param userid - User ID from IMS profile
   * @param timeRange - Time range in JQL format (e.g., "1w" for 1 week, "1M" for 1 month, "2w" for 2 weeks)
   * @param maxResults - Maximum number of results to return
   * @param status - Optional specific status to filter by (e.g., "To Do", "In Development")
   */
  async searchUserIssuesByTimeRange(
    userid: string,
    timeRange: string,
    maxResults: number = 10,
    status?: string
  ): Promise<JiraServiceResponse<JiraIssue[]>> {
    let jql = `project=DOTCOM AND assignee="${userid}" AND updated >= -${timeRange}`;

    if (status) {
      jql += ` AND status="${status}"`;
    }

    jql += ` ORDER BY updated DESC`;

    return await this.searchIssues({ jql, maxResults });
  }

  /**
   * Search issues by assignee name and time range
   * @param assigneeName - Assignee display name
   * @param timeRange - Time range in JQL format (e.g., "1w" for 1 week, "1M" for 1 month, "2w" for 2 weeks)
   * @param maxResults - Maximum number of results to return
   * @param status - Optional specific status to filter by (e.g., "To Do", "In Development")
   */
  async searchByAssigneeNameAndTimeRange(
    assigneeName: string,
    timeRange: string,
    maxResults: number = 10,
    status?: string
  ): Promise<JiraServiceResponse<JiraIssue[]>> {
    let jql = `project=DOTCOM AND assignee in ("${assigneeName}") AND updated >= -${timeRange}`;

    if (status) {
      jql += ` AND status="${status}"`;
    }

    jql += ` ORDER BY updated DESC`;

    return await this.searchIssues({ jql, maxResults });
  }

  /**
   * Get detailed information about a specific JIRA issue
   */
  async getIssueDetail(issueKey: string): Promise<JiraServiceResponse<JiraIssueDetail>> {
    const endpoint = `/jira/rest/api/2/issue/${issueKey}`;

    const response = await this.makeRequest<any>(endpoint);

    if (!response.success) {
      // Check for 404 specifically
      if (response.error?.includes('404')) {
        return {
          success: false,
          error: `Issue ${issueKey} not found`,
        };
      }
      return response;
    }

    // Transform the response to detailed issue format
    const issue = response.data;
    const issueDetail: JiraIssueDetail = {
      key: issue.key,
      summary: issue.fields.summary,
      description: issue.fields.description || 'No description',
      status: issue.fields.status.name,
      priority: issue.fields.priority?.name || 'None',
      assignee: issue.fields.assignee?.displayName || 'Unassigned',
      reporter: issue.fields.reporter?.displayName || 'Unknown',
      created: issue.fields.created,
      updated: issue.fields.updated,
      labels: issue.fields.labels || [],
      components: issue.fields.components?.map((c: any) => c.name) || [],
      issueType: issue.fields.issuetype?.name || 'Unknown',
      project: issue.fields.project?.name || 'Unknown',
      commentCount: issue.fields.comment?.total || 0,
    };

    return {
      success: true,
      data: issueDetail,
    };
  }
}

// Export a singleton instance
let _jiraServiceInstance: JiraService | null = null;

/**
 * Get or create the JIRA service instance
 */
export function getJiraService(credentials?: Partial<JiraCredentials>): JiraService {
  if (!_jiraServiceInstance || credentials) {
    _jiraServiceInstance = new JiraService(credentials);
  }
  return _jiraServiceInstance;
}

/**
 * Clear the cached JIRA service instance (useful for testing)
 */
export function clearJiraService(): void {
  _jiraServiceInstance = null;
}

