import { NextRequest, NextResponse } from 'next/server';
import { INBOX_SESSION_COOKIE, isInboxSessionValid } from '../../lib/inbox-auth';
export const dynamic = 'force-dynamic';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();
  if (!apiBase || !inboxKey) throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.');
  return { apiBase, inboxKey };
}
async function valid(request: NextRequest) { return isInboxSessionValid(request.cookies.get(INBOX_SESSION_COOKIE)?.value); }
async function forward(response: Response) { return new NextResponse(await response.text(), { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' } }); }
function url(request: NextRequest, id = '') {
  const company = request.nextUrl.searchParams.get('company')?.trim().toLowerCase() ?? '';
  if (!company) throw new Error('Falta la empresa.');
  const { apiBase } = config(); const target = new URL(`${apiBase}/quick-replies${id ? `/${encodeURIComponent(id)}` : ''}`);
  target.searchParams.set('company', company); return target;
}
function unauthorized() { return NextResponse.json({ ok:false, error:'Sesión requerida.' }, { status:401 }); }
export async function GET(request: NextRequest) {
  if (!(await valid(request))) return unauthorized();
  try { const { inboxKey } = config(); return forward(await fetch(url(request), { headers:{'x-chatpro-inbox-key':inboxKey}, cache:'no-store' })); }
  catch (error) { return NextResponse.json({ok:false,error:error instanceof Error?error.message:'No se pudieron cargar.'},{status:500}); }
}
async function mutate(request: NextRequest, method: 'POST'|'PUT'|'DELETE') {
  if (!(await valid(request))) return unauthorized();
  try {
    const id = request.nextUrl.searchParams.get('id')?.trim() ?? '';
    if ((method === 'PUT' || method === 'DELETE') && !id) return NextResponse.json({ok:false,error:'Falta la respuesta.'},{status:400});
    const { inboxKey } = config();
    const init: RequestInit = { method, headers:{'x-chatpro-inbox-key':inboxKey}, cache:'no-store' };
    if (method !== 'DELETE') { init.headers = {'x-chatpro-inbox-key':inboxKey,'content-type':'application/json'}; init.body = JSON.stringify(await request.json()); }
    return forward(await fetch(url(request,id), init));
  } catch (error) { return NextResponse.json({ok:false,error:error instanceof Error?error.message:'No se pudo completar.'},{status:500}); }
}
export async function POST(request: NextRequest) { return mutate(request,'POST'); }
export async function PUT(request: NextRequest) { return mutate(request,'PUT'); }
export async function DELETE(request: NextRequest) { return mutate(request,'DELETE'); }
