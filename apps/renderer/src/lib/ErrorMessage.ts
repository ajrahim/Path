/** User-facing text for a caught value; non-Error values and empty messages use the fallback. */
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
