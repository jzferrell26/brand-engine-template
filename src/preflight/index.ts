import type { ContentPackage, ContentPiece, PreflightResult, Violation } from "../types.js";
import type { BrandConfig } from "../config/brand-config.js";
import { getRegister } from "../config/brand-config.js";

// ---------------------------------------------------------------------------
// Violation code constants
// ---------------------------------------------------------------------------

/** U+2014 em dash found in piece text. */
export const CODE_EM_DASH = "EM_DASH" as const;

/** U+2013 en dash found in piece text. */
export const CODE_EN_DASH = "EN_DASH" as const;

/** A piece contains language or a domain reference that belongs to a different register. */
export const CODE_REGISTER_CONTAMINATION = "REGISTER_CONTAMINATION" as const;

/** A phrase from the brand-config banned-phrases list was found. */
export const CODE_BANNED_PHRASE = "BANNED_PHRASE" as const;

/** A merge token was found that is not in the confirmed-tokens list. */
export const CODE_UNCONFIRMED_MERGE_TOKEN = "UNCONFIRMED_MERGE_TOKEN" as const;

/** Email piece is missing the CAN-SPAM physical address token. */
export const CODE_CAN_SPAM_ADDRESS_MISSING = "CAN_SPAM_ADDRESS_MISSING" as const;

/** Email piece is missing the unsubscribe link token. */
export const CODE_UNSUBSCRIBE_MISSING = "UNSUBSCRIBE_MISSING" as const;

/** A piece references a named framework but is missing required framework keywords. */
export const CODE_FRAMEWORK_INCOMPLETE = "FRAMEWORK_INCOMPLETE" as const;

/** A numeric claim or percentage not present in the voice pack (warning severity). */
export const CODE_UNCONFIRMED_STAT = "UNCONFIRMED_STAT" as const;

/** An email piece is missing fromName or fromAddress. */
export const CODE_FROM_IDENTITY_MISSING = "FROM_IDENTITY_MISSING" as const;

// ---------------------------------------------------------------------------
// Static, brand-agnostic constants
// ---------------------------------------------------------------------------

/** Physical address placeholder -- the token the template hydration replaces. */
const PHYSICAL_ADDRESS_TOKEN = "{{physical_address}}";

/** Pattern matching any merge token in the form {{...}} */
const MERGE_TOKEN_PATTERN = /\{\{[^}]+\}\}/g;

/**
 * CAN-SPAM compliance tokens that must be present in email pieces but are
 * NOT personalization merge tokens. They pass the merge-token allowlist check
 * automatically -- they are handled by their own dedicated checks.
 */
const CAN_SPAM_TOKENS: readonly string[] = ["{{physical_address}}"];

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function textFields(piece: ContentPiece): string[] {
  return [piece.body, piece.subject ?? ""].filter(Boolean);
}

function fullText(piece: ContentPiece): string {
  return textFields(piece).join("\n");
}

// ---------------------------------------------------------------------------
// Em/en dash check (U+2014 / U+2013)
// ---------------------------------------------------------------------------

function checkEmDash(piece: ContentPiece): Violation[] {
  const violations: Violation[] = [];
  const text = fullText(piece);
  const pattern = /[–—]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const charCode = text.codePointAt(match.index) ?? 0;
    const isEmDash = charCode === 0x2014;
    const charName = isEmDash ? "em dash (U+2014)" : "en dash (U+2013)";
    violations.push({
      pieceId: piece.id,
      code: isEmDash ? CODE_EM_DASH : CODE_EN_DASH,
      detail: `${charName} at character offset ${match.index}`,
      severity: "error",
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Register contamination (config-driven)
//
// A piece generated for register R fails if it contains a marker or domain
// pattern that belongs to a DIFFERENT declared register. This generalizes a
// two-register "don't let register A's markers/CTAs leak into register B"
// rule into an N-register rule driven entirely by brand-config.json.
// ---------------------------------------------------------------------------

function checkRegisterContamination(piece: ContentPiece, packageRegister: string, config: BrandConfig): Violation[] {
  const violations: Violation[] = [];
  const text = fullText(piece);
  const textLower = text.toLowerCase();

  const otherRegisters = config.registers.filter((r) => r.name !== packageRegister);

  for (const other of otherRegisters) {
    for (const marker of other.markers) {
      if (textLower.includes(marker.toLowerCase())) {
        violations.push({
          pieceId: piece.id,
          code: CODE_REGISTER_CONTAMINATION,
          detail: `"${other.label}" marker "${marker}" found in a "${packageRegister}"-register piece`,
          severity: "error",
        });
      }
    }
    for (const domain of other.domainPatterns) {
      if (textLower.includes(domain.toLowerCase())) {
        violations.push({
          pieceId: piece.id,
          code: CODE_REGISTER_CONTAMINATION,
          detail: `"${other.label}" domain/CTA "${domain}" found in a "${packageRegister}"-register piece`,
          severity: "error",
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Banned phrases (config-driven)
// ---------------------------------------------------------------------------

function checkBannedPhrases(piece: ContentPiece, config: BrandConfig): Violation[] {
  const violations: Violation[] = [];
  const text = fullText(piece);
  const textLower = text.toLowerCase();

  for (const { phrase, replacement } of config.bannedPhrases) {
    if (textLower.includes(phrase.toLowerCase())) {
      violations.push({
        pieceId: piece.id,
        code: CODE_BANNED_PHRASE,
        detail: `Banned phrase "${phrase}" found; use "${replacement}" instead`,
        severity: "error",
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Unconfirmed merge tokens (config-driven allowlist)
// ---------------------------------------------------------------------------

function checkMergeTokens(piece: ContentPiece, config: BrandConfig): Violation[] {
  const violations: Violation[] = [];
  const text = fullText(piece);
  const found = text.match(MERGE_TOKEN_PATTERN) ?? [];

  for (const token of found) {
    if (CAN_SPAM_TOKENS.includes(token)) continue;
    if (!config.confirmedMergeTokens.includes(token)) {
      violations.push({
        pieceId: piece.id,
        code: CODE_UNCONFIRMED_MERGE_TOKEN,
        detail: `"${token}" is not in the confirmed merge token list`,
        severity: "error",
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// CAN-SPAM physical address token (email only)
// ---------------------------------------------------------------------------

function checkCanSpamAddress(piece: ContentPiece): Violation[] {
  if (piece.type !== "email") return [];
  if (!piece.body.includes(PHYSICAL_ADDRESS_TOKEN)) {
    return [
      {
        pieceId: piece.id,
        code: CODE_CAN_SPAM_ADDRESS_MISSING,
        detail: `Email piece is missing the CAN-SPAM physical address token "${PHYSICAL_ADDRESS_TOKEN}"`,
        severity: "error",
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Unsubscribe link token (email only)
// ---------------------------------------------------------------------------

function checkUnsubscribeLink(piece: ContentPiece): Violation[] {
  if (piece.type !== "email") return [];
  if (!piece.body.includes("{{email.unsubscribe_link}}")) {
    return [
      {
        pieceId: piece.id,
        code: CODE_UNSUBSCRIBE_MISSING,
        detail: `Email piece is missing required {{email.unsubscribe_link}} token`,
        severity: "error",
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Named framework fidelity (config-driven; replaces the two hardcoded
// Accountability-Gap / Follow-Up-Gap checks with one generic loop)
// ---------------------------------------------------------------------------

function checkNamedFrameworks(piece: ContentPiece, config: BrandConfig): Violation[] {
  const violations: Violation[] = [];
  const text = fullText(piece);
  const textLower = text.toLowerCase();

  for (const framework of config.namedFrameworks) {
    if (!text.includes(framework.name)) continue;

    const matchedSlots = framework.requiredSlots.filter((variants) =>
      variants.some((v) => textLower.includes(v.toLowerCase()))
    );

    if (matchedSlots.length < framework.minSlotsMatched) {
      violations.push({
        pieceId: piece.id,
        code: CODE_FRAMEWORK_INCOMPLETE,
        detail:
          `"${framework.name}" referenced but only ${matchedSlots.length}/${framework.requiredSlots.length} ` +
          `required components matched (need at least ${framework.minSlotsMatched})`,
        severity: "error",
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Unconfirmed stat (numeric claims / percentages)
//
// Emits a WARNING-severity violation. Warnings do NOT block preflight.
// ---------------------------------------------------------------------------

/**
 * SECURITY (ReDoS): the numeric run is length-bounded ({0,19}) rather than an
 * unbounded `*` to keep the scan strictly linear on adversarial input.
 */
const STAT_PATTERN = /\b\d[\d,.]{0,19}\s*%|\b\d[\d,.]{0,19}\+?\s+[a-zA-Z]/g;

function checkUnconfirmedStat(piece: ContentPiece): Violation[] {
  const violations: Violation[] = [];
  const text = fullText(piece);

  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  STAT_PATTERN.lastIndex = 0;
  while ((match = STAT_PATTERN.exec(text)) !== null) {
    const claim = match[0].trim();
    if (!seen.has(claim)) {
      seen.add(claim);
      violations.push({
        pieceId: piece.id,
        code: CODE_UNCONFIRMED_STAT,
        detail: `Numeric claim "${claim}" at offset ${match.index} is not confirmed in the voice pack; verify before sending`,
        severity: "warning",
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// From-identity check (email pieces must supply fromName + fromAddress)
// ---------------------------------------------------------------------------

function checkFromIdentity(piece: ContentPiece): Violation[] {
  if (piece.type !== "email") return [];
  const violations: Violation[] = [];

  if (!piece.fromName || piece.fromName.trim() === "") {
    violations.push({
      pieceId: piece.id,
      code: CODE_FROM_IDENTITY_MISSING,
      detail: `Email piece is missing required "fromName" field`,
      severity: "error",
    });
  }
  if (!piece.fromAddress || piece.fromAddress.trim() === "") {
    violations.push({
      pieceId: piece.id,
      code: CODE_FROM_IDENTITY_MISSING,
      detail: `Email piece is missing required "fromAddress" field`,
      severity: "error",
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all brand preflight checks against a content package.
 *
 * PURE FUNCTION: no API calls, no file writes, no network. `config` is the
 * caller's already-loaded BrandConfig (see loadBrandConfig in
 * src/config/brand-config.ts) -- this module never reads it from disk itself.
 *
 * Returns a PreflightResult. When passed is false, violations contains one
 * entry per failing check per piece. The delivery layer must treat a
 * passed=false result as a hard block.
 *
 * Throws if pkg.register does not match a register declared in config.
 */
export function preflight(pkg: ContentPackage, config: BrandConfig): PreflightResult {
  // Validate the package's register against the brand config up front so a
  // typo'd register name fails loud instead of silently skipping contamination checks.
  getRegister(config, pkg.register);

  const violations: Violation[] = [];

  for (const piece of pkg.pieces) {
    violations.push(...checkEmDash(piece));
    violations.push(...checkRegisterContamination(piece, pkg.register, config));
    violations.push(...checkBannedPhrases(piece, config));
    violations.push(...checkMergeTokens(piece, config));
    violations.push(...checkCanSpamAddress(piece));
    violations.push(...checkUnsubscribeLink(piece));
    violations.push(...checkNamedFrameworks(piece, config));
    violations.push(...checkUnconfirmedStat(piece));
    violations.push(...checkFromIdentity(piece));
  }

  const hasError = violations.some((v) => v.severity === "error");

  return {
    passed: !hasError,
    violations,
  };
}
