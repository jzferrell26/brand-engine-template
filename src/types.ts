import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive enumerations
//
// Register and audience are brand vocabulary, not engine facts -- an earlier
// single-client build of this engine hardcoded them as compile-time enums.
// Both are open strings here;
// `register` is validated against the loaded brand-config's declared
// registers at runtime (see getRegister in src/config/brand-config.ts).
// `audience` is free-text prompt context only -- it does not drive platform
// routing (see `platforms` below).
// ---------------------------------------------------------------------------

export const ChannelSchema = z.enum(["email", "social", "both"]);
export type Channel = z.infer<typeof ChannelSchema>;

/**
 * Common GHL-supported platform identifiers. Not an exhaustive enum -- a
 * brand-config's registers may target any platform string; these are the
 * ones the delivery layer (ghl-client.ts, adapter.ts) currently understands.
 */
export const PlatformSchema = z.string().min(1);
export type Platform = z.infer<typeof PlatformSchema>;

/** Platforms routed to video-script output instead of the GHL Social Planner API. */
export const VIDEO_PLATFORMS = new Set(["tiktok", "youtube"]);

// ---------------------------------------------------------------------------
// Campaign Brief (operator input)
// ---------------------------------------------------------------------------

export const BriefSchema = z.object({
  event: z.string().min(1),
  theme: z.string().min(1),
  /** Free-text audience description injected into the prompt (e.g. "leaders", "sales", "new members"). */
  audience: z.string().min(1).default("general"),
  /** Must match a register name declared in this client's brand-config.json. */
  register: z.string().min(1),
  channel: ChannelSchema,
  count: z.number().int().min(1).max(12),
  eventDate: z.string().optional(), // ISO 8601 date string; drives scheduleHint
  /**
   * Social platforms to round-robin across when channel is "social" or
   * "both". Defaults to the two GHL Social Planner supports natively.
   */
  platforms: z.array(PlatformSchema).default(["linkedin", "facebook"]),
});
export type Brief = z.infer<typeof BriefSchema>;

// ---------------------------------------------------------------------------
// Content Piece (one deliverable unit)
// ---------------------------------------------------------------------------

export const ContentPieceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["email", "social-post"]),
  platform: PlatformSchema,
  subject: z.string().optional(),       // email only
  fromName: z.string().optional(),      // email only
  fromAddress: z.string().optional(),   // email only
  replyTo: z.string().optional(),       // email only
  body: z.string().min(1),
  scheduleHint: z.string().optional(),  // ISO 8601 UTC; advisory, operator re-schedules
  imageDirectionHint: z.string().optional(),
  imageUrl: z.string().optional(),      // hosted image attached to the post (social)
});
export type ContentPiece = z.infer<typeof ContentPieceSchema>;

// ---------------------------------------------------------------------------
// Violation + PreflightResult
// ---------------------------------------------------------------------------

export const ViolationSchema = z.object({
  pieceId: z.string().min(1),
  code: z.string().min(1),
  detail: z.string().min(1),
  severity: z.enum(["error", "warning"]).default("error"),
});
export type Violation = z.infer<typeof ViolationSchema>;

export const PreflightResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(ViolationSchema),
});
export type PreflightResult = z.infer<typeof PreflightResultSchema>;

// ---------------------------------------------------------------------------
// ContentPackage (complete output contract)
// ---------------------------------------------------------------------------

export const ContentPackageSchema = z.object({
  briefSummary: z.string().min(1),
  register: z.string().min(1),
  channel: ChannelSchema,
  pieces: z.array(ContentPieceSchema),
  preflightResult: PreflightResultSchema,
});
export type ContentPackage = z.infer<typeof ContentPackageSchema>;

// ---------------------------------------------------------------------------
// EventBrief (extends Brief with event-specific runway fields)
// ---------------------------------------------------------------------------

export const EventBriefSchema = z.object({
  event: z.string().min(1),
  theme: z.string().min(1),
  audience: z.string().min(1).default("general"),
  register: z.string().min(1),

  eventDate: z.string().min(1),        // ISO 8601 date (e.g., "2026-07-08")
  eventTime: z.string().min(1),        // HH:MM in the event's local timezone
  timezone: z.string().min(1),         // IANA timezone (e.g., "America/Denver")
  runwayStartDate: z.string().min(1),  // ISO 8601 date; first content drops on this date

  emailCount: z.number().int().min(6).max(12),
  socialCount: z.number().int().min(6).max(15),

  platforms: z.array(PlatformSchema).default(["linkedin", "facebook"]),

  accountabilityUrl: z.string().optional(),
  followUpUrl: z.string().optional(),
});
export type EventBrief = z.infer<typeof EventBriefSchema>;

export const EVENT_DATE_PAST = "EVENT_DATE_PAST" as const;

// ---------------------------------------------------------------------------
// RunwaySchedule (output of calculateRunway)
// ---------------------------------------------------------------------------

export interface RunwaySlot {
  /** ISO 8601 date string (YYYY-MM-DD) */
  date: string;
  /** Phase label for diagnostics / summary */
  phase: "announcement" | "value" | "urgency" | "day-before" | "day-of";
}

export interface RunwayResult {
  emailSlots: RunwaySlot[];
  socialSlots: RunwaySlot[];
  /** Present only for short-runway (<5 day) briefings */
  warning?: string;
}

// ---------------------------------------------------------------------------
// LaunchKit (full launch package)
// ---------------------------------------------------------------------------

export interface LaunchKit {
  eventBrief: EventBrief;
  emailPackage: ContentPackage;
  socialPackage: ContentPackage;
  overallPreflight: PreflightResult;
}
