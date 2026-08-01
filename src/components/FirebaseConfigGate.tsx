"use client";

import { Braces, Clock3 } from "lucide-react";
import { isFirebaseConfigured } from "@/lib/firebase";
import { Card } from "./ui";

const variables = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];

export function FirebaseConfigGate({ children }: { children: React.ReactNode }) {
  if (isFirebaseConfigured) return children;

  return (
    <main className="config-missing">
      <Card>
        <div className="brand">
          <span><Clock3 size={18} /></span>
          <b>Ponto <span>Uau</span></b>
        </div>
        <div className="config-icon"><Braces /></div>
        <span className="eyebrow">Configuração necessária</span>
        <h1>Conecte o Firebase</h1>
        <p>
          Crie o arquivo <code>.env.local</code>, adicione as variáveis públicas
          do aplicativo Web Firebase e reinicie o servidor.
        </p>
        <div className="config-vars">
          {variables.map((variable) => <code key={variable}>{variable}</code>)}
        </div>
        <small>Use o arquivo .env.example como modelo. Não envie chaves ao repositório.</small>
      </Card>
    </main>
  );
}
