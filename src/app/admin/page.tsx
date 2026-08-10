"use client";

import { Clock3, Coffee, LogOut, UserCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Badge, Card, DataTable, Loading, PanelHeader, StatCard } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { companyUsers, companyWorkdays } from "@/lib/queries";
import { saoPauloDate } from "@/lib/utils";
import type { AppUser, Workday } from "@/types";

export default function Admin() {
  return <Protected role="admin"><AdminInner /></Protected>;
}

function AdminInner() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<AppUser[]>();
  const [days, setDays] = useState<Workday[]>();

  useEffect(() => {
    if (!profile) return;
    Promise.all([
      companyUsers(profile.companyId),
      companyWorkdays(profile.companyId, 20),
    ]).then(([userRows, workdayRows]) => {
      setUsers(userRows);
      setDays(workdayRows);
    });
  }, [profile]);

  const today = useMemo(() => days?.filter((day) => day.date === saoPauloDate()) ?? [], [days]);
  const employeeCount = users?.filter((user) => user.role === "employee" && user.active).length ?? 0;
  const counts = {
    working: today.filter((day) => day.status === "working").length,
    onBreak: today.filter((day) => day.status === "on_break").length,
    finished: today.filter((day) => day.status === "finished").length,
  };

  return (
    <AppShell title="Visão geral">
      {!users || !days ? <Loading /> : (
        <>
          <div className="metric-grid">
            <StatCard icon={<UserCheck />} label="Funcionários ativos" value={employeeCount} description="Colaboradores com acesso" />
            <StatCard icon={<Clock3 />} label="Trabalhando agora" value={counts.working} description="Jornadas em andamento" />
            <StatCard icon={<Coffee />} label="Em intervalo" value={counts.onBreak} description="Pausas registradas hoje" />
            <StatCard icon={<LogOut />} label="Jornada encerrada" value={counts.finished} description="Expedientes concluídos" />
          </div>

          <div className="admin-grid">
            <Card>
              <PanelHeader title="Últimos registros" description="Movimentações recentes da equipe." />
              <DataTable headers={["Funcionário", "Data", "Status"]}>
                {days.slice(0, 8).map((day) => (
                  <tr key={day.id}>
                    <td>{users.find((user) => user.uid === day.userId)?.name || day.employeeName || "Funcionário excluído"}</td>
                    <td>{day.date.split("-").reverse().join("/")}</td>
                    <td>
                      <Badge tone={day.status === "finished" ? "success" : day.status === "on_break" ? "warning" : "neutral"}>
                        {day.status === "day_off" ? "Folga" : day.status === "finished" ? "Encerrado" : day.status === "on_break" ? "Intervalo" : "Trabalhando"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </DataTable>
            </Card>

            <Card>
              <PanelHeader title="Sem registro hoje" description="Funcionários que ainda não iniciaram a jornada." />
              <div className="missing-list">
                {users
                  .filter((user) => user.role === "employee" && !today.some((day) => day.userId === user.uid))
                  .slice(0, 8)
                  .map((user) => (
                    <div key={user.uid}>
                      <span>{user.name.slice(0, 2).toUpperCase()}</span>
                      <div><b>{user.name}</b><small>{user.email}</small></div>
                    </div>
                  ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}
