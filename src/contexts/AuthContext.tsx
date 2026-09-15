"use client";

import { browserLocalPersistence, onAuthStateChanged, setPersistence, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import type { AppUser } from "@/types";

type AuthState = { firebaseUser: User | null; profile: AppUser | null; loading: boolean; authError: string };
type Value = AuthState & { logout: () => Promise<void> };
const initialState: AuthState = { firebaseUser: null, profile: null, loading: true, authError: "" };
const logout = () => signOut(auth);
const AuthContext = createContext<Value>({ ...initialState, logout });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    let active = true;
    let revision = 0;
    let unsubscribe = () => {};

    setPersistence(auth, browserLocalPersistence).then(() => {
      if (!active) return;
      unsubscribe = onAuthStateChanged(auth, async (user) => {
        const currentRevision = ++revision;
        const isCurrent = () => active && currentRevision === revision;

        // A new session is not ready until its application profile has loaded.
        setState({ firebaseUser: user, profile: null, loading: !!user, authError: "" });
        if (!user) return;

        try {
          const snapshot = await getDoc(doc(db, "users", user.uid));
          if (!isCurrent()) return;
          setState({
            firebaseUser: user,
            profile: snapshot.exists() ? { ...snapshot.data(), uid: snapshot.id } as AppUser : null,
            loading: false,
            authError: snapshot.exists() ? "" : "Perfil não encontrado. Procure o administrador.",
          });
        } catch {
          if (isCurrent()) {
            setState({ firebaseUser: user, profile: null, loading: false, authError: "Não foi possível carregar seu perfil. Tente entrar novamente." });
          }
        }
      });
    }).catch(() => {
      if (active) setState({ ...initialState, loading: false, authError: "Não foi possível inicializar a sessão. Atualize a página e tente novamente." });
    });

    return () => {
      active = false;
      revision++;
      unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ ...state, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
