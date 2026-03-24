import {
  getMSGraphTokenProvider,
  type MSGraphCredentials,
} from "./msGraphTokenProvider.js";

export interface GraphUser {
  displayName: string;
  mail: string | null;
}

export interface GraphUserSearchOptions {
  namePrefix: string;
}

export interface GraphServiceResponse<T> {
  success: boolean;
  data?: T;
  totalCount?: number;
  error?: string;
  statusText?: string;
}

/**
 * Microsoft Graph User Search Service.
 *
 * Searches Azure AD / Entra ID users whose givenName starts with a prefix,
 * filtering to users that have a mail address, ordered by userPrincipalName.
 */
export class MSGraphUserService {
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
      console.error("[MSGraphUserService] Token error:", msg);
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
          `[MSGraphUserService] API error: ${response.status} – ${body}`
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
      console.error("[MSGraphUserService] Request failed:", error);
      return {
        success: false,
        error: "Request failed",
        statusText: msg,
      };
    }
  }

  private static escapeODataValue(value: string): string {
    return value.replace(/'/g, "''");
  }

  private static buildUserFilter(rawQuery: string): string {
    const query = MSGraphUserService.escapeODataValue(rawQuery.trim());
    const parts = query.split(/\s+/).filter(Boolean);
    const first = parts[0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1] : "";

    const clauses: string[] = [
      `startswith(givenName,'${query}')`,
      `startswith(surname,'${query}')`,
      `startswith(displayName,'${query}')`,
      `startswith(mail,'${query}')`,
      `startswith(userPrincipalName,'${query}')`,
      `startswith(mailNickname,'${query}')`,
    ];

    if (first && last) {
      clauses.push(
        `(startswith(givenName,'${first}') and startswith(surname,'${last}'))`
      );
    }

    return `(${clauses.join(" or ")}) and mail ne null`;
  }

  /**
   * Search users by first name, last name, full name, LDAP/mail prefix.
   * Only users with a non-null mail are returned.
   */
  async searchUsers(
    options: GraphUserSearchOptions
  ): Promise<GraphServiceResponse<GraphUser[]>> {
    const { namePrefix } = options;
    const normalizedQuery = namePrefix?.trim();

    if (!normalizedQuery) {
      return { success: true, data: [], totalCount: 0 };
    }

    const filter = MSGraphUserService.buildUserFilter(normalizedQuery);
    const select = "displayName,mail";
    const orderby = "userPrincipalName";

    const qs = new URLSearchParams({
      $filter: filter,
      $select: select,
      $orderby: orderby,
      $count: "true",
    });

    let url = `${MSGraphUserService.BASE_URL}/users?${qs.toString()}`;
    const allUsers: GraphUser[] = [];
    let totalCount: number | undefined;

    while (url) {
      const response = await this.fetchPage(url);

      if (!response.success) {
        return response as GraphServiceResponse<GraphUser[]>;
      }

      const data = response.data as Record<string, unknown> | undefined;
      if (totalCount === undefined && data?.["@odata.count"] != null) {
        totalCount = data["@odata.count"] as number;
      }

      const pageUsers: GraphUser[] =
        (data?.value as Record<string, unknown>[] | undefined)?.map((u) => ({
          displayName: String(u.displayName ?? ""),
          mail: (u.mail as string | null | undefined) ?? null,
        })) || [];

      allUsers.push(...pageUsers);

      url = (data?.["@odata.nextLink"] as string | undefined) ?? "";
    }

    return {
      success: true,
      data: allUsers,
      ...(totalCount !== undefined && { totalCount }),
    };
  }

  /**
   * Resolve a single directory user by work email or UPN (exact match).
   * Tries `mail` first, then `userPrincipalName`.
   */
  async getUserByEmail(
    email: string
  ): Promise<
    GraphServiceResponse<{
      id: string;
      displayName: string;
      mail: string | null;
      userPrincipalName?: string;
    } | null>
  > {
    const raw = email.trim();
    if (!raw) {
      return { success: true, data: null };
    }
    const escaped = MSGraphUserService.escapeODataValue(raw);
    const filters = [
      `mail eq '${escaped}'`,
      `userPrincipalName eq '${escaped}'`,
    ];

    for (const filter of filters) {
      const qs = new URLSearchParams({
        $filter: filter,
        $select: "id,displayName,mail,userPrincipalName",
        $top: "5",
      });
      const url = `${MSGraphUserService.BASE_URL}/users?${qs.toString()}`;
      const response = await this.fetchPage(url);
      if (!response.success) {
        return {
          success: false,
          error: response.error,
          statusText: response.statusText,
        };
      }
      const data = response.data as Record<string, unknown> | undefined;
      const arr = data?.value as Record<string, unknown>[] | undefined;
      if (arr && arr.length > 0) {
        const u = arr[0];
        return {
          success: true,
          data: {
            id: String(u.id ?? ""),
            displayName: String(u.displayName ?? ""),
            mail: (u.mail as string | null | undefined) ?? null,
            userPrincipalName: u.userPrincipalName as string | undefined,
          },
        };
      }
    }

    return { success: true, data: null };
  }
}

let _instance: MSGraphUserService | null = null;

export function getMSGraphUserService(
  credentials?: Partial<MSGraphCredentials>
): MSGraphUserService {
  if (!_instance || credentials) {
    _instance = new MSGraphUserService(credentials);
  }
  return _instance;
}

export function clearMSGraphUserService(): void {
  _instance = null;
}
