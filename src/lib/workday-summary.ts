import type { Workday } from "@/types";

export function summarizeWorkdays(rows: Workday[]) {
  const result = new Map<string, { worked: number; breaks: number; days: number; daysOff: number }>();
  const workedDates = new Map<string, Set<string>>();
  const offDates = new Map<string, Set<string>>();
  for (const row of rows) {
    const value = result.get(row.userId) ?? { worked: 0, breaks: 0, days: 0, daysOff: 0 };
    const dates = row.status === "day_off" ? offDates : workedDates;
    const employeeDates = dates.get(row.userId) ?? new Set<string>();
    employeeDates.add(row.date);
    dates.set(row.userId, employeeDates);
    if (row.status === "day_off") {
      value.daysOff = employeeDates.size;
    } else {
      value.worked += row.totalWorkedMinutes || 0;
      value.breaks += row.totalBreakMinutes || 0;
      value.days = employeeDates.size;
    }
    result.set(row.userId, value);
  }
  return [...result.entries()];
}
