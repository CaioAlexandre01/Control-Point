"use client";
import { LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
export function Button({className,loading,...p}:React.ButtonHTMLAttributes<HTMLButtonElement>&{loading?:boolean}){return <button className={cn("button",className)} disabled={p.disabled||loading} {...p}>{loading&&<LoaderCircle size={16} className="spin"/>}{p.children}</button>}
export function Card({className,...p}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn("card",className)} {...p}/>}
export function Field({label,error,...p}:React.InputHTMLAttributes<HTMLInputElement>&{label:string;error?:string}){return <label className="field"><span>{label}</span><input {...p}/>{error&&<small>{error}</small>}</label>}
export function Badge({children,tone="neutral"}:{children:React.ReactNode;tone?:"neutral"|"success"|"warning"|"danger"}){return <span className={`badge ${tone}`}>{children}</span>}
export function Empty({title,description}:{title:string;description:string}){return <div className="empty"><div>—</div><strong>{title}</strong><span>{description}</span></div>}
export function Loading(){return <div className="loading"><LoaderCircle className="spin"/>Carregando…</div>}
export function Alert({children,tone="info"}:{children:React.ReactNode;tone?:"info"|"error"|"success"}){return <div className={`alert ${tone}`}>{children}</div>}
export function Modal({open,title,children,onClose}:{open:boolean;title:string;children:React.ReactNode;onClose:()=>void}){if(!open)return null;return <div className="modal-backdrop" role="dialog" aria-modal="true"><Card className="modal"><div className="modal-title"><h2>{title}</h2><button onClick={onClose} aria-label="Fechar"><X/></button></div>{children}</Card></div>}
export function DataTable({headers,children}:{headers:string[];children:React.ReactNode}){return <div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
