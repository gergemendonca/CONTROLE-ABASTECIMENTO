'use client';

import {useEffect, useState} from 'react';
import {usePathname} from 'next/navigation';

export function SessionGate({children}:{children:React.ReactNode}){
  const pathname=usePathname();
  const mustCheck=pathname!=='/';
  const needsLogin=mustCheck&&!pathname.startsWith('/admin');
  const [checked,setChecked]=useState(!mustCheck);

  useEffect(()=>{
    if(!mustCheck){setChecked(true);return;}
    setChecked(false);
    void fetch('/api/admin-session',{cache:'no-store'})
      .then(response=>response.json())
      .then(data=>{
        if(data.user?.passwordChangeRequired){window.location.replace('/?trocarSenha=1');return;}
        if(data.user){setChecked(true);return;}
        if(!needsLogin){setChecked(true);return;}
        const next=window.location.pathname+window.location.search;
        window.location.replace('/?next='+encodeURIComponent(next));
      })
      .catch(()=>needsLogin?window.location.replace('/?next='+encodeURIComponent(window.location.pathname+window.location.search)):setChecked(true));
  },[pathname,mustCheck,needsLogin]);

  if(mustCheck&&!checked)return <main className="grid min-h-screen place-items-center bg-slate-50 text-lg text-slate-600">Verificando acesso...</main>;
  return <>{children}</>;
}
