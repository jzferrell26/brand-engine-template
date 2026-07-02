/**
 * Per-client brand configuration.
 *
 * This is the single swap point between clients. Everything in this file's
 * schema used to be hardcoded TypeScript in the original single-client engine
 * (registers, named frameworks, email design system, from-identity, signoff).
 * A new client means writing a new brand-config.json (plus BRAND-GUIDE.md and
 * brand-voice-pack.md); it never means editing src/.
 *
 * Loaded once at generation/render time from the repo root's
 * src/config/brand-config.json. Fails loud (never partially-generates) when
 * missing or invalid, matching the existing brain-file-missing behavior in
 * src/agent/index.ts.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Register definitions
// ---------------------------------------------------------------------------

/**
 * One voice register (a brand with two distinct voices -- e.g. a polished
 * main-brand voice and a rawer community-brand voice -- declares two of
 * these; a client with only one voice declares a single register here).
 */
export const RegisterDefSchema = z.object({
  /** Machine name used in briefs/content packages, e.g. "strategist". */
  name: z.string().min(1),
  /** Human label for docs/prompts, e.g. "The Strategist". */
  label: z.string().min(1),
  /** Free-text voice/tone instructions injected into the generation prompt. */
  voiceInstructions: z.string().min(1),
  /**
   * Marker phrases that identify THIS register. Preflight fails a piece
   * generated for a DIFFERENT register if any of these markers appear in it
   * (register-purity / contamination check).
   */
  markers: z.array(z.string()).default([]),
  /**
   * Domain or CTA substrings that belong ONLY to this register (e.g. a
   * community-brand domain). Preflight fails a piece generated for a
   * DIFFERENT register if any of these appear in it.
   */
  domainPatterns: z.array(z.string()).default([]),
});
export type RegisterDef = z.infer<typeof RegisterDefSchema>;

// ---------------------------------------------------------------------------
// Named framework fidelity rules
// ---------------------------------------------------------------------------

/**
 * A named framework the brand talks about (e.g. a "system" or "method" with
 * specific required parts). When a piece mentions the framework name,
 * preflight checks it also mentions enough of the framework's required
 * components so the LLM can't half-remember it into something wrong.
 *
 * requiredSlots: each inner array is one "slot"; the slot is satisfied if
 * ANY one of its variant strings appears (case-insensitive substring).
 * minSlotsMatched: how many slots must be satisfied. Set equal to
 * requiredSlots.length to require ALL of them (a framework with 3 required
 * parts where all 3 must appear). Set lower to require "at least N of M"
 * (a framework with 4 possible components where any 2 satisfy it).
 */
export const NamedFrameworkSchema = z.object({
  /** Exact string that triggers this check when found in a piece, e.g. "The Accountability Gap". */
  name: z.string().min(1),
  requiredSlots: z.array(z.array(z.string().min(1)).min(1)).min(1),
  minSlotsMatched: z.number().int().min(1),
});
export type NamedFramework = z.infer<typeof NamedFrameworkSchema>;

// ---------------------------------------------------------------------------
// Email design system
// ---------------------------------------------------------------------------

export const EmailDesignSystemSchema = z.object({
  palette: z.object({
    background: z.string().min(1),
    primary: z.string().min(1),
    accent: z.string().min(1),
    secondary: z.string().min(1),
    emphasis: z.string().min(1),
  }),
  headingFont: z.string().min(1).default("Georgia, serif"),
  bodyFont: z.string().min(1).default("Arial, sans-serif"),
  /** Optional @import url for a webfont (e.g. a Google Fonts CSS2 URL). Omit for system fonts. */
  fontImportUrl: z.string().optional(),
  logoUrl: z.string().min(1),
  logoAlt: z.string().min(1),
  /** Default CTA button label when a piece doesn't supply its own. */
  defaultCtaLabel: z.string().min(1).default("Learn More"),
  /**
   * One-line reason-for-receiving copy shown in the email footer (e.g. "You're
   * receiving this because you opted in to updates from Acme Co."). Falls
   * back to a generic line built from brandName when omitted.
   */
  footerNote: z.string().optional(),
});
export type EmailDesignSystem = z.infer<typeof EmailDesignSystemSchema>;

// ---------------------------------------------------------------------------
// Top-level brand config
// ---------------------------------------------------------------------------

export const BrandConfigSchema = z.object({
  /** Display name used in prompts, email footer, page titles, pull-quote attribution. */
  brandName: z.string().min(1),

  registers: z.array(RegisterDefSchema).min(1),

  /** Global hard rules injected into every generation prompt regardless of register. */
  hardRules: z.array(z.string()).default([]),

  /** The brand's signature content pattern (a repeatable "hook -> reframe -> fix" shape), as ordered free-text steps. */
  contentPattern: z.array(z.string()).default([]),

  /** Required block order for rendered emails, as ordered free-text labels shown to the LLM. */
  emailBlockOrder: z.array(z.string()).min(1),

  namedFrameworks: z.array(NamedFrameworkSchema).default([]),

  bannedPhrases: z
    .array(z.object({ phrase: z.string().min(1), replacement: z.string().min(1) }))
    .default([]),

  /**
   * Merge tokens allowed beyond the CAN-SPAM tokens the engine always
   * permits (see CAN_SPAM_TOKENS in src/preflight/index.ts, currently just
   * {{physical_address}}). {{email.unsubscribe_link}} is NOT auto-allowed --
   * it must be listed here explicitly, same as any personalization token.
   */
  confirmedMergeTokens: z
    .array(z.string())
    .default(["{{contact.first_name}}", "{{email.unsubscribe_link}}"]),

  fromIdentity: z.object({
    name: z.string().min(1),
    address: z.string().email(),
    replyTo: z.string().email(),
  }),

  signoffName: z.string().min(1),

  emailDesignSystem: EmailDesignSystemSchema,
});
export type BrandConfig = z.infer<typeof BrandConfigSchema>;

// ---------------------------------------------------------------------------
// Loader (fail loud -- never generate against a missing/invalid brand pack)
// ---------------------------------------------------------------------------

function repoRoot(): string {
  // src/config/ -> repo root is two levels up.
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

/** Async loader for use by the generation/delivery pipeline. */
export async function loadBrandConfig(path?: string): Promise<BrandConfig> {
  const configPath = path ?? join(repoRoot(), "src/config/brand-config.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    throw new Error(
      `Brand config not found: ${configPath}\n` +
        "src/config/brand-config.json must exist before generation. " +
        "Copy src/config/brand-config.example.json and fill it in for this client " +
        "(see the client-brand-engine-intake skill)."
    );
  }
  const parsed = BrandConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `Brand config at ${configPath} is invalid:\n${formatZodError(parsed.error)}`
    );
  }
  return parsed.data;
}

/** Look up a register definition by name; throws with the valid list if not found. */
export function getRegister(config: BrandConfig, name: string): RegisterDef {
  const found = config.registers.find((r) => r.name === name);
  if (!found) {
    const valid = config.registers.map((r) => r.name).join(", ");
    throw new Error(`Unknown register "${name}". Valid registers for this brand: ${valid}`);
  }
  return found;
}
