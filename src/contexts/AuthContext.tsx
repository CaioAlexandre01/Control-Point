"use client";
import { browserLocalPersistence, onAuthStateChanged, setPersistence, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import type { AppUser } from "@/types";
type Value={firebaseUser:User|null;profile:AppUser|null;loading:boolean;logout:()=>Promise<void>};
const AuthContext=createContext<Value>({firebaseUser:null,profile:null,loading:true,logout:async()=>{}});
export function AuthProvider({children}:{children:React.ReactNode}){
 const [firebaseUser,setUser]=useState<User|null>(null),[profile,setProfile]=useState<AppUser|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{
  let active=true;
  let unsubscribe=()=>{};
  setPersistence(auth,browserLocalPersistence).then(()=>{
   if(!active)return;
   unsubscribe=onAuthStateChanged(auth,async user=>{
    setUser(user);setProfile(null);
    try{if(user){const s=await getDoc(doc(db,"users",user.uid));if(s.exists())setProfile({...s.data(),uid:s.id} as AppUser)}}
    finally{if(active)setLoading(false)}
   });
  }).catch(()=>setLoading(false));
  return()=>{active=false;unsubscribe()};
 },[]);
 return <AuthContext.Provider value={{firebaseUser,profile,loading,logout:()=>signOut(auth)}}>{children}</AuthContext.Provider>
}
export const useAuth=()=>useContext(AuthContext);
