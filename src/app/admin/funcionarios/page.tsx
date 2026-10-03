"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { CheckCircle2, Copy, Link2Off, Mail, Plus, Power, RotateCw, Trash2, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Badge, Button, Card, DataTable, Empty, Field, Loading, Modal, PanelHeader, StatCard } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { createEmployeeInvite, deleteEmployee, listInvites, updateEmployeeInvite, type InviteRow } from "@/lib/admin-actions";
import { db } from "@/lib/firebase";
import { companyUsers } from "@/lib/queries";
import type { AppUser } from "@/types";

const schema = z.object({ email: z.string().email("E-mail inválido") });
type Form = z.infer<typeof schema>;

export default function Employees() {
  return <Protected role="admin"><EmployeesContent /></Protected>;
}

function EmployeesContent() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<AppUser[]>();
  const [invites, setInvites] = useState<InviteRow[]>();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [employeeToDelete, setEmployeeToDelete] = useState<AppUser>();
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busyInvite, setBusyInvite] = useState("");
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<Form>({ resolver: zodResolver(schema) });

  const load = useCallback(async () => {
    if (!profile) return;
    const [allUsers, result] = await Promise.all([
      companyUsers(profile.companyId),
      listInvites(),
    ]);
    setUsers(allUsers.filter((user) => user.role === "employee"));
    setInvites(result.invites);
  }, [profile]);

  useEffect(() => {
    const refresh = () => { void load().catch(() => setError("Não foi possível carregar os funcionários e convites. Tente novamente.")); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);

  async function createInvite(values: Form) {
    if (!profile) return;
    try {
      setError("");
      const { token } = await createEmployeeInvite(values.email);
      setLink(`${location.origin}/ativar?token=${token}`);
      reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao criar convite.");
    }
  }

  async function toggleUser(user: AppUser) {
    try {
    await updateDoc(doc(db, "users", user.uid), {
      active: !user.active,
      updatedAt: serverTimestamp(),
    });
    await load();
    } catch { setError("Não foi possível alterar o acesso do funcionário."); }
  }

  async function changeInvite(inviteId: string, action: "renew" | "cancel") {
    setBusyInvite(inviteId);
    setError("");
    try {
      await updateEmployeeInvite(inviteId, action);
      if (action === "renew") {
        setLink(`${location.origin}/ativar?token=${inviteId}`);
        setOpen(true);
      }
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o convite."); }
    finally { setBusyInvite(""); }
  }

  async function removeEmployee() {
    if (!employeeToDelete) return;
    try {
      setDeleting(true);
      setDeleteError("");
      await deleteEmployee(employeeToDelete.uid);
      setEmployeeToDelete(undefined);
      await load();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "Não foi possível excluir o funcionário.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell title="Funcionários">
      {error && !open && <Alert tone="error">{error}</Alert>}
      <div className="metric-grid employees-metrics">
        <StatCard
          icon={<UsersRound />}
          label="Funcionários ativos"
          value={users?.filter((user) => user.active).length ?? "—"}
          description="Colaboradores com acesso"
        />
        <StatCard
          icon={<Mail />}
          label="Convites pendentes"
          value={invites?.filter((invite) => invite.status === "pending").length ?? "—"}
          description="Aguardando aceite"
        />
        <StatCard
          icon={<CheckCircle2 />}
          label="Convites utilizados"
          value={invites?.filter((invite) => invite.used).length ?? "—"}
          description="Convites já aceitos"
        />
      </div>
      <div className="stack">
        <Card>
          <PanelHeader
            title="Funcionários"
            description="Gerencie acessos e acompanhe o status da equipe."
            actions={<Button onClick={() => setOpen(true)}><Plus />Novo convite</Button>}
          />
          {!users ? <Loading /> : users.length === 0
            ? <Empty title="Nenhum funcionário" description="Crie um convite para adicionar alguém." />
            : (
              <DataTable headers={["Nome", "E-mail", "Status", "Ação"]}>
                {users.map((user) => (
                  <tr key={user.uid}>
                    <td><div className="employee-cell"><span>{user.name.slice(0, 2).toUpperCase()}</span><strong>{user.name}</strong></div></td><td>{user.email}</td>
                    <td><Badge tone={user.active ? "success" : "danger"}>{user.active ? "Ativo" : "Inativo"}</Badge></td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-button" onClick={() => toggleUser(user)} title={user.active ? "Desativar" : "Ativar"}><Power /></button>
                        <button
                          className="icon-button delete-icon-button"
                          onClick={() => {
                            setEmployeeToDelete(user);
                            setDeleteError("");
                          }}
                          title="Excluir funcionário"
                          aria-label={`Excluir ${user.name}`}
                        >
                          <Trash2 />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
        </Card>
        <Card>
          <PanelHeader title="Convites" description="Histórico dos convites enviados pela empresa." />
          {!invites ? <Loading /> : invites.length === 0
            ? <Empty title="Nenhum convite" description="Convites enviados aparecem aqui." />
            : (
              <DataTable headers={["E-mail", "Validade", "Status", "Ação"]}>
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td>{invite.expiresAt ? new Date(invite.expiresAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</td>
                    <td><Badge tone={invite.status === "used" ? "success" : invite.status === "pending" ? "warning" : "danger"}>{{ used: "Utilizado", pending: "Pendente", expired: "Expirado", canceled: "Cancelado" }[invite.status]}</Badge></td>
                    <td>{!invite.used && <div className="row-actions">
                      <button className="icon-button" disabled={busyInvite === invite.id} onClick={() => changeInvite(invite.id, "renew")} title="Renovar por 7 dias"><RotateCw /></button>
                      {invite.active && <button className="icon-button" disabled={busyInvite === invite.id} onClick={() => changeInvite(invite.id, "cancel")} title="Cancelar convite"><Link2Off /></button>}
                    </div>}</td>
                  </tr>
                ))}
              </DataTable>
            )}
        </Card>
      </div>

      <Modal open={open} title="Convidar funcionário" onClose={() => { setOpen(false); setLink(""); }}>
        {error && <Alert tone="error">{error}</Alert>}
        {link ? (
          <div className="invite-link">
            <p>Convite válido por 7 dias. Compartilhe este link com o funcionário.</p>
            <code>{link}</code>
            <Button onClick={() => navigator.clipboard.writeText(link)}><Copy />Copiar link</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(createInvite)}>
            <Field label="E-mail" type="email" error={errors.email?.message} {...register("email")} />
            <div className="modal-actions">
              <Button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button loading={isSubmitting}>Criar convite</Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={Boolean(employeeToDelete)}
        title="Tem certeza?"
        onClose={() => { if (!deleting) setEmployeeToDelete(undefined); }}
      >
        {deleteError && <Alert tone="error">{deleteError}</Alert>}
        <p>
          Deseja excluir permanentemente o funcionário <strong>{employeeToDelete?.name}</strong>?
        </p>
        <div className="modal-actions">
          <Button className="secondary" disabled={deleting} onClick={() => setEmployeeToDelete(undefined)}>Cancelar</Button>
          <Button className="danger-button" loading={deleting} onClick={removeEmployee}>Excluir funcionário</Button>
        </div>
      </Modal>
    </AppShell>
  );
}
