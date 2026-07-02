/**
 * GHL Social Planner API client with retry logic.
 *
 * Handles:
 * - Account discovery (GET /social-media-posting/{locationId}/accounts)
 * - Post creation  (POST /social-media-posting/{locationId}/posts)
 * - Exponential backoff on 429 / 5xx
 */

import { GhlAccountsResponseSchema, GhlPostResponseSchema } from "./schema.js";
import type { GhlAccount, GhlPostPayload, GhlPostResponse } from "./schema.js";

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

/** Maximum attempts per API call (initial + 3 retries). */
const MAX_ATTEMPTS = 4;

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Version: VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** Determine if an HTTP status warrants a retry. */
function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Sleep for a given number of milliseconds.
 * Extracted for testability (tests can replace global setTimeout).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sentinel to signal that an error is non-retryable and should break the loop. */
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/**
 * Retry wrapper with exponential backoff: 1s, 2s, 4s.
 * Throws on the final attempt if all retries are exhausted.
 * NonRetryableError breaks the retry loop immediately.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: Error = new Error(`${label}: unknown error`);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NonRetryableError) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        await sleep(backoffMs);
      }
    }
  }
  throw lastError;
}

/**
 * Fetch all connected social accounts for a location.
 * Defensive: handles multiple response shapes GHL has shipped over time.
 */
export async function fetchAccounts(locationId: string, token: string): Promise<GhlAccount[]> {
  const url = `${BASE}/social-media-posting/${locationId}/accounts`;
  const headers = buildHeaders(token);

  return withRetry(`GET accounts`, async () => {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`GET accounts ${res.status}: ${text}`);
      (err as NodeJS.ErrnoException & { status?: number }).status = res.status;
      throw err;
    }
    const raw: unknown = await res.json();
    const parsed = GhlAccountsResponseSchema.parse(raw);

    // GHL has shipped multiple response shapes; handle them all.
    if (Array.isArray(parsed.accounts)) return parsed.accounts;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.results)) return parsed.results;
    if (parsed.results && !Array.isArray(parsed.results) && Array.isArray(parsed.results.accounts)) {
      return parsed.results.accounts;
    }
    return [];
  });
}

/**
 * Extract the canonical ID from a GHL account object.
 * GHL uses id, _id, accountId, or oauthId depending on the endpoint version.
 */
export function extractAccountId(account: GhlAccount): string | undefined {
  return account.id ?? account._id ?? account.accountId ?? account.oauthId;
}

/**
 * Find a connected account matching a platform string.
 * Performs case-insensitive substring matching on the platform/type/provider field.
 */
export function matchAccountForPlatform(accounts: GhlAccount[], platform: string): GhlAccount | undefined {
  return accounts.find((a) => {
    const p = String(a.platform ?? a.type ?? a.provider ?? "").toLowerCase();
    return p.includes(platform.toLowerCase());
  });
}

/**
 * Create a single post in the GHL Social Planner.
 * Retries on 429 and 5xx. Throws after all retries exhausted.
 *
 * IMPORTANT: caller is responsible for ensuring the payload status is
 * never "published" or "active". The adapter layer enforces this invariant.
 */
export async function createPost(
  locationId: string,
  token: string,
  payload: GhlPostPayload,
): Promise<GhlPostResponse> {
  const url = `${BASE}/social-media-posting/${locationId}/posts`;
  const headers = buildHeaders(token);
  const body = JSON.stringify(payload);

  return withRetry(`POST post`, async () => {
    const res = await fetch(url, { method: "POST", headers, body });
    const text = await res.text();
    if (!res.ok) {
      if (isRetryable(res.status)) {
        throw new Error(`POST post ${res.status}: ${text}`);
      }
      throw new NonRetryableError(`POST post ${res.status}: ${text}`);
    }
    const raw: unknown = JSON.parse(text);
    return GhlPostResponseSchema.parse(raw);
  });
}

/**
 * Extract the GHL post ID from a create-post response.
 * GHL nests the created post at results.post._id; older/other shapes use
 * top-level id/_id/postId or a top-level post object.
 */
export function extractPostId(response: GhlPostResponse): string | undefined {
  const r = response as Record<string, unknown>;
  const results = r["results"] as Record<string, unknown> | undefined;
  const nestedPost = (results?.["post"] ?? r["post"]) as Record<string, unknown> | undefined;
  return (
    (r["id"] as string | undefined) ??
    (r["_id"] as string | undefined) ??
    (r["postId"] as string | undefined) ??
    (nestedPost?.["_id"] as string | undefined) ??
    (nestedPost?.["id"] as string | undefined)
  );
}
