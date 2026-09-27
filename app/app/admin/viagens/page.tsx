"use client";

import { useEffect, useState } from "react";
import AdminClient from "../admin-client";

export default function Viagens() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => { void fetch("/api/admin-session", { cache: "no-store" }).then(r => r.json()).then(data => { if (data.user?.roles?.includes("admin")) setAllowed(true); else window.location.replace("/admin?next=/admin/viagens"); }).catch(() => window.location.replace("/admin?next=/admin/viagens")); }, []);
  if (allowed === null) return <main className="grid min-h-screen place-items-center bg-slate-50 text-lg">Verificando acesso...</main>;
  return <AdminClient mode="list"/>;
}
