/**
 * LIKE patterns built from user text. The text is always passed as a bound replacement (never spliced into
 * SQL); these helpers only neutralise LIKE's own wildcards so `%` and `_` match themselves. The escape
 * character is `!` (not backslash), so the meaning does not depend on the server's NO_BACKSLASH_ESCAPES
 * mode: every query using these patterns must say `LIKE :param ESCAPE '!'` (see LIKE_ESCAPE).
 */
export const LIKE_ESCAPE = `ESCAPE '!'`;

/** `%`, `_` and the escape character itself, each prefixed with `!`. */
export function escapeLike(text: string): string {
  return text.replace(/[!%_]/g, (c) => `!${c}`);
}

/** "starts with" (index friendly on a prefix of an indexed column). */
export function likePrefix(text: string): string {
  return `${escapeLike(text)}%`;
}

/** "contains" (cannot use an index; only for short free-text columns). */
export function likeContains(text: string): string {
  return `%${escapeLike(text)}%`;
}
