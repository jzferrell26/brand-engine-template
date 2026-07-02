/**
 * Launch Kit generation and delivery.
 *
 * GOLDEN INVARIANT: the engine never publishes.
 * deliverLaunchKit only uses the approval-gated pushSocial (draft/scheduled)
 * and pushEmail (draft templates). No publish/send path exists here.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  EventBrief,
  LaunchKit,
  ContentPackage,
  PreflightResult,
  Brief,
} from "../types.js";
import { preflight } from "../preflight/index.js";
import { generate } from "../agent/index.js";
import type { LlmClient, GenerateOptions } from "../agent/index.js";
import { pushSocial } from "../delivery/social/index.js";
import type { PushSocialOpts } from "../delivery/social/index.js";
import { pushEmail } from "../email/push.js";
import { renderEmail } from "../email/render.js";
import { loadBrandConfig } from "../config/brand-config.js";
import { calculateRunway, validateEventBrief } from "./runway.js";
import type { RunwaySlot } from "../types.js";

export { calculateRunway, validateEventBrief } from "./runway.js";
export { EventBriefSchema, EVENT_DATE_PAST } from "../types.js";
export type { EventBrief, LaunchKit, RunwayResult, RunwaySlot } from "../types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert a YYYY-MM-DD string to an ISO 8601 UTC timestamp at 09:00 UTC. */
function slotToScheduleHint(slot: RunwaySlot, offsetHours = 9): string {
  return `${slot.date}T${String(offsetHours).padStart(2, "0")}:00:00.000Z`;
}

/**
 * Build a Brief from an EventBrief for a specific channel + count.
 * The eventDate and platforms are passed through so the agent can embed
 * them in prompts / round-robin social platforms.
 */
function buildBrief(eb: EventBrief, channel: "email" | "social", count: number): Brief {
  return {
    event: eb.event,
    theme: eb.theme,
    audience: eb.audience,
    register: eb.register,
    channel,
    count,
    eventDate: eb.eventDate,
    platforms: eb.platforms,
  };
}

/**
 * Apply runway schedule hints to a ContentPackage's pieces (mutates a copy).
 * Email slots map to email pieces; social slots map to social-post pieces.
 */
function applyScheduleHints(pkg: ContentPackage, slots: RunwaySlot[]): ContentPackage {
  const piecesWithHints = pkg.pieces.map((piece, i) => {
    const slot = slots[i];
    if (!slot) return piece;
    const slotIsSecondDayOf =
      slot.phase === "day-of" && i > 0 && slots[i - 1]?.phase === "day-of";
    const slotIsSecondDayBefore =
      slot.phase === "day-before" && i > 0 && slots[i - 1]?.phase === "day-before";

    let offsetHours: number;
    if (slot.phase === "day-of") {
      offsetHours = slotIsSecondDayOf ? 18 : 7;
    } else if (slot.phase === "day-before") {
      offsetHours = slotIsSecondDayBefore ? 17 : 9;
    } else {
      offsetHours = 9;
    }

    return { ...piece, scheduleHint: slotToScheduleHint(slot, offsetHours) };
  });
  return { ...pkg, pieces: piecesWithHints };
}

/**
 * Combine two PreflightResults into one.
 * passed=false if either fails; violations from both are merged with pieceId
 * prefix disambiguation (e.g. "email:" and "social:").
 */
function combinePreflights(emailPf: PreflightResult, socialPf: PreflightResult): PreflightResult {
  const emailViolations = emailPf.violations.map((v) => ({ ...v, pieceId: `email:${v.pieceId}` }));
  const socialViolations = socialPf.violations.map((v) => ({ ...v, pieceId: `social:${v.pieceId}` }));

  const violations = [...emailViolations, ...socialViolations];
  const passed = !violations.some((v) => v.severity === "error");

  return { passed, violations };
}

// ---------------------------------------------------------------------------
// Campaign summary writer
// ---------------------------------------------------------------------------

/** Slugify an event name for use in a folder name. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Write a human-readable campaign-summary.md to
 * campaigns/<event-slug>-<date>/campaign-summary.md.
 *
 * Returns the absolute path written.
 */
export async function writeCampaignSummary(kit: LaunchKit, outputDir?: string): Promise<string> {
  const slug = slugify(kit.eventBrief.event);
  const datePart = kit.eventBrief.eventDate.replace(/-/g, "");
  const folderName = `${slug}-${datePart}`;
  const baseDir = outputDir ?? "campaigns";
  const campaignDir = join(baseDir, folderName);
  const summaryPath = join(campaignDir, "campaign-summary.md");

  await mkdir(campaignDir, { recursive: true });

  const emailCount = kit.emailPackage.pieces.length;
  const socialCount = kit.socialPackage.pieces.length;

  const lines: string[] = [
    `# Campaign Summary: ${kit.eventBrief.event}`,
    ``,
    `**Event date:** ${kit.eventBrief.eventDate}`,
    `**Event time:** ${kit.eventBrief.eventTime} (${kit.eventBrief.timezone})`,
    `**Runway start:** ${kit.eventBrief.runwayStartDate}`,
    `**Register:** ${kit.eventBrief.register}`,
    `**Audience:** ${kit.eventBrief.audience}`,
    `**Preflight:** ${kit.overallPreflight.passed ? "PASSED" : "FAILED"}`,
    ``,
    `---`,
    ``,
    `## Email Sequence (${emailCount} piece${emailCount !== 1 ? "s" : ""})`,
    ``,
  ];

  for (const piece of kit.emailPackage.pieces) {
    const hint = piece.scheduleHint ?? "(no date)";
    const subject = piece.subject ?? "(no subject)";
    lines.push(`### ${piece.id}`);
    lines.push(`- **Subject:** ${subject}`);
    lines.push(`- **Scheduled:** ${hint}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`## Social Calendar (${socialCount} piece${socialCount !== 1 ? "s" : ""})`);
  lines.push(``);

  for (const piece of kit.socialPackage.pieces) {
    const hint = piece.scheduleHint ?? "(no date)";
    const preview = piece.body.slice(0, 100).replace(/\n+/g, " ");
    lines.push(`### ${piece.id} (${piece.platform})`);
    lines.push(`- **Scheduled:** ${hint}`);
    lines.push(`- **Preview:** ${preview}...`);
    lines.push(``);
  }

  if (!kit.overallPreflight.passed && kit.overallPreflight.violations.length > 0) {
    lines.push(`---`);
    lines.push(``);
    lines.push(`## Preflight Violations`);
    lines.push(``);
    for (const v of kit.overallPreflight.violations) {
      lines.push(`- [${v.severity.toUpperCase()}] ${v.pieceId} (${v.code}): ${v.detail}`);
    }
    lines.push(``);
  }

  const content = lines.join("\n");
  await writeFile(summaryPath, content, "utf8");
  return summaryPath;
}

// ---------------------------------------------------------------------------
// DeliverLaunchKit options and result
// ---------------------------------------------------------------------------

export interface DeliverLaunchKitOpts {
  /** GHL location ID. Falls back to GHL_LOCATION_ID env; throws if neither is set. */
  locationId?: string;
  /** If true, prints payloads but makes no API calls. */
  dryRun?: boolean;
  /** GHL approver user ID for social planner routing. */
  approver?: string;
  /** Physical mailing address (required for email push). */
  physicalAddress?: string;
  /** Output directory for manifests (default: current working directory). */
  outputDir?: string;
  /** Override output directory for campaign-summary.md (default: "campaigns"). */
  campaignDir?: string;
}

export interface DeliverStep {
  channel: "social" | "email";
  ok: boolean;
  error?: string;
  /** Path to the push manifest written (when available). */
  manifestPath?: string | null;
}

export interface DeliverLaunchKitResult {
  summaryPath: string;
  steps: [DeliverStep, DeliverStep]; // [social, email] -- social always first
}

// ---------------------------------------------------------------------------
// generateLaunchKit
// ---------------------------------------------------------------------------

export interface GenerateLaunchKitOpts extends GenerateOptions {
  llm?: LlmClient;
}

/**
 * Generate a full LaunchKit from an EventBrief.
 *
 * Calls generate() twice: once for channel=email (emailCount pieces),
 * once for channel=social (socialCount pieces). Assembles the LaunchKit
 * with combined preflight (overallPreflight.passed=false if either fails;
 * pieceId disambiguation via "email:" and "social:" prefixes).
 *
 * Requires ANTHROPIC_API_KEY in the environment when deps.llm is not
 * supplied. Tests inject a mock LlmClient.
 */
export async function generateLaunchKit(
  brief: EventBrief,
  opts: GenerateLaunchKitOpts = {}
): Promise<LaunchKit> {
  const { llm, ...genOpts } = opts;
  const deps = llm ? { llm } : undefined;

  // Validate the event brief up front so direct programmatic callers get
  // EVENT_DATE_PAST before any generation runs.
  const validationError = validateEventBrief(brief);
  if (validationError) {
    throw new Error(`${validationError.code}: ${validationError.message}`);
  }

  const runway = calculateRunway(brief);

  const emailBrief = buildBrief(brief, "email", brief.emailCount);
  const socialBrief = buildBrief(brief, "social", brief.socialCount);

  const [rawEmailPkg, rawSocialPkg] = await Promise.all([
    generate(emailBrief, deps, genOpts),
    generate(socialBrief, deps, genOpts),
  ]);

  const emailPackage = applyScheduleHints(rawEmailPkg, runway.emailSlots);
  const socialPackage = applyScheduleHints(rawSocialPkg, runway.socialSlots);

  const brandConfig = await loadBrandConfig(genOpts.brandConfigPath);
  const emailPf = preflight(emailPackage, brandConfig);
  const socialPf = preflight(socialPackage, brandConfig);
  const overallPreflight = combinePreflights(emailPf, socialPf);

  return {
    eventBrief: brief,
    emailPackage: { ...emailPackage, preflightResult: emailPf },
    socialPackage: { ...socialPackage, preflightResult: socialPf },
    overallPreflight,
  };
}

// ---------------------------------------------------------------------------
// deliverLaunchKit
// ---------------------------------------------------------------------------

/**
 * Deliver a LaunchKit to both GHL approval queues.
 *
 * GOLDEN INVARIANT: uses only the approval-gated pushSocial (draft/scheduled)
 * and pushEmail (draft templates). Never publishes or sends directly.
 *
 * Social is pushed FIRST (lower risk).
 * If one step fails, the other is still attempted.
 *
 * Also writes campaign-summary.md.
 *
 * Live push requires GHL_PIT + a location ID (opts.locationId or
 * GHL_LOCATION_ID env). The summary write and step reporting are testable
 * without those env vars in dryRun mode.
 */
export async function deliverLaunchKit(
  kit: LaunchKit,
  opts: DeliverLaunchKitOpts = {}
): Promise<DeliverLaunchKitResult> {
  const locationId = opts.locationId ?? process.env["GHL_LOCATION_ID"];
  const dryRun = opts.dryRun ?? false;
  const outputDir = opts.outputDir ?? ".";

  if (!locationId) {
    throw new Error(
      "No GHL location ID. Pass opts.locationId or set the GHL_LOCATION_ID env var."
    );
  }

  const socialStep: DeliverStep = { channel: "social", ok: false };
  const emailStep: DeliverStep = { channel: "email", ok: false };

  // --- Social FIRST (lower risk) ---
  try {
    const socialOpts: PushSocialOpts = {
      token: process.env["GHL_PIT"] ?? "",
      locationId,
      dryRun,
      outputDir,
      approver: opts.approver,
    };
    const socialResult = await pushSocial(kit.socialPackage, socialOpts);
    socialStep.ok = socialResult.failed === 0;
    socialStep.manifestPath = socialResult.manifestPath;
    if (!socialStep.ok) {
      socialStep.error = `${socialResult.failed} social post(s) failed`;
    }
  } catch (err) {
    // Log but do NOT rethrow; email delivery must still be attempted
    socialStep.error = err instanceof Error ? err.message : String(err);
  }

  // --- Email SECOND ---
  try {
    const brandConfig = await loadBrandConfig();
    const htmls = kit.emailPackage.pieces
      .filter((p) => p.type === "email")
      .map((piece) => ({
        name: `${slugify(kit.eventBrief.event)}-${piece.id}`,
        html: renderEmail(piece, { physicalAddress: opts.physicalAddress }, brandConfig),
      }));

    const emailManifest = await pushEmail(htmls, {
      locationId,
      dryRun,
      physicalAddress: opts.physicalAddress,
    });

    const failed = emailManifest.results.filter((r) => !r.ok).length;
    emailStep.ok = failed === 0;
    if (!emailStep.ok) {
      emailStep.error = `${failed} email template(s) failed`;
    }
  } catch (err) {
    // Capture but do NOT rethrow
    emailStep.error = err instanceof Error ? err.message : String(err);
  }

  // Write campaign summary (always; regardless of delivery outcome)
  const summaryPath = await writeCampaignSummary(kit, opts.campaignDir);

  return {
    summaryPath,
    steps: [socialStep, emailStep],
  };
}
