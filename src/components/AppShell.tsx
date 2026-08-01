"use client";
import Link from "next/link"; import { usePathname,useRouter } from "next/navigation";
import { BarChart3,Clock3,History,LayoutDashboard,LogOut,QrCode,Settings,UserRound,UsersRound,ClipboardList,Menu } from "lucide-react";
import { useState } from "react"; import { useAuth } from "@/contexts/AuthContext"; import { cn } from "@/lib/utils";
const employee=[["/ponto","Registrar ponto",Clock3],["/historico","Histórico",History],["/perfil","Meu perfil",UserRound]] as const;
const admin=[["/admin","Visão geral",LayoutDashboard],["/admin/funcionarios","Funcionários",UsersRound],["/admin/registros","Registros",ClipboardList],["/admin/relatorios","Relatórios",BarChart3],["/admin/qrcode","QR Code",QrCode],["/admin/configuracoes","Configurações",Settings]] as const;
export function AppShell({children,title}:{children:React.ReactNode;title:string}){
 const {profile,logout}=useAuth(),path=usePathname(),router=useRouter(),[open,setOpen]=useState(false),items=profile?.role==="admin"?admin:employee;
 return <div className="shell"><aside className={cn("sidebar",open&&"open")}><div className="brand"><span><Clock3 size={18}/></span><b>Ponto <span>Uau</span></b></div><nav>{items.map(([href,label,Icon])=><Link onClick={()=>setOpen(false)} className={path===href?"active":""} href={href} key={href}><Icon size={18}/>{label}</Link>)}</nav><button className="logout" onClick={async()=>{await logout();router.replace("/login")}}><LogOut size={18}/>Sair</button></aside><main><header><button className="menu" onClick={()=>setOpen(!open)}><Menu/></button><div><h1>{title}</h1><p>{profile?.name} · {profile?.role==="admin"?"Administrador":"Funcionário"}</p></div><div className="avatar">{profile?.name?.slice(0,2).toUpperCase()}</div></header><div className="content">{children}</div></main>{open&&<button className="scrim" onClick={()=>setOpen(false)}/>}</div>
}
