import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { z } from "zod";
import type { Brief, ContentPackage, ContentPiece } from "../types.js";
import { preflight } from "../preflight/index.js";
import { loadBrandConfig, getRegister } from "../config/brand-config.js";
import type { BrandConfig } from "../config/brand-config.js";

// ---------------------------------------------------------------------------
// Re-export the Brief schema so callers can validate at the boundary
// ---------------------------------------------------------------------------

export { BriefSchema } from "../types.js";

// ---------------------------------------------------------------------------
// LlmClient abstraction (testability seam)
// ---------------------------------------------------------------------------

/**
 * Minimal LLM client abstraction. Implementations wrap @ai-sdk/anthropic
 * (or any compatible provider). The seam is here so the agent can be tested
 * with a deterministic stub without hitting a live API.
 */
export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Override the repo-root brain file paths (useful in tests). */
  brandGuidePath?: string;
  brandVoicePackPath?: string;
  /** Override the repo-root brand-config.json path (useful in tests). */
  brandConfigPath?: string;
}

// ---------------------------------------------------------------------------
// Production LlmClient backed by Vercel AI SDK + @ai-sdk/anthropic
// ---------------------------------------------------------------------------

/**
 * Returns a production LlmClient using claude-sonnet-4-6.
 * ANTHROPIC_API_KEY must be set in the environment; it is never logged.
 */
export function createProductionLlmClient(): LlmClient {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. " +
        "Set it before invoking the brand agent in production."
    );
  }
  const anthropic = createAnthropic({ apiKey });
  const model = anthropic("claude-sonnet-4-6");

  return {
    async complete(prompt: string): Promise<string> {
      const { text } = await generateText({ model, prompt });
      return text;
    },
  };
}

// ---------------------------------------------------------------------------
// Brain file loading
// ---------------------------------------------------------------------------

/** Repo root is two levels above src/agent/. */
function repoRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

async function loadBrainFiles(opts: GenerateOptions): Promise<{
  brandGuide: string;
  brandVoicePack: string;
}> {
  const root = repoRoot();
  const brandGuidePath = opts.brandGuidePath ?? join(root, "BRAND-GUIDE.md");
  const brandVoicePackPath =
    opts.brandVoicePackPath ?? join(root, "brand-voice-pack.md");

  // Fail loud if either brain file is absent. We intentionally do NOT
  // generate partial content.
  let brandGuide: string;
  let brandVoicePack: string;

  try {
    brandGuide = await readFile(brandGuidePath, "utf8");
  } catch {
    throw new Error(
      `Brain file not found: ${brandGuidePath}\n` +
        "BRAND-GUIDE.md must be present in the repo root before generation. " +
        "Copy BRAND-GUIDE.template.md and fill it in for this client."
    );
  }

  try {
    brandVoicePack = await readFile(brandVoicePackPath, "utf8");
  } catch {
    throw new Error(
      `Brain file not found: ${brandVoicePackPath}\n` +
        "brand-voice-pack.md must be present in the repo root before generation. " +
        "Copy brand-voice-pack.template.md and fill it in for this client."
    );
  }

  return { brandGuide, brandVoicePack };
}

// ---------------------------------------------------------------------------
// Piece-type helpers
// ---------------------------------------------------------------------------

type PieceType = "email" | "social-post";

/**
 * Determine which platform to assign to a given social slot.
 * For channel=email all slots are ghl-email.
 * For channel=social slots round-robin across brief.platforms.
 * For channel=both: first half are email, second half are social.
 */
function assignPlatform(
  index: number,
  total: number,
  brief: Brief
): { type: PieceType; platform: string } {
  if (brief.channel === "email") {
    return { type: "email", platform: "ghl-email" };
  }

  if (brief.channel === "social") {
    return socialSlot(index, brief);
  }

  // channel=both: first half email, second half social
  const halfway = Math.ceil(total / 2);
  if (index < halfway) {
    return { type: "email", platform: "ghl-email" };
  }
  return socialSlot(index - halfway, brief);
}

function socialSlot(index: number, brief: Brief): { type: "social-post"; platform: string } {
  const platforms = brief.platforms.length > 0 ? brief.platforms : ["linkedin", "facebook"];
  return { type: "social-post", platform: platforms[index % platforms.length]! };
}

// ---------------------------------------------------------------------------
// Prompt construction (config-driven)
// ---------------------------------------------------------------------------

/**
 * Build the full generation prompt for a single piece.
 * The brand files are injected verbatim at generation time; register voice,
 * hard rules, content pattern, and email block order all come from the
 * loaded BrandConfig rather than being hardcoded to any one client.
 */
function buildPiecePrompt(
  brief: Brief,
  pieceIndex: number,
  type: PieceType,
  platform: string,
  brandGuide: string,
  brandVoicePack: string,
  config: BrandConfig
): string {
  const register = getRegister(config, brief.register);

  const hardRulesBlock =
    config.hardRules.length > 0
      ? `\nHARD RULES (non-negotiable across ALL pieces):\n${config.hardRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
      : "";

  const contentPatternBlock =
    config.contentPattern.length > 0
      ? `\nTHE ${config.brandName.toUpperCase()} CONTENT PATTERN (required in every piece):\n${config.contentPattern.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "";

  const registerBlock = `
REGISTER: ${register.label}
${register.voiceInstructions}`;

  const sharedHeader = `
## BRAND CONTEXT (read every word)

### BRAND-GUIDE.md
${brandGuide}

### BRAND-VOICE-PACK.md
${brandVoicePack}

## CAMPAIGN BRIEF
- Event: ${brief.event}
- Theme: ${brief.theme}
- Audience: ${brief.audience}
- Register: ${brief.register}
- Channel: ${type === "email" ? "email" : "social"}
- Piece index: ${pieceIndex + 1}
${brief.eventDate ? `- Event date: ${brief.eventDate}` : ""}
${registerBlock}
${hardRulesBlock}
${contentPatternBlock}`;

  if (type === "email") {
    const blockOrder = config.emailBlockOrder.map((b, i) => `${i + 1}. ${b}`).join("\n");
    return `You are writing ONE email for ${config.brandName}'s campaign. This is piece ${pieceIndex + 1} in the sequence.
${sharedHeader}

## EMAIL BLOCK ORDER (REQUIRED - follow this exactly)
${blockOrder}

## OUTPUT FORMAT
Return ONLY a JSON object with these exact fields (no markdown, no explanation, just the JSON):
{
  "subject": "...",
  "fromName": "${config.fromIdentity.name}",
  "fromAddress": "${config.fromIdentity.address}",
  "replyTo": "${config.fromIdentity.replyTo}",
  "heroEyebrow": "...",
  "heroHeadline": "...",
  "heroSub": "...",
  "body": "full email body text including all paragraphs, the content-pattern beats, CTA text, signoff, P.S., and ending with {{email.unsubscribe_link}} and {{physical_address}} on separate lines at the end",
  "truthBlock": "the standalone punchy-reframe line for the emphasis block",
  "pullQuote": "the short quotable pull-quote line (no attribution, no quotes)",
  "ctaLabel": "...",
  "ps": "the P.S. text"
}`;
  }

  // social-post
  const platformNote =
    platform === "linkedin"
      ? "This is a LinkedIn post: professional, thought-leadership tone. Can be slightly longer (200-400 words). Paragraph breaks. End with a question or call to action."
      : platform === "facebook"
        ? "This is a Facebook post: slightly more conversational than LinkedIn. 150-300 words. More personal story emphasis."
        : platform === "tiktok"
          ? "This is a TikTok caption: very short (100 words max), punchy, hooks in first 5 words."
          : platform === "youtube"
            ? "This is a YouTube description or community post: can include a short description + call to action."
            : `This is a ${platform} post: match the platform's typical tone and length.`;

  return `You are writing ONE social media post for ${config.brandName}'s campaign. This is piece ${pieceIndex + 1} in the sequence.
${sharedHeader}
- Platform: ${platform}

## PLATFORM CONTEXT
${platformNote}

## OUTPUT FORMAT
Return ONLY a JSON object with these exact fields (no markdown, no explanation, just the JSON):
{
  "body": "the complete social post text, closing with '${config.signoffName}' on its own line"
}`;
}

// ---------------------------------------------------------------------------
// JSON extraction from LLM response
// ---------------------------------------------------------------------------

const EmailLlmOutputSchema = z.object({
  subject: z.string(),
  fromName: z.string().optional(),
  fromAddress: z.string().optional(),
  replyTo: z.string().optional(),
  heroEyebrow: z.string().optional(),
  heroHeadline: z.string().optional(),
  heroSub: z.string().optional(),
  body: z.string(),
  truthBlock: z.string().optional(),
  pullQuote: z.string().optional(),
  ctaLabel: z.string().optional(),
  ps: z.string().optional(),
});

const SocialLlmOutputSchema = z.object({
  body: z.string(),
});

/**
 * Extract the first JSON object from an LLM response string.
 * The model is instructed to return raw JSON but may include prose.
 */
function extractJson(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        throw new Error(
          `LLM response did not contain valid JSON. Raw response (first 500 chars): ${text.slice(0, 500)}`
        );
      }
    }
    throw new Error(
      `LLM response contained no JSON object. Raw response (first 500 chars): ${text.slice(0, 500)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Single-piece generation
// ---------------------------------------------------------------------------

async function generatePiece(
  brief: Brief,
  index: number,
  total: number,
  brandGuide: string,
  brandVoicePack: string,
  config: BrandConfig,
  llm: LlmClient
): Promise<ContentPiece> {
  const pieceId = `piece-${index + 1}`;
  const { type, platform } = assignPlatform(index, total, brief);

  const prompt = buildPiecePrompt(brief, index, type, platform, brandGuide, brandVoicePack, config);

  const raw = await llm.complete(prompt);
  const parsed = extractJson(raw);

  if (type === "email") {
    const validated = EmailLlmOutputSchema.parse(parsed);

    let body = validated.body;
    if (!body.includes("{{email.unsubscribe_link}}")) {
      body += "\n\n{{email.unsubscribe_link}}";
    }
    if (!body.includes("{{physical_address}}")) {
      body += "\n{{physical_address}}";
    }

    return {
      id: pieceId,
      type: "email",
      platform: "ghl-email",
      subject: validated.subject,
      fromName: validated.fromName ?? config.fromIdentity.name,
      fromAddress: validated.fromAddress ?? config.fromIdentity.address,
      replyTo: validated.replyTo ?? config.fromIdentity.replyTo,
      body,
      imageDirectionHint: validated.heroEyebrow
        ? `Hero eyebrow: ${validated.heroEyebrow}. Headline: ${validated.heroHeadline ?? ""}. Sub: ${validated.heroSub ?? ""}`
        : undefined,
    };
  }

  // social-post
  const validated = SocialLlmOutputSchema.parse(parsed);
  let body = validated.body;

  if (!body.trimEnd().endsWith(config.signoffName)) {
    body = body.trimEnd() + `\n\n${config.signoffName}`;
  }

  return {
    id: pieceId,
    type: "social-post",
    platform,
    body,
  };
}

// ---------------------------------------------------------------------------
// briefSummary builder
// ---------------------------------------------------------------------------

function buildBriefSummary(brief: Brief, total: number): string {
  if (brief.channel === "both") {
    const emailCount = Math.ceil(total / 2);
    const socialCount = total - emailCount;
    return (
      `Campaign: ${brief.event} | Theme: ${brief.theme} | ` +
      `Audience: ${brief.audience} | Register: ${brief.register} | ` +
      `Channel: both (${emailCount} email + ${socialCount} social)`
    );
  }
  return (
    `Campaign: ${brief.event} | Theme: ${brief.theme} | ` +
    `Audience: ${brief.audience} | Register: ${brief.register} | ` +
    `Channel: ${brief.channel} | Count: ${total}`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a ContentPackage grounded on the brain files (BRAND-GUIDE.md +
 * brand-voice-pack.md) and this client's brand-config.json for the given
 * campaign brief.
 *
 * The returned package always includes a PreflightResult. If preflight fails,
 * the package is returned with passed=false and the violation list; the
 * generator does NOT suppress or auto-retry.
 *
 * @param brief - Validated campaign brief (use BriefSchema.parse() at the
 *                call site before passing here).
 * @param deps  - Optional injectable dependencies; provide llm in tests.
 * @param opts  - Optional path overrides for brain files / brand-config (useful in tests).
 */
export async function generate(
  brief: Brief,
  deps?: { llm?: LlmClient },
  opts: GenerateOptions = {}
): Promise<ContentPackage> {
  const { brandGuide, brandVoicePack } = await loadBrainFiles(opts);
  const config = await loadBrandConfig(opts.brandConfigPath);

  // Fail loud on an unknown register before spending any LLM calls.
  getRegister(config, brief.register);

  const llm = deps?.llm ?? createProductionLlmClient();

  const pieces: ContentPiece[] = [];
  for (let i = 0; i < brief.count; i++) {
    const piece = await generatePiece(brief, i, brief.count, brandGuide, brandVoicePack, config, llm);
    pieces.push(piece);
  }

  const packageForPreflight: ContentPackage = {
    briefSummary: buildBriefSummary(brief, brief.count),
    register: brief.register,
    channel: brief.channel,
    pieces,
    preflightResult: { passed: true, violations: [] },
  };

  const preflightResult = preflight(packageForPreflight, config);

  return {
    ...packageForPreflight,
    preflightResult,
  };
}
