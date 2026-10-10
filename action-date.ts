export function actionDate(value:unknown){
 if(typeof value!=='string'||!value.trim())return null;
 const raw=value.trim();
 const digits=raw.replace(/\D/g,'');
 const compact=digits.match(/^(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})$/);
 const brazilian=compact?[compact[0],compact[1],compact[2],compact[3],compact[4],compact[5]]:raw.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})(?:[ T](\d{2}):(\d{2}))?$/);
 const year=brazilian?(brazilian[3].length===2?`20${brazilian[3]}`:brazilian[3]):'';
 const normalized=brazilian?`${year}-${brazilian[2]}-${brazilian[1]}T${brazilian[4]||'00'}:${brazilian[5]||'00'}`:raw.replace(' ','T');
 const parsed=new Date(normalized);
 if(!Number.isFinite(parsed.getTime())||parsed.getTime()>Date.now())return undefined;
 return parsed.toISOString();
}
