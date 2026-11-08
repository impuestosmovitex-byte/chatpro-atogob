import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { INBOX_SESSION_COOKIE, getInboxSession } from '../lib/inbox-auth';

export const dynamic = 'force-dynamic';

type Item = Record<string, unknown>;

function listFrom(payload: unknown, keys: string[]): Item[] {
  if (!payload || typeof payload !== 'object') return [];
  const object = payload as Record<string, unknown>;
  const candidates: unknown[] = [object, object.data, object.result];
  for (const value of candidates) {
    if (Array.isArray(value)) return value.filter((item): item is Item => !!item && typeof item === 'object' && !Array.isArray(item));
    if (!value || typeof value !== 'object') continue;
    const container = value as Record<string, unknown>;
    for (const key of keys) {
      const arr = container[key];
      if (Array.isArray(arr)) return arr.filter((item): item is Item => !!item && typeof item === 'object' && !Array.isArray(item));
    }
  }
  return [];
}

function safeText(value: unknown, max = 80): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
function title(item: Item): string {
  return safeText(item.name ?? item.title ?? item.automationKey ?? item.automation_key, 90);
}
function status(item: Item): string {
  const candidate = item.status ?? item.approvalStatus;
  return safeText(candidate, 30) || (typeof item.enabled === 'boolean' ? item.enabled ? 'Activa' : 'Inactiva' : 'Registrada');
}

async function readOnlyData(path: string, keys: string[]): Promise<Item[]> {
  const base = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const key = process.env.CHATPRO_INBOX_KEY?.trim();
  if (!base || !key) return [];
  try {
    const url = new URL(base + path);
    url.searchParams.set('company', 'atogob');
    const response = await fetch(url, {
      headers: { 'x-chatpro-inbox-key': key }, cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    return listFrom(payload, keys).slice(0, 100);
  } catch {
    return [];
  }
}

export default async function AtogobMetaReview() {
  const store = await cookies();
  const session = await getInboxSession(store.get(INBOX_SESSION_COOKIE)?.value);
  if (!session) redirect('/login?company=atogob&next=%2Frevision-atogob');
  if (session.type !== 'user' || session.companySlug !== 'atogob' || session.roleKey !== 'meta_reviewer_atogob') redirect('/');

  const [templates, automations] = await Promise.all([
    readOnlyData('/whatsapp-templates', ['templates','items','rows']),
    readOnlyData('/automations', ['automations','items','rows']),
  ]);

  const approved = templates.filter(x => status(x).toUpperCase() === 'APPROVED').length;
  const pageStyle: React.CSSProperties = { fontFamily:'Arial, sans-serif', maxWidth:1050, margin:'auto', padding:'32px 18px', color:'#142138' };
  const card: React.CSSProperties = { padding:20, border:'1px solid #e0e7f0', borderRadius:14, background:'#fff', minWidth:0 };
  const pill: React.CSSProperties = { borderRadius:99, background:'#edf3fb', padding:'7px 12px', fontSize:12, fontWeight:700 };
  return <main style={{ background:'#f5f7fb', minHeight:'100vh' }}>
    <div style={pageStyle}>
      <header style={{display:'flex',justifyContent:'space-between',gap:15,alignItems:'center',flexWrap:'wrap'}}>
        <div><div style={{color:'#9b7200',fontWeight:800,fontSize:12}}>ChatPro MW1 · ATOGOB · REVISIÓN EXCLUSIVA</div>
          <h1 style={{margin:'8px 0',fontSize:30}}>Vista de revisión — solo lectura</h1>
          <p>Configuraciones reales de ATOGOB, con acceso limitado y sin datos personales de clientes.</p>
        </div>
        <form action="/api/auth/logout" method="post"><button style={{border:0,background:'#13233f',color:'white',padding:'12px 18px',borderRadius:9}}>Cerrar sesión</button></form>
      </header>

      <div style={{padding:16,borderRadius:12,background:'#fff7db',border:'1px solid #ecd99a',margin:'24px 0',lineHeight:1.5}}>
        <strong>Cuenta de revisión protegida.</strong> Puede consultar este resumen, pero no puede abrir mensajes reales,
        datos de clientes, números de teléfono, configuraciones sensibles ni realizar envíos o cambios.
        Las estadísticas y nombres marcados como reales vienen de la configuración del CRM. La conversación inferior es un ejemplo simulado, no una transacción por la API de Meta.
      </div>

      <nav style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:22}}>
        <a style={pill} href="#plantillas">Plantillas de WhatsApp</a>
        <a style={pill} href="#automatizaciones">Automatizaciones</a>
        <a style={pill} href="#chat">Conversación de demostración</a>
      </nav>

      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:14,marginBottom:24}}>
        <div style={card}><div style={{fontSize:13,color:'#64748b'}}>Plantillas consultables</div><strong style={{fontSize:32}}>{templates.length}</strong><div style={{fontSize:12}}>Datos de configuración real</div></div>
        <div style={card}><div style={{fontSize:13,color:'#64748b'}}>Plantillas aprobadas</div><strong style={{fontSize:32}}>{approved}</strong><div style={{fontSize:12}}>Estado informado por el sistema</div></div>
        <div style={card}><div style={{fontSize:13,color:'#64748b'}}>Automatizaciones consultables</div><strong style={{fontSize:32}}>{automations.length}</strong><div style={{fontSize:12}}>Datos de configuración real</div></div>
      </section>

      <section id="plantillas" style={{...card,marginBottom:20}}>
        <h2 style={{marginTop:0}}>Plantillas de WhatsApp <span style={{fontSize:12,color:'#64748b'}}>(nombres y estados reales)</span></h2>
        <p>La información se consulta directamente desde MW1. No se muestran destinatarios, variables de clientes ni contenidos confidenciales.</p>
        {templates.length ? <div style={{display:'grid',gap:8}}>
          {templates.slice(0,16).map((t,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',borderBottom:'1px solid #e9edf4',padding:'10px 0'}}>
            <strong style={{overflowWrap:'anywhere'}}>{title(t) || 'Plantilla'}</strong><span style={{fontSize:12,color:'#176139',fontWeight:700}}>{status(t)}</span>
          </div>)}
        </div> : <p style={{color:'#6b7280'}}>No se pudo recuperar el listado en esta vista. No significa que ATOGOB no tenga plantillas.</p>}
      </section>

      <section id="automatizaciones" style={{...card,marginBottom:20}}>
        <h2 style={{marginTop:0}}>Automatizaciones <span style={{fontSize:12,color:'#64748b'}}>(configuración real)</span></h2>
        <p>Consulta únicamente de nombres y estados. No permite habilitar, deshabilitar ni editar acciones.</p>
        {automations.length ? <div style={{display:'grid',gap:8}}>
          {automations.slice(0,16).map((a,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',borderBottom:'1px solid #e9edf4',padding:'10px 0'}}>
            <strong>{title(a) || 'Automatización'}</strong><span style={{fontSize:12,fontWeight:700}}>{status(a)}</span>
          </div>)}
        </div> : <p style={{color:'#6b7280'}}>No se pudo recuperar el listado de automatizaciones en esta vista.</p>}
      </section>

      <section id="chat" style={card}>
        <h2 style={{marginTop:0}}>Bandeja comercial — recorrido ilustrativo</h2>
        <p style={{color:'#805500',fontWeight:700}}>SIMULACIÓN. No son mensajes reales ni acredita el envío mediante la API de WhatsApp.</p>
        <div style={{display:'grid',gap:12,maxWidth:680}}>
          <div style={{background:'#edf2fa',borderRadius:12,padding:15,justifySelf:'start',maxWidth:'80%'}}><small>Cliente de prueba</small><p>Hola, ¿tienen pantalones cargo disponibles?</p></div>
          <div style={{background:'#fff0b6',borderRadius:12,padding:15,justifySelf:'end',maxWidth:'80%'}}><small>Asistente IA · ejemplo</small><p>¡Hola! Podemos ayudarte a encontrar un pantalón cargo. ¿Qué talla prefieres?</p></div>
          <div style={{background:'#edf2fa',borderRadius:12,padding:15,justifySelf:'start',maxWidth:'80%'}}><small>Cliente de prueba</small><p>¿Tienen talla M en negro?</p></div>
          <div style={{background:'#fff0b6',borderRadius:12,padding:15,justifySelf:'end',maxWidth:'80%'}}><small>Asistente IA · ejemplo</small><p>Claro, voy a orientarte con las opciones disponibles en talla M.</p></div>
        </div>
        <p style={{fontSize:13,color:'#64748b',marginTop:20}}>Las grabaciones de operaciones reales se adjuntaron por separado a la solicitud de Meta.</p>
      </section>
    </div>
  </main>;
}
