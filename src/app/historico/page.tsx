"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Badge, Card, DataTable, Empty, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { minutesText, userWorkdays } from "@/lib/queries";
import type { Workday } from "@/types";

export default function History() {
  return <Protected role="employee"><HistoryContent /></Protected>;
}

function HistoryContent() {
  const { firebaseUser, profile } = useAuth();
  const [rows, setRows] = useState<Workday[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseUser || !profile) return;
    userWorkdays(profile.companyId, firebaseUser.uid)
      .then(setRows)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar o histórico."));
  }, [firebaseUser, profile]);

  return (
    <AppShell title="Meu histórico">
      <Card>
        <div className="section-title"><h2>Registros recentes</h2></div>
        {error ? <Alert tone="error">{error}</Alert> : !rows ? <Loading /> : rows.length === 0
          ? <Empty title="Nenhum registro" description="Sua primeira jornada aparecerá aqui." />
          : (
            <DataTable headers={["Data", "Status", "Horas trabalhadas", "Intervalo"]}>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.date.split("-").reverse().join("/")}</td>
                  <td><Badge tone={row.status === "finished" ? "success" : "warning"}>{row.status === "finished" ? "Encerrada" : row.status === "on_break" ? "Intervalo" : "Em andamento"}</Badge></td>
                  <td>{minutesText(row.totalWorkedMinutes)}</td>
                  <td>{minutesText(row.totalBreakMinutes)}</td>
                </tr>
              ))}
            </DataTable>
          )}
      </Card>
    </AppShell>
  );
}
