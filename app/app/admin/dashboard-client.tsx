"use client";

const cards = [
  { label: "Nova viagem", icon: "🚚", color: "bg-[#1677d8] text-white", href: "/admin/viagens/nova" },
  { label: "Listar viagens", icon: "▤", color: "bg-[#7441c8] text-white", href: "/admin/viagens" },
  { label: "Solicitar abastecimento", icon: "⛽", color: "bg-[#0b7184] text-white", href: "/solicitar-abastecimento" },
  { label: "AUTORIZAR", icon: "✓", color: "bg-[#c9272c] text-white", href: "/pedidos?status=pending", prominent: true },
  { label: "Pendências", icon: "!", color: "bg-[#f5b51b] text-[#2c2509]", href: "/pedidos?status=pending" },
  { label: "Autorizados", icon: "✓", color: "bg-[#188145] text-white", href: "/pedidos?status=authorized" },
  { label: "Abastecimentos feitos", icon: "▤", color: "bg-[#0f8f8e] text-white", href: "/admin/abastecimentos-feitos" },
  { label: "Configurações", icon: "⚙", color: "bg-[#46515d] text-white", href: "/admin/configuracoes" },
];

export default function DashboardClient() {
  return <main className="min-h-screen bg-[#f3f6f9] p-5"><div className="mx-auto max-w-xl"><header className="mb-6 flex items-center gap-3"><img src="/icon.png" alt="SD Tour Abastecimento" className="h-16 w-16 rounded-2xl shadow"/><div><p className="text-sm font-bold uppercase tracking-[.12em] text-[#b3262b]">SD Tour</p><h1 className="text-3xl font-extrabold text-slate-900">Área Adm</h1></div></header><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{cards.map(card=><button key={card.label} type="button" onClick={()=>window.location.assign(card.href)} className={`flex min-h-32 flex-col items-center justify-center rounded-2xl px-3 py-4 text-center shadow-sm transition active:scale-[.98] ${card.color} ${card.prominent?"ring-4 ring-red-100":""}`}><span className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-white/20 text-2xl font-extrabold">{card.icon}</span><span className={`font-extrabold leading-tight ${card.prominent?"text-lg":"text-base"}`}>{card.label}</span></button>)}</div><button type="button" onClick={()=>window.location.assign('/')} className="mt-6 h-14 w-full rounded-xl border-2 border-slate-500 bg-white px-3 text-lg font-bold text-slate-700">Sair da Área Adm</button></div></main>;
}
