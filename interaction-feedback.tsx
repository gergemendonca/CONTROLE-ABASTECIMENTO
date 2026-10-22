'use client';

import {useEffect, useRef, useState} from 'react';

/**
 * Retorno visual comum a todas as telas: mostra que o toque foi recebido e
 * informa quando uma consulta ao sistema está demorando para concluir.
 */
export function InteractionFeedback(){
 const [loading,setLoading]=useState(false);
 const [clicked,setClicked]=useState(false);
 const pending=useRef(0),loadingTimer=useRef<ReturnType<typeof setTimeout>|null>(null),clickedTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

 useEffect(()=>{
  const originalFetch=window.fetch.bind(window);
  const begin=()=>{
   pending.current+=1;
   if(pending.current===1)loadingTimer.current=setTimeout(()=>setLoading(true),180);
  };
  const end=()=>{
   pending.current=Math.max(0,pending.current-1);
   if(pending.current===0){
    if(loadingTimer.current)clearTimeout(loadingTimer.current);
    loadingTimer.current=null;
    setLoading(false);
   }
  };
  window.fetch=(async (...args:Parameters<typeof fetch>)=>{
   begin();
   try{return await originalFetch(...args)}finally{end()}
  }) as typeof fetch;
  return ()=>{
   window.fetch=originalFetch;
   if(loadingTimer.current)clearTimeout(loadingTimer.current);
   if(clickedTimer.current)clearTimeout(clickedTimer.current);
  };
 },[]);

 useEffect(()=>{
  const clickedButton=(event:MouseEvent)=>{
   const target=event.target;
   if(!(target instanceof Element))return;
   const button=target.closest('button:not(:disabled)');
   if(!button)return;
   button.classList.remove('app-button-activated');
   void button.getBoundingClientRect();
   button.classList.add('app-button-activated');
   setClicked(true);
   if(clickedTimer.current)clearTimeout(clickedTimer.current);
   clickedTimer.current=setTimeout(()=>setClicked(false),900);
   setTimeout(()=>button.classList.remove('app-button-activated'),650);
  };
  document.addEventListener('click',clickedButton,true);
  return ()=>document.removeEventListener('click',clickedButton,true);
 },[]);

 return <>
  {loading&&<div className="app-loading-overlay" role="status" aria-live="assertive"><div className="app-loading-card"><span className="app-loading-spinner" aria-hidden="true"/><strong>Aguarde, carregando informações...</strong></div></div>}
  {clicked&&<p className="app-click-feedback" role="status" aria-live="polite">✓ Comando recebido</p>}
 </>;
}
