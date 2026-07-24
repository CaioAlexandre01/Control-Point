import type { Metadata } from "next"; import { Inter } from "next/font/google"; import "./globals.css"; import { AuthProvider } from "@/contexts/AuthContext"; import { FirebaseConfigGate } from "@/components/FirebaseConfigGate";
const inter=Inter({subsets:["latin"]});
export const metadata:Metadata={title:"Pontofy — Registro de ponto",description:"Controle de jornada com validação por QR Code e GPS."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body suppressHydrationWarning className={inter.className}><FirebaseConfigGate><AuthProvider>{children}</AuthProvider></FirebaseConfigGate></body></html>}
