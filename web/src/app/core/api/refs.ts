/** The import job a record came from, as the order and settlement endpoints embed it. */
export interface ImportRef {
  id: string;
  originalFilename: string;
  /** ISO-8601 UTC. */
  createdAt: string;
}

/** A user as the API embeds one (who matched an entry, who started a run). */
export interface UserRef {
  id: string;
  displayName: string | null;
  email: string;
}

/** Display name, else email. */
export function userName(user: UserRef): string {
  return user.displayName ?? user.email;
}
