"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workdayTimeZone = exports.punchTypes = exports.punchFields = void 0;
exports.isOpenShift = isOpenShift;
exports.expectedPunch = expectedPunch;
exports.validateShiftSequence = validateShiftSequence;
exports.shiftTotals = shiftTotals;
exports.shiftDate = shiftDate;
exports.punchFields = ["clockInAt", "breakStartAt", "breakEndAt", "clockOutAt"];
exports.punchTypes = ["clock_in", "break_start", "break_end", "clock_out"];
exports.workdayTimeZone = "America/Sao_Paulo";
// Incomplete historical records must not silently permit a second open shift.
function isOpenShift(shift) {
    return !shift.clockOutAt && (Boolean(shift.clockInAt || shift.breakStartAt || shift.breakEndAt)
        || shift.status === "working" || shift.status === "on_break");
}
function expectedPunch(shift) {
    if (!shift)
        return "clock_in";
    if (shift.status === "day_off" || shift.clockOutAt)
        return null;
    const count = exports.punchFields.findIndex(field => !shift[field]);
    if (count < 1 || exports.punchFields.slice(count).some(field => shift[field]))
        return null;
    return exports.punchTypes[count];
}
function validateShiftSequence(shift) {
    if (!shift.clockInAt)
        throw new Error("O horário de entrada é obrigatório.");
    let previous;
    let missing = false;
    for (const field of exports.punchFields) {
        const value = shift[field]?.toMillis();
        if (value === undefined) {
            missing = true;
            continue;
        }
        if (!Number.isFinite(value))
            throw new Error("Data ou horário inválido.");
        if (missing)
            throw new Error("Preencha as batidas em sequência, sem pular etapas.");
        if (previous !== undefined && value <= previous) {
            throw new Error("Cada batida deve ser posterior à anterior. Confira também a data quando houver virada de dia.");
        }
        previous = value;
    }
    const entry = shift.clockInAt.toMillis();
    const start = shift.breakStartAt?.toMillis();
    const end = shift.breakEndAt?.toMillis();
    const exit = shift.clockOutAt?.toMillis();
    // Only completed work intervals contribute to an incomplete shift.
    const worked = (start !== undefined ? start - entry : 0)
        + (exit !== undefined && end !== undefined ? exit - end : 0);
    return {
        totalBreakMinutes: start !== undefined && end !== undefined ? Math.round((end - start) / 60_000) : 0,
        totalWorkedMinutes: Math.round(worked / 60_000),
        status: exit !== undefined ? "finished" : start !== undefined && end === undefined ? "on_break" : "working",
    };
}
function shiftTotals(shift) {
    const { totalWorkedMinutes, totalBreakMinutes } = validateShiftSequence(shift);
    if (!shift.clockOutAt)
        throw new Error("As quatro batidas são obrigatórias para encerrar o turno.");
    return { totalWorkedMinutes, totalBreakMinutes };
}
function shiftDate(date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: exports.workdayTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(date);
}
