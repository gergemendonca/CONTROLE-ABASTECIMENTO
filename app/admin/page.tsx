'use client';

import {useEffect,useState} from 'react';
import DashboardClient from './dashboard-client';

type Session={name:string;username:string;roles:string[];groupName?:'motorista'|'adm'|'gerencia';passwordChangeRequired?:boolean};
const canOpenAdm=(user:Session|null)=>!!user&&(user.groupName==='adm'||user.groupName==='gerencia');

export default function Admin(){
 const [user,setUser]=useState<Session|null>(null),[checking,setChecking]=useState(true),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
 const params=typeof window==='undefined'?null:new URLSearchParams(window.location.search),next=params?.get('next')||'',force=params?.get('force')==='1',destination=next.startsWith('/')&&!next.startsWith('//')?next:(force?'/admin':'/');
 useEffect(()=>{void fetch('/api/admin-session',{cache:'no-store'}).then(r=>r.json()).then(data=>{const current=data.user as Session|null;if(current?.passwordChangeRequired){window.location.replace('/?trocarSenha=1');return;}setUser(current||null);setUsername(current?.username||localStorage.getItem('controle-abastecimento-ultimo-usuario')||'');}).finally(()=>setChecking(false));},[]);
 useEffect(()=>{if(!force&&user&&!canOpenAdm(user))window.location.replace(destination);},[user,destination,force]);
 async function enter(event:React.FormEvent){event.preventDefault();setError('');const response=await fetch('/api/admin-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}),data:any=await response.json();if(!response.ok){setError(data.error||'Usuário ou senha incorretos.');return;}if(data.user?.passwordChangeRequired){window.location.assign('/?trocarSenha=1');return;}if(!canOpenAdm(data.user)){setError('Este usuário não possui permissão para acessar a Área Adm.');setPassword('');return;}localStorage.setItem('controle-abastecimento-ultimo-usuario',username.trim());setPassword('');window.location.assign(destination);}
 if(checking)return <main className="grid min-h-screen place-items-center bg-slate-50 text-lg">Verificando acesso...</main>;
 if(!force&&canOpenAdm(user))return <DashboardClient/>;
 if(!force&&user)return <main className="grid min-h-screen place-items-center bg-slate-50 text-lg">Abrindo seu painel...</main>;
 return <main className="min-h-screen bg-slate-50 p-5"><section className="mx-auto mt-16 max-w-md rounded-3xl bg-white p-7 shadow"><h1 className="text-3xl font-bold">Área administrativa</h1><p className="mt-2 text-lg">Entre com seu próprio usuário e senha cadastrados no app.</p><form onSubmit={enter} className="mt-6 space-y-4"><input autoFocus autoCapitalize="none" value={username} onChange={event=>setUsername(event.target.value)} placeholder="Seu usuário" className="h-16 w-full rounded-xl border p-4 text-xl"/><input required type="password" value={password} onChange={event=>setPassword(event.target.value)} placeholder="Sua senha" className="h-16 w-full rounded-xl border p-4 text-2xl"/><button className="h-14 w-full rounded-xl bg-[#096a9b] text-xl font-bold text-white">Entrar na Área Adm</button></form>{error&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-lg text-red-800">{error}</p>}</section></main>;
}
