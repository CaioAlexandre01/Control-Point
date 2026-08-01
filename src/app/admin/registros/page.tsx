"use client";

import { collection, deleteField, doc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from "firebase/firestore";
import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Button, Card, DataTable, Empty, Field, Loading, Modal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { deleteWorkday } from "@/lib/admin-actions";
import { db } from "@/lib/firebase";
import { companyUsers, companyWorkdays } from "@/lib/queries";
import { randomToken, saoPauloDate } from "@/lib/utils";
import type { AppUser, Workday } from "@/types";

interface AuditLog {
  id: string;
  adminId: string;
  action?: string;
  reason: string;
  workdayId?: string;
  employeeName?: string;
  createdAt?: Timestamp;
}

const DAILY_TARGET_MINUTES = 8 * 60;

type PunchTimeField = "clockInAt" | "breakStartAt" | "breakEndAt" | "clockOutAt";
type PunchTimes = Record<PunchTimeField, string>;

const EMPTY_PUNCH_TIMES: PunchTimes = {
  clockInAt: "",
  breakStartAt: "",
  breakEndAt: "",
  clockOutAt: "",
};

function timeInputValue(value?: Timestamp) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value.toDate());
}

function timestampFromDateAndTime(date: string, time: string) {
  if (!time) return undefined;
  const parsed = new Date(`${date}T${time}:00-03:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Informe horários válidos.");
  return Timestamp.fromDate(parsed);
}

function validatePunchTimes(date: string, times: PunchTimes) {
  const clockInAt = timestampFromDateAndTime(date, times.clockInAt);
  const breakStartAt = timestampFromDateAndTime(date, times.breakStartAt);
  const breakEndAt = timestampFromDateAndTime(date, times.breakEndAt);
  const clockOutAt = timestampFromDateAndTime(date, times.clockOutAt);

  if (!clockInAt) throw new Error("O horário de entrada é obrigatório.");
  if (breakEndAt && !breakStartAt) throw new Error("Informe o início do intervalo antes do retorno.");
  if (clockOutAt && breakStartAt && !breakEndAt) {
    throw new Error("Informe o retorno do intervalo antes da saída.");
  }

  const clockInMillis = clockInAt.toMillis();
  if (breakStartAt && breakStartAt.toMillis() <= clockInMillis) {
    throw new Error("O intervalo deve começar depois da entrada.");
  }
  if (breakStartAt && breakEndAt && breakEndAt.toMillis() <= breakStartAt.toMillis()) {
    throw new Error("O retorno deve ser posterior ao início do intervalo.");
  }
  if (clockOutAt && clockOutAt.toMillis() <= clockInMillis) {
    throw new Error("A saída deve ser posterior à entrada.");
  }
  if (clockOutAt && breakEndAt && clockOutAt.toMillis() <= breakEndAt.toMillis()) {
    throw new Error("A saída deve ser posterior ao retorno do intervalo.");
  }

  const breakMilliseconds = breakStartAt && breakEndAt
    ? breakEndAt.toMillis() - breakStartAt.toMillis()
    : 0;
  const totalBreakMinutes = Math.max(0, Math.round(breakMilliseconds / 60_000));
  const calculatedWorkedMinutes = clockOutAt
    ? Math.max(0, Math.round((clockOutAt.toMillis() - clockInMillis - breakMilliseconds) / 60_000))
    : 0;
  const status = clockOutAt ? "finished" : breakStartAt && !breakEndAt ? "on_break" : "working";

  return {
    clockInAt,
    breakStartAt,
    breakEndAt,
    clockOutAt,
    totalBreakMinutes,
    calculatedWorkedMinutes,
    status,
  } as const;
}

function timeText(value?: Timestamp) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value.toDate());
}

function balanceText(workday: Workday) {
  if (workday.status !== "finished" || !workday.clockOutAt) return "—";
  const balance = (workday.totalWorkedMinutes || 0) - DAILY_TARGET_MINUTES;
  const sign = balance >= 0 ? "+" : "−";
  const absolute = Math.abs(balance);
  return `${sign}${Math.floor(absolute / 60)}h ${String(absolute % 60).padStart(2, "0")}min`;
}

function auditActionText(action?: string) {
  if (action === "workday_deleted") return "Batidas excluídas";
  if (action === "employee_deleted") return "Funcionário excluído";
  return "Horários corrigidos";
}

export default function Records() {
  return <Protected role="admin"><RecordsContent /></Protected>;
}

function RecordsContent() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<AppUser[]>();
  const [rows, setRows] = useState<Workday[]>();
  const [audits, setAudits] = useState<AuditLog[]>();
  const [selectedDate, setSelectedDate] = useState(saoPauloDate());
  const [selected, setSelected] = useState<Workday>();
  const [punchTimes, setPunchTimes] = useState<PunchTimes>(EMPTY_PUNCH_TIMES);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(0);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [workdayToDelete, setWorkdayToDelete] = useState<Workday>();
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setRows(undefined);
    setLoadError("");
    try {
      const [companyUserRows, workdays, auditSnapshot] = await Promise.all([
        companyUsers(profile.companyId),
        companyWorkdays(profile.companyId, selectedDate ? 500 : 100, selectedDate || undefined),
        getDocs(query(
          collection(db, "auditLogs"),
          where("companyId", "==", profile.companyId),
        )),
      ]);
      setUsers(companyUserRows);
      setRows(workdays);
      setAudits(auditSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as AuditLog)).sort((a,b)=>(b.createdAt?.toMillis()??0)-(a.createdAt?.toMillis()??0)).slice(0,30));
    } catch (caught) {
      setUsers([]);
      setRows([]);
      setAudits([]);
      setLoadError(caught instanceof Error ? caught.message : "Não foi possível carregar os registros.");
    }
  }, [profile, selectedDate]);

  useEffect(() => { void load(); }, [load]);

  function selectForCorrection(workday: Workday) {
    setSelected(workday);
    setPunchTimes({
      clockInAt: timeInputValue(workday.clockInAt),
      breakStartAt: timeInputValue(workday.breakStartAt),
      breakEndAt: timeInputValue(workday.breakEndAt),
      clockOutAt: timeInputValue(workday.clockOutAt),
    });
    setMinutes(workday.totalWorkedMinutes);
    setReason("");
    setError("");
  }

  function updatePunchTime(field: PunchTimeField, value: string) {
    if (!selected) return;
    const nextTimes = { ...punchTimes, [field]: value };
    setPunchTimes(nextTimes);
    try {
      const calculated = validatePunchTimes(selected.date, nextTimes);
      if (calculated.clockOutAt) setMinutes(calculated.calculatedWorkedMinutes);
    } catch {
      // The complete sequence is validated when the administrator saves it.
    }
  }

  async function correct() {
    if (!selected || !profile || reason.trim().length < 5) return;
    try {
      setSaving(true);
      setError("");
      const corrected = validatePunchTimes(selected.date, punchTimes);
      if (!Number.isFinite(minutes) || minutes < 0) {
        throw new Error("O total trabalhado deve ser um número maior ou igual a zero.");
      }
      const auditId = randomToken(16);
      const batch = writeBatch(db);
      const before = {
        clockInAt: selected.clockInAt ?? null,
        breakStartAt: selected.breakStartAt ?? null,
        breakEndAt: selected.breakEndAt ?? null,
        clockOutAt: selected.clockOutAt ?? null,
        totalWorkedMinutes: selected.totalWorkedMinutes,
        totalBreakMinutes: selected.totalBreakMinutes,
        status: selected.status ?? null,
      };
      const after = {
        clockInAt: corrected.clockInAt,
        breakStartAt: corrected.breakStartAt ?? null,
        breakEndAt: corrected.breakEndAt ?? null,
        clockOutAt: corrected.clockOutAt ?? null,
        totalWorkedMinutes: Math.round(minutes),
        totalBreakMinutes: corrected.totalBreakMinutes,
        status: corrected.status,
      };
      batch.update(doc(db, "workdays", selected.id), {
        clockInAt: corrected.clockInAt,
        breakStartAt: corrected.breakStartAt ?? deleteField(),
        breakEndAt: corrected.breakEndAt ?? deleteField(),
        clockOutAt: corrected.clockOutAt ?? deleteField(),
        totalWorkedMinutes: Math.round(minutes),
        totalBreakMinutes: corrected.totalBreakMinutes,
        status: corrected.status,
        correctionAuditId: auditId,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, "auditLogs", auditId), {
        companyId: profile.companyId,
        adminId: profile.uid,
        action: "manual_workday_correction",
        reason: reason.trim(),
        before,
        after,
        workdayId: selected.id,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setSelected(undefined);
      setPunchTimes(EMPTY_PUNCH_TIMES);
      setReason("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar a correção.");
    } finally {
      setSaving(false);
    }
  }

  async function removeWorkday() {
    if (!workdayToDelete) return;
    try {
      setDeleting(true);
      setDeleteError("");
      await deleteWorkday(workdayToDelete.id);
      setWorkdayToDelete(undefined);
      await load();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "Não foi possível excluir o registro.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell title="Registros">
      <div className="stack">
      <Card>
        <div className="section-title records-heading">
          <div>
            <h2>Registros de ponto</h2>
            <p className="table-note">Jornada-base: 8h trabalhadas + 1h de intervalo.</p>
          </div>
          <div className="records-filters">
            <Field
              label="Data"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
            <Button
              type="button"
              className="secondary"
              disabled={selectedDate === saoPauloDate()}
              onClick={() => setSelectedDate(saoPauloDate())}
            >
              Hoje
            </Button>
            <Button
              type="button"
              className="secondary"
              disabled={!selectedDate}
              onClick={() => setSelectedDate("")}
            >
              Todos
            </Button>
          </div>
        </div>
        {loadError && <Alert tone="error">{loadError}</Alert>}
        {loadError ? null : !rows || !users ? <Loading /> : rows.length === 0
          ? <Empty title="Nenhum registro" description={selectedDate ? "Não há jornadas registradas nesta data." : "As jornadas da empresa aparecerão aqui."} />
          : (
            <div className="records-table">
            <DataTable headers={["Funcionário", "Data", "Entrada", "Intervalo ida", "Intervalo volta", "Saída", "Saldo 8h", ""]}>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{users.find((user) => user.uid === row.userId)?.name ?? row.employeeName ?? "Funcionário excluído"}</td>
                  <td>{row.date.split("-").reverse().join("/")}</td>
                  <td className="time-cell">{timeText(row.clockInAt)}</td>
                  <td className="time-cell">{timeText(row.breakStartAt)}</td>
                  <td className="time-cell">{timeText(row.breakEndAt)}</td>
                  <td className="time-cell">{timeText(row.clockOutAt)}</td>
                  <td className={row.status === "finished" && row.totalWorkedMinutes >= DAILY_TARGET_MINUTES ? "balance positive" : row.status === "finished" ? "balance negative" : "balance"}>
                    {balanceText(row)}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-button" onClick={() => selectForCorrection(row)} aria-label="Editar horários do registro"><Pencil /></button>
                      <button
                        className="icon-button delete-icon-button"
                        onClick={() => {
                          setWorkdayToDelete(row);
                          setDeleteError("");
                        }}
                        aria-label="Excluir batidas deste dia"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
            </div>
          )}
      </Card>
      <Card>
        <div className="section-title"><h2>Histórico de alterações</h2></div>
        {!audits || !users ? <Loading /> : audits.length === 0
          ? <Empty title="Nenhuma correção" description="Alterações administrativas aparecerão aqui." />
          : (
            <DataTable headers={["Data", "Administrador", "Ação", "Registro", "Motivo"]}>
              {audits.map((audit) => (
                <tr key={audit.id}>
                  <td>{audit.createdAt?.toDate().toLocaleString("pt-BR") ?? "—"}</td>
                  <td>{users.find((user) => user.uid === audit.adminId)?.name ?? "—"}</td>
                  <td>{auditActionText(audit.action)}</td>
                  <td>{audit.workdayId ? audit.workdayId.split("_").at(-1)?.split("-").reverse().join("/") : audit.employeeName ?? "—"}</td>
                  <td>{audit.reason}</td>
                </tr>
              ))}
            </DataTable>
          )}
      </Card>
      </div>
      <Modal open={Boolean(selected)} title="Editar horários da jornada" onClose={() => setSelected(undefined)}>
        {error && <Alert tone="error">{error}</Alert>}
        {selected && (
          <p className="table-note">
            {users?.find((user) => user.uid === selected.userId)?.name ?? "Funcionário"}
            {" · "}
            {selected.date.split("-").reverse().join("/")}
          </p>
        )}
        <div className="form-grid punch-time-fields">
          <Field label="Entrada" type="time" value={punchTimes.clockInAt} onChange={(event) => updatePunchTime("clockInAt", event.target.value)} />
          <Field label="Intervalo — saída" type="time" value={punchTimes.breakStartAt} onChange={(event) => updatePunchTime("breakStartAt", event.target.value)} />
          <Field label="Intervalo — retorno" type="time" value={punchTimes.breakEndAt} onChange={(event) => updatePunchTime("breakEndAt", event.target.value)} />
          <Field label="Saída" type="time" value={punchTimes.clockOutAt} onChange={(event) => updatePunchTime("clockOutAt", event.target.value)} />
        </div>
        <Field label="Total trabalhado (minutos)" type="number" min={0} step={1} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} />
        <p className="table-note">O total é recalculado ao alterar uma sequência completa e pode ser ajustado manualmente.</p>
        <label className="field">
          <span>Motivo obrigatório</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Informe o motivo da correção" />
        </label>
        <div className="modal-actions">
          <Button className="secondary" onClick={() => setSelected(undefined)}>Cancelar</Button>
          <Button loading={saving} disabled={reason.trim().length < 5 || !Number.isFinite(minutes) || minutes < 0} onClick={correct}>Salvar alterações</Button>
        </div>
      </Modal>
      <Modal
        open={Boolean(workdayToDelete)}
        title="Tem certeza?"
        onClose={() => { if (!deleting) setWorkdayToDelete(undefined); }}
      >
        {deleteError && <Alert tone="error">{deleteError}</Alert>}
        <p>
          Deseja excluir todas as batidas de
          {" "}<strong>{workdayToDelete ? users?.find((user) => user.uid === workdayToDelete.userId)?.name ?? workdayToDelete.employeeName ?? "funcionário" : "funcionário"}</strong>
          {" "}do dia {workdayToDelete?.date.split("-").reverse().join("/")}?
        </p>
        <div className="modal-actions">
          <Button className="secondary" disabled={deleting} onClick={() => setWorkdayToDelete(undefined)}>Cancelar</Button>
          <Button className="danger-button" loading={deleting} onClick={removeWorkday}>Excluir definitivamente</Button>
        </div>
      </Modal>
    </AppShell>
  );
}
