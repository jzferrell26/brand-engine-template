/**
 * Runway date distribution algorithm.
 *
 * PURE FUNCTION: no API calls, no file I/O, no randomness.
 * Distributes emailCount email dates and socialCount social dates across
 * the runway following the proven escalation shape:
 *
 *   Announcement phase : first ~30% of runway days
 *   Value/teaching     : middle ~40% of runway days
 *   Urgency            : days 3 and 2 before event
 *   Day-before         : two sends (AM and PM, same calendar date)
 *   Day-of             : two sends (early AM and ~1h before, same calendar date)
 *
 * For short runways (<5 days), the algorithm compresses the schedule:
 * it skips the value phase and distributes remaining slots into announcement
 * and urgency only, then preserves day-before and day-of. A warning is
 * attached to the result.
 *
 * The algorithm NEVER duplicates dates within the same channel's output.
 * When emailCount or socialCount exceeds the natural slots available, extra
 * slots are distributed evenly across the announcement and value phases
 * (round-robin from the full runway day list).
 */

import type { EventBrief, RunwayResult, RunwaySlot } from "../types.js";

// ---------------------------------------------------------------------------
// Date helpers (no external deps; Node 22 built-in Date is sufficient)
// ---------------------------------------------------------------------------

/** Parse an ISO date string (YYYY-MM-DD) to a UTC midnight Date. */
function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Format a Date as YYYY-MM-DD (UTC). */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Add N days to a date (returns a new Date). */
function addDays(d: Date, n: number): Date {
  const result = new Date(d.getTime());
  result.setUTCDate(result.getUTCDate() + n);
  return result;
}

/** Return an array of Date objects for every day in [start, end] inclusive. */
function dateRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let current = new Date(start.getTime());
  while (current.getTime() <= end.getTime()) {
    days.push(new Date(current.getTime()));
    current = addDays(current, 1);
  }
  return days;
}

// ---------------------------------------------------------------------------
// Phase allocation
// ---------------------------------------------------------------------------

type Phase = RunwaySlot["phase"];

interface PhaseDay {
  date: string;
  phase: Phase;
}

/**
 * Given the full runway day list (start..eventDate inclusive),
 * assign each day to a phase.
 *
 * Phases in order:
 *   announcement : first 30% of runway days (excluding day-before / day-of)
 *   value        : middle 40% (excluding day-before / day-of)
 *   urgency      : urgency2 (2 days before) + urgency3 (3 days before)
 *   day-before   : 1 day before event
 *   day-of       : event day itself
 *
 * NOTE: "days before" is calendar days in UTC.
 */
function buildPhasedDays(runwayStart: Date, eventDate: Date, shortRunway: boolean): PhaseDay[] {
  const allDays = dateRange(runwayStart, eventDate);
  const n = allDays.length;

  const eventDateStr = formatDate(eventDate);
  const dayBeforeStr = formatDate(addDays(eventDate, -1));
  const urgency2Str = formatDate(addDays(eventDate, -2));
  const urgency3Str = formatDate(addDays(eventDate, -3));

  const result: PhaseDay[] = [];
  const terminalDates = new Set([
    eventDateStr,
    dayBeforeStr,
    urgency2Str,
    ...(n >= 5 ? [urgency3Str] : []),
  ]);

  const flexDays = allDays.map((d) => formatDate(d)).filter((ds) => !terminalDates.has(ds));

  const flexCount = flexDays.length;

  if (shortRunway) {
    for (const ds of flexDays) {
      result.push({ date: ds, phase: "announcement" });
    }
  } else {
    const announcementCount = Math.max(1, Math.round(flexCount * 0.30));
    const announcementDays = flexDays.slice(0, announcementCount);
    const valueDays = flexDays.slice(announcementCount);

    for (const ds of announcementDays) {
      result.push({ date: ds, phase: "announcement" });
    }
    for (const ds of valueDays) {
      result.push({ date: ds, phase: "value" });
    }
  }

  if (n >= 5 && terminalDates.has(urgency3Str)) {
    result.push({ date: urgency3Str, phase: "urgency" });
  }
  if (terminalDates.has(urgency2Str)) {
    result.push({ date: urgency2Str, phase: "urgency" });
  }
  if (terminalDates.has(dayBeforeStr)) {
    result.push({ date: dayBeforeStr, phase: "day-before" });
  }
  result.push({ date: eventDateStr, phase: "day-of" });

  return result;
}

// ---------------------------------------------------------------------------
// Slot selector
// ---------------------------------------------------------------------------

/**
 * Select exactly `count` slots from the phased day list with no duplicate
 * dates. The algorithm:
 *   1. Always include at least one slot per terminal phase (urgency, day-before, day-of).
 *   2. Fill remaining slots from announcement -> value -> urgency in order,
 *      spreading evenly using round-robin when count exceeds unique day count.
 *
 * When count is smaller than the number of phases, priority is:
 *   day-of (2) > day-before (2) > urgency (1+) > announcement (1+) > value (rest)
 */
function selectSlots(phasedDays: PhaseDay[], count: number): RunwaySlot[] {
  const unique = phasedDays.filter((d, i, arr) => arr.findIndex((x) => x.date === d.date) === i);

  if (count <= 0) return [];

  const dayOfDays = unique.filter((d) => d.phase === "day-of");
  const dayBeforeDays = unique.filter((d) => d.phase === "day-before");
  const urgencyDays = unique.filter((d) => d.phase === "urgency");
  const announcementDays = unique.filter((d) => d.phase === "announcement");
  const valueDays = unique.filter((d) => d.phase === "value");

  const selected: RunwaySlot[] = [];
  const usedDates = new Set<string>();

  function addSlot(d: PhaseDay): void {
    if (!usedDates.has(d.date)) {
      usedDates.add(d.date);
      selected.push({ date: d.date, phase: d.phase });
    }
  }

  const dayOfSlots = Math.min(2, count);
  for (let i = 0; i < dayOfSlots && dayOfDays.length > 0; i++) {
    const d = dayOfDays[0]!;
    selected.push({ date: d.date, phase: "day-of" });
    usedDates.add(d.date);
  }

  const dayBeforeSlots = Math.min(2, Math.max(0, count - selected.length));
  for (let i = 0; i < dayBeforeSlots && dayBeforeDays.length > 0; i++) {
    const d = dayBeforeDays[0]!;
    selected.push({ date: d.date, phase: "day-before" });
    usedDates.add(d.date);
  }

  for (const d of urgencyDays) {
    if (selected.length >= count) break;
    addSlot(d);
  }

  const flexPool = [...announcementDays, ...valueDays];
  let flexIdx = 0;
  while (selected.length < count && flexPool.length > 0) {
    const d = flexPool[flexIdx % flexPool.length]!;
    if (!usedDates.has(d.date)) {
      addSlot(d);
    }
    flexIdx++;
    if (flexIdx > flexPool.length * 2 + count) break;
  }

  return selected.slice(0, count);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an EventBrief for date correctness.
 * Returns null on success, or an error object with code + message on failure.
 */
export function validateEventBrief(brief: EventBrief): { code: string; message: string } | null {
  const eventDate = parseDate(brief.eventDate);
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  if (eventDate.getTime() < todayUtc.getTime()) {
    return {
      code: "EVENT_DATE_PAST",
      message: `eventDate "${brief.eventDate}" is in the past. Update the event date before generating a launch kit.`,
    };
  }
  return null;
}

/**
 * Calculate the campaign runway date schedule for an EventBrief.
 *
 * PURE FUNCTION:
 *   - Returns emailSlots.length === emailCount, socialSlots.length === socialCount.
 *   - No date within the same channel appears more than twice (day-of and
 *     day-before are intentional dual-slot dates; all other dates are unique).
 *   - Short runway (<5 days) returns a warning + compressed schedule.
 *
 * NOTE: this function does NOT validate that eventDate is in the future.
 * Call validateEventBrief() separately before calling this.
 */
export function calculateRunway(brief: EventBrief): RunwayResult {
  const runwayStart = parseDate(brief.runwayStartDate);
  const eventDate = parseDate(brief.eventDate);

  const runwayDays =
    Math.round((eventDate.getTime() - runwayStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  const shortRunway = runwayDays < 5;
  const warning = shortRunway
    ? `Runway is only ${runwayDays} day(s). Using compressed schedule: announcement, urgency, day-before, and day-of phases only. Review schedule hints before delivery.`
    : undefined;

  const phasedDays = buildPhasedDays(runwayStart, eventDate, shortRunway);

  const emailSlots = selectSlots(phasedDays, brief.emailCount);
  const socialSlots = selectSlots(phasedDays, brief.socialCount);

  return { emailSlots, socialSlots, warning };
}
