import assert from "node:assert/strict";
import * as firestore from "firebase-admin/firestore";
import { loadTypescript } from "./load-typescript.mjs";

export async function testOvernight({ db, companyId, api, admin, employee, check }) {
  let now;
  const { savePunch: executePunch } = loadTypescript("functions/src/punch-service.ts");
  const savePunch = (...args) => executePunch(...args, {
    FieldValue: firestore.FieldValue,
    Timestamp: { now: () => firestore.Timestamp.fromMillis(now), fromMillis: firestore.Timestamp.fromMillis },
  });
  const base = { companyId, qrCodeId: "test-qr", latitude: -23.5, longitude: -46.6, accuracy: 5, clientTimestamp: Date.now(), userAgent: "Overnight QA" };
  let serial = 0;
  async function person() {
    const uid = `overnight-${++serial}`;
    await db.doc(`users/${uid}`).set({ companyId, active: true, role: "employee", name: uid });
    return uid;
  }
  const types = ["clock_in", "break_start", "break_end", "clock_out"];
  await check("real transactions preserve overnight shifts and exact timestamps, including month boundaries", async () => {
    for (const times of [
      ["2026-10-20T08:00:00-03:00", "2026-10-20T12:00:00-03:00", "2026-10-20T13:00:00-03:00", "2026-10-20T16:00:00-03:00"],
      ["2026-10-20T18:00:00-03:00", "2026-10-20T22:00:00-03:00", "2026-10-20T23:00:00-03:00", "2026-10-21T02:00:00-03:00"],
      ["2026-10-31T20:00:00-03:00", "2026-10-31T23:30:00-03:00", "2026-11-01T00:30:00-03:00", "2026-11-01T04:00:00-03:00"],
      ["2026-12-31T23:30:00-03:00", "2027-01-01T02:00:00-03:00", "2027-01-01T03:00:00-03:00", "2027-01-01T07:30:00-03:00"],
    ]) {
      const uid = await person();
      let id = null;
      for (let i = 0; i < 4; i++) {
        now = Date.parse(times[i]);
        const result = await savePunch(db, uid, { ...base, type: types[i], expectedWorkdayId: id, requestId: `${uid}-request-${i}` }, 0);
        if (id) assert.equal(result.workdayId, id);
        id = result.workdayId;
        assert.equal(result.workdayDate, times[0].slice(0, 10));
        assert.equal(result.officialTimestampMillis, now);
        // Fresh database reads simulate losing all in-memory state between stages.
        const saved = (await db.doc(`workdays/${id}`).get()).data();
        assert.equal(saved[["clockInAt", "breakStartAt", "breakEndAt", "clockOutAt"][i]].toMillis(), now);
      }
      const ref = db.doc(`workdays/${id}`);
      assert.equal((await ref.get()).get("totalWorkedMinutes"), 420);
      assert.equal((await ref.get()).get("totalBreakMinutes"), 60);
      assert.equal((await ref.collection("events").get()).size, 4);
      const next = await savePunch(db, uid, { ...base, type: "clock_in", expectedWorkdayId: null, requestId: `${uid}-next-shift` }, 0);
      assert.notEqual(next.workdayId, id);
      assert.equal((await db.collection("workdays").where("userId", "==", uid).get()).size, 2);
      const retried = await savePunch(db, uid, { ...base, type: "clock_out", expectedWorkdayId: id, requestId: `${uid}-request-3` }, 0);
      assert.equal(retried.workdayId, id);
      assert.equal((await ref.collection("events").get()).size, 4);
    }
  });
  await check("concurrent first punches and retries produce one shift and one event", async () => {
    const uid = await person();
    now = Date.parse("2026-10-20T23:59:59-03:00");
    const responses = await Promise.allSettled([1, 2].map(i => savePunch(db, uid, {
      ...base, type: "clock_in", expectedWorkdayId: null, requestId: `concurrent-first-${i}`,
    }, 0)));
    assert.equal(responses.filter(x => x.status === "fulfilled").length, 1);
    const days = await db.collection("workdays").where("userId", "==", uid).get();
    assert.equal(days.size, 1);
    now = Date.parse("2026-10-21T00:01:00-03:00");
    const request = { ...base, type: "break_start", expectedWorkdayId: days.docs[0].id, requestId: "identical-retry-12345" };
    const retries = await Promise.all([savePunch(db, uid, request, 0), savePunch(db, uid, request, 0)]);
    assert.equal(retries[0].officialTimestampMillis, retries[1].officialTimestampMillis);
    assert.equal((await days.docs[0].ref.collection("events").get()).size, 2);
  });
  await check("legacy open records keep their identifier and conflicting historical records are untouched", async () => {
    const uid = await person();
    const id = `${companyId}_${uid}_2026-10-19`;
    const original = { companyId, userId: uid, date: "2026-10-19", clockInAt: firestore.Timestamp.fromDate(new Date("2026-10-19T18:00:00-03:00")), status: "working" };
    await db.doc(`workdays/${id}`).set(original);
    now = Date.parse("2026-10-21T01:00:00-03:00");
    const result = await savePunch(db, uid, { ...base, type: "break_start", expectedWorkdayId: id }, 0);
    assert.equal(result.workdayId, id);
    assert.equal((await db.doc(`workdays/${id}`).get()).get("clockInAt").toMillis(), original.clockInAt.toMillis());
    await db.doc(`workdays/conflict-${uid}`).set(original);
    await assert.rejects(savePunch(db, uid, { ...base, type: "break_end" }, 0), /turno aberto/);
    assert.equal((await db.doc(`workdays/${id}`).collection("events").get()).size, 1);
  });
  await check("audited corrections preserve overnight dates and reject reopening a second shift", async () => {
    const uid = await person();
    const start = firestore.Timestamp.fromDate(new Date("2026-10-20T18:00:00-03:00"));
    await db.doc("workdays/correction-overnight").set({ companyId, userId: uid, date: "2026-10-20", clockInAt: start, status: "working" });
    const times = Object.fromEntries(["clockInAt", "breakStartAt", "breakEndAt", "clockOutAt"].map((field, i) => [
      field, Date.parse(["2026-10-20T18:00:00-03:00", "2026-10-20T22:00:00-03:00", "2026-10-20T23:00:00-03:00", "2026-10-21T02:00:00-03:00"][i]),
    ]));
    const request = { mode: "active", times, minutes: 420, reason: "Overnight correction", expectedUpdatedAt: null };
    assert.equal((await api("/api/admin/registros/correction-overnight", employee.token, "PATCH", request)).status, 403);
    const corrected = await api("/api/admin/registros/correction-overnight", admin.token, "PATCH", request);
    assert.equal(corrected.status, 200, JSON.stringify(corrected));
    const saved = (await db.doc("workdays/correction-overnight").get()).data();
    assert.equal(saved.clockOutAt.toMillis(), times.clockOutAt);
    assert.equal(saved.totalBreakMinutes, 60);
    assert.equal((await api("/api/admin/registros/correction-overnight", admin.token, "PATCH", request)).status, 409);
    now = Date.parse("2026-10-21T18:00:00-03:00");
    await savePunch(db, uid, { ...base, type: "clock_in" }, 0);
    const reopen = await api("/api/admin/registros/correction-overnight", admin.token, "PATCH", {
      ...request, times: { clockInAt: times.clockInAt }, expectedUpdatedAt: saved.updatedAt.toMillis(),
    });
    assert.equal(reopen.status, 409);
  });
  await check("editing the real overnight example rejects wrong dates and persists 899 minutes computed by the server", async () => {
    const uid = await person();
    const ref = db.doc("workdays/real-edit-example");
    const timestamps = ["2026-10-18T09:21:00-03:00", "2026-10-18T17:37:00-03:00", "2026-10-18T18:45:00-03:00", "2026-10-19T01:28:00-03:00"].map(Date.parse);
    const fields = ["clockInAt", "breakStartAt", "breakEndAt", "clockOutAt"];
    const times = Object.fromEntries(fields.map((field, i) => [field, timestamps[i]]));
    await ref.set({ companyId, userId: uid, date: "2026-10-18", status: "working", clockInAt: firestore.Timestamp.fromMillis(times.clockInAt) });
    const request = { mode: "active", reason: "Confirm overnight dates", times, minutes: 99999, expectedUpdatedAt: null };
    const path = "/api/admin/registros/real-edit-example";
    for (const invalid of [
      { ...times, clockOutAt: Date.parse("2026-10-18T01:28:00-03:00") },
      { ...times, breakStartAt: null },
      { ...times, breakStartAt: times.clockInAt },
      { ...times, clockOutAt: "01:28" },
      { ...times, clockOutAt: 1e16 },
    ]) {
      const response = await api(path, admin.token, "PATCH", { ...request, times: invalid });
      assert.equal(response.status, 400, JSON.stringify(response));
      assert.equal((await ref.get()).get("status"), "working");
    }
    assert.equal((await api(path, admin.token, "PATCH", request)).status, 200);
    const saved = (await ref.get()).data();
    assert.equal(saved.totalWorkedMinutes, 899);
    assert.equal(saved.totalBreakMinutes, 68);
    assert.equal(saved.clockOutAt.toMillis(), times.clockOutAt);
    assert.equal(saved.date, "2026-10-18");
    assert.equal(saved.status, "finished");
    assert.equal(saved.timeZone, "America/Sao_Paulo");
    const audit = (await db.doc(`auditLogs/${saved.correctionAuditId}`).get()).data();
    assert.equal(audit.after.totalWorkedMinutes, 899);
    assert.equal(audit.before.status, "working");
    // Even an explicit correction of the entry date must retain the original grouping.
    const moved = Object.fromEntries(fields.map(field => [field, times[field] + 86400000]));
    assert.equal((await api(path, admin.token, "PATCH", { ...request, times: moved, expectedUpdatedAt: saved.updatedAt.toMillis() })).status, 200);
    assert.equal((await ref.get()).get("date"), "2026-10-18");

    const normalUid = await person();
    let id = null;
    for (let i = 0; i < 4; i++) {
      now = timestamps[i];
      const result = await savePunch(db, normalUid, { ...base, type: types[i], expectedWorkdayId: id }, 0);
      id = result.workdayId;
    }
    assert.equal((await db.doc(`workdays/${id}`).get()).get("totalWorkedMinutes"), 899);
  });
  await check("administrative saves handle incomplete shifts and breaks crossing midnight", async () => {
    const fields = ["clockInAt", "breakStartAt", "breakEndAt", "clockOutAt"];
    const timestamps = ["2026-10-18T20:00:00-03:00", "2026-10-18T23:30:00-03:00", "2026-10-19T00:30:00-03:00", "2026-10-19T04:00:00-03:00"].map(Date.parse);
    for (let count = 1; count <= 4; count++) {
      const uid = await person();
      const ref = db.doc(`workdays/partial-edit-${count}`);
      await ref.set({ companyId, userId: uid, date: "2026-10-18", status: "working", clockInAt: firestore.Timestamp.fromMillis(timestamps[0]) });
      const response = await api(`/api/admin/registros/${ref.id}`, admin.token, "PATCH", {
        mode: "active", reason: "Partial overnight correction", expectedUpdatedAt: null,
        times: Object.fromEntries(fields.map((field, i) => [field, i < count ? timestamps[i] : null])),
      });
      assert.equal(response.status, 200, JSON.stringify(response));
      const saved = (await ref.get()).data();
      assert.equal(saved.status, count === 4 ? "finished" : count === 2 ? "on_break" : "working");
      assert.equal(saved.totalWorkedMinutes, count === 4 ? 420 : count > 1 ? 210 : 0);
      assert.equal(saved.totalBreakMinutes, count > 2 ? 60 : 0);
      assert.equal(saved.date, "2026-10-18");
    }
  });
}
