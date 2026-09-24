'use client';

import {useEffect,useState} from 'react';

type Trip={id:number;vehicleLabel:string;departureDate:string;arrivalDate:string;route:string};
const formatDate=(date:string)=>date.split('-').reverse().join('/');

export default function SolicitarAbastecimento(){
 const [trips,setTrips]=useState<Trip[]>([]),[message,setMessage]=useState('Carregando viagens...');
 useEffect(()=>{void (async()=>{try{const response=await fetch('/api/trips',{cache:'no-store'}),data:any=await response.json();if(!response.ok){setMessage(data.error||'Não foi possível carregar as viagens.');return}const today=new Date().toISOString().slice(0,10);setTrips((data.trips||[]).filter((trip:Trip)=>(trip.arrivalDate||trip.departureDate)>=today));setMessage('')}catch{setMessage('Não foi possível carregar as viagens. Atualize a página e tente novamente.')}})()},[]);

 return <main className="min-h-screen bg-slate-50 p-5"><div className="mx-auto max-w-xl"><div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2"><button type="button" onClick={()=>window.location.assign('/admin')} className="h-14 rounded-xl border-2 border-slate-500 px-3 text-base font-bold text-slate-700 sm:text-lg">Voltar para Adm</button><button type="button" onClick={()=>window.location.assign('/')} className="h-14 rounded-xl border-2 border-slate-500 px-3 text-base font-bold text-slate-700 sm:text-lg">Página inicial</button></div><section className="rounded-3xl border-2 border-[#096a9b] bg-white p-6 shadow"><h1 className="text-3xl font-bold">Solicitar abastecimento</h1><p className="mt-3 text-lg text-slate-600">Marque uma ou várias viagens que devem entrar no pedido.</p><form action="/solicitar-abastecimento/detalhes" method="get" className="mt-5 space-y-3">{!message&&trips.length===0?<p className="rounded-xl bg-slate-50 p-4 text-lg">Não há viagens pendentes a partir de hoje.</p>:trips.map(trip=><label key={trip.id} className="flex cursor-pointer items-start gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 text-lg"><input name="trip" value={trip.id} type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-[#178045]"/><span><strong>{trip.vehicleLabel}</strong><br/>{trip.route}<br/><small>{formatDate(trip.departureDate)} a {formatDate(trip.arrivalDate)}</small></span></label>)}<button type="submit" className="mt-3 min-h-14 h-auto w-full rounded-xl bg-[#178045] px-4 py-2 text-lg font-bold leading-tight text-white sm:text-xl">OK — informar litros e KM</button></form></section>{message&&<p role="status" className="mt-5 rounded-xl bg-sky-50 p-4 text-lg">{message}</p>}</div></main>
}
