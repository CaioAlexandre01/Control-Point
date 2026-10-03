"use client";

import { doc, getDocFromServer } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";

export function useInitialSetup() {
  const [status, setStatus] = useState<"checking" | "required" | "ready" | "error">("checking");

  useEffect(() => {
    let active = true;
    // A reset may have removed the configuration since the last cached read.
    getDocFromServer(doc(db, "system", "config"))
      .then((snapshot) => {
        if (active) setStatus(snapshot.exists() ? "ready" : "required");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => { active = false; };
  }, []);

  return status;
}
