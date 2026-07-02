import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { generate, BriefSchema } from "./index.js";
import type { LlmClient, GenerateOptions } from "./index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures");

const opts: GenerateOptions = {
  brandGuidePath: join(fixturesDir, "BRAND-GUIDE.md"),
  brandVoicePackPath: join(fixturesDir, "brand-voice-pack.md"),
  brandConfigPath: join(fixturesDir, "brand-config.json"),
};

/** Deterministic stub LLM: returns canned JSON shaped for whichever piece type was requested. */
const stubLlm: LlmClient = {
  async complete(prompt: string): Promise<string> {
    if (prompt.includes("EMAIL BLOCK ORDER")) {
      return JSON.stringify({
        subject: "A clean subject line",
        heroEyebrow: "Free Session",
        heroHeadline: "So Why Are You Still <em>Waiting?</em>",
        heroSub: "It's time.",
        body: "Hi {{contact.first_name}}. Here's the real issue. You can fix it today.",
        truthBlock: "The fix is a system, not willpower.",
        pullQuote: "Momentum is a system you run.",
        ctaLabel: "Get Started",
        ps: "Don't wait on this.",
      });
    }
    return JSON.stringify({ body: "Here's a quick social post about the pivot." });
  },
};

describe("generate", () => {
  it("produces a passing ContentPackage grounded on a fictitious fixture brand, not any real client", async () => {
    const brief = BriefSchema.parse({
      event: "Test Launch",
      theme: "Getting started",
      register: "advisor",
      channel: "email",
      count: 1,
    });

    const pkg = await generate(brief, { llm: stubLlm }, opts);

    expect(pkg.pieces).toHaveLength(1);
    expect(pkg.register).toBe("advisor");
    expect(pkg.preflightResult.passed).toBe(true);
    // Ensure the from-identity fell back to the fixture brand-config, not a hardcoded client.
    expect(pkg.pieces[0]!.fromAddress).toBe("hello@testco.example.com");
  });

  it("round-robins social platforms from the brief instead of an audience-based hardcoded bias", async () => {
    const brief = BriefSchema.parse({
      event: "Test Launch",
      theme: "Getting started",
      register: "spark",
      channel: "social",
      count: 4,
      platforms: ["linkedin", "mastodon"],
    });

    const pkg = await generate(brief, { llm: stubLlm }, opts);

    expect(pkg.pieces.map((p) => p.platform)).toEqual(["linkedin", "mastodon", "linkedin", "mastodon"]);
  });

  it("closes social posts with the brand-config signoffName, not a hardcoded name", async () => {
    const brief = BriefSchema.parse({
      event: "Test Launch",
      theme: "Getting started",
      register: "advisor",
      channel: "social",
      count: 1,
    });

    const pkg = await generate(brief, { llm: stubLlm }, opts);
    expect(pkg.pieces[0]!.body.trimEnd().endsWith("The Test Co Team")).toBe(true);
  });

  it("fails loud when the brief's register is not declared in brand-config.json", async () => {
    const brief = BriefSchema.parse({
      event: "Test Launch",
      theme: "Getting started",
      register: "nonexistent",
      channel: "email",
      count: 1,
    });

    await expect(generate(brief, { llm: stubLlm }, opts)).rejects.toThrow(/Unknown register/);
  });

  it("fails loud when BRAND-GUIDE.md is missing", async () => {
    const brief = BriefSchema.parse({
      event: "Test Launch",
      theme: "Getting started",
      register: "advisor",
      channel: "email",
      count: 1,
    });

    await expect(
      generate(brief, { llm: stubLlm }, { ...opts, brandGuidePath: join(fixturesDir, "does-not-exist.md") })
    ).rejects.toThrow(/Brain file not found/);
  });
});
