import { type MSGraphCredentials } from "./msGraphTokenProvider.js";
import {
  MSGraphUserService,
  type GraphUser,
  type GraphServiceResponse,
} from "./msGraphUserService.js";
import {
  MSGraphGroupService,
  type GraphGroup,
  type GroupTypeFilter,
} from "./msGraphGroupService.js";

export interface GraphSearchOptions {
  query: string;
  groupType?: GroupTypeFilter;
}

export interface GraphSearchResultItem {
  type: "user" | "group";
  id: string;
  displayName: string;
  mail: string | null;
}

export interface GraphSearchResult {
  result: GraphSearchResultItem[];
}

/**
 * When set (e.g. `contoso.com`), only groups whose mail ends with `@contoso.com` are included.
 * When unset, all groups from the group search are included.
 */
function groupMailMatchesDomain(
  mail: string | null,
  domain: string | undefined
): boolean {
  const d = domain?.trim();
  if (!d) return true;
  if (!mail) return false;
  const suffix = `@${d.toLowerCase()}`;
  return mail.toLowerCase().endsWith(suffix);
}

/**
 * Unified Microsoft Graph search service.
 * Searches both users and groups in parallel based on a single query string.
 */
export class MSGraphSearchService {
  private readonly userService: MSGraphUserService;
  private readonly groupService: MSGraphGroupService;

  constructor(credentials?: Partial<MSGraphCredentials>) {
    this.userService = new MSGraphUserService(credentials);
    this.groupService = new MSGraphGroupService(credentials);
  }

  async search(
    options: GraphSearchOptions
  ): Promise<GraphServiceResponse<GraphSearchResult>> {
    const { query, groupType } = options;
    const mailDomain = process.env.MS_GRAPH_GROUP_MAIL_DOMAIN;

    const [userResult, groupResult] = await Promise.all([
      this.userService.searchUsers({ namePrefix: query }),
      this.groupService.searchGroups({
        displayNamePrefix: query,
        ...(groupType && { groupType }),
      }),
    ]);

    if (!userResult.success && !groupResult.success) {
      return {
        success: false,
        error: `Users: ${userResult.error} | Groups: ${groupResult.error}`,
      };
    }

    const users: GraphSearchResultItem[] = (userResult.data ?? []).map(
      (u: GraphUser) => ({
        type: "user" as const,
        id: u.mail?.split("@")[0] ?? "",
        displayName: u.displayName,
        mail: u.mail,
      })
    );

    const groups: GraphSearchResultItem[] = (groupResult.data ?? [])
      .filter((g: GraphGroup) => groupMailMatchesDomain(g.mail, mailDomain))
      .map((g: GraphGroup) => ({
        type: "group" as const,
        id: g.id,
        displayName: g.displayName,
        mail: g.mail,
      }));

    return {
      success: true,
      data: { result: [...users, ...groups] },
    };
  }
}

let _instance: MSGraphSearchService | null = null;

export function getMSGraphSearchService(
  credentials?: Partial<MSGraphCredentials>
): MSGraphSearchService {
  if (!_instance || credentials) {
    _instance = new MSGraphSearchService(credentials);
  }
  return _instance;
}

export function clearMSGraphSearchService(): void {
  _instance = null;
}
