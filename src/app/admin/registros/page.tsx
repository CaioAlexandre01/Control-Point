"use client";

import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Badge, Button, Card, DataTable, Empty, Field, Loading, Modal, PageHeader } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { correctWorkday, deleteWorkday } from "@/lib/admin-actions";
import { db } from "@/lib/firebase";
import { companyUsers, companyWorkdays } from "@/lib/queries";
import { punchDateTimeInput, punchTimeText } from "@/lib/punch-time";
import { suggestPunchDates, validateCorrectionTimes, type PunchTimeField, type PunchTimes } from "@/lib/workday-correction";
import { saoPauloDate } from "@/lib/utils";
import type { AppUser, Workday } from "@/types";

interface AuditLog {
  id: string;
  adminId: string;
  action?: string;
  reason: string;
  workdayId?: string;
  workdayDate?: string;
  employeeName?: string;
  createdAt?: Timestamp;
}

const DAILY_TARGET_MINUTES = 8 * 60;

type CorrectionMode = "active" | "day_off";

const EMPTY_PUNCH_TIMES: PunchTimes = {
  clockInAt: "",
  breakStartAt: "",
  breakEndAt: "",
  clockOutAt: "",
};

const punchLabels: Record<PunchTimeField, string> = {
  clockInAt: "Entrada", breakStartAt: "Intervalo — saída",
  breakEndAt: "Intervalo — retorno", clockOutAt: "Saída",
};

function dateTimeLabel(value: string) {
  const [date, time] = value.split("T");
  return `${date.split("-").reverse().join("/")} às ${time}`;
}

function timeInputValue(value?: Timestamp) {
  if (!value) return "";
  return punchDateTimeInput(value.toDate());
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
  const [correctionMode, setCorrectionMode] = useState<CorrectionMode>("active");
  const [punchTimes, setPunchTimes] = useState<PunchTimes>(EMPTY_PUNCH_TIMES);
  const [reason, setReason] = useState("");
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
    setCorrectionMode(workday.status === "day_off" ? "day_off" : "active");
    setPunchTimes({
      clockInAt: timeInputValue(workday.clockInAt),
      breakStartAt: timeInputValue(workday.breakStartAt),
      breakEndAt: timeInputValue(workday.breakEndAt),
      clockOutAt: timeInputValue(workday.clockOutAt),
    });
    setReason("");
    setError("");
  }

  const correction = useMemo(() => {
    if (!selected || correctionMode !== "active") return {};
    try { return { value: validateCorrectionTimes(selected, punchTimes) }; }
    catch (caught) { return { error: caught instanceof Error ? caught.message : "Datas inválidas." }; }
  }, [selected, correctionMode, punchTimes]);
  const suggestedTimes = useMemo(() => correction.error ? suggestPunchDates(punchTimes) : undefined, [correction.error, punchTimes]);

  function updatePunchTime(field: PunchTimeField, value: string) {
    setPunchTimes(current => ({ ...current, [field]: value }));
    setError("");
  }

  async function correct() {
    if (!selected || !profile || reason.trim().length < 5) return;
    try {
      setSaving(true);
      setError("");
      const corrected = correctionMode === "active" ? validateCorrectionTimes(selected, punchTimes) : undefined;
      await correctWorkday(selected.id, {
        mode: correctionMode,
        times: corrected?.times,
        reason: reason.trim(), expectedUpdatedAt: selected.updatedAt?.toMillis() ?? null,
      });
      setSelected(undefined);
      setCorrectionMode("active");
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
      <PageHeader title="Jornadas da equipe" description="Consulte batidas, corrija horários e acompanhe o histórico de alterações." />
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
            <DataTable headers={["Funcionário", "Data", "Entrada", "Intervalo ida", "Intervalo volta", "Saída", "Situação", "Saldo 8h", ""]}>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{users.find((user) => user.uid === row.userId)?.name ?? row.employeeName ?? "Funcionário excluído"}</td>
                  <td>{row.date.split("-").reverse().join("/")}</td>
                  <td className="time-cell">{punchTimeText(row.clockInAt, row.date)}</td>
                  <td className="time-cell">{punchTimeText(row.breakStartAt, row.date)}</td>
                  <td className="time-cell">{punchTimeText(row.breakEndAt, row.date)}</td>
                  <td className="time-cell">{punchTimeText(row.clockOutAt, row.date)}</td>
                  <td><Badge tone={row.status === "finished" ? "success" : row.status === "on_break" ? "warning" : "neutral"}>{row.status === "day_off" ? "Folga" : row.status === "finished" ? "Concluído" : row.status === "on_break" ? "Intervalo" : "Ativo"}</Badge></td>
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
                  <td>{(audit.workdayDate || audit.workdayId) ? (audit.workdayDate ?? audit.workdayId!.split("_").at(-1))?.split("-").reverse().join("/") : audit.employeeName ?? "—"}</td>
                  <td>{audit.reason}</td>
                </tr>
              ))}
            </DataTable>
          )}
      </Card>
      </div>
      <Modal open={Boolean(selected)} title="Editar jornada" onClose={() => setSelected(undefined)}>
        {error && <Alert tone="error">{error}</Alert>}
        {selected && (
          <p className="table-note">
            {users?.find((user) => user.uid === selected.userId)?.name ?? "Funcionário"}
            {" · "}
            {selected.date.split("-").reverse().join("/")}
          </p>
        )}
        <label className="field correction-status-field">
          <span>Situação do dia</span>
          <select value={correctionMode} onChange={(event) => setCorrectionMode(event.target.value as CorrectionMode)}>
            <option value="active">Ativo</option>
            <option value="day_off">Folga</option>
          </select>
        </label>
        {correctionMode === "active" ? (
          <>
            <p className="table-note">Datas e horários em America/Sao_Paulo. A data de abertura original será mantida.</p>
            <div className="form-grid punch-time-fields">
              <Field label="Entrada" type="datetime-local" value={punchTimes.clockInAt} onChange={(event) => updatePunchTime("clockInAt", event.target.value)} />
              <Field label="Intervalo — saída" type="datetime-local" value={punchTimes.breakStartAt} onChange={(event) => updatePunchTime("breakStartAt", event.target.value)} />
              <Field label="Intervalo — retorno" type="datetime-local" value={punchTimes.breakEndAt} onChange={(event) => updatePunchTime("breakEndAt", event.target.value)} />
              <Field label="Saída" type="datetime-local" value={punchTimes.clockOutAt} onChange={(event) => updatePunchTime("clockOutAt", event.target.value)} />
            </div>
            {correction.error && <Alert tone="error">{correction.error}</Alert>}
            {suggestedTimes && (
              <div className="stack">
                <Alert>
                  Há horários anteriores à batida precedente. Se houve virada de dia, confira as datas abaixo;
                  se foi um erro de digitação, corrija os campos. Nenhuma data foi alterada automaticamente.
                  <ul>
                    {(Object.keys(punchLabels) as PunchTimeField[]).filter(field => suggestedTimes[field] !== punchTimes[field]).map(field => (
                      <li key={field}>{punchLabels[field]}: {dateTimeLabel(punchTimes[field])} → <strong>{dateTimeLabel(suggestedTimes[field])}</strong></li>
                    ))}
                  </ul>
                </Alert>
                <Button type="button" className="secondary" onClick={() => { setPunchTimes(suggestedTimes); setError(""); }}>
                  Confirmar datas sugeridas
                </Button>
              </div>
            )}
            <Field label="Total trabalhado (minutos)" type="number" value={correction.value?.totalWorkedMinutes ?? ""} readOnly />
            <p className="table-note">Calculado pelas batidas. Em jornadas incompletas, soma apenas os períodos trabalhados já concluídos.</p>
          </>
        ) : (
          <Alert>Os horários serão removidos e esta jornada será marcada como folga.</Alert>
        )}
        <label className="field">
          <span>Motivo obrigatório</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Informe o motivo da correção" />
        </label>
        <div className="modal-actions">
          <Button className="secondary" onClick={() => setSelected(undefined)}>Cancelar</Button>
          <Button loading={saving} disabled={reason.trim().length < 5 || correctionMode === "active" && !correction.value} onClick={correct}>Salvar alterações</Button>
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
