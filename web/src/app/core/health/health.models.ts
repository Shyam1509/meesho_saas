/** Body of `GET /api/v1/health` (HTTP 200 when healthy, HTTP 503 when the database is down). */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  uptimeSeconds: number;
  timestamp: string;
}

/** Outcome of a health check, as the UI needs it. A check never fails: problems become `unreachable`. */
export type HealthCheckResult =
  /** API up, database up. */
  | { kind: 'ok'; health: HealthResponse }
  /** API up, database down (or the API reports itself degraded). */
  | { kind: 'degraded'; health: HealthResponse }
  /** No usable answer: network error, timeout or a body that is not a health response. */
  | { kind: 'unreachable'; reason: string };

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    (body['status'] === 'ok' || body['status'] === 'degraded') &&
    (body['db'] === 'up' || body['db'] === 'down') &&
    typeof body['uptimeSeconds'] === 'number' &&
    typeof body['timestamp'] === 'string'
  );
}
