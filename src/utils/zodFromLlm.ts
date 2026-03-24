import { z } from "zod";

/**
 * Optional string fields: models often send JSON `null` instead of omitting the key.
 * Zod's `.optional()` allows `undefined` but rejects `null`.
 */
export const zOptionalString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v == null ? undefined : v));

/**
 * Optional boolean with default when null/undefined (same null issue as above).
 */
export function zOptionalBooleanDefault(defaultValue: boolean) {
  return z
    .union([z.boolean(), z.null()])
    .optional()
    .transform((v) => (v == null || v === undefined ? defaultValue : v));
}
