/** GoTrue uses different duplicate codes for public signup and admin.createUser. */
export function isExistingAccountError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  // Older GoTrue versions did not return a structured code.
  return /already\s*(?:been\s*)?(?:registered|exists)|email(?:\s+address)?\s+already\s+in\s+use/i.test(error.message ?? "");
}
