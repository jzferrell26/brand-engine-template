/**
 * GHL v3 email templates API push.
 *
 * Pushes rendered HTML emails to GHL as draft templates for the operator to
 * review and send from the GHL UI. Never sends directly.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";

// ---------------------------------------------------------------------------
// GHL v3 email templates API constants
// ---------------------------------------------------------------------------

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_EMAIL_PATH = "/emails/builder";

// ---------------------------------------------------------------------------
// Zod schemas (all external / env boundaries validated here)
// ---------------------------------------------------------------------------

export const PushOptsSchema = z.object({
  /** GHL location ID for this client. No default -- every client has its own. */
  locationId: z.string().min(1),
  /** Skip API calls; print template name + first 200 chars of HTML per piece. */
  dryRun: z.boolean().default(false),
  /**
   * Physical mailing address. Must be a real address before pushing.
   * Leaving it unset triggers COMPLIANCE_BLOCK.
   */
  physicalAddress: z.string().optional(),
});

export type PushOpts = z.infer<typeof PushOptsSchema>;

export const PushResultEntrySchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    name: z.string(),
    templateId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    name: z.string(),
    status: z.number().optional(),
    body: z.string().optional(),
    error: z.string(),
  }),
]);

export type PushResultEntry = z.infer<typeof PushResultEntrySchema>;

export const PushManifestSchema = z.object({
  pushedAt: z.string(),
  locationId: z.string(),
  results: z.array(PushResultEntrySchema),
});

export type PushManifest = z.infer<typeof PushManifestSchema>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the GHL PIT from the environment only (never accept it as a
 * parameter to prevent accidental logging). Throws on missing.
 */
function resolvePit(): string {
  const pit = process.env["GHL_PIT"];
  if (!pit) {
    const msg = "Missing GHL_PIT env var";
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }
  return pit;
}

/**
 * Check that physicalAddress has been supplied by the operator.
 * Exits with COMPLIANCE_BLOCK if not.
 */
function assertPhysicalAddress(physicalAddress: string | undefined): void {
  if (!physicalAddress || physicalAddress.trim() === "") {
    const msg =
      "COMPLIANCE_BLOCK: physical_address not configured. Set the address before pushing email templates.";
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }
}

async function pushOne(
  pit: string,
  locationId: string,
  name: string,
  html: string
): Promise<PushResultEntry> {
  const url = `${GHL_BASE}${GHL_EMAIL_PATH}`;
  const body = JSON.stringify({
    title: name,
    locationId,
    type: "html",
    editorContent: html,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pit}`,
        Version: "v3",
      },
      body,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, name, error };
  }

  const responseText = await response.text().catch(() => "");

  if (!response.ok) {
    process.stderr.write(
      `[push] FAILED ${name} - HTTP ${response.status}: ${responseText}\n`
    );
    return {
      ok: false,
      name,
      status: response.status,
      body: responseText,
      error: `HTTP ${response.status}`,
    };
  }

  let templateId = "";
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "id" in parsed &&
      typeof (parsed as Record<string, unknown>)["id"] === "string"
    ) {
      templateId = (parsed as Record<string, unknown>)["id"] as string;
    }
  } catch {
    // Response was not JSON; template ID unavailable but push succeeded.
  }

  process.stdout.write(`[push] OK   ${name} - templateId: ${templateId}\n`);
  return { ok: true, name, templateId };
}

async function writeManifest(manifest: PushManifest, timestamp: string): Promise<void> {
  await mkdir("email", { recursive: true });
  const path = `email/push-manifest-${timestamp}.json`;
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
  process.stdout.write(`[push] Manifest written: ${path}\n`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push rendered HTML email templates to the GHL v3 templates API as drafts
 * for the operator to review and send from the GHL UI.
 *
 * Behavior summary:
 *   - dryRun=true: prints name + first 200 chars of HTML per piece, no API calls.
 *   - Missing physicalAddress: exits with COMPLIANCE_BLOCK message.
 *   - Missing GHL_PIT env var: exits with "Missing GHL_PIT env var".
 *   - API failure per template: logs HTTP status + body, continues remaining.
 *   - On success: captures template ID into push-manifest-<timestamp>.json.
 *   - Any failure: throws PushEmailError after all templates are attempted.
 *
 * @param htmls   - Rendered emails: name + html pairs.
 * @param rawOpts - Raw options (will be validated through PushOptsSchema).
 */
export async function pushEmail(
  htmls: { name: string; html: string }[],
  rawOpts: Partial<PushOpts> & Pick<PushOpts, "locationId">
): Promise<PushManifest> {
  const opts = PushOptsSchema.parse(rawOpts);

  if (opts.dryRun) {
    for (const { name, html } of htmls) {
      process.stdout.write(
        `[DRY RUN] Would push: ${name} (${html.length} HTML)\n` +
          `  Preview: ${html.slice(0, 200)}\n`
      );
    }
    return {
      pushedAt: new Date().toISOString(),
      locationId: opts.locationId,
      results: [],
    };
  }

  assertPhysicalAddress(opts.physicalAddress);

  const pit = resolvePit();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const results: PushResultEntry[] = [];

  // Push sequentially to respect GHL rate limits (no unbounded concurrency).
  for (const { name, html } of htmls) {
    const result = await pushOne(pit, opts.locationId, name, html);
    results.push(result);
  }

  const manifest: PushManifest = {
    pushedAt: new Date().toISOString(),
    locationId: opts.locationId,
    results,
  };

  await writeManifest(manifest, timestamp);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new PushEmailError(
      `${failed.length} template(s) failed to push. See manifest for details.`,
      manifest
    );
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export class PushEmailError extends Error {
  readonly manifest: PushManifest;

  constructor(message: string, manifest: PushManifest) {
    super(message);
    this.name = "PushEmailError";
    this.manifest = manifest;
  }
}
