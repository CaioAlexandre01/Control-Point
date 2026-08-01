import type { Timestamp } from "firebase/firestore";
export type Role = "admin" | "employee";
export type WorkStatus = "working" | "on_break" | "finished";
export type EventType = "clock_in" | "break_start" | "break_end" | "clock_out";
export interface AppUser { uid:string; name:string; email:string; role:Role; companyId:string; active:boolean }
export interface Company { id:string; name:string; document:string; active:boolean; qrCodeId:string; latitude:number; longitude:number; radiusMeters:number }
export interface Workday { id:string; companyId:string; userId:string; employeeName?:string; date:string; status?:WorkStatus; clockInAt?:Timestamp; breakStartAt?:Timestamp; breakEndAt?:Timestamp; clockOutAt?:Timestamp; totalWorkedMinutes:number; totalBreakMinutes:number }
export interface Validation { company:Company; latitude:number; longitude:number; accuracy:number; distanceMeters:number; qrCodeId:string; validatedAt:number }
