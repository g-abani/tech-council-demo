import type { UserRole } from "../../poc/rbacMiddleware.js";
import { getMSGraphMembershipService } from "./msGraphMembershipService.js";
import { getMSGraphUserService } from "./msGraphUserService.js";

/** Client credentials present (user/group API calls). */
export function isGraphApiConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_SECRET?.trim()
  );
}

/**
 * Looks up an Entra user object id by email (mail or UPN) for RBAC resolution.
 */
export async function resolveEntraUserIdByEmail(
  email: string
): Promise<string | undefined> {
  if (!isGraphApiConfigured()) return undefined;
  const svc = getMSGraphUserService();
  const r = await svc.getUserByEmail(email);
  if (!r.success) {
    console.warn("[RBAC] Graph user by email failed:", r.error ?? r.statusText);
    return undefined;
  }
  if (!r.data?.id) {
    return undefined;
  }
  return r.data.id;
}

export function isGraphMembershipConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_SECRET?.trim() &&
      (process.env.MS_GRAPH_GROUP_OBJECT_ID_VIEWER?.trim() ||
        process.env.MS_GRAPH_GROUP_OBJECT_ID_EDITOR?.trim() ||
        process.env.MS_GRAPH_GROUP_OBJECT_ID_ADMIN?.trim())
  );
}

/**
 * Resolves viewer / editor / admin from Entra group membership via
 * `checkMemberGroups` (highest privilege wins: admin → editor → viewer).
 */
export async function resolveUserRoleFromEntraGroups(
  userObjectId: string
): Promise<UserRole | undefined> {
  if (!isGraphMembershipConfigured()) return undefined;

  const adminG = process.env.MS_GRAPH_GROUP_OBJECT_ID_ADMIN?.trim();
  const editorG = process.env.MS_GRAPH_GROUP_OBJECT_ID_EDITOR?.trim();
  const viewerG = process.env.MS_GRAPH_GROUP_OBJECT_ID_VIEWER?.trim();

  const svc = getMSGraphMembershipService();

  if (adminG) {
    const r = await svc.isUserMemberOfGroup(userObjectId, adminG);
    if (r.success && r.data?.isMember) return "admin";
  }
  if (editorG) {
    const r = await svc.isUserMemberOfGroup(userObjectId, editorG);
    if (r.success && r.data?.isMember) return "editor";
  }
  if (viewerG) {
    const r = await svc.isUserMemberOfGroup(userObjectId, viewerG);
    if (r.success && r.data?.isMember) return "viewer";
  }

  return undefined;
}
