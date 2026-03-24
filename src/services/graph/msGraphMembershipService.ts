import {
  getMSGraphTokenProvider,
  type MSGraphCredentials,
} from "./msGraphTokenProvider.js";

export interface MembershipCheckResult {
  isMember: boolean;
  groupId: string;
  userId: string;
}

export interface GraphServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusText?: string;
}

/**
 * Microsoft Graph Membership Service.
 *
 * Validates if a user is a member of a group using the checkMemberGroups API.
 * Supports both direct and transitive (nested) group membership.
 *
 * Required application permissions: User.ReadBasic.All, GroupMember.Read.All
 *
 * @see https://learn.microsoft.com/en-us/graph/api/directoryobject-checkmembergroups
 */
export class MSGraphMembershipService {
  private static readonly BASE_URL = "https://graph.microsoft.com/v1.0";

  private readonly credentials: Partial<MSGraphCredentials> | undefined;

  constructor(credentials?: Partial<MSGraphCredentials>) {
    this.credentials = credentials;
  }

  private async getToken(): Promise<string> {
    const provider = getMSGraphTokenProvider(this.credentials);
    return provider.token();
  }

  /**
   * Check if a user is a member of a group.
   * Uses transitive membership (includes nested groups).
   *
   * @param userId - User object ID (GUID) or userPrincipalName
   * @param groupId - Group object ID (GUID)
   */
  async isUserMemberOfGroup(
    userId: string,
    groupId: string
  ): Promise<GraphServiceResponse<MembershipCheckResult>> {
    let token: string;
    try {
      token = await this.getToken();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[MSGraphMembershipService] Token error:", message);
      return {
        success: false,
        error: `Token acquisition failed: ${message}`,
      };
    }

    const url = `${MSGraphMembershipService.BASE_URL}/users/${encodeURIComponent(userId)}/checkMemberGroups`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ groupIds: [groupId] }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(
          `[MSGraphMembershipService] API error: ${response.status} – ${body}`
        );
        return {
          success: false,
          error: `Graph API error: ${response.status}`,
          statusText: response.statusText,
        };
      }

      const data = (await response.json()) as { value?: string[] };
      const memberGroupIds = data.value ?? [];
      const isMember = memberGroupIds.includes(groupId);

      return {
        success: true,
        data: {
          isMember,
          groupId,
          userId,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[MSGraphMembershipService] Request failed:", error);
      return {
        success: false,
        error: "Request failed",
        statusText: message,
      };
    }
  }
}

let _instance: MSGraphMembershipService | null = null;

export function getMSGraphMembershipService(
  credentials?: Partial<MSGraphCredentials>
): MSGraphMembershipService {
  if (!_instance || credentials) {
    _instance = new MSGraphMembershipService(credentials);
  }
  return _instance;
}

export function clearMSGraphMembershipService(): void {
  _instance = null;
}
