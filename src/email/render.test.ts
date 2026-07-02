import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { renderEmail } from "./render.js";
import { BrandConfigSchema } from "../config/brand-config.js";
import type { ContentPiece } from "../types.js";

const fixtureConfigPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test-fixtures",
  "brand-config.json"
);

async function loadFixtureConfig() {
  const raw = await readFile(fixtureConfigPath, "utf8");
  return BrandConfigSchema.parse(JSON.parse(raw));
}

function piece(overrides: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "p1",
    type: "email",
    platform: "ghl-email",
    subject: "Hello there",
    body: "First paragraph.\n\nSecond paragraph.",
    ...overrides,
  };
}

describe("renderEmail", () => {
  it("uses this brand's palette and fonts, not a hardcoded design system", async () => {
    const config = await loadFixtureConfig();
    const html = renderEmail(piece(), {}, config);
    expect(html).toContain(config.emailDesignSystem.palette.emphasis);
    expect(html).toContain(config.emailDesignSystem.headingFont);
    expect(html).not.toContain("Cormorant Garamond"); // the original hardcoded font
  });

  it("uses brand-config.brandName in the title and footer copyright, not a hardcoded client name", async () => {
    const config = await loadFixtureConfig();
    const html = renderEmail(piece(), {}, config);
    expect(html).toContain(config.brandName);
    expect(html.match(new RegExp(config.brandName, "g"))?.length).toBeGreaterThanOrEqual(2); // title + footer
  });

  it("always includes the unsubscribe token", async () => {
    const config = await loadFixtureConfig();
    const html = renderEmail(piece(), {}, config);
    expect(html).toContain("{{email.unsubscribe_link}}");
  });

  it("uses the placeholder physical-address token when none is supplied", async () => {
    const config = await loadFixtureConfig();
    const html = renderEmail(piece(), {}, config);
    expect(html).toContain("{{physical_address}}");
  });

  it("renders the real physical address when supplied", async () => {
    const config = await loadFixtureConfig();
    const html = renderEmail(piece(), { physicalAddress: "123 Main St" }, config);
    expect(html).toContain("123 Main St");
  });

  it("escapes plain-text fields to prevent HTML/attribute injection", async () => {
    const config = await loadFixtureConfig();
    const html = renderEmail(
      piece(),
      { pullQuote: '"><script>alert(1)</script>', ctaHref: "javascript:alert(1)" },
      config
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('href="javascript:alert(1)"');
  });

  it("closes the signoff with brand-config.signoffName", async () => {
    const config = await loadFixtureConfig();
    const html = renderEmail(piece(), {}, config);
    expect(html).toContain(config.signoffName);
  });
});
