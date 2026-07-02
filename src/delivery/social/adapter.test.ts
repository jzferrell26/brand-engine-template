import { describe, it, expect } from "vitest";
import { buildGhlPayload, VIDEO_PLATFORMS } from "./adapter.js";
import type { ContentPiece } from "../../types.js";

function piece(overrides: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "p1",
    type: "social-post",
    platform: "linkedin",
    body: "A post.",
    ...overrides,
  };
}

describe("buildGhlPayload", () => {
  it("always sets status to draft (the publish gate)", () => {
    const payload = buildGhlPayload(piece(), "acct-1", "user-1");
    expect(payload.status).toBe("draft");
  });

  it("accepts a single account id or an array", () => {
    const single = buildGhlPayload(piece(), "acct-1", "user-1");
    expect(single.accountIds).toEqual(["acct-1"]);

    const multi = buildGhlPayload(piece(), ["acct-1", "acct-2"], "user-1");
    expect(multi.accountIds).toEqual(["acct-1", "acct-2"]);
  });

  it("sends an empty media array when the piece has no image", () => {
    const payload = buildGhlPayload(piece(), "acct-1", "user-1");
    expect(payload.media).toEqual([]);
  });

  it("attaches the hosted image when the piece has one", () => {
    const payload = buildGhlPayload(piece({ imageUrl: "https://example.com/img.png" }), "acct-1", "user-1");
    expect(payload.media).toEqual([{ url: "https://example.com/img.png", type: "image" }]);
  });

  it("passes scheduleHint through as a non-binding hint only", () => {
    const payload = buildGhlPayload(piece({ scheduleHint: "2099-01-01T09:00:00.000Z" }), "acct-1", "user-1");
    expect(payload.scheduleDate).toBe("2099-01-01T09:00:00.000Z");
    expect(payload.status).toBe("draft"); // still draft even with a schedule hint
  });
});

describe("VIDEO_PLATFORMS", () => {
  it("routes tiktok and youtube to video-script handling", () => {
    expect(VIDEO_PLATFORMS.has("tiktok")).toBe(true);
    expect(VIDEO_PLATFORMS.has("youtube")).toBe(true);
    expect(VIDEO_PLATFORMS.has("linkedin")).toBe(false);
  });
});
