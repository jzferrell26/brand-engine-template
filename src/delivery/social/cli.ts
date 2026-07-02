/**
 * CLI entry point for the social delivery module.
 *
 * Usage (via tsx or after tsc build):
 *   GHL_PIT=pit-xxx GHL_LOCATION_ID=xxx tsx src/delivery/social/cli.ts [options]
 *
 * Options:
 *   --dry-run              Print payloads + account IDs; no API calls (default).
 *   --push                 Actually push to GHL. Without this flag, dry-run is forced.
 *   --approver=<userId>    Route posts to Content > Approval queue.
 *   --only=W1,W3           Push only matching piece IDs.
 *   --resume=<path>        Skip pieces already pushed in a previous manifest.
 *   --location=<id>        Override the GHL location ID (else GHL_LOCATION_ID env).
 *   --list-users           List users in the location (find approver ID) and exit.
 *   --output-dir=<path>    Directory for manifests + video scripts (default: ./social).
 *
 * The PIT is read from the GHL_PIT env var only; never passed on the command
 * line to avoid shell-history exposure.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ContentPackageSchema } from "../../types.js";
import { pushSocial, resolveToken } from "./index.js";

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

// Public base URL where post images are hosted. Override with IMAGE_BASE_URL
// to point at this client's actual image host (e.g. GitHub Pages for this repo).
const IMAGE_BASE = process.env["IMAGE_BASE_URL"] ?? "";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(name);
}

function argValue(prefix: string): string | undefined {
  const found = args.find((a) => a.startsWith(prefix + "="));
  return found ? found.slice(prefix.length + 1).trim() : undefined;
}

const PUSH = flag("--push");
const DRY_RUN = !PUSH; // default is dry-run
const LIST_USERS = flag("--list-users");
const APPROVER = argValue("--approver");
const ONLY_RAW = argValue("--only");
const RESUME = argValue("--resume");
const LOCATION_ID = argValue("--location") ?? process.env["GHL_LOCATION_ID"];
const OUTPUT_DIR = argValue("--output-dir") ?? "social";

function requireLocationId(): string {
  if (!LOCATION_ID) {
    console.error(
      "ERROR: no GHL location ID. Pass --location=<id> or set GHL_LOCATION_ID."
    );
    process.exit(1);
  }
  return LOCATION_ID;
}

// ---------------------------------------------------------------------------
// --list-users helper
// ---------------------------------------------------------------------------

async function listUsers(token: string): Promise<void> {
  const locationId = requireLocationId();
  const url = `${BASE}/users/?locationId=${locationId}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: VERSION,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`GET users ${res.status}: ${await res.text()}`);
  }
  const body = await res.json() as Record<string, unknown>;
  const users = (body["users"] ?? body["results"] ?? body["data"] ?? []) as Array<Record<string, unknown>>;
  console.log(`Users in location ${locationId} (${users.length}):`);
  for (const u of users) {
    const name = u["name"] ?? [u["firstName"], u["lastName"]].filter(Boolean).join(" ");
    console.log(`  - id=${u["id"] ?? u["_id"]}  ${String(name)}  ${String(u["email"] ?? "")}`);
  }
}

/**
 * Resolve the post-owner userId (GHL requires it on every post). Uses the
 * --user-id override if given, otherwise the first user in the location.
 * Returns undefined if it can't be resolved (live push then fails loudly).
 */
async function resolveOwnerUserId(token: string): Promise<string | undefined> {
  const override = argValue("--user-id");
  if (override) return override;
  try {
    const locationId = requireLocationId();
    const url = `${BASE}/users/?locationId=${locationId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json" },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    const users = (body["users"] ?? body["results"] ?? body["data"] ?? []) as Array<Record<string, unknown>>;
    const first = users[0];
    return first ? String(first["id"] ?? first["_id"] ?? "") || undefined : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Load posts.json as a ContentPackage (backwards-compatibility shim)
// ---------------------------------------------------------------------------

function loadPostsAsPackage(): typeof ContentPackageSchema._type {
  const here = dirname(fileURLToPath(import.meta.url));
  // Resolve from the project root (3 levels up from src/delivery/social/).
  const postsPath = join(here, "../../../social/posts.json");
  let raw: string;
  try {
    raw = readFileSync(postsPath, "utf8");
  } catch {
    throw new Error(`Cannot find social/posts.json at ${postsPath}. Run from the project root.`);
  }

  const data = JSON.parse(raw) as {
    campaign?: string;
    register?: string;
    posts: Array<{
      id: string;
      platform: string;
      summary?: string;
      scheduleUtc?: string;
      image?: string;
    }>;
  };

  const pieces = data.posts.map((p) => ({
    id: p.id,
    type: "social-post" as const,
    platform: p.platform,
    body: p.summary ?? "",
    scheduleHint: p.scheduleUtc,
    imageUrl: p.image ? `${IMAGE_BASE}/${p.image}` : undefined,
  }));

  if (!data.register) {
    throw new Error(`social/posts.json must include a "register" field matching a register declared in brand-config.json`);
  }

  return ContentPackageSchema.parse({
    briefSummary: data.campaign ?? "social campaign",
    register: data.register,
    channel: "social",
    pieces,
    preflightResult: { passed: true, violations: [] },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const token = resolveToken();

  if (LIST_USERS) {
    await listUsers(token);
    process.exit(0);
  }

  const pkg = loadPostsAsPackage();
  const locationId = requireLocationId();

  // GHL requires a post owner userId. Resolve it (override or first location user).
  const ownerUserId = await resolveOwnerUserId(token);

  const result = await pushSocial(pkg, {
    token,
    locationId,
    approver: APPROVER,
    ownerUserId,
    dryRun: DRY_RUN,
    only: ONLY_RAW ? ONLY_RAW.split(",").map((s) => s.trim()) : undefined,
    resumeManifest: RESUME,
    outputDir: OUTPUT_DIR,
  });

  console.log(`Done. ${result.pushed} pushed, ${result.skipped} skipped (already pushed), ${result.failed} failed.`);

  if (DRY_RUN) {
    console.log("This was a DRY RUN. Re-run with --push (and ideally --only=W1 first) to create drafts.");
  } else {
    console.log("Drafts created. The operator approves and schedules each one in the GHL Social Planner.");
  }

  if (result.failed > 0) process.exit(1);
})().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Fatal error: ${msg}`);
  process.exit(1);
});
