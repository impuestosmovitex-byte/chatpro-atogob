'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PlatformSidebar } from '../../components/PlatformSidebar';
import Link from 'next/link';

type Entitlements = {
  planKey: string;
  aiEnabled: boolean;
  whatsappEnabled: boolean;
  instagramEnabled: boolean;
  messengerEnabled: boolean;
  automationsEnabled: boolean;
  statisticsEnabled: boolean;
  maxUsers: number | null;
  maxWhatsappLines: number | null;
};

type OnboardingStatus={
  stage:'create_owner'|'choose_plan'|'connect_channel'|'verify_real_message'|'ready_for_pilot_review';
  title:string; notes:string[];configuredChannels:number;
  pendingConnectors:number;connectorErrors:number;
  integrations:Array<{key:string;label:string;status:string;meaning:string}>;
};

type Company = {
  readiness?:OnboardingStatus;
  id: string;
  slug: string;
  name: string;
  status: string;
  activeUsers: number;
  entitlements: Entitlements;
};

type LinkedCompany={
  name:string;slug:string;source:string;billingStatus:string;verifiedAt:string;
  recommendedPlan:string|null;commercialMode:string;
  activeUsers:number|null;activeIntegrations:number|null;
  messages30d:number|null;aiResponses30d:number|null;
  lastMessageAt:string|null;activityObservedAt:string|null;
  aiCostStatus:string;recommendationReason:string;
};
type DemoLead={
  id:string;companyName:string;contactName:string;contactEmail:string;
  planInterest:string;status:string;createdAt:string;
};

type CompaniesResponse = {
  ok?: boolean;
  error?: string;
  companies?: Company[];
  linkedCompanies?: LinkedCompany[];
};

type FormState = {
  name: string;
  slug: string;
  planKey: string;
  aiEnabled: boolean;
  whatsappEnabled: boolean;
  instagramEnabled: boolean;
  messengerEnabled: boolean;
  automationsEnabled: boolean;
  statisticsEnabled: boolean;
  maxUsers: string;
  maxWhatsappLines: string;
  ownerFullName: string;
  ownerIdentifier: string;
  ownerPassword: string;
};

const initialForm: FormState = {
  name: '',
  slug: '',
  planKey: 'custom',
  aiEnabled: false,
  whatsappEnabled: true,
  instagramEnabled: false,
  messengerEnabled: false,
  automationsEnabled: true,
  statisticsEnabled: true,
  maxUsers: '3',
  maxWhatsappLines: '1',
  ownerFullName: '',
  ownerIdentifier: '',
  ownerPassword: '',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: 24,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #d9dde5',
  borderRadius: 10,
  padding: '11px 12px',
  fontSize: 14,
};

export default function PlatformCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [linkedCompanies,setLinkedCompanies]=useState<LinkedCompany[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [demoRequests,setDemoRequests]=useState<DemoLead[]>([]);
  const [demoLoading,setDemoLoading]=useState(false);
  const [demoAvailable,setDemoAvailable]=useState(false);

  async function load() {
    setLoading(true);
    setError('');

    try {
      const meResponse = await fetch('/api/platform-admin/me', { cache: 'no-store' });
      const me = (await meResponse.json()) as {
        ok?: boolean;
        platformAdmin?: boolean;
        error?: string;
      };

      if (!meResponse.ok || !me.ok || me.platformAdmin !== true) {
        setAuthorized(false);
        setError(me.error || 'No tienes permiso de Super Admin de MW1.');
        return;
      }

      setAuthorized(true);
      const response = await fetch('/api/platform-admin/companies', { cache: 'no-store' });
      const data = (await response.json()) as CompaniesResponse;

      if (!response.ok || !data.ok) {
        setError(data.error || 'No se pudieron cargar las empresas.');
        return;
      }

      setCompanies(data.companies || []);
      setLinkedCompanies(Array.isArray(data.linkedCompanies)?data.linkedCompanies:[]);
    } catch {
      setError('No se pudo cargar la administración de empresas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(()=>{
    if(authorized!==true)return;
    let active=true;
    setDemoLoading(true);
    fetch('/api/platform-admin/demo-requests',{cache:'no-store'})
      .then(async response=>{
        if(!active)return;
        if(!response.ok){
          setDemoAvailable(false);
          return;
        }
        const payload=await response.json() as {ok?:boolean;requests?:DemoLead[]};
        if(active&&payload.ok){
          setDemoAvailable(true);
          setDemoRequests(Array.isArray(payload.requests)?payload.requests:[]);
        }
      })
      .catch(()=>{if(active)setDemoAvailable(false);})
      .finally(()=>{if(active)setDemoLoading(false);});
    return()=>{active=false;};
  },[authorized]);

  function setValue<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function generateSlug(name: string) {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/platform-admin/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          maxUsers: Number(form.maxUsers),
          maxWhatsappLines: Number(form.maxWhatsappLines),
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        company?: { name?: string };
      };

      if (!response.ok || !data.ok) {
        setError(data.error || 'No se pudo crear la empresa.');
        return;
      }

      setSuccess(`${data.company?.name || 'La empresa'} quedó creada y aislada.`);
      setForm(initialForm);
      await load();
    } catch {
      setError('No se pudo crear la empresa.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6f8', color: '#171a21' }}>
      <PlatformSidebar />
      <main style={{ marginLeft: 176, padding: '38px 42px 80px', maxWidth: 1500 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4, color: '#9a7627' }}>
            SUPER ADMIN MW1
          </div>
          <h1 style={{ fontSize: 36, margin: '4px 0 6px' }}>Empresas</h1>
          <p style={{ margin: 0, color: '#667085' }}>
            Crea empresas independientes, define accesos y controla sus límites.
          </p>
          <p style={{fontSize:13,margin:'12px 0'}}>
            <Link href="/admin/planes">Definir planes comerciales (borradores) →</Link>
          </p>
        </div>

        {error ? (
          <div style={{ ...cardStyle, borderColor: '#f3c5c5', background: '#fff7f7', marginBottom: 18 }}>
            {error}
          </div>
        ) : null}
        {success ? (
          <div style={{ ...cardStyle, borderColor: '#b9e3c5', background: '#f4fff7', marginBottom: 18 }}>
            {success}
          </div>
        ) : null}

        {authorized === false ? null : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,430px),1fr))', gap: 22 }}>
            <form onSubmit={submit} style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>+ Nueva empresa</h2>
              <p style={{ color: '#667085', marginTop: -6 }}>
                La empresa inicia sin chats, clientes, productos ni credenciales de otra empresa.
              </p>

              <div style={{ display: 'grid', gap: 14 }}>
                <label>
                  <strong>Nombre de la empresa</strong>
                  <input
                    style={{ ...inputStyle, marginTop: 6 }}
                    value={form.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      setForm((current) => ({
                        ...current,
                        name,
                        slug: current.slug ? current.slug : generateSlug(name),
                      }));
                    }}
                    placeholder="Emprende Cosmoshogo"
                    required
                  />
                </label>

                <label>
                  <strong>Identificador</strong>
                  <input
                    style={{ ...inputStyle, marginTop: 6 }}
                    value={form.slug}
                    onChange={(event) => setValue('slug', generateSlug(event.target.value))}
                    placeholder="emprende-cosmoshogo"
                    required
                  />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <label>
                    <strong>Plan</strong>
                    <input style={{ ...inputStyle, marginTop: 6 }} value={form.planKey} onChange={(e) => setValue('planKey', e.target.value)} />
                  </label>
                  <label>
                    <strong>Usuarios</strong>
                    <input type="number" min="1" style={{ ...inputStyle, marginTop: 6 }} value={form.maxUsers} onChange={(e) => setValue('maxUsers', e.target.value)} />
                  </label>
                  <label>
                    <strong>Líneas WA</strong>
                    <input type="number" min="1" style={{ ...inputStyle, marginTop: 6 }} value={form.maxWhatsappLines} onChange={(e) => setValue('maxWhatsappLines', e.target.value)} />
                  </label>
                </div>

                <div style={{ borderTop: '1px solid #eceef2', paddingTop: 14 }}>
                  <strong>Módulos habilitados</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                    {([
                      ['aiEnabled', 'IA'],
                      ['whatsappEnabled', 'WhatsApp'],
                      ['instagramEnabled', 'Instagram'],
                      ['messengerEnabled', 'Messenger'],
                      ['automationsEnabled', 'Automatizaciones'],
                      ['statisticsEnabled', 'Estadísticas'],
                    ] as Array<[keyof FormState, string]>).map(([key, label]) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(form[key])}
                          onChange={(event) => setValue(key, event.target.checked as never)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #eceef2', paddingTop: 14 }}>
                  <strong>Propietario inicial</strong>
                  <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                    <input style={inputStyle} value={form.ownerFullName} onChange={(e) => setValue('ownerFullName', e.target.value)} placeholder="Nombre completo" required />
                    <input style={inputStyle} value={form.ownerIdentifier} onChange={(e) => setValue('ownerIdentifier', e.target.value)} placeholder="Código de acceso" required />
                    <input type="password" minLength={8} style={inputStyle} value={form.ownerPassword} onChange={(e) => setValue('ownerPassword', e.target.value)} placeholder="Contraseña inicial (mínimo 8 caracteres)" required />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  style={{ border: 0, borderRadius: 10, background: '#171a21', color: '#fff', padding: '12px 16px', fontWeight: 800, cursor: 'pointer' }}
                >
                  {saving ? 'Creando empresa…' : 'Crear empresa'}
                </button>
              </div>
            </form>

            <section style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0 }}>Directorio de empresas MW1</h2>
                  <p style={{ color: '#667085', margin: '5px 0 0' }}>{companies.length+linkedCompanies.length} empresas identificadas · {linkedCompanies.length} operativas vinculadas · {companies.length} en staging</p>
                </div>
                <button type="button" onClick={() => void load()} style={{ ...inputStyle, width: 'auto', cursor: 'pointer', background: '#fff' }}>
                  Actualizar
                </button>
              </div>

              {loading ? <p>Cargando…</p> : null}
              {!loading&&linkedCompanies.length>0&&<div style={{margin:'18px 0 22px',display:'grid',gap:12}}>
                <h3 style={{fontSize:17,margin:'4px 0'}}>Empresas operativas vinculadas</h3>
                <p style={{color:'#667085',fontSize:13,margin:0}}>
                  Cuentas existentes en el MW1 operativo. Son empresas clientes, no propietarios de MW1.
                  Estas fichas son referencias de solo lectura: sus conversaciones, accesos, contratos
                  y permisos siguen en su entorno original.
                </p>
                {linkedCompanies.map(linked=><article key={linked.slug} style={{border:'1px solid #dce6f2',background:'#f8fbff',borderRadius:12,padding:15}}>
                  <strong style={{fontSize:16}}>{linked.name}</strong>
                  <p style={{fontSize:12,color:'#63718a',margin:'4px 0 10px'}}>{linked.slug} · {linked.source}</p>
                  <p style={{fontSize:13,margin:'5px 0'}}><strong>Facturación MW1:</strong> Pendiente de configurar y validar; no significa servicio gratuito ni pago confirmado.</p>
                  <div style={{display:'grid',gap:9,gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',margin:'14px 0 10px'}}>
                    <span style={{fontSize:13}}><strong>Plan sugerido:</strong> {linked.recommendedPlan?.toUpperCase()||'Por evaluar'}<small style={{display:'block',color:'#64748b'}}>Solo comercial; sin aplicar límites</small></span>
                    <span style={{fontSize:13}}><strong>Usuarios registrados:</strong> {linked.activeUsers??'Sin medición'}</span>
                    <span style={{fontSize:13}}><strong>Conexiones activas registradas:</strong> {linked.activeIntegrations??'Sin medición'}</span>
                    <span style={{fontSize:13}}><strong>Mensajes / 30 días:</strong> {linked.messages30d?.toLocaleString('es-CO')??'Sin medición'}</span>
                    <span style={{fontSize:13}}><strong>Registros con respuesta IA / 30 días:</strong> {linked.aiResponses30d?.toLocaleString('es-CO')??'Sin medición'}</span>
                  </div>
                  <p style={{fontSize:12,color:'#45556d',margin:'5px 0'}}><strong>Último mensaje registrado:</strong> {linked.lastMessageAt?new Date(linked.lastMessageAt).toLocaleString('es-CO'):'No registrado'}</p>
                  <p style={{fontSize:12,color:'#45556d',margin:'5px 0'}}><strong>Costo verificable de OpenAI por empresa:</strong> No medido todavía. Las respuestas registradas no equivalen a tokens ni cargos.</p>
                  <p style={{fontSize:12,color:'#45556d',margin:'5px 0'}}><strong>Motivo:</strong> {linked.recommendationReason||'Por evaluar'}</p>
                  <p style={{fontSize:12,color:'#64748b',margin:'7px 0'}}><strong>Datos consultados:</strong> {linked.activityObservedAt?new Date(linked.activityObservedAt).toLocaleString('es-CO'):'Sin registro'}. Es una fotografía de actividad, no información en tiempo real.</p>
                  <p style={{fontSize:12,color:'#63718a',margin:'5px 0'}}>Sin sincronización automática de usuarios, consumos ni planes. No se creó una cuenta demo duplicada.</p>
                </article>)}
              </div>}
              <h3 style={{fontSize:17,margin:'20px 0 8px'}}>Empresas en pruebas de MW1</h3>
              {!loading && companies.length === 0 ? <p>No hay empresas todavía.</p> : null}

              <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
                {companies.map((company) => (
                  <article key={company.id} style={{ border: '1px solid #e7e9ee', borderRadius: 14, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <strong style={{ fontSize: 17 }}>{company.name}</strong>
                        <div style={{ color: '#667085', fontSize: 13 }}>{company.slug}</div>
                      </div>
                      <span style={{ alignSelf: 'start', background: company.status === 'active' ? '#eaf8ee' : '#f2f3f5', padding: '5px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                        {company.readiness?.configuredChannels
                          ? 'Canal registrado · operación sin verificar'
                          : 'Sin canales conectados'}
                      </span>
                      <span style={{fontSize:11,color:'#64748b',alignSelf:'center'}}>
                        Registro: {company.status}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14, fontSize: 13 }}>
                      <span><strong>Plan:</strong> {company.entitlements.planKey}</span>
                      <span><strong>Usuarios:</strong> {company.activeUsers}/{company.entitlements.maxUsers ?? '∞'}</span>
                      <span><strong>IA:</strong> {company.entitlements.aiEnabled ? 'Sí' : 'No'}</span>
                      <span><strong>WhatsApp:</strong> {company.entitlements.whatsappEnabled ? 'Sí' : 'No'}</span>
                      <span><strong>Automat.:</strong> {company.entitlements.automationsEnabled ? 'Sí' : 'No'}</span>
                      <span><strong>Estadísticas:</strong> {company.entitlements.statisticsEnabled ? 'Sí' : 'No'}</span>
                      <div style={{gridColumn:'1 / -1',marginTop:14,padding:'13px 14px',borderRadius:10,
                        background:'#f8f7f5',border:'1px solid #ebe8e4'}}>
                        <strong style={{fontSize:13}}>Incorporación y diagnóstico inicial</strong>
                        <p style={{fontSize:13,margin:'6px 0 10px',fontWeight:650}}>
                          {company.readiness?.title||'Estado aún no disponible'}
                        </p>
                        <div style={{display:'flex',gap:10,flexWrap:'wrap',fontSize:12}}>
                          <span>Canales registrados: {company.readiness?.configuredChannels??'—'}</span>
                          <span>Pendientes: {company.readiness?.pendingConnectors??'—'}</span>
                          <span>Con error: {company.readiness?.connectorErrors??'—'}</span>
                        </div>
                        {company.readiness?.integrations?.length?(
                          <p style={{fontSize:12,marginTop:9}}>
                            {company.readiness.integrations.map(i=>
                              i.label+': '+(i.status==='active'?'registrada':
                                i.status==='error'?'error':i.status==='pending'?'pendiente':'desconectada')
                            ).join(' · ')}
                          </p>
                        ):<p style={{fontSize:12}}>Sin integraciones reconocidas en el registro.</p>}
                        {company.readiness?.notes?.length?
                          <ul style={{fontSize:12,color:'#6b7280',paddingLeft:18,
                            lineHeight:1.55,margin:'9px 0 0'}}>
                            {company.readiness.notes.map((note,index)=><li key={index}>{note}</li>)}
                          </ul>:null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
        {authorized===true&&demoAvailable?(
          <section style={{...cardStyle,marginTop:24}}>
            <h2 style={{marginTop:0}}>Solicitudes de demo de MW1</h2>
            <p style={{color:'#667085',fontSize:13}}>
              Bandeja comercial de pruebas. Estas solicitudes no crean empresas,
              no activan planes y no confirman pagos.
            </p>
            {demoLoading?<p>Cargando solicitudes…</p>:null}
            {demoRequests.length===0?<p>Sin solicitudes registradas.</p>:
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead><tr style={{textAlign:'left'}}>
                    <th style={{padding:10}}>Empresa</th>
                    <th style={{padding:10}}>Contacto</th>
                    <th style={{padding:10}}>Plan consultado</th>
                    <th style={{padding:10}}>Estado</th>
                    <th style={{padding:10}}>Fecha</th>
                  </tr></thead>
                  <tbody>{demoRequests.map(lead=><tr key={lead.id}
                    style={{borderTop:'1px solid #eceef2'}}>
                    <td style={{padding:10}}>{lead.companyName}</td>
                    <td style={{padding:10}}>{lead.contactName}
                      <div><a href={'mailto:'+lead.contactEmail}>{lead.contactEmail}</a></div>
                    </td>
                    <td style={{padding:10}}>{lead.planInterest}</td>
                    <td style={{padding:10}}>{lead.status==='new'?'Nueva':lead.status}</td>
                    <td style={{padding:10}}>{new Date(lead.createdAt).toLocaleString('es-CO')}</td>
                  </tr>)}</tbody>
                </table>
              </div>}
          </section>
        ):null}
      </main>
    </div>
  );
}
