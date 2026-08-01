import { collection, getDocs, query, where, type QueryConstraint } from "firebase/firestore";
import { db } from "./firebase";
import type { AppUser, Workday } from "@/types";

export async function companyUsers(companyId: string) {
  const snapshot = await getDocs(query(
    collection(db, "users"),
    where("companyId", "==", companyId),
  ));
  return snapshot.docs
    .map((document) => ({ ...document.data(), uid: document.id } as AppUser))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function companyWorkdays(companyId: string, max = 100, date?: string) {
  const constraints: QueryConstraint[] = [where("companyId", "==", companyId)];
  if (date) constraints.push(where("date", "==", date));
  const snapshot = await getDocs(query(collection(db, "workdays"), ...constraints));
  return snapshot.docs
    .map((document) => ({ ...document.data(), id: document.id } as Workday))
    .filter((workday) => workday.companyId === companyId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, max);
}

export async function userWorkdays(companyId: string, userId: string, max = 100) {
  const snapshot = await getDocs(query(
    collection(db, "workdays"),
    where("companyId", "==", companyId),
    where("userId", "==", userId),
  ));
  return snapshot.docs
    .map((document) => ({ ...document.data(), id: document.id } as Workday))
    .filter((workday) => workday.companyId === companyId && workday.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, max);
}

export function minutesText(value = 0) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}

export function exportCsv(name: string, rows: Record<string, unknown>[]) {
  const keys = Object.keys(rows[0] || {});
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    keys.map(escape).join(";"),
    ...rows.map((row) => keys.map((key) => escape(row[key])).join(";")),
  ].join("\n");
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
