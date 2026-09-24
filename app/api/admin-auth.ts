import { env } from 'cloudflare:workers';

const encoder=new TextEncoder();
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const equal=(a:string,b:string)=>{if(a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0};
const cookie=(req:Request,name:string)=>req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||null;
async function signature(value:string){const secret=env.ADMIN_SESSION_SECRET;if(!secret)throw Error('ADMIN_SESSION_SECRET não configurado.');const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))));}
export async function verifyAdminPassword(value:unknown){const password=env.ADMIN_PASSWORD;if(!password||typeof value!=='string')return false;return equal(value,password)}
export async function createAdminSession(){const payload=encode(encoder.encode(JSON.stringify({exp:Math.floor(Date.now()/1000)+28800})));return payload+'.'+await signature(payload)}
export async function isAdmin(req:Request){try{const token=cookie(req,'admin_access');if(!token)return false;const [payload,provided]=token.split('.');if(!payload||!provided||!equal(provided,await signature(payload)))return false;const data=JSON.parse(new TextDecoder().decode(decode(payload))) as {exp?:number};return typeof data.exp==='number'&&data.exp>Math.floor(Date.now()/1000)}catch{return false}}
export function adminCookie(token:string){return `admin_access=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`}
