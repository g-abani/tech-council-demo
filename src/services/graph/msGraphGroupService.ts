import {
  getMSGraphTokenProvider,
  type MSGraphCredentials,
} from "./msGraphTokenProvider.js";

export interface GraphGroup {
  id: string;
  displayName: string;
  description: string | null;
  mail: string | null;
  mailEnabled: boolean;
  securityEnabled: boolean;
  groupTypes: string[];
  visibility: string | null;
}

export type GroupTypeFilter =
  | "unified"
  | "security"
  | "distribution"
  | "mailSecurity";

export interface GraphGroupSearchOptions {
  displayNamePrefix?: string;
  search?: string;
  groupType?: GroupTypeFilter;
}

export interface GraphServiceResponse<T> {
  success: boolean;
  data?: T;
  totalCount?: number;
  error?: string;
  statusText?: string;
}

const GROUP_TYPE_FILTERS: Record<GroupTypeFilter, string> = {
  unified: "groupTypes/any(c:c eq 'Unified')",
  security:
    "mailEnabled eq false and securityEnabled eq true",
  distribution:
    "NOT groupTypes/any(c:c eq 'Unified') and mailEnabled eq true and securityEnabled eq false",
  mailSecurity:
    "NOT groupTypes/any(c:c eq 'Unified') and mailEnabled eq true and securityEnabled eq true",
};

const DEFAULT_SELECT = [
  "id",
  "displayName",
  "description",
  "mail",
  "mailEnabled",
  "securityEnabled",
  "groupTypes",
  "visibility",
].join(",");

/**
 * Microsoft Graph Group Service.
 *
 * Lists and searches Azure AD / Entra ID groups using the
 * GET /groups endpoint with OData query parameters.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/group-list?view=graph-rest-1.0
 */
export class MSGraphGroupService {
  private static readonly BASE_URL = "https://graph.microsoft.com/v1.0";

  private readonly credentials: Partial<MSGraphCredentials> | undefined;

  constructor(credentials?: Partial<MSGraphCredentials>) {
    this.credentials = credentials;
  }

  private async getToken(): Promise<string> {
    const provider = getMSGraphTokenProvider(this.credentials);
    return provider.token();
  }

  private async fetchPage(url: string): Promise<GraphServiceResponse<unknown>> {
    let token: string;
    try {
      token = await this.getToken();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[MSGraphGroupService] Token error:", msg);
      return {
        success: false,
        error: `Token acquisition failed: ${msg}`,
      };
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ConsistencyLevel: "eventual",
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(
          `[MSGraphGroupService] API error: ${response.status} – ${body}`
        );
        return {
          success: false,
          error: `Graph API error: ${response.status}`,
          statusText: response.statusText,
        };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[MSGraphGroupService] Request failed:", error);
      return {
        success: false,
        error: "Request failed",
        statusText: msg,
      };
    }
  }

  private static toGraphGroup(g: Record<string, unknown>): GraphGroup {
    return {
      id: String(g.id ?? ""),
      displayName: String(g.displayName ?? ""),
      description: (g.description as string | null | undefined) ?? null,
      mail: (g.mail as string | null | undefined) ?? null,
      mailEnabled: Boolean(g.mailEnabled),
      securityEnabled: Boolean(g.securityEnabled),
      groupTypes: Array.isArray(g.groupTypes) ? (g.groupTypes as string[]) : [],
      visibility: (g.visibility as string | null | undefined) ?? null,
    };
  }

  /**
   * Search / list groups.
   *
   * Automatically follows @odata.nextLink to return all results.
   */
  async searchGroups(
    options: GraphGroupSearchOptions = {}
  ): Promise<GraphServiceResponse<GraphGroup[]>> {
    const { displayNamePrefix, search, groupType } = options;

    const qs = new URLSearchParams({
      $select: DEFAULT_SELECT,
      $count: "true",
      $orderby: "displayName",
    });

    const filterParts: string[] = [];

    if (displayNamePrefix) {
      filterParts.push(`startswith(displayName,'${displayNamePrefix}')`);
    }
    if (groupType) {
      filterParts.push(GROUP_TYPE_FILTERS[groupType]);
    }
    if (filterParts.length > 0) {
      qs.set("$filter", filterParts.join(" and "));
    }
    if (search) {
      qs.set("$search", search);
    }

    let url = `${MSGraphGroupService.BASE_URL}/groups?${qs.toString()}`;
    const allGroups: GraphGroup[] = [];
    let totalCount: number | undefined;

    while (url) {
      const response = await this.fetchPage(url);

      if (!response.success) {
        return response as GraphServiceResponse<GraphGroup[]>;
      }

      const data = response.data as Record<string, unknown> | undefined;
      if (totalCount === undefined && data?.["@odata.count"] != null) {
        totalCount = data["@odata.count"] as number;
      }

      const pageGroups: GraphGroup[] =
        (data?.value as Record<string, unknown>[] | undefined)?.map(
          MSGraphGroupService.toGraphGroup
        ) || [];

      allGroups.push(...pageGroups);

      url = (data?.["@odata.nextLink"] as string | undefined) ?? "";
    }

    return {
      success: true,
      data: allGroups,
      ...(totalCount !== undefined && { totalCount }),
    };
  }
}

let _instance: MSGraphGroupService | null = null;

export function getMSGraphGroupService(
  credentials?: Partial<MSGraphCredentials>
): MSGraphGroupService {
  if (!_instance || credentials) {
    _instance = new MSGraphGroupService(credentials);
  }
  return _instance;
}

export function clearMSGraphGroupService(): void {
  _instance = null;
}
