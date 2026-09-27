'use client';
import Home from '../page';

export default function LancarAbastecimento(){return <div className="launch-only"><style>{`.launch-only main > div > header > .ml-auto,.launch-only main > div > header~button{display:none!important}`}</style><div className="mx-auto max-w-xl bg-[#f3f6f9] px-4 pt-5"><button type="button" onClick={()=>window.location.assign('/')} className="h-12 rounded-xl border-2 border-slate-500 bg-white px-5 text-lg font-bold text-slate-700">Página inicial</button></div><Home launch/></div>}
