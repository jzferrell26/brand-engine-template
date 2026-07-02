/**
 * Brand Agent CLI
 *
 * Usage:
 *   node --import tsx/esm src/agent/cli.ts --brief brief.json
 *   node --import tsx/esm src/agent/cli.ts --brief brief.json --out output.json
 *
 * Exit codes:
 *   0 = success (preflight passed)
 *   1 = preflight failure or runtime error
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BriefSchema, generate } from "./index.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

let values: { brief?: string; out?: string };
try {
  ({ values } = parseArgs({
    options: {
      brief: { type: "string" },
      out: { type: "string" },
    },
  }));
} catch (err) {
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n` +
      "Usage: brand-agent --brief brief.json [--out output.json]\n"
  );
  process.exit(1);
}

if (!values.brief) {
  process.stderr.write(
    "Error: --brief <path> is required\n" +
      "Usage: brand-agent --brief brief.json [--out output.json]\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const briefPath = values.brief as string;
  const outPath = values.out;

  let briefRaw: unknown;
  try {
    const contents = await readFile(briefPath, "utf8");
    briefRaw = JSON.parse(contents);
  } catch (err) {
    process.stderr.write(
      `Error reading brief file "${briefPath}": ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }

  const briefResult = BriefSchema.safeParse(briefRaw);
  if (!briefResult.success) {
    process.stderr.write(
      `Error: invalid brief schema:\n${briefResult.error.message}\n`
    );
    process.exit(1);
  }

  let pkg;
  try {
    pkg = await generate(briefResult.data);
  } catch (err) {
    process.stderr.write(
      `Error during generation: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }

  const json = JSON.stringify(pkg, null, 2);

  if (!pkg.preflightResult.passed) {
    process.stderr.write("Preflight failed. Violations:\n");
    for (const v of pkg.preflightResult.violations) {
      process.stderr.write(`  [${v.code}] piece=${v.pieceId}: ${v.detail}\n`);
    }
  }

  if (outPath) {
    await writeFile(outPath, json, "utf8");
    process.stdout.write(
      `ContentPackage written to ${outPath}\n` +
        `Pieces: ${pkg.pieces.length} | Preflight: ${pkg.preflightResult.passed ? "PASSED" : "FAILED"}\n`
    );
  } else {
    process.stdout.write(json + "\n");
  }

  process.exit(pkg.preflightResult.passed ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
