/**
 * Launch Kit CLI entry point.
 *
 * Usage:
 *   node --import tsx/esm src/launch/cli.ts --event-brief event-brief.json --launch-kit
 *   node --import tsx/esm src/launch/cli.ts --event-brief event-brief.json --launch-kit --dry-run
 *
 * Environment variables for a live run:
 *   ANTHROPIC_API_KEY    - Required for generation
 *   GHL_PIT              - Required for delivery to GHL
 *   GHL_LOCATION_ID      - Required for delivery to GHL (this client's location)
 *   PHYSICAL_ADDRESS     - Required for email push (COMPLIANCE_BLOCK without this)
 *
 * Dry-run mode (--dry-run):
 *   - Generates content (still needs ANTHROPIC_API_KEY unless a mock is injected)
 *   - Writes campaign-summary.md, makes no GHL API calls
 *   - Fully testable without GHL_PIT / GHL_LOCATION_ID
 *
 * Exit codes:
 *   0 = kit generated + delivered (or dry-run) + preflight passed
 *   1 = validation error, generation error, or preflight failure
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  generateLaunchKit,
  deliverLaunchKit,
  writeCampaignSummary,
} from "./index.js";
import { EventBriefSchema, validateEventBrief } from "./index.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

let values: {
  "event-brief"?: string;
  "launch-kit"?: boolean;
  "dry-run"?: boolean;
  out?: string;
};

try {
  ({ values } = parseArgs({
    options: {
      "event-brief": { type: "string" },
      "launch-kit": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      out: { type: "string" },
    },
  }));
} catch (err) {
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n` +
      "Usage: brand-agent --event-brief event-brief.json --launch-kit [--dry-run]\n"
  );
  process.exit(1);
}

if (!values["event-brief"]) {
  process.stderr.write(
    "Error: --event-brief <path> is required\n" +
      "Usage: brand-agent --event-brief event-brief.json --launch-kit [--dry-run]\n"
  );
  process.exit(1);
}

if (!values["launch-kit"]) {
  process.stderr.write(
    "Error: --launch-kit flag is required for this CLI\n" +
      "Usage: brand-agent --event-brief event-brief.json --launch-kit [--dry-run]\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const briefPath = values["event-brief"] as string;
  const dryRun = values["dry-run"] ?? false;

  let briefRaw: unknown;
  try {
    const contents = await readFile(briefPath, "utf8");
    briefRaw = JSON.parse(contents);
  } catch (err) {
    process.stderr.write(
      `Error reading event brief "${briefPath}": ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }

  const briefResult = EventBriefSchema.safeParse(briefRaw);
  if (!briefResult.success) {
    process.stderr.write(
      `Error: invalid event brief schema:\n${briefResult.error.message}\n`
    );
    process.exit(1);
  }

  const brief = briefResult.data;

  const validationError = validateEventBrief(brief);
  if (validationError) {
    process.stderr.write(`Error [${validationError.code}]: ${validationError.message}\n`);
    process.exit(1);
  }

  process.stdout.write(`Generating launch kit for "${brief.event}"...\n`);
  let kit;
  try {
    kit = await generateLaunchKit(brief);
  } catch (err) {
    process.stderr.write(
      `Error during launch kit generation: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }

  if (!kit.overallPreflight.passed) {
    process.stderr.write("Preflight FAILED. Violations:\n");
    for (const v of kit.overallPreflight.violations) {
      process.stderr.write(`  [${v.code}] piece=${v.pieceId}: ${v.detail}\n`);
    }
    // Continue to delivery even if preflight failed (kit is still delivered as draft)
  } else {
    process.stdout.write("Preflight PASSED.\n");
  }

  let summaryPath: string;
  if (dryRun) {
    process.stdout.write("\n[DRY RUN] Writing campaign summary only. No GHL API calls.\n");
    summaryPath = await writeCampaignSummary(kit);
    process.stdout.write(`Campaign summary written to: ${summaryPath}\n`);
  } else {
    process.stdout.write("\nDelivering to GHL approval queues...\n");
    let result;
    try {
      result = await deliverLaunchKit(kit, {
        dryRun,
        physicalAddress: process.env["PHYSICAL_ADDRESS"],
        locationId: process.env["GHL_LOCATION_ID"],
      });
    } catch (err) {
      process.stderr.write(
        `Error during delivery: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    }

    summaryPath = result.summaryPath;

    for (const step of result.steps) {
      if (step.ok) {
        process.stdout.write(`[OK] ${step.channel} delivery succeeded\n`);
      } else {
        process.stderr.write(
          `[FAIL] ${step.channel} delivery: ${step.error ?? "unknown error"}\n`
        );
      }
    }

    process.stdout.write(`\nCampaign summary written to: ${summaryPath}\n`);
  }

  process.stdout.write(`\nLaunch kit summary:\n`);
  process.stdout.write(`  Event         : ${brief.event}\n`);
  process.stdout.write(`  Event date    : ${brief.eventDate}\n`);
  process.stdout.write(`  Email pieces  : ${kit.emailPackage.pieces.length}\n`);
  process.stdout.write(`  Social pieces : ${kit.socialPackage.pieces.length}\n`);
  process.stdout.write(
    `  Preflight     : ${kit.overallPreflight.passed ? "PASSED" : "FAILED"}\n`
  );
  process.stdout.write(`  Summary file  : ${summaryPath}\n`);

  process.exit(kit.overallPreflight.passed ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
