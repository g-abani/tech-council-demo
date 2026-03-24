import { parseUserRole, type UserRole } from "./rbacMiddleware.js";
import {
  resolveEntraUserIdByEmail,
  resolveUserRoleFromEntraGroups,
} from "../services/graph/resolveUserRoleFromGraph.js";

export type RbacSource = "header" | "graph" | "auto";

/**
 * - `graph` | `auto` — from env
 * - `header` — legacy: body `userRole` only (set `SECURE_AGENT_RBAC_SOURCE=header`)
 * - **Unset:** defaults to **`auto`** so the UI member picker + Entra Graph work without extra config.
 *   (The UI does not send `userRole`; under `header` everyone would stay viewer.)
 */
export function getRbacSource(): RbacSource {
  const raw = process.env.SECURE_AGENT_RBAC_SOURCE?.trim();
  if (!raw) return "auto";
  const v = raw.toLowerCase();
  if (v === "graph" || v === "auto" || v === "header") return v;
  return "auto";
}

export function pickAadObjectId(
  body: Record<string, unknown>
): string | undefined {
  for (const key of ["aadObjectId", "aadUserId", "userObjectId"]) {
    const v = body[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Demo member picker — DB `members.email`, resolved to Entra id via Graph. */
export function pickMemberEmail(
  body: Record<string, unknown>
): string | undefined {
  const v = body.memberEmail;
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

export function pickMemberId(
  body: Record<string, unknown>
): string | undefined {
  const v = body.memberId;
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

/** Comma-separated `members.id` or email local-part (before @), case-insensitive. */
function getUniversalAdminKeys(): Set<string> {
  const raw =
    process.env.SECURE_AGENT_UNIVERSAL_ADMIN_MEMBER_IDS?.trim() ||
    "abani,sandeep,behera,sann";
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const k = part.trim().toLowerCase();
    if (k) set.add(k);
  }
  return set;
}

export function isUniversalAdmin(
  memberId?: string | null,
  memberEmail?: string | null
): boolean {
  const keys = getUniversalAdminKeys();
  const id = typeof memberId === "string" ? memberId.trim().toLowerCase() : "";
  if (id && keys.has(id)) return true;
  const em = typeof memberEmail === "string" ? memberEmail.trim() : "";
  if (em) {
    const local = em.split("@")[0]?.trim().toLowerCase() ?? "";
    if (local && keys.has(local)) return true;
  }
  return false;
}

function noMatchFallback(): UserRole {
  const v = process.env.MS_GRAPH_RBAC_NO_MATCH_ROLE;
  if (v === "viewer" || v === "editor" || v === "admin") return v;
  return "viewer";
}

/**
 * Server-side effective role: universal admins (allowlist) → Graph group membership → optional header `userRole`.
 * `aadObjectId` wins over `memberEmail`; `memberEmail` triggers Graph user lookup by mail/UPN.
 */
export async function resolveEffectiveUserRole(options: {
  userRoleRaw?: unknown;
  aadObjectId?: string | null;
  memberEmail?: string | null;
  memberId?: string | null;
}): Promise<UserRole> {
  const { userRoleRaw, aadObjectId, memberEmail, memberId } = options;

  if (isUniversalAdmin(memberId, memberEmail)) {
    console.log("[RBAC] Universal admin (allowlist) → admin");
    return "admin";
  }

  const source = getRbacSource();
  const headerRole =
    userRoleRaw === undefined || userRoleRaw === null || userRoleRaw === ""
      ? "viewer"
      : parseUserRole(userRoleRaw);

  if (source === "header") {
    return headerRole;
  }

  let oid = typeof aadObjectId === "string" ? aadObjectId.trim() : "";
  if (!oid && memberEmail) {
    const resolved = await resolveEntraUserIdByEmail(memberEmail.trim());
    if (resolved) {
      oid = resolved;
      console.log(
        `[RBAC] Resolved Entra user from memberEmail → id prefix ${resolved.slice(0, 8)}…`
      );
    }
  }

  if (oid) {
    const fromGraph = await resolveUserRoleFromEntraGroups(oid);
    if (fromGraph !== undefined) {
      return fromGraph;
    }
    if (source === "graph") {
      return noMatchFallback();
    }
  }

  if (source === "auto") {
    return headerRole;
  }

  return noMatchFallback();
}
