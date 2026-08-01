"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { Copy, Link2Off, Plus, Power, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Badge, Button, Card, DataTable, Empty, Field, Loading, Modal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { deleteEmployee } from "@/lib/admin-actions";
import { db } from "@/lib/firebase";
import { companyUsers } from "@/lib/queries";
import { randomToken } from "@/lib/utils";
import type { AppUser } from "@/types";

const schema = z.object({ email: z.string().email("E-mail inválido") });
type Form = z.infer<typeof schema>;
interface InviteRow { id: string; email: string; active: boolean; used: boolean; expiresAt?: Timestamp }

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
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<Form>({ resolver: zodResolver(schema) });

  const load = useCallback(async () => {
    if (!profile) return;
    const [allUsers, inviteSnapshot] = await Promise.all([
      companyUsers(profile.companyId),
      getDocs(query(
        collection(db, "invites"),
        where("companyId", "==", profile.companyId),
      )),
    ]);
    setUsers(allUsers.filter((user) => user.role === "employee"));
    setInvites(inviteSnapshot.docs.map((snapshot) => ({
      id: snapshot.id,
      ...snapshot.data(),
    } as InviteRow)).sort((a,b)=>(b.expiresAt?.toMillis()??0)-(a.expiresAt?.toMillis()??0)));
  }, [profile]);

  useEffect(() => { void load(); }, [load]);

  async function createInvite(values: Form) {
    if (!profile) return;
    try {
      setError("");
      const token = randomToken();
      await setDoc(doc(db, "invites", token), {
        companyId: profile.companyId,
        email: values.email.trim().toLowerCase(),
        role: "employee",
        token,
        active: true,
        used: false,
        expiresAt: Timestamp.fromMillis(new Date().getTime() + 7 * 86_400_000),
        createdAt: serverTimestamp(),
      });
      setLink(`${location.origin}/ativar?token=${token}`);
      reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao criar convite.");
    }
  }

  async function toggleUser(user: AppUser) {
    await updateDoc(doc(db, "users", user.uid), {
      active: !user.active,
      updatedAt: serverTimestamp(),
    });
    await load();
  }

  async function cancelInvite(inviteId: string) {
    await updateDoc(doc(db, "invites", inviteId), {
      active: false,
      canceledAt: serverTimestamp(),
      canceledBy: profile?.uid,
    });
    await load();
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
      <div className="stack">
        <Card>
          <div className="section-title">
            <h2>Funcionários</h2>
            <Button onClick={() => setOpen(true)}><Plus />Novo convite</Button>
          </div>
          {!users ? <Loading /> : users.length === 0
            ? <Empty title="Nenhum funcionário" description="Crie um convite para adicionar alguém." />
            : (
              <DataTable headers={["Nome", "E-mail", "Status", "Ação"]}>
                {users.map((user) => (
                  <tr key={user.uid}>
                    <td>{user.name}</td><td>{user.email}</td>
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
          <div className="section-title"><h2>Convites</h2></div>
          {!invites ? <Loading /> : invites.length === 0
            ? <Empty title="Nenhum convite" description="Convites enviados aparecem aqui." />
            : (
              <DataTable headers={["E-mail", "Validade", "Status", "Ação"]}>
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td>{invite.expiresAt?.toDate().toLocaleDateString("pt-BR") ?? "—"}</td>
                    <td><Badge tone={invite.used ? "success" : invite.active ? "warning" : "danger"}>{invite.used ? "Utilizado" : invite.active ? "Pendente" : "Cancelado"}</Badge></td>
                    <td>{invite.active && !invite.used && <button className="icon-button" onClick={() => cancelInvite(invite.id)} title="Cancelar convite"><Link2Off /></button>}</td>
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
            <p>Convite criado. Validade: 7 dias.</p>
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
