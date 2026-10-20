import { workdayTimeZone, shiftDate } from "../../functions/src/workday-state";

export function punchDateTimeInput(date: Date) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: workdayTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
  return `${shiftDate(date)}T${time}`;
}

export function parsePunchDateTime(input: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) throw new Error("Informe data e hora completas.");
  const target = Date.parse(`${input}:00Z`);
  if (!Number.isFinite(target)) throw new Error("Data ou horário inválido.");
  let instant = target;
  // Resolve the named timezone rather than assuming the browser zone or UTC-3
  // (historical São Paulo records may have daylight-saving offsets).
  for (let attempt = 0; attempt < 3; attempt++) {
    const represented = punchDateTimeInput(new Date(instant));
    if (represented === input) return new Date(instant);
    instant += target - Date.parse(`${represented}:00Z`);
  }
  throw new Error("Data ou horário inexistente no fuso America/Sao_Paulo.");
}

export function punchTimeText(value?: { toDate(): Date }, openingDate?: string) {
  if (!value) return "—";
  const date = value.toDate();
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: workdayTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
  return openingDate && shiftDate(date) !== openingDate
    ? `${shiftDate(date).split("-").reverse().join("/")} ${time}`
    : time;
}
