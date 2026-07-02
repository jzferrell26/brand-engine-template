import type { ContentPiece } from "../types.js";
import type { BrandConfig } from "../config/brand-config.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured email content extracted from a ContentPiece.
 *
 * All fields are drawn from the piece body or operator-supplied values.
 * The renderer maps these 1:1 to the canonical 9-block structure declared by
 * this client's brand-config.emailBlockOrder.
 *
 * Fixed block order (matches the prompt sent to the LLM in src/agent/index.ts):
 *   1. Header (logo)
 *   2. Hero (eyebrow + headline with emphasis + sub)
 *   3. Body
 *   4. Emphasis/truth block (accent color, left border)
 *   5. Pull-quote block
 *   6. CTA button
 *   7. Signoff
 *   8. P.S. block
 *   9. Footer (unsubscribe + physical address)
 */
export interface EmailRenderConfig {
  /**
   * Physical mailing address. Required by CAN-SPAM before any push to GHL.
   * If unset, renderEmail still renders (using the {{physical_address}}
   * token as a placeholder) so drafts can be previewed; the push layer
   * enforces the COMPLIANCE_BLOCK gate.
   */
  physicalAddress?: string;

  // --- Hero block ---
  heroEyebrow?: string;
  /**
   * Full hero headline. Wrap the emphasis portion in <em>...</em>.
   * E.g. "So Why Are You Still<br><em>Chasing the Update?</em>"
   */
  heroHeadline?: string;
  heroSub?: string;

  // --- Content blocks ---
  truthBlock?: string;
  pullQuote?: string;
  /** Attribution line beneath the pull-quote (default: brand-config.brandName). */
  pullQuoteCite?: string;

  // --- CTA ---
  ctaText?: string;
  /** Button label (default: brand-config.emailDesignSystem.defaultCtaLabel). */
  ctaLabel?: string;
  /** Button href (default: "#"). */
  ctaHref?: string;

  // --- P.S. ---
  ps?: string;
}

// ---------------------------------------------------------------------------
// CSS (driven by brand-config.emailDesignSystem)
// ---------------------------------------------------------------------------

function buildCss(config: BrandConfig): string {
  const ds = config.emailDesignSystem;
  const importRule = ds.fontImportUrl ? `@import url('${ds.fontImportUrl}');` : "";
  return `
    ${importRule}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{background-color:${ds.palette.background};font-family:${ds.bodyFont};color:${ds.palette.primary};-webkit-font-smoothing:antialiased;}
    .wrapper{max-width:620px;margin:0 auto;background:#ffffff;}
    .header{background:${ds.palette.primary};padding:28px 40px;text-align:center;}
    .header img{height:44px;}
    .hero{background:${ds.palette.primary};padding:52px 40px 44px;text-align:center;}
    .eyebrow{font-family:${ds.bodyFont};font-size:11px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:${ds.palette.secondary};margin-bottom:12px;}
    .hero h1{font-family:${ds.headingFont};font-size:38px;font-weight:700;color:${ds.palette.background};line-height:1.15;margin-bottom:14px;}
    .hero h1 em{font-style:italic;color:${ds.palette.emphasis};}
    .hero .sub{font-family:${ds.bodyFont};font-size:15px;color:${ds.palette.secondary};line-height:1.6;}
    .body{padding:44px 40px 36px;}
    .body p{font-size:15px;line-height:1.75;color:${ds.palette.primary};margin-bottom:18px;}
    .body p strong{font-weight:600;}
    .truth-block{background:${ds.palette.background};border-left:4px solid ${ds.palette.emphasis};padding:24px 28px;margin:0 40px 36px;}
    .truth-block p{font-family:${ds.headingFont};font-size:22px;font-style:italic;color:${ds.palette.primary};line-height:1.4;}
    .quote-block{background:${ds.palette.accent};padding:32px 40px;margin:0;}
    .quote-block blockquote{font-family:${ds.headingFont};font-size:26px;font-weight:600;font-style:italic;color:${ds.palette.background};line-height:1.35;text-align:center;}
    .quote-block cite{display:block;font-family:${ds.bodyFont};font-size:12px;font-weight:500;letter-spacing:0.15em;text-transform:uppercase;color:${ds.palette.background};opacity:0.7;text-align:center;margin-top:14px;}
    .cta-section{padding:40px 40px;text-align:center;}
    .cta-section p{font-size:15px;line-height:1.75;color:${ds.palette.primary};margin-bottom:24px;}
    .btn{display:inline-block;background:${ds.palette.accent};color:#ffffff;font-family:${ds.bodyFont};font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;text-decoration:none;padding:16px 36px;border-radius:3px;}
    .signoff{padding:0 40px 36px;}
    .signoff p{font-size:15px;line-height:1.75;color:${ds.palette.primary};margin-bottom:6px;}
    .ps-block{background:${ds.palette.background};padding:28px 40px;border-top:1px solid #e8e3dc;}
    .ps-block p{font-size:14px;line-height:1.7;color:${ds.palette.accent};}
    .ps-block p strong{color:${ds.palette.primary};}
    .footer{background:${ds.palette.primary};padding:28px 40px;text-align:center;}
    .footer p{font-family:${ds.bodyFont};font-size:12px;color:${ds.palette.secondary};line-height:1.7;}
    .footer a{color:${ds.palette.secondary};text-decoration:underline;}
  `.trim();
}

// ---------------------------------------------------------------------------
// Escaping helpers
//
// Some render fields are contractually HTML-bearing (heroHeadline carries
// <br>/<em>, truthBlock/ctaText/ps/body may carry inline <strong>/<a>). Those
// are intentionally NOT escaped. The fields below are documented as PLAIN TEXT
// (heroEyebrow, heroSub, pullQuote, pullQuoteCite, ctaLabel) or land in an HTML
// ATTRIBUTE context (ctaHref). Interpolating untrusted/LLM-derived text into
// those positions unescaped allows attribute breakout and javascript: URIs, so
// they are escaped here. This is defense-in-depth: the output is a draft email
// template the operator reviews in GHL before any send, but escaping the
// plain-text positions costs nothing and closes the injection vector.
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitize a CTA href: escape it for attribute context and neutralize any
 * non-http(s)/mailto scheme (e.g. javascript:, data:) by falling back to "#".
 */
function safeHref(href: string): string {
  const trimmed = href.trim();
  const allowed =
    /^https?:\/\//i.test(trimmed) ||
    /^mailto:/i.test(trimmed) ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("{{");
  const value = allowed ? trimmed : "#";
  return escapeHtml(value);
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function buildHeader(config: BrandConfig): string {
  const ds = config.emailDesignSystem;
  return `
  <!-- HEADER -->
  <div class="header">
    <img src="${ds.logoUrl}" alt="${escapeHtml(ds.logoAlt)}" />
  </div>`.trimStart();
}

function buildHero(cfg: EmailRenderConfig): string {
  const eyebrow = cfg.heroEyebrow ? escapeHtml(cfg.heroEyebrow) : "";
  const headline = cfg.heroHeadline ?? "";
  const sub = cfg.heroSub ? escapeHtml(cfg.heroSub) : "";
  return `
  <!-- HERO -->
  <div class="hero">
    ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}
    <h1>${headline}</h1>
    ${sub ? `<p class="sub">${sub}</p>` : ""}
  </div>`.trimStart();
}

function buildBody(piece: ContentPiece): string {
  const paragraphs = piece.body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `    <p>${p}</p>`)
    .join("\n");
  return `
  <!-- BODY -->
  <div class="body">
${paragraphs}
  </div>`.trimStart();
}

function buildTruthBlock(cfg: EmailRenderConfig): string {
  const content = cfg.truthBlock ?? "";
  return `
  <!-- EMPHASIS BLOCK -->
  <div class="truth-block">
    <p>${content}</p>
  </div>`.trimStart();
}

function buildPullQuote(cfg: EmailRenderConfig, config: BrandConfig): string {
  const quote = escapeHtml(cfg.pullQuote ?? "");
  const cite = escapeHtml(cfg.pullQuoteCite ?? config.brandName);
  return `
  <!-- QUOTE BLOCK -->
  <div class="quote-block">
    <blockquote>"${quote}"</blockquote>
    <cite>${cite}</cite>
  </div>`.trimStart();
}

function buildCta(cfg: EmailRenderConfig, config: BrandConfig): string {
  const ctaText = cfg.ctaText ?? "";
  const label = escapeHtml(cfg.ctaLabel ?? config.emailDesignSystem.defaultCtaLabel);
  const href = safeHref(cfg.ctaHref ?? "#");
  return `
  <!-- CTA SECTION -->
  <div class="cta-section">
    ${ctaText ? `<p>${ctaText}</p>` : ""}
    <a href="${href}" class="btn">${label}</a>
  </div>`.trimStart();
}

function buildSignoff(config: BrandConfig): string {
  return `
  <!-- SIGNOFF -->
  <div class="signoff">
    <p><strong>${escapeHtml(config.signoffName)}</strong></p>
  </div>`.trimStart();
}

function buildPs(cfg: EmailRenderConfig): string {
  const ps = cfg.ps ?? "";
  return `
  <!-- P.S. -->
  <div class="ps-block">
    <p><strong>P.S.</strong> ${ps}</p>
  </div>`.trimStart();
}

function buildFooter(cfg: EmailRenderConfig, config: BrandConfig): string {
  const address = cfg.physicalAddress ?? "{{physical_address}}";
  const note = config.emailDesignSystem.footerNote ?? `You're receiving this because you're subscribed to updates from ${config.brandName}.`;
  return `
  <!-- FOOTER -->
  <div class="footer">
    <p>&copy; ${new Date().getFullYear()} ${escapeHtml(config.brandName)}. All rights reserved.<br />
    ${escapeHtml(note)}<br />
    ${address}<br />
    <a href="{{email.unsubscribe_link}}">Unsubscribe</a></p>
  </div>`.trimStart();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a single email ContentPiece into a fully-formed 620px HTML string
 * using this client's brand-config email design system and block structure.
 *
 * Footer always contains:
 *   - {{email.unsubscribe_link}} (GHL merge token)
 *   - {{physical_address}} when physicalAddress is unset, or the real address
 *     when the operator has supplied it
 *
 * {{contact.first_name}} is the ONLY personalization token the renderer may
 * introduce; it never adds other {{...}} tokens itself.
 *
 * The renderer does NOT block on a missing physicalAddress; that compliance
 * gate lives in pushEmail so draft previews remain possible.
 *
 * @param piece  - An email ContentPiece (piece.type === "email").
 * @param cfg    - Operator-supplied config and structured email fields.
 * @param config - This client's loaded BrandConfig.
 * @returns      - Full HTML string ready for editorContent in the GHL v3 API.
 */
export function renderEmail(
  piece: ContentPiece,
  cfg: EmailRenderConfig & { physicalAddress?: string },
  config: BrandConfig
): string {
  const blocks = [
    buildHeader(config),
    buildHero(cfg),
    buildBody(piece),
    buildTruthBlock(cfg),
    buildPullQuote(cfg, config),
    buildCta(cfg, config),
    buildSignoff(config),
    buildPs(cfg),
    buildFooter(cfg, config),
  ].join("\n\n");

  const subject = piece.subject ?? "";
  const titleEscaped = subject
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${titleEscaped ? `${titleEscaped} | ${config.brandName}` : config.brandName}</title>
  <style>
    ${buildCss(config)}
  </style>
</head>
<body>
<div class="wrapper">

${blocks}

</div>
</body>
</html>`;
}
