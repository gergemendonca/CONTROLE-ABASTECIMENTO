export function actionDate(value:unknown){
 if(typeof value!=='string'||!value.trim())return null;
 const normalized=value.trim().replace(' ','T');
 const parsed=new Date(normalized);
 if(!Number.isFinite(parsed.getTime())||parsed.getTime()>Date.now())return undefined;
 return parsed.toISOString();
}
