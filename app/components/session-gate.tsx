'use client';

import {useEffect, useState} from 'react';
import {usePathname} from 'next/navigation';

export function SessionGate({children}:{children:React.ReactNode}){
  const pathname=usePathname();
  const protectedPage=pathname!=='/'&&!pathname.startsWith('/admin');
  const [checked,setChecked]=useState(!protectedPage);

  useEffect(()=>{
    if(!protectedPage){setChecked(true);return;}
    setChecked(false);
    void fetch('/api/admin-session',{cache:'no-store'})
      .then(response=>response.json())
      .then(data=>{
        if(data.user){setChecked(true);return;}
        const next=window.location.pathname+window.location.search;
        window.location.replace('/?next='+encodeURIComponent(next));
      })
      .catch(()=>window.location.replace('/?next='+encodeURIComponent(window.location.pathname+window.location.search)));
  },[pathname,protectedPage]);

  if(protectedPage&&!checked)return <main className="grid min-h-screen place-items-center bg-slate-50 text-lg text-slate-600">Verificando acesso...</main>;
  return <>{children}</>;
}
