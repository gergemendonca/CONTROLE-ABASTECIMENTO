'use client';

import {useEffect,useState} from 'react';

type User={name:string;roles:string[]};

export default function Painel(){
 const [user,setUser]=useState<User|null>(null),[pending,setPending]=useState(0);
 useEffect(()=>{void (async()=>{const response=await fetch('/api/admin-session',{cache:'no-store'}),data:any=await response.json();if(!data.user){window.location.assign('/admin');return}setUser(data.user);try{const requests=await fetch('/api/fuel-requests?status=pending',{cache:'no-store'}),requestData:any=await requests.json();if(requests.ok)setPending((requestData.requests||[]).length)}catch{}})()},[]);
 async function leave(){await fetch('/api/admin-session',{method:'DELETE'});window.location.assign('/')}
 if(!user)return <main className="grid min-h-screen place-items-center bg-slate-50 text-lg">Carregando...</main>;
 const canAuthorize=user.roles.includes('admin')||user.roles.includes('autorizador');
 return <main className="min-h-screen bg-slate-50 p-5"><section className="mx-auto max-w-xl rounded-3xl bg-white p-7 shadow"><h1 className="text-3xl font-bold">Olá, {user.name}</h1><p className="mt-2 text-lg text-slate-600">Acesse as atividades permitidas para o seu usuário.</p>{pending>0&&<button type="button" onClick={()=>window.location.assign(canAuthorize?'/autorizacoes':'/avisos')} className={`mt-6 w-full rounded-2xl p-5 text-left shadow-lg ${canAuthorize?'bg-[#b3262b] text-white':'bg-[#e7b629] text-[#2c2509]'}`}><p className="text-xl font-extrabold">{canAuthorize?'PEDIDO PENDENTE DE AUTORIZAÇÃO':'NOVA SOLICITAÇÃO DE ABASTECIMENTO'}</p><p className="mt-1 text-lg font-bold">{pending} pedido(s). {canAuthorize?'Toque para autorizar agora.':'Toque para acompanhar.'}</p></button>}<div className="mt-7 grid gap-3">{user.roles.includes('solicitante')&&<button onClick={()=>window.location.assign('/solicitar-abastecimento')} className="min-h-14 rounded-xl bg-[#096a9b] px-4 py-2 text-lg font-bold text-white">Solicitar abastecimento</button>}{canAuthorize&&<button onClick={()=>window.location.assign('/autorizacoes')} className="min-h-14 rounded-xl bg-[#b3262b] px-4 py-2 text-lg font-bold text-white">Autorizar abastecimentos</button>}<button onClick={()=>window.location.assign('/avisos')} className="min-h-14 rounded-xl border-2 border-[#096a9b] px-4 py-2 text-lg font-bold text-[#096a9b]">Meus avisos</button><button onClick={()=>void leave()} className="min-h-14 rounded-xl border px-4 py-2 text-lg font-bold">Sair para a página inicial</button></div></section></main>
}
