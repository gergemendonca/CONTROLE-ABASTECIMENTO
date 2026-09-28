'use client';
import {useEffect,useState} from 'react';

type Trip={id:number;vehicleLabel:string;departureDate:string;arrivalDate:string;route:string};
const formatDate=(date:string)=>date.split('-').reverse().join('/');

export default function SolicitarAbastecimento(){
 const [trips,setTrips]=useState<Trip[]>([]),[message,setMessage]=useState('Carregando viagens...');
 const origin=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('origem')==='adm'?'adm':'usuario';
 const backTo=origin==='adm'?'/admin':'/lancar-abastecimento';
 useEffect(()=>{void (async()=>{try{const response=await fetch('/api/trips?available=1',{cache:'no-store'}),data:any=await response.json();if(!response.ok){setMessage(data.error||'Não foi possível carregar as viagens.');return}setTrips(data.trips||[]);setMessage('')}catch{setMessage('Não foi possível carregar as viagens. Atualize a página e tente novamente.')}})()},[]);
 const description=origin==='adm'?'Selecione uma ou mais viagens que ainda estão no período e não possuem solicitação de abastecimento.':'Estas são as viagens associadas ao seu usuário que ainda estão no período e não possuem solicitação.';
 return <main className="min-h-screen bg-slate-50 p-5"><div className="mx-auto max-w-xl"><button type="button" onClick={()=>window.location.assign(backTo)} className="mb-5 h-14 w-full rounded-xl border-2 border-slate-500 bg-white px-3 text-lg font-bold text-slate-700">{origin==='adm'?'Página inicial do Adm':'Voltar'}</button><section className="rounded-3xl border-2 border-[#178045] bg-white p-6 shadow"><h1 className="text-3xl font-extrabold">Solicitar abastecimento</h1><p className="mt-3 text-lg text-slate-600">{description}</p><form action="/solicitar-abastecimento/detalhes" method="get" className="mt-6 space-y-3"><input type="hidden" name="origem" value={origin}/>{!message&&trips.length===0?<p className="rounded-xl bg-slate-50 p-4 text-lg">Não há viagens disponíveis para solicitação.</p>:trips.map(trip=><label key={trip.id} className="flex cursor-pointer items-start gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 text-lg"><input name="trip" value={trip.id} type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-[#178045]"/><span><strong>{trip.vehicleLabel}</strong><br/>{trip.route}<br/><small>Saída: {formatDate(trip.departureDate)} · Chegada: {formatDate(trip.arrivalDate)}</small></span></label>)}<button type="submit" className="mt-3 min-h-14 h-auto w-full rounded-xl bg-[#178045] px-4 py-2 text-lg font-bold leading-tight text-white disabled:opacity-50 sm:text-xl" disabled={!!message||!trips.length}>Enviar solicitação</button></form></section>{message&&<p role="status" className="mt-5 rounded-xl bg-sky-50 p-4 text-lg">{message}</p>}</div></main>;
}
