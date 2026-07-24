"use client";

import { collection, doc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from "firebase/firestore";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Button, Card, DataTable, Empty, Field, Loading, Modal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { companyUsers, companyWorkdays } from "@/lib/queries";
import { randomToken } from "@/lib/utils";
import type { AppUser, Workday } from "@/types";

interface AuditLog {
  id: string;
  adminId: string;
  reason: string;
  workdayId: string;
  createdAt?: Timestamp;
}

const DAILY_TARGET_MINUTES = 8 * 60;

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

export default function Records() {
  return <Protected role="admin"><RecordsContent /></Protected>;
}

function RecordsContent() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<AppUser[]>();
  const [rows, setRows] = useState<Workday[]>();
  const [audits, setAudits] = useState<AuditLog[]>();
  const [selected, setSelected] = useState<Workday>();
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const [companyUserRows, workdays, auditSnapshot] = await Promise.all([
      companyUsers(profile.companyId),
      companyWorkdays(profile.companyId),
      getDocs(query(
        collection(db, "auditLogs"),
        where("companyId", "==", profile.companyId),
      )),
    ]);
    setUsers(companyUserRows);
    setRows(workdays);
    setAudits(auditSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as AuditLog)).sort((a,b)=>(b.createdAt?.toMillis()??0)-(a.createdAt?.toMillis()??0)).slice(0,30));
  }, [profile]);

  useEffect(() => { void load(); }, [load]);

  async function correct() {
    if (!selected || !profile || reason.trim().length < 5) return;
    try {
      setSaving(true);
      setError("");
      const auditId = randomToken(16);
      const batch = writeBatch(db);
      const before = {
        totalWorkedMinutes: selected.totalWorkedMinutes,
        totalBreakMinutes: selected.totalBreakMinutes,
        status: selected.status ?? null,
      };
      const after = { totalWorkedMinutes: minutes };
      batch.update(doc(db, "workdays", selected.id), {
        ...after,
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
      setReason("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar a correção.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Registros">
      <div className="stack">
      <Card>
        <div className="section-title">
          <div>
            <h2>Registros de ponto</h2>
            <p className="table-note">Jornada-base: 8h trabalhadas + 1h de intervalo.</p>
          </div>
        </div>
        {!rows || !users ? <Loading /> : rows.length === 0
          ? <Empty title="Nenhum registro" description="As jornadas da empresa aparecerão aqui." />
          : (
            <div className="records-table">
            <DataTable headers={["Funcionário", "Data", "Entrada", "Intervalo ida", "Intervalo volta", "Saída", "Saldo 8h", ""]}>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{users.find((user) => user.uid === row.userId)?.name ?? "—"}</td>
                  <td>{row.date.split("-").reverse().join("/")}</td>
                  <td className="time-cell">{timeText(row.clockInAt)}</td>
                  <td className="time-cell">{timeText(row.breakStartAt)}</td>
                  <td className="time-cell">{timeText(row.breakEndAt)}</td>
                  <td className="time-cell">{timeText(row.clockOutAt)}</td>
                  <td className={row.status === "finished" && row.totalWorkedMinutes >= DAILY_TARGET_MINUTES ? "balance positive" : row.status === "finished" ? "balance negative" : "balance"}>
                    {balanceText(row)}
                  </td>
                  <td><button className="icon-button" onClick={() => { setSelected(row); setMinutes(row.totalWorkedMinutes); setError(""); }} aria-label="Corrigir registro"><Pencil /></button></td>
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
            <DataTable headers={["Data", "Administrador", "Jornada", "Motivo"]}>
              {audits.map((audit) => (
                <tr key={audit.id}>
                  <td>{audit.createdAt?.toDate().toLocaleString("pt-BR") ?? "—"}</td>
                  <td>{users.find((user) => user.uid === audit.adminId)?.name ?? "—"}</td>
                  <td>{audit.workdayId.split("_").at(-1)?.split("-").reverse().join("/") ?? "—"}</td>
                  <td>{audit.reason}</td>
                </tr>
              ))}
            </DataTable>
          )}
      </Card>
      </div>
      <Modal open={Boolean(selected)} title="Correção manual" onClose={() => setSelected(undefined)}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Total trabalhado (minutos)" type="number" min={0} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} />
        <label className="field">
          <span>Motivo obrigatório</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Informe o motivo da correção" />
        </label>
        <div className="modal-actions">
          <Button className="secondary" onClick={() => setSelected(undefined)}>Cancelar</Button>
          <Button loading={saving} disabled={reason.trim().length < 5 || minutes < 0} onClick={correct}>Salvar correção</Button>
        </div>
      </Modal>
    </AppShell>
  );
}
