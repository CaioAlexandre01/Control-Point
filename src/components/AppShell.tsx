"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  Clock3,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  Settings,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const employee = [
  ["/ponto", "Registrar ponto", Clock3],
  ["/historico", "Histórico", History],
  ["/perfil", "Meu perfil", UserRound],
] as const;

const admin = [
  ["/admin", "Visão geral", LayoutDashboard],
  ["/admin/funcionarios", "Funcionários", UsersRound],
  ["/admin/registros", "Registros", ClipboardList],
  ["/admin/relatorios", "Relatórios", BarChart3],
  ["/admin/qrcode", "QR Code", QrCode],
  ["/admin/configuracoes", "Configurações", Settings],
] as const;

export function AppShell({ children, title }: { children: React.ReactNode; title: string }) {
  const { profile, logout } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = profile?.role === "admin" ? admin : employee;

  return (
    <div className="shell">
      <aside className={cn("sidebar", open && "open")} aria-label="Navegação principal">
        <div className="sidebar-brand">
          <Link className="brand" href={profile?.role === "admin" ? "/admin" : "/ponto"} aria-label="Ponto Uau">
            <span><Clock3 size={20} /></span>
            <b>Ponto <em>Uau</em></b>
          </Link>
          <button className="sidebar-close" onClick={() => setOpen(false)} aria-label="Fechar menu"><X /></button>
        </div>
        <nav>
          {items.map(([href, label, Icon]) => (
            <Link
              onClick={() => setOpen(false)}
              className={path === href ? "active" : ""}
              href={href}
              key={href}
              title={label}
              aria-current={path === href ? "page" : undefined}
            >
              <Icon size={20} />
              <span className="nav-label">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="logout"
            title="Sair"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            <LogOut size={20} />
            <span className="nav-label">Sair</span>
          </button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="menu" onClick={() => setOpen(!open)} aria-label="Abrir menu"><Menu /></button>
          <div className="topbar-copy">
            <h1>{title}</h1>
            <p><span>{profile?.name}</span><i />{profile?.role === "admin" ? "Administrador" : "Funcionário"}</p>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
      {open && <button className="scrim" onClick={() => setOpen(false)} aria-label="Fechar menu" />}
    </div>
  );
}
