"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPunch = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const punch_service_1 = require("./punch-service");
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
    assertNumber(data.clientTimestamp, "Horário do dispositivo");
    if (data.requestId !== undefined && (typeof data.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId))) {
        throw new https_1.HttpsError("invalid-argument", "Identificador de registro inválido.");
    }
    if (data.expectedWorkdayId !== undefined && data.expectedWorkdayId !== null && (typeof data.expectedWorkdayId !== "string" || data.expectedWorkdayId.includes("/"))) {
        throw new https_1.HttpsError("invalid-argument", "Turno inválido.");
    }
    try {
        return await (0, punch_service_1.savePunch)(db, request.auth.uid, { ...data, userAgent: String(data.userAgent || "").slice(0, 500) }, distanceMeters, { FieldValue: firestore_1.FieldValue, Timestamp: firestore_1.Timestamp });
    }
    catch (error) {
        if (error instanceof punch_service_1.PunchConflict)
            throw new https_1.HttpsError("failed-precondition", error.message);
        throw error;
    }
});
