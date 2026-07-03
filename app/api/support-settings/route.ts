import { NextRequest,NextResponse } from 'next/server';
import { INBOX_SESSION_COOKIE,isInboxSessionValid } from '../../lib/inbox-auth';
export const dynamic='force-dynamic';
const cfg=()=>{const apiBase=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,''),inboxKey=process.env.CHATPRO_INBOX_KEY?.trim();if(!apiBase||!inboxKey)throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');return{apiBase,inboxKey}};
const out=(r:Response)=>r.text().then(t=>new NextResponse(t,{status:r.status,headers:{'content-type':r.headers.get('content-type')??'application/json'}}));
async function go(r:NextRequest,method?:string){if(!(await isInboxSessionValid(r.cookies.get(INBOX_SESSION_COOKIE)?.value)))return NextResponse.json({ok:false,error:'Sesión requerida.'},{status:401});try{const company=r.nextUrl.searchParams.get('company')?.trim();if(!company)return NextResponse.json({ok:false,error:'Falta la empresa.'},{status:400});const {apiBase,inboxKey}=cfg(),u=new URL(apiBase+'/support-settings');u.searchParams.set('company',company);return out(await fetch(u,{method:method??'GET',headers:{'x-chatpro-inbox-key':inboxKey,...(method?{'content-type':'application/json'}:{})},body:method?JSON.stringify(await r.json()):undefined,cache:'no-store'}));}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Error'},{status:500});}}
export async function GET(r:NextRequest){return go(r)}
export async function PUT(r:NextRequest){return go(r,'PUT')}
