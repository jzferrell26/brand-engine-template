/**
 * Push manifest: read and write the JSON record of what was pushed.
 * Written to social/push-manifest-<timestamp>.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PushManifestSchema } from "./schema.js";
import type { ManifestEntry, PushManifest } from "./schema.js";

/**
 * Build a timestamp string safe for use in filenames (ISO without colons).
 */
export function buildTimestamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "Z");
}

/**
 * Write the push manifest to disk.
 * Creates the output directory if it does not exist.
 */
export function writeManifest(
  outputDir: string,
  campaignId: string | undefined,
  entries: ManifestEntry[],
  timestamp?: string,
): string {
  mkdirSync(outputDir, { recursive: true });
  const ts = timestamp ?? buildTimestamp();
  const filename = `push-manifest-${ts}.json`;
  const filePath = join(outputDir, filename);

  const manifest: PushManifest = {
    pushedAt: new Date().toISOString(),
    ...(campaignId ? { campaignId } : {}),
    posts: entries,
  };

  writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf8");
  return filePath;
}

/**
 * Read and parse an existing manifest file.
 * Throws if the file is missing or malformed.
 */
export function readManifest(filePath: string): PushManifest {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read manifest at ${filePath}: ${msg}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Manifest at ${filePath} is not valid JSON`);
  }
  return PushManifestSchema.parse(parsed);
}

/**
 * Build a Set of piece IDs that should be skipped in a resume run.
 * Only IDs with status "pushed" are skipped; "failed" entries are retried.
 */
export function buildSkipSet(manifest: PushManifest): Set<string> {
  const skip = new Set<string>();
  for (const entry of manifest.posts) {
    if (entry.status === "pushed") {
      skip.add(entry.id);
    }
  }
  return skip;
}

/**
 * Write the video-scripts JSON file for TikTok/YouTube pieces.
 */
export function writeVideoScripts(
  outputDir: string,
  pieces: Array<{ id: string; platform: string; body: string; scheduleHint?: string }>,
  timestamp?: string,
): string {
  mkdirSync(outputDir, { recursive: true });
  const ts = timestamp ?? buildTimestamp();
  const filename = `video-scripts-${ts}.json`;
  const filePath = join(outputDir, filename);
  writeFileSync(filePath, JSON.stringify({ exportedAt: new Date().toISOString(), pieces }, null, 2), "utf8");
  return filePath;
}
