import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
export const cn = (...v:(string|false|null|undefined)[]) => v.filter(Boolean).join(" ");
export const brDate = (date:Date|number) => format(date,"dd/MM/yyyy",{locale:ptBR});
export const brTime = (date:Date|number) => format(date,"HH:mm",{locale:ptBR});
export function saoPauloDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const get=(t:string)=>parts.find(p=>p.type===t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function haversine(aLat:number,aLng:number,bLat:number,bLng:number){
  const r=6371000,toRad=(n:number)=>n*Math.PI/180;
  const dLat=toRad(bLat-aLat),dLng=toRad(bLng-aLng);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
  return 2*r*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
export const randomToken=(bytes=24)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,"0")).join("");
