import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { preflight } from "./index.js";
import { loadBrandConfig } from "../config/brand-config.js";
import type { BrandConfig } from "../config/brand-config.js";
import type { ContentPackage, ContentPiece } from "../types.js";

const fixtureConfigPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test-fixtures",
  "brand-config.json"
);

let config: BrandConfig;

beforeAll(async () => {
  config = await loadBrandConfig(fixtureConfigPath);
});

function pkg(register: string, pieces: ContentPiece[]): ContentPackage {
  return {
    briefSummary: "test",
    register,
    channel: "email",
    pieces,
    preflightResult: { passed: true, violations: [] },
  };
}

function emailPiece(overrides: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "p1",
    type: "email",
    platform: "ghl-email",
    body: "Body text here. {{email.unsubscribe_link}} {{physical_address}}",
    fromName: "Test Co Team",
    fromAddress: "hello@testco.example.com",
    ...overrides,
  };
}

describe("preflight", () => {
  it("passes a clean email piece", () => {
    const result = preflight(pkg("advisor", [emailPiece()]), config);
    expect(result.passed).toBe(true);
  });

  it("throws on an unknown register", () => {
    expect(() => preflight(pkg("unknown-register", [emailPiece()]), config)).toThrow(
      /Unknown register/
    );
  });

  it("flags em dashes and en dashes", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ body: "This is bad — very bad. {{email.unsubscribe_link}} {{physical_address}}" })]),
      config
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.code === "EM_DASH")).toBe(true);
  });

  it("flags a piece generated for one register that contains another register's marker (contamination)", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ body: "LET'S GOOOO get started. {{email.unsubscribe_link}} {{physical_address}}" })]),
      config
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.code === "REGISTER_CONTAMINATION")).toBe(true);
  });

  it("flags a piece with the other register's exclusive domain", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ body: "Join us at testsparkclub.example.com today. {{email.unsubscribe_link}} {{physical_address}}" })]),
      config
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.code === "REGISTER_CONTAMINATION")).toBe(true);
  });

  it("does not flag a register's own markers as contamination", () => {
    const result = preflight(
      pkg("spark", [emailPiece({ body: "LET'S GOOOO get started. {{email.unsubscribe_link}} {{physical_address}}" })]),
      config
    );
    expect(result.violations.some((v) => v.code === "REGISTER_CONTAMINATION")).toBe(false);
  });

  it("flags banned phrases with the configured replacement in the detail", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ body: "Let's touch base soon. {{email.unsubscribe_link}} {{physical_address}}" })]),
      config
    );
    const v = result.violations.find((v) => v.code === "BANNED_PHRASE");
    expect(v).toBeDefined();
    expect(v!.detail).toContain("quick check-in");
  });

  it("flags unconfirmed merge tokens", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ body: "Hi {{contact.company}}. {{email.unsubscribe_link}} {{physical_address}}" })]),
      config
    );
    expect(result.violations.some((v) => v.code === "UNCONFIRMED_MERGE_TOKEN")).toBe(true);
  });

  it("allows the confirmed merge token", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ body: "Hi {{contact.first_name}}. {{email.unsubscribe_link}} {{physical_address}}" })]),
      config
    );
    expect(result.violations.some((v) => v.code === "UNCONFIRMED_MERGE_TOKEN")).toBe(false);
  });

  it("flags a missing CAN-SPAM physical address token on email pieces", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ body: "Body only. {{email.unsubscribe_link}}" })]),
      config
    );
    expect(result.violations.some((v) => v.code === "CAN_SPAM_ADDRESS_MISSING")).toBe(true);
  });

  it("flags a missing unsubscribe link token on email pieces", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ body: "Body only. {{physical_address}}" })]),
      config
    );
    expect(result.violations.some((v) => v.code === "UNSUBSCRIBE_MISSING")).toBe(true);
  });

  it("requires ALL required slots for a minSlotsMatched===requiredSlots.length framework", () => {
    const result = preflight(
      pkg("advisor", [
        emailPiece({
          body: "The Focus Triangle is about priority and boundary. {{email.unsubscribe_link}} {{physical_address}}",
        }),
      ]),
      config
    );
    // "review" is missing -- only 2 of 3 required slots matched.
    expect(result.violations.some((v) => v.code === "FRAMEWORK_INCOMPLETE")).toBe(true);
  });

  it("passes a framework mention once all required slots are present", () => {
    const result = preflight(
      pkg("advisor", [
        emailPiece({
          body:
            "The Focus Triangle: set your priority, hold the boundary, do the review. {{email.unsubscribe_link}} {{physical_address}}",
        }),
      ]),
      config
    );
    expect(result.violations.some((v) => v.code === "FRAMEWORK_INCOMPLETE")).toBe(false);
  });

  it("accepts an 'at least N of M' framework once N slots are matched", () => {
    const result = preflight(
      pkg("advisor", [
        emailPiece({
          body: "The Momentum Loop starts with a plan, then you act. {{email.unsubscribe_link}} {{physical_address}}",
        }),
      ]),
      config
    );
    // plan + act = 2 of 4, minSlotsMatched=2 -> should pass.
    expect(result.violations.some((v) => v.code === "FRAMEWORK_INCOMPLETE")).toBe(false);
  });

  it("emits a warning (not a blocking error) for an unconfirmed numeric stat", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ body: "92% of clients agree. {{email.unsubscribe_link}} {{physical_address}}" })]),
      config
    );
    const stat = result.violations.find((v) => v.code === "UNCONFIRMED_STAT");
    expect(stat).toBeDefined();
    expect(stat!.severity).toBe("warning");
    expect(result.passed).toBe(true);
  });

  it("flags a missing fromName/fromAddress on email pieces", () => {
    const result = preflight(
      pkg("advisor", [emailPiece({ fromName: "", fromAddress: "" })]),
      config
    );
    const violations = result.violations.filter((v) => v.code === "FROM_IDENTITY_MISSING");
    expect(violations).toHaveLength(2);
  });
});
