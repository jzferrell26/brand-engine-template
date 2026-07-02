import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { loadBrandConfig, getRegister, BrandConfigSchema } from "./brand-config.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures");
const fixtureConfigPath = join(fixturesDir, "brand-config.json");

describe("loadBrandConfig", () => {
  it("loads and validates a well-formed brand-config.json", async () => {
    const config = await loadBrandConfig(fixtureConfigPath);
    expect(config.brandName).toBe("Test Co");
    expect(config.registers).toHaveLength(2);
  });

  it("fails loud when the file is missing", async () => {
    await expect(loadBrandConfig(join(fixturesDir, "does-not-exist.json"))).rejects.toThrow(
      /Brand config not found/
    );
  });

  it("fails loud with field-level detail when the file is invalid", async () => {
    const invalid = { brandName: "X" }; // missing everything else
    const result = BrandConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("getRegister", () => {
  it("returns the matching register", async () => {
    const config = await loadBrandConfig(fixtureConfigPath);
    const register = getRegister(config, "spark");
    expect(register.label).toBe("Spark Club");
  });

  it("throws with the valid register list when the name is unknown", async () => {
    const config = await loadBrandConfig(fixtureConfigPath);
    expect(() => getRegister(config, "nonexistent")).toThrow(/advisor, spark/);
  });
});
