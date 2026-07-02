/**
 * Pure adapter: converts a ContentPiece into a GHL Social Planner payload.
 * No I/O inside this module.
 */

import type { ContentPiece } from "../../types.js";
import type { GhlPostPayload } from "./schema.js";
import { VIDEO_PLATFORMS } from "../../types.js";

export { VIDEO_PLATFORMS };

/**
 * Build the GHL Social Planner API payload for a single ContentPiece.
 *
 * Pure function: input is (piece, account ids) -> output is the GHL API
 * payload. No I/O, no side effects.
 *
 * PUBLISH-GATE INVARIANT: the engine ONLY ever creates posts with status
 * "draft". It NEVER creates "scheduled" / "published" / "active". A "scheduled"
 * post auto-publishes at its scheduleDate WITHOUT human approval (the GHL
 * approver/userId field does not hold a post for approval, it just schedules
 * it). So scheduled is treated as a publish and forbidden. The operator
 * reviews each draft in the Social Planner and schedules/publishes it
 * themself; that is the approval gate.
 */
export function buildGhlPayload(
  piece: ContentPiece,
  account: string | string[],
  ownerUserId: string,
): GhlPostPayload {
  // Accept a single account id or several (one post -> multiple platforms).
  const accountIds = Array.isArray(account) ? account : [account];

  const payload: GhlPostPayload = {
    accountIds,
    summary: piece.body,
    // GHL rejects the post (422) unless `media` is present. Attach the hosted
    // image when the piece has one; otherwise send an empty array.
    media: piece.imageUrl ? [{ url: piece.imageUrl, type: "image" }] : [],
    type: "post",
    // Always a draft. Never auto-publishing. This is the publish gate.
    status: "draft",
    // GHL requires a userId (the post owner). Without it the API returns 422.
    userId: ownerUserId,
  };

  // scheduleDate is a non-binding hint for the operator (the planned slot
  // shown in the planner). A draft does NOT publish at this date; only the
  // operator can publish.
  if (piece.scheduleHint) {
    payload.scheduleDate = piece.scheduleHint;
  }

  return payload;
}
