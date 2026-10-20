import assert from "node:assert/strict";
import { test } from "node:test";
import { Timestamp } from "firebase/firestore";
import { loadTypescript } from "./load-typescript.mjs";

const { suggestPunchDates, validateCorrectionTimes } = loadTypescript("src/lib/workday-correction.ts");
const { validateShiftSequence, shiftTotals } = loadTypescript("functions/src/workday-state.ts");
const fields = ["clockInAt", "breakStartAt", "breakEndAt", "clockOutAt"];
const inputs = values => Object.fromEntries(fields.map((field, i) => [field, values[i] ?? ""]));
const example = inputs(["2026-10-18T09:21", "2026-10-18T17:37", "2026-10-18T18:45", "2026-10-18T01:28"]);

test("real example requires explicit date confirmation and calculates 899 minutes", () => {
  const before = { ...example };
  assert.throws(() => validateCorrectionTimes({}, example), /posterior/);
  const proposed = suggestPunchDates(example);
  assert.deepEqual(example, before, "Showing a suggestion must not change the form");
  assert.equal(proposed.clockOutAt, "2026-10-19T01:28");
  const result = validateCorrectionTimes({}, proposed);
  assert.equal(result.totalWorkedMinutes, 899);
  assert.equal(result.totalBreakMinutes, 68);
  assert.equal(result.status, "finished");
  assert.equal(result.times.clockOutAt, Date.parse("2026-10-19T01:28:00-03:00"));
  const shift = Object.fromEntries(fields.map(field => [field, Timestamp.fromMillis(result.times[field])]));
  assert.equal(shiftTotals(shift).totalWorkedMinutes, 899);
});

test("already dated overnight and same-day records do not get new dates", () => {
  for (const values of [
    ["2026-10-18T09:21", "2026-10-18T17:37", "2026-10-18T18:45", "2026-10-19T01:28"],
    ["2026-10-18T08:00", "2026-10-18T12:00", "2026-10-18T13:00", "2026-10-18T17:00"],
  ]) {
    assert.equal(suggestPunchDates(inputs(values)), undefined);
    assert.equal(validateCorrectionTimes({}, inputs(values)).status, "finished");
  }
});

test("date proposals propagate through a midnight break in chronological order", () => {
  const proposed = suggestPunchDates(inputs(["2026-12-31T20:00", "2026-12-31T23:30", "2026-12-31T00:30", "2026-12-31T04:00"]));
  assert.equal(proposed.breakEndAt, "2027-01-01T00:30");
  assert.equal(proposed.clockOutAt, "2027-01-01T04:00");
  const result = validateCorrectionTimes({}, proposed);
  assert.equal(result.totalWorkedMinutes, 420);
  assert.equal(result.totalBreakMinutes, 60);
});

test("one, two and three punches remain open and only count completed work periods", () => {
  for (let count = 1; count < 4; count++) {
    const result = validateCorrectionTimes({}, inputs(Object.values(example).slice(0, count)));
    assert.equal(result.totalWorkedMinutes, count > 1 ? 496 : 0);
    assert.equal(result.totalBreakMinutes, count > 2 ? 68 : 0);
    assert.equal(result.status, count === 2 ? "on_break" : "working");
    assert.equal(result.times.clockOutAt, null);
  }
});

test("invalid dates, skipped stages and equal timestamps are rejected without rollover", () => {
  for (const values of [
    ["2026-02-30T09:00"],
    ["2026-10-18T25:00"],
    ["2026-10-18T09:21", "", "2026-10-18T18:45"],
    ["2026-10-18T09:21", "2026-10-18T09:21"],
    ["2026-10-18T09:21", "", "", "2026-10-19T01:28"],
  ]) {
    assert.throws(() => validateCorrectionTimes({}, inputs(values)));
    assert.equal(suggestPunchDates(inputs(values)), undefined);
  }
  assert.throws(() => validateShiftSequence({ clockInAt: { toMillis: () => NaN } }));
});

test("an earlier time may be a typo: no automatic correction is applied on save", () => {
  const typed = inputs(["2026-10-18T09:21", "2026-10-18T08:37"]);
  assert.ok(suggestPunchDates(typed));
  assert.throws(() => validateCorrectionTimes({}, typed), /posterior/);
});

test("untouched saved timestamps retain seconds and milliseconds", () => {
  const original = { clockInAt: Timestamp.fromDate(new Date("2026-10-18T09:21:38.123-03:00")) };
  const result = validateCorrectionTimes(original, inputs(["2026-10-18T09:21"]));
  assert.equal(result.times.clockInAt, original.clockInAt.toMillis());
});
