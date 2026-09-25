'use client';

import {useEffect,useState} from 'react';

export type UpcomingTrip={id:number;departureDate:string;arrivalDate:string;route:string;totalKm:number};
const formatDate=(date:string)=>date.split('-').reverse().join('/');
const isoDate=(date:Date)=>date.toISOString().slice(0,10);

export function UpcomingTrips({vehicleId,onSelect}:{vehicleId:number;onSelect:(trip:UpcomingTrip)=>void}){
 const [trips,setTrips]=useState<UpcomingTrip[]>([]),[message,setMessage]=useState('Carregando viagens...');
 useEffect(()=>{const start=new Date(),end=new Date(start);end.setDate(end.getDate()+7);void (async()=>{try{const response=await fetch(`/api/trips?vehicleId=${vehicleId}&from=${isoDate(start)}&to=${isoDate(end)}`,{cache:'no-store'}),data:any=await response.json();if(!response.ok)throw Error(data.error);setTrips(data.trips||[]);setMessage('')}catch{setTrips([]);setMessage('Não foi possível carregar as viagens.')}})()},[vehicleId]);
 return <div className="mt-4"><p className="text-lg font-bold text-[#075579]">Viagens cadastradas: hoje e próximos 7 dias</p>{message?<p className="mt-2 text-base text-[#526979]">{message}</p>:trips.length===0?<p className="mt-2 rounded-xl bg-white p-3 text-base text-[#526979]">Nenhuma viagem cadastrada neste período.</p>:<div className="mt-3 space-y-2">{trips.map(trip=><button key={trip.id} type="button" onClick={()=>onSelect(trip)} className="w-full rounded-xl border-2 border-[#096a9b] bg-white p-3 text-left active:bg-[#dff2f7]"><p className="text-lg font-bold text-[#102b43]">{trip.route}</p><p className="mt-1 text-base text-[#526979]">{formatDate(trip.departureDate)} até {formatDate(trip.arrivalDate)} · {Number(trip.totalKm||0).toLocaleString('pt-BR')} km</p></button>)}</div>}</div>
}
