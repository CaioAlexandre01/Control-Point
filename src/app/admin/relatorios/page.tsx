"use client";

import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Button, Card, DataTable, Empty, Loading, PageHeader } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { companyUsers, companyWorkdays, exportCsv, minutesText } from "@/lib/queries";
import { saoPauloDate } from "@/lib/utils";
import type { AppUser, Workday } from "@/types";

export default function Reports() {
  return <Protected role="admin"><ReportsContent /></Protected>;
}

function ReportsContent() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<AppUser[]>();
  const [rows, setRows] = useState<Workday[]>();
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"daily" | "monthly">("monthly");
  const [reference, setReference] = useState(() => saoPauloDate().slice(0, 7));

  useEffect(() => {
    if (!profile) return;
    Promise.all([
      companyUsers(profile.companyId),
      companyWorkdays(profile.companyId, Infinity),
    ]).then(([companyUserRows, workdays]) => {
      setUsers(companyUserRows);
      setRows(workdays);
    }).catch(() => setError("Não foi possível carregar os relatórios. Atualize a página e tente novamente."));
  }, [profile]);

  const filtered = useMemo(
    () => rows?.filter((row) => mode === "daily" ? row.date === reference : row.date.startsWith(reference)) ?? [],
    [rows, reference, mode],
  );
  const summary = useMemo(() => {
    const result = new Map<string, { worked: number; breaks: number; days: number; daysOff: number }>();
    filtered.forEach((row) => {
      const value = result.get(row.userId) ?? { worked: 0, breaks: 0, days: 0, daysOff: 0 };
      if (row.status === "day_off") {
        value.daysOff += 1;
      } else {
        value.worked += row.totalWorkedMinutes || 0;
        value.breaks += row.totalBreakMinutes || 0;
        value.days += 1;
      }
      result.set(row.userId, value);
    });
    return [...result.entries()];
  }, [filtered]);

  function switchMode(nextMode: "daily" | "monthly") {
    setMode(nextMode);
    setReference(nextMode === "daily" ? saoPauloDate() : saoPauloDate().slice(0, 7));
  }

  function employeeName(userId: string) {
    return users?.find((user) => user.uid === userId)?.name
      ?? filtered.find((row) => row.userId === userId)?.employeeName
      ?? "Funcionário excluído";
  }

  function downloadCsv() {
    exportCsv(`relatorio-${reference}.csv`, summary.map(([userId, values]) => ({
      Funcionário: employeeName(userId),
      Período: reference,
      Dias: values.days,
      Folgas: values.daysOff,
      "Horas trabalhadas": minutesText(values.worked),
      Intervalos: minutesText(values.breaks),
      "Horas extras": minutesText(Math.max(0, values.worked - values.days * 480)),
    })));
  }

  return (
    <AppShell title="Relatórios">
      <PageHeader title="Análise de jornada" description="Consulte horas trabalhadas, intervalos e saldos por período." />
      <Card>
        <div className="section-title report-heading">
          <div className="report-title-group">
            <div><h2>Resumo por funcionário</h2><p>Selecione o formato e o período do relatório.</p></div>
            <div className="segmented">
              <button className={mode === "daily" ? "active" : ""} onClick={() => switchMode("daily")}>Diário</button>
              <button className={mode === "monthly" ? "active" : ""} onClick={() => switchMode("monthly")}>Mensal</button>
            </div>
          </div>
          <div className="filters">
            <input type={mode === "daily" ? "date" : "month"} value={reference} onChange={(event) => setReference(event.target.value)} />
            <Button onClick={downloadCsv} disabled={!summary.length}><Download />Exportar CSV</Button>
          </div>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : !rows || !users ? <Loading /> : summary.length === 0
          ? <Empty title="Sem dados no período" description="Escolha outra data para consultar." />
          : (
            <DataTable headers={["Funcionário", "Dias", "Folgas", "Trabalhado", "Intervalo", "Horas extras"]}>
              {summary.map(([userId, values]) => (
                <tr key={userId}>
                  <td>{employeeName(userId)}</td>
                  <td>{values.days}</td>
                  <td>{values.daysOff}</td>
                  <td>{minutesText(values.worked)}</td>
                  <td>{minutesText(values.breaks)}</td>
                  <td>{minutesText(Math.max(0, values.worked - values.days * 480))}</td>
                </tr>
              ))}
            </DataTable>
          )}
      </Card>
    </AppShell>
  );
}
