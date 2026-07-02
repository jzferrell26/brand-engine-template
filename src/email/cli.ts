/**
 * CLI entry point for the email push workflow.
 *
 * Usage:
 *   npx tsx src/email/cli.ts [--dry-run] --location-id <id>
 *
 * Environment variables required for a live push:
 *   GHL_PIT              - Private Integration Token for this client's GHL location
 *
 * Environment variables for configuration:
 *   GHL_LOCATION_ID      - Location ID (or pass --location-id)
 *   PHYSICAL_ADDRESS     - Operator's physical mailing address (required for live push)
 *   CAMPAIGN_SLUG        - Which campaigns/<slug>.json manifest to load
 *
 * The CLI loads a set of rendered email HTMLs and pushes them to GHL.
 * In practice, this is called from the brand agent pipeline after renderEmail
 * has been invoked for each ContentPiece.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pushEmail, PushEmailError } from "./push.js";
import type { PushOpts } from "./push.js";
import { renderEmail } from "./render.js";
import type { EmailRenderConfig } from "./render.js";
import type { ContentPiece } from "../types.js";
import { loadBrandConfig } from "../config/brand-config.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { dryRun: boolean; locationId?: string } {
  const dryRun = argv.includes("--dry-run");
  const locationIdx = argv.indexOf("--location-id");
  const locationId = locationIdx >= 0 ? argv[locationIdx + 1] : undefined;
  return { dryRun, locationId };
}

// ---------------------------------------------------------------------------
// Campaign manifest loader
//
// The manifest lives at src/email/campaigns/<campaign-slug>.json.
// Each entry contains:
//   {
//     "name": "campaign-piece-01",
//     "piece": { ...ContentPiece fields... },
//     "cfg":   { ...EmailRenderConfig fields... }
//   }
// ---------------------------------------------------------------------------

interface CampaignEntry {
  name: string;
  piece: ContentPiece;
  cfg: EmailRenderConfig;
}

async function loadCampaign(campaignSlug: string): Promise<CampaignEntry[]> {
  const manifestPath = path.join(__dirname, "campaigns", `${campaignSlug}.json`);
  const raw = await readFile(manifestPath, "utf8");
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new TypeError(`Campaign manifest at ${manifestPath} must be a JSON array.`);
  }
  return data as CampaignEntry[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { dryRun, locationId: cliLocationId } = parseArgs(process.argv.slice(2));

  const locationId = cliLocationId ?? process.env["GHL_LOCATION_ID"];
  if (!locationId) {
    process.stderr.write("Error: no GHL location ID. Pass --location-id <id> or set GHL_LOCATION_ID.\n");
    process.exit(1);
  }

  const campaignSlug = process.env["CAMPAIGN_SLUG"];
  if (!campaignSlug) {
    process.stderr.write("Error: CAMPAIGN_SLUG env var is required (which campaigns/<slug>.json to load).\n");
    process.exit(1);
  }

  let entries: CampaignEntry[];
  try {
    entries = await loadCampaign(campaignSlug);
  } catch (err) {
    process.stderr.write(
      `Failed to load campaign "${campaignSlug}": ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }

  const brandConfig = await loadBrandConfig();
  const physicalAddress = process.env["PHYSICAL_ADDRESS"];

  const htmls = entries.map(({ name, piece, cfg }) => ({
    name,
    html: renderEmail(piece, { ...cfg, physicalAddress }, brandConfig),
  }));

  const opts: Partial<PushOpts> & Pick<PushOpts, "locationId"> = {
    locationId,
    dryRun,
    physicalAddress,
  };

  try {
    await pushEmail(htmls, opts);
    process.exit(0);
  } catch (err) {
    if (err instanceof PushEmailError) {
      process.stderr.write(`Push completed with failures: ${err.message}\n`);
    } else {
      process.stderr.write(
        `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
