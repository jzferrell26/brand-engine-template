import { describe, it, expect } from "vitest";
import { calculateRunway, validateEventBrief } from "./runway.js";
import type { EventBrief } from "../types.js";

function brief(overrides: Partial<EventBrief> = {}): EventBrief {
  return {
    event: "Test Launch",
    theme: "Getting started",
    audience: "general",
    register: "advisor",
    eventDate: "2099-01-20",
    eventTime: "10:00",
    timezone: "America/Denver",
    runwayStartDate: "2099-01-08",
    emailCount: 8,
    socialCount: 8,
    platforms: ["linkedin", "facebook"],
    ...overrides,
  };
}

describe("validateEventBrief", () => {
  it("returns null for a future event date", () => {
    expect(validateEventBrief(brief())).toBeNull();
  });

  it("returns EVENT_DATE_PAST for a past event date", () => {
    const result = validateEventBrief(brief({ eventDate: "2020-01-01", runwayStartDate: "2019-12-20" }));
    expect(result?.code).toBe("EVENT_DATE_PAST");
  });
});

describe("calculateRunway", () => {
  it("returns exactly emailCount and socialCount slots for a normal runway", () => {
    const result = calculateRunway(brief());
    expect(result.emailSlots).toHaveLength(8);
    expect(result.socialSlots).toHaveLength(8);
    expect(result.warning).toBeUndefined();
  });

  it("returns a warning and compressed schedule for a short runway", () => {
    const result = calculateRunway(
      brief({ runwayStartDate: "2099-01-18", eventDate: "2099-01-20", emailCount: 6, socialCount: 6 })
    );
    expect(result.warning).toMatch(/compressed schedule/);
  });

  it("always includes a day-of slot on the event date itself", () => {
    const result = calculateRunway(brief());
    const dayOf = result.emailSlots.filter((s) => s.phase === "day-of");
    expect(dayOf.length).toBeGreaterThan(0);
    expect(dayOf.every((s) => s.date === "2099-01-20")).toBe(true);
  });
});
