import assert from "node:assert/strict";
import { test } from "node:test";
import { Timestamp } from "firebase/firestore";
import { loadTypescript } from "./load-typescript.mjs";

const state = loadTypescript("functions/src/workday-state.ts");
const at = value => Timestamp.fromDate(new Date(value));
const shift = values => Object.fromEntries(values.map((value, index) => [state.punchFields[index], at(value)]));

test("the four stages depend on punches, including incomplete legacy statuses", () => {
  assert.equal(state.expectedPunch(), "clock_in");
  for (let count = 1; count <= 3; count++) {
    const row = shift(Array.from({ length: count }, (_, i) => `2026-10-20T${18 + i}:00:00-03:00`));
    row.status = "finished"; // Incorrect legacy status cannot unlock a second shift.
    assert.equal(state.isOpenShift(row), true);
    assert.equal(state.expectedPunch(row), state.punchTypes[count]);
  }
  assert.equal(state.expectedPunch({ status: "day_off" }), null);
  assert.equal(state.expectedPunch({ clockInAt: at("2026-10-20T18:00:00-03:00"), breakEndAt: at("2026-10-20T20:00:00-03:00") }), null);
});

test("same-day, overnight and midnight breaks retain actual elapsed time", () => {
  for (const values of [
    ["2026-10-20T08:00:00-03:00", "2026-10-20T12:00:00-03:00", "2026-10-20T13:00:00-03:00", "2026-10-20T16:00:00-03:00"],
    ["2026-10-20T18:00:00-03:00", "2026-10-20T22:00:00-03:00", "2026-10-20T23:00:00-03:00", "2026-10-21T02:00:00-03:00"],
    ["2026-10-31T20:00:00-03:00", "2026-10-31T23:30:00-03:00", "2026-11-01T00:30:00-03:00", "2026-11-01T04:00:00-03:00"],
  ]) {
    const row = shift(values);
    assert.equal(state.shiftTotals(row).totalWorkedMinutes, 420);
    assert.equal(state.shiftTotals(row).totalBreakMinutes, 60);
    assert.equal(state.isOpenShift(row), false);
    assert.equal(state.expectedPunch(row), null);
    assert.equal(state.shiftDate(row.clockInAt.toDate()), values[0].slice(0, 10));
  }
});

test("refresh selects an open shift from any date and permits entry after completion", async () => {
  let rows = [];
  const clientWorkday = loadTypescript("src/lib/workday.ts", {
    "./firebase": { auth: {}, db: {} },
    "./utils": { randomToken: () => "request" },
    "firebase/firestore": {
      Timestamp, collection: () => ({}), query: () => ({}), where: () => ({}),
      getDocsFromServer: async () => ({ docs: rows.map(row => ({ id: row.id, data: () => row })) }),
    },
  }, { fetch: async () => ({ ok: true, json: async () => ({ date: "2026-10-21" }) }) });
  for (let count = 1; count <= 3; count++) {
    rows = [{ id: "original", date: "2026-10-20", ...shift(Array.from({ length: count }, (_, i) => `2026-10-20T${18 + i}:00:00-03:00`)) }];
    const selected = await clientWorkday.getWorkday("employee", "company");
    assert.equal(selected.id, "original");
    assert.equal(clientWorkday.nextEvent(selected), state.punchTypes[count]);
  }
  rows[0].clockOutAt = at("2026-10-21T02:00:00-03:00");
  assert.equal(clientWorkday.nextEvent(await clientWorkday.getWorkday("employee", "company")), "clock_in");
  rows = [{ id: "a", clockInAt: at("2026-10-20T18:00:00-03:00") }, { id: "b", clockInAt: at("2026-10-21T18:00:00-03:00") }];
  await assert.rejects(clientWorkday.getWorkday("employee", "company"), /turno aberto/);
});

test("cross-date labels preserve the full date in the official timezone", () => {
  const { punchTimeText } = loadTypescript("src/lib/punch-time.ts");
  assert.equal(punchTimeText(at("2026-10-21T02:00:00-03:00"), "2026-10-20"), "21/10/2026 02:00");
});

test("correction dates use São Paulo including historical daylight saving and reject invalid dates", () => {
  const { parsePunchDateTime } = loadTypescript("src/lib/punch-time.ts");
  assert.equal(parsePunchDateTime("2026-10-21T02:00").toISOString(), "2026-10-21T05:00:00.000Z");
  assert.equal(parsePunchDateTime("2018-12-20T02:00").toISOString(), "2018-12-20T04:00:00.000Z");
  assert.throws(() => parsePunchDateTime("2026-02-30T02:00"));
  assert.throws(() => parsePunchDateTime("2018-11-04T00:30"));
});

test("reports keep overnight hours on the opening date and do not count two same-day shifts as two days", () => {
  const { summarizeWorkdays } = loadTypescript("src/lib/workday-summary.ts");
  const rows = [
    { userId: "employee", date: "2026-10-31", status: "finished", totalWorkedMinutes: 420, totalBreakMinutes: 60 },
    { userId: "employee", date: "2026-10-31", status: "finished", totalWorkedMinutes: 120, totalBreakMinutes: 15 },
    { userId: "employee", date: "2026-11-01", status: "finished", totalWorkedMinutes: 480, totalBreakMinutes: 60 },
  ];
  const october = summarizeWorkdays(rows.filter(row => row.date.startsWith("2026-10")))[0][1];
  assert.equal(october.worked, 540);
  assert.equal(october.breaks, 75);
  assert.equal(october.days, 1);
  assert.equal(Math.max(0, october.worked - october.days * 480), 60);
});
