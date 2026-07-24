"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPunch = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
const region = "southamerica-east1";
const eventTypes = ["clock_in", "break_start", "break_end", "clock_out"];
function haversine(aLat, aLng, bLat, bLng) {
    const radius = 6_371_000;
    const radians = (value) => value * Math.PI / 180;
    const latitude = radians(bLat - aLat);
    const longitude = radians(bLng - aLng);
    const value = Math.sin(latitude / 2) ** 2
        + Math.cos(radians(aLat)) * Math.cos(radians(bLat))
            * Math.sin(longitude / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function saoPauloDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const part = (type) => parts.find((value) => value.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
}
function expectedEvent(workday) {
    if (!workday?.clockInAt)
        return "clock_in";
    if (workday.status === "finished" || workday.clockOutAt)
        return null;
    if (workday.status === "on_break" && workday.breakStartAt && !workday.breakEndAt)
        return "break_end";
    if (workday.breakEndAt)
        return "clock_out";
    return "break_start";
}
function assertNumber(value, field) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new https_1.HttpsError("invalid-argument", `${field} inválido.`);
    }
}
exports.registerPunch = (0, https_1.onCall)({ region, enforceAppCheck: false, cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Faça login novamente.");
    const data = request.data;
    if (!data || !eventTypes.includes(data.type) || typeof data.companyId !== "string" || typeof data.qrCodeId !== "string") {
        throw new https_1.HttpsError("invalid-argument", "Dados do registro inválidos.");
    }
    assertNumber(data.latitude, "Latitude");
    assertNumber(data.longitude, "Longitude");
    assertNumber(data.accuracy, "Precisão");
    if (data.latitude < -90 || data.latitude > 90 || data.longitude < -180 || data.longitude > 180 || data.accuracy < 0) {
        throw new https_1.HttpsError("invalid-argument", "Coordenadas inválidas.");
    }
    const userRef = db.doc(`users/${request.auth.uid}`);
    const companyRef = db.doc(`companies/${data.companyId}`);
    const [userSnapshot, companySnapshot] = await Promise.all([userRef.get(), companyRef.get()]);
    if (!userSnapshot.exists)
        throw new https_1.HttpsError("permission-denied", "Perfil não encontrado.");
    const user = userSnapshot.data();
    const company = companySnapshot.data();
    if (!user.active || user.role !== "employee")
        throw new https_1.HttpsError("permission-denied", "Funcionário inativo ou inválido.");
    if (user.companyId !== data.companyId)
        throw new https_1.HttpsError("permission-denied", "Empresa não autorizada.");
    if (!companySnapshot.exists || !company?.active)
        throw new https_1.HttpsError("failed-precondition", "Empresa inativa ou inexistente.");
    if (company.qrCodeId !== data.qrCodeId)
        throw new https_1.HttpsError("failed-precondition", "QR Code antigo ou inválido.");
    const distanceMeters = haversine(data.latitude, data.longitude, company.latitude, company.longitude);
    if (distanceMeters + data.accuracy > company.radiusMeters) {
        throw new https_1.HttpsError("failed-precondition", "Localização fora do raio permitido.");
    }
    const date = saoPauloDate();
    const workdayRef = db.doc(`workdays/${data.companyId}_${request.auth.uid}_${date}`);
    const eventRef = workdayRef.collection("events").doc();
    const nowForCalculation = firestore_1.Timestamp.now();
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(workdayRef);
        const current = snapshot.exists ? snapshot.data() : undefined;
        if (expectedEvent(current) !== data.type) {
            throw new https_1.HttpsError("failed-precondition", "Esta não é a próxima ação da jornada.");
        }
        const timestampField = {
            clock_in: "clockInAt",
            break_start: "breakStartAt",
            break_end: "breakEndAt",
            clock_out: "clockOutAt",
        };
        const update = {
            companyId: data.companyId,
            userId: request.auth.uid,
            date,
            [timestampField[data.type]]: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        if (data.type === "clock_in")
            Object.assign(update, {
                status: "working",
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                totalWorkedMinutes: 0,
                totalBreakMinutes: 0,
            });
        if (data.type === "break_start")
            update.status = "on_break";
        if (data.type === "break_end")
            update.status = "working";
        if (data.type === "clock_out") {
            update.status = "finished";
            const clockIn = current?.clockInAt;
            const breakStart = current?.breakStartAt;
            const breakEnd = current?.breakEndAt;
            const breakMilliseconds = breakStart && breakEnd ? breakEnd.toMillis() - breakStart.toMillis() : 0;
            update.totalBreakMinutes = Math.max(0, Math.round(breakMilliseconds / 60_000));
            update.totalWorkedMinutes = Math.max(0, Math.round((nowForCalculation.toMillis() - clockIn.toMillis() - breakMilliseconds) / 60_000));
        }
        transaction.set(workdayRef, update, { merge: true });
        transaction.set(eventRef, {
            companyId: data.companyId,
            userId: request.auth.uid,
            type: data.type,
            officialTimestamp: firestore_1.FieldValue.serverTimestamp(),
            clientTimestamp: firestore_1.Timestamp.fromMillis(data.clientTimestamp),
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.accuracy,
            distanceMeters,
            qrCodeId: data.qrCodeId,
            userAgent: String(data.userAgent || "").slice(0, 500),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    });
    const eventSnapshot = await eventRef.get();
    const officialTimestamp = eventSnapshot.get("officialTimestamp");
    return { officialTimestampMillis: officialTimestamp.toMillis() };
});
