import { punchFields, validateShiftSequence, type Shift } from "../../functions/src/workday-state";
import { parsePunchDateTime, punchDateTimeInput } from "./punch-time";

export type PunchTimeField = typeof punchFields[number];
export type PunchTimes = Record<PunchTimeField, string>;
type OriginalTimes = Partial<Record<PunchTimeField, { toDate(): Date; toMillis(): number }>>;

export function validateCorrectionTimes(original: OriginalTimes, inputs: PunchTimes) {
  const times = {} as Record<PunchTimeField, number | null>;
  const shift: Shift = {};
  for (const field of punchFields) {
    const value = inputs[field];
    const saved = original[field];
    const millis = !value ? null : saved && punchDateTimeInput(saved.toDate()) === value
      ? saved.toMillis()
      : parsePunchDateTime(value).getTime();
    times[field] = millis;
    if (millis !== null) shift[field] = { toMillis: () => millis };
  }
  return { times, ...validateShiftSequence(shift) };
}

// This is a proposal only. The caller must show the dates and require a click
// before replacing any field; neither validation nor persistence applies it.
export function suggestPunchDates(inputs: PunchTimes): PunchTimes | undefined {
  const proposal = { ...inputs };
  let previous: Date | undefined;
  let changed = false;
  let missing = false;
  try {
    for (const field of punchFields) {
      if (!proposal[field]) { missing = true; continue; }
      if (missing) return undefined;
      let current = parsePunchDateTime(proposal[field]);
      if (previous && current.getTime() === previous.getTime()) return undefined;
      if (previous && current < previous) {
        const previousDate = punchDateTimeInput(previous).slice(0, 10);
        const time = proposal[field].slice(11);
        let candidate = `${previousDate}T${time}`;
        current = parsePunchDateTime(candidate);
        if (current <= previous) {
          // Advance the calendar date, then resolve its actual timezone offset.
          const calendar = new Date(`${previousDate}T12:00:00Z`);
          calendar.setUTCDate(calendar.getUTCDate() + 1);
          candidate = `${calendar.toISOString().slice(0, 10)}T${time}`;
          current = parsePunchDateTime(candidate);
        }
        proposal[field] = candidate;
        changed = true;
      }
      previous = current;
    }
    return changed ? proposal : undefined;
  } catch {
    return undefined;
  }
}
