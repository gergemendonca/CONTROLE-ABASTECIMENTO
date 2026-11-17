"use client";

import { useEffect, useState } from "react";
import AdminClient from "../admin-client";

export default function Viagens() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => { void fetch("/api/admin-session", { cache: "no-store" }).then(r => r.json()).then(data => { if (data.user?.roles?.includes("admin") || data.user?.groupName === "adm" || data.user?.groupName === "gerencia") setAllowed(true); else window.location.replace("/admin?next=/admin/viagens"); }).catch(() => window.location.replace("/admin?next=/admin/viagens")); }, []);
  if (allowed === null) return <main className="grid min-h-screen place-items-center bg-slate-50 text-lg">Verificando acesso...</main>;
  return <>
    <nav className="bg-slate-50 px-5 pt-5">
      <a href="/admin/viagens/turismo" className="inline-block rounded-xl bg-blue-800 px-5 py-3 font-bold text-white">Revisar viagens do Turismo</a>
    </nav>
    <AdminClient mode="list"/>
  </>;
}
