'use client';

import {useEffect,useState} from 'react';

export function dateTimeMask(value:string){
 const digits=value.replace(/\D/g,'').slice(0,12);
 if(digits.length<=2)return digits;
 if(digits.length<=4)return `${digits.slice(0,2)}/${digits.slice(2)}`;
 if(digits.length<=8)return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
 if(digits.length<=10)return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4,8)} ${digits.slice(8)}`;
 return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4,8)} ${digits.slice(8,10)}:${digits.slice(10)}`;
}

export function RetroactiveDateDialog({open,title,description,onConfirm,onCancel}:{open:boolean;title:string;description:string;onConfirm:(value:string)=>void;onCancel:()=>void}){
 const [value,setValue]=useState('');
 useEffect(()=>{if(open)setValue('')},[open]);
 if(!open)return null;
 const valid=value.replace(/\D/g,'').length===12;
 return <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-5">
  <section role="dialog" aria-modal="true" aria-labelledby="retroactive-title" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
   <div className="rounded-2xl bg-amber-100 p-4 text-amber-950"><h2 id="retroactive-title" className="text-2xl font-extrabold">{title}</h2><p className="mt-2 text-base font-semibold">{description}</p></div>
   <label className="mt-5 block text-lg font-bold">Data e hora reais
    <input autoFocus inputMode="numeric" autoComplete="off" value={value} onChange={event=>setValue(dateTimeMask(event.target.value))} placeholder="DD/MM/AAAA HH:MM" aria-describedby="retroactive-help" className="mt-2 h-14 w-full rounded-xl border-2 border-slate-300 px-4 text-xl font-bold tracking-wide outline-none focus:border-[#096a9b]"/>
   </label>
   <p id="retroactive-help" className="mt-2 text-sm text-slate-600">Digite somente números: DDMMAAAA HHMM.</p>
   <div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" onClick={onCancel} className="min-h-13 rounded-xl border-2 border-slate-400 px-4 py-3 text-lg font-bold text-slate-700">Cancelar</button><button type="button" disabled={!valid} onClick={()=>onConfirm(value)} className="min-h-13 rounded-xl bg-[#178045] px-4 py-3 text-lg font-bold text-white disabled:opacity-50">Confirmar data</button></div>
  </section>
 </div>;
}
