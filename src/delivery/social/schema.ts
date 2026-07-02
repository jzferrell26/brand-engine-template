/**
 * Zod-validated options schema for the social delivery module.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// GHL Social Planner post status values
// The engine ONLY creates "draft". "scheduled" auto-publishes at its
// scheduleDate without human approval, so it is forbidden alongside
// published/active. The operator schedules/publishes each draft themself.
// ---------------------------------------------------------------------------
export const SAFE_STATUSES = ["draft"] as const;
export const FORBIDDEN_STATUSES = ["scheduled", "published", "active"] as const;

// ---------------------------------------------------------------------------
// Options schema
// ---------------------------------------------------------------------------

export const PushSocialOptsSchema = z.object({
  /** GHL Private Integration Token. Pulled from GHL_PIT env if not provided. */
  token: z.string().min(1),

  /** GHL location ID for this client. No default -- every client has its own. */
  locationId: z.string().min(1),

  /**
   * Approver user ID. When set, posts are created with status "scheduled"
   * and the userId field attached, routing to Content > Approval.
   * When absent, posts are created with status "draft" (safe default).
   */
  approver: z.string().min(1).optional(),

  /**
   * Post owner user id (GHL requires `userId` on every post). Resolved by the
   * CLI from the location's users. Required for a live push; the engine throws
   * a clear error if it is missing.
   */
  ownerUserId: z.string().min(1).optional(),

  /**
   * Dry-run mode: print every resolved payload and account IDs,
   * make no API calls. Default false.
   */
  dryRun: z.boolean().default(false),

  /**
   * Filter: push only pieces whose IDs are in this list.
   * Undefined = push all social-post pieces.
   */
  only: z.array(z.string().min(1)).optional(),

  /**
   * Path to a push manifest from a previous partial run.
   * When set, pieces with status "pushed" in the manifest are skipped.
   */
  resumeManifest: z.string().optional(),

  /**
   * Directory for writing manifest + video-script files.
   * Defaults to ./social (relative to cwd).
   */
  outputDir: z.string().default("social"),
});

export type PushSocialOpts = z.infer<typeof PushSocialOptsSchema>;

// ---------------------------------------------------------------------------
// GHL API response shapes (partial - only what we use)
// ---------------------------------------------------------------------------

export const GhlPostResponseSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  postId: z.string().optional(),
}).passthrough();

export type GhlPostResponse = z.infer<typeof GhlPostResponseSchema>;

export const GhlAccountSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  accountId: z.string().optional(),
  oauthId: z.string().optional(),
  platform: z.string().optional(),
  type: z.string().optional(),
  provider: z.string().optional(),
  name: z.string().optional(),
  accountName: z.string().optional(),
}).passthrough();

export type GhlAccount = z.infer<typeof GhlAccountSchema>;

export const GhlAccountsResponseSchema = z.object({
  accounts: z.array(GhlAccountSchema).optional(),
  results: z.union([
    z.array(GhlAccountSchema),
    z.object({ accounts: z.array(GhlAccountSchema).optional() }).passthrough(),
  ]).optional(),
  data: z.array(GhlAccountSchema).optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Push manifest schema
// ---------------------------------------------------------------------------

export const ManifestEntryStatusSchema = z.enum(["pushed", "failed", "skipped"]);

export const ManifestEntrySchema = z.object({
  id: z.string().min(1),
  ghlPostId: z.string().optional(),
  status: ManifestEntryStatusSchema,
  platform: z.string().min(1),
  error: z.string().optional(),
});

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const PushManifestSchema = z.object({
  pushedAt: z.string().min(1),
  campaignId: z.string().optional(),
  posts: z.array(ManifestEntrySchema),
});

export type PushManifest = z.infer<typeof PushManifestSchema>;

// ---------------------------------------------------------------------------
// GHL payload (what we POST to the API)
// ---------------------------------------------------------------------------

export const GhlPostPayloadSchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
  // GHL requires `media` to be present as an array (may be empty). Omitting it
  // yields a 422. Populated from piece.imageUrl when the post has an image.
  media: z.array(z.unknown()),
  type: z.literal("post"),
  scheduleDate: z.string().optional(),
  // Publish gate: only ever "draft" (never "scheduled", which auto-publishes).
  status: z.literal("draft"),
  // Required by GHL: the post owner. Does not affect publishing (status does).
  userId: z.string().min(1),
});

export type GhlPostPayload = z.infer<typeof GhlPostPayloadSchema>;
