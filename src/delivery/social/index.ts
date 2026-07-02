/**
 * GHL Social Planner delivery module.
 *
 * INVARIANT: no post is ever created with status "published" or "active".
 * Every piece is created as "draft" (no approver) or "scheduled" (with
 * approver attached for Content > Approval routing). The engine never
 * publishes.
 */

import type { ContentPackage } from "../../types.js";
import { PushSocialOptsSchema } from "./schema.js";
import type { ManifestEntry, PushManifest, PushSocialOpts } from "./schema.js";
import { VIDEO_PLATFORMS, buildGhlPayload } from "./adapter.js";
import {
  createPost,
  extractAccountId,
  extractPostId,
  fetchAccounts,
  matchAccountForPlatform,
} from "./ghl-client.js";
import { buildSkipSet, buildTimestamp, readManifest, writeManifest, writeVideoScripts } from "./manifest.js";

export { PushSocialOptsSchema } from "./schema.js";
export type { PushSocialOpts } from "./schema.js";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type PushSocialResult = {
  pushed: number;
  skipped: number;
  failed: number;
  manifestPath: string | null;
  videoScriptsPath: string | null;
  entries: ManifestEntry[];
};

// ---------------------------------------------------------------------------
// Token resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolve the GHL PIT from opts or the GHL_PIT environment variable.
 * Exits with code 1 and a clear message if missing.
 */
export function resolveToken(envToken?: string): string {
  const token = envToken ?? process.env["GHL_PIT"];
  if (!token || token.trim() === "") {
    console.error(
      "ERROR: GHL_PIT is not set. Export this client's Private Integration Token before running:\n" +
      "  export GHL_PIT=pit-...\n" +
      "The token must have socialplanner/account.readonly + socialplanner/post.write scopes.",
    );
    process.exit(1);
  }
  return token;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Push all social-post pieces from a ContentPackage to the GHL Social Planner.
 *
 * @param pkg  - A ContentPackage whose preflight has already passed.
 * @param opts - Zod-validated PushSocialOpts (or a raw object that will be
 *               validated and coerced by the schema).
 */
export async function pushSocial(
  pkg: ContentPackage,
  opts: PushSocialOpts | Record<string, unknown>,
): Promise<PushSocialResult> {
  const options = PushSocialOptsSchema.parse(opts);

  const token = resolveToken(options.token);

  const socialPieces = pkg.pieces.filter(
    (p) => p.type === "social-post" && !VIDEO_PLATFORMS.has(p.platform),
  );
  const videoPieces = pkg.pieces.filter(
    (p) => p.type === "social-post" && VIDEO_PLATFORMS.has(p.platform),
  );

  const filteredPieces = options.only
    ? socialPieces.filter((p) => options.only!.includes(p.id))
    : socialPieces;

  let skipSet = new Set<string>();
  let resumedManifest: PushManifest | null = null;
  if (options.resumeManifest) {
    resumedManifest = readManifest(options.resumeManifest);
    skipSet = buildSkipSet(resumedManifest);
  }

  const timestamp = buildTimestamp();
  const entries: ManifestEntry[] = [];

  let videoScriptsPath: string | null = null;
  if (videoPieces.length > 0) {
    videoScriptsPath = writeVideoScripts(
      options.outputDir,
      videoPieces.map((p) => ({
        id: p.id,
        platform: p.platform,
        body: p.body,
        scheduleHint: p.scheduleHint,
      })),
      timestamp,
    );
    console.log(`Video scripts written to: ${videoScriptsPath}`);
  }

  if (options.dryRun) {
    console.log(`[DRY RUN] locationId=${options.locationId}`);
    console.log(`[DRY RUN] mode=draft (held in the planner; the operator schedules/publishes each, nothing auto-publishes)`);
    console.log(`[DRY RUN] ${filteredPieces.length} social-post piece(s) to push:`);

    let accountMap: Record<string, string> = {};
    try {
      const accounts = await fetchAccounts(options.locationId, token);
      for (const acct of accounts) {
        const id = extractAccountId(acct);
        const platform = String(acct.platform ?? acct.type ?? acct.provider ?? "").toLowerCase();
        if (id && platform) accountMap[platform] = id;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[DRY RUN] Could not fetch accounts: ${msg}`);
    }

    const dualAccountIds = ["facebook", "linkedin"]
      .map((p) => accountMap[p])
      .filter((id): id is string => Boolean(id));
    for (const piece of filteredPieces) {
      const ids = dualAccountIds.length ? dualAccountIds : ["(no-fb/li-account)"];
      const payload = buildGhlPayload(piece, ids, options.ownerUserId ?? "(owner-user-id)");
      console.log(`\n[DRY RUN] ${piece.id} -> accounts: ${ids.join(", ")}`);
      console.log(JSON.stringify(payload, null, 2));
    }

    console.log(`\n[DRY RUN] No API calls made. Re-run without --dry-run to push.`);
    return {
      pushed: 0,
      skipped: filteredPieces.length,
      failed: 0,
      manifestPath: null,
      videoScriptsPath,
      entries: [],
    };
  }

  const accounts = await fetchAccounts(options.locationId, token);
  const accountMap: Record<string, string> = {};
  for (const acct of accounts) {
    const id = extractAccountId(acct);
    const platform = String(acct.platform ?? acct.type ?? acct.provider ?? "").toLowerCase();
    if (id && platform) accountMap[platform] = id;
  }

  // Every post publishes to BOTH Facebook and LinkedIn (one post, both
  // accounts, one approval). Video platforms are handled separately above.
  const dualAccountIds = ["facebook", "linkedin"]
    .map((p) => accountMap[p])
    .filter((id): id is string => Boolean(id));

  console.log(`Connected accounts (${accounts.length}):`);
  for (const acct of accounts) {
    matchAccountForPlatform([acct], acct.platform ?? "");
    const id = extractAccountId(acct);
    console.log(`  - ${acct.platform ?? acct.type ?? acct.provider}  id=${id ?? "(unknown)"}  name=${acct.name ?? acct.accountName ?? ""}`);
  }

  // GHL requires a post owner (userId) on every post. The CLI resolves it from
  // the location's users; fail loudly rather than 422 on every post.
  const ownerUserId = options.ownerUserId;
  if (!ownerUserId) {
    throw new Error(
      "ownerUserId is required for a live push (GHL requires a post owner userId). " +
      "Resolve it from the location's users (e.g. --list-users) and pass it through.",
    );
  }

  let pushed = 0;
  let skipped = 0;
  let failed = 0;

  for (const piece of filteredPieces) {
    if (skipSet.has(piece.id)) {
      console.log(`SKIP ${piece.id} (already pushed in previous run)`);
      entries.push({ id: piece.id, status: "skipped", platform: piece.platform });
      skipped++;
      continue;
    }

    if (dualAccountIds.length === 0) {
      console.warn(`SKIP ${piece.id}: no connected Facebook or LinkedIn account found`);
      entries.push({ id: piece.id, status: "skipped", platform: piece.platform });
      skipped++;
      continue;
    }

    const payload = buildGhlPayload(piece, dualAccountIds, ownerUserId);

    try {
      const response = await createPost(options.locationId, token, payload);
      const ghlPostId = extractPostId(response);
      console.log(`OK ${piece.id} created as draft -> facebook + linkedin (${dualAccountIds.length} accounts) ghlPostId=${ghlPostId ?? "(unknown)"}`);
      entries.push({
        id: piece.id,
        ghlPostId: ghlPostId,
        status: "pushed",
        platform: piece.platform,
      });
      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`FAIL ${piece.id}: ${msg}`);
      entries.push({
        id: piece.id,
        status: "failed",
        platform: piece.platform,
        error: msg,
      });
      failed++;
    }
  }

  const manifestPath = writeManifest(options.outputDir, pkg.briefSummary, entries, timestamp);

  console.log(`\nDone. ${pushed} pushed as drafts, ${skipped} skipped, ${failed} failed.`);
  console.log(`Manifest: ${manifestPath}`);

  return { pushed, skipped, failed, manifestPath, videoScriptsPath, entries };
}
