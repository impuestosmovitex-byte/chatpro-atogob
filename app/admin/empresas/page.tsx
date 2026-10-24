'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PlatformSidebar } from '../../components/PlatformSidebar';
import Link from 'next/link';
import {MW1_PILOT_PRESETS,resolvePilotPlan,type PilotPlan} from '../../lib/mw1-pilot-onboarding';

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

type RecoveryHelpRequest={
 id:string;companySlug:string;identifier:string;
 method:'email'|'phone';contact:string;status:string;createdAt:string;
};
type CompanyOwner={
 companyId:string;companyName:string;companySlug:string;userId:string;
 name:string;identifier:string;contactEmail:string;contactPhone:string;
 emailVerified:boolean;active:boolean;
};
type OwnerEdit={identifier:string;password:string;contactEmail:string;contactPhone:string};
type OwnerField=keyof OwnerEdit;
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
  requestType:'trial'|'demo';contactPhone:string|null;whatsappSetup:string|null;trialDays:number|null;trialActivatedAt:string|null;
  internalNote:string;followUpOn:string|null;
};

type LeadFollowupDraft={status:'new'|'contacted'|'qualified'|'closed';internalNote:string;followUpOn:string;};

const leadStatusOptions:LeadFollowupDraft['status'][]=['new','contacted','qualified','closed'];
const leadStatusLabels:Record<LeadFollowupDraft['status'],string>={new:'Nueva',contacted:'Contactada',qualified:'Calificada',closed:'Cerrada'};

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
  const [leadDrafts,setLeadDrafts]=useState<Record<string,LeadFollowupDraft>>({});
  const [leadSaving,setLeadSaving]=useState<string|null>(null);
  const [leadMessage,setLeadMessage]=useState('');
  const [reviewedCompanyAccess,setReviewedCompanyAccess]=useState(false);
  const [preparedFromLead,setPreparedFromLead]=useState<string|null>(null);
  const [owners,setOwners]=useState<CompanyOwner[]>([]);
  const [ownerEdits,setOwnerEdits]=useState<Record<string,OwnerEdit>>({});
  const [ownerBusy,setOwnerBusy]=useState<string|null>(null);
  const [ownerMessage,setOwnerMessage]=useState<Record<string,string>>({});
  const [recoveryHelp,setRecoveryHelp]=useState<RecoveryHelpRequest[]>([]);
  const [recoveryHelpError,setRecoveryHelpError]=useState('');



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

  async function loadOwners(){
    try{
      const response=await fetch('/api/platform-admin/companies/owners',{cache:'no-store'});
      if(!response.ok)return;
      const payload=await response.json() as {ok?:boolean;owners?:CompanyOwner[]};
      if(!payload.ok)return;
      const entries=payload.owners||[];
      setOwners(entries);
      setOwnerEdits(Object.fromEntries(entries.map(o=>[o.userId,{
        identifier:o.identifier,password:'',contactEmail:o.contactEmail,
        contactPhone:o.contactPhone,
      }])));
    }catch{/* Existing company directory remains available if owners endpoint is unavailable. */}
  }

  function ownerChange(userId:string,key:OwnerField,value:string){
    setOwnerEdits(current=>({...current,[userId]:{...current[userId],[key]:value}}));
    setOwnerMessage(current=>({...current,[userId]:''}));
  }

  async function saveOwner(company:Company,owner:CompanyOwner){
    const draft=ownerEdits[owner.userId];
    if(!draft||ownerBusy)return;
    const payload:Record<string,string>={companyId:company.id,userId:owner.userId};
    if(draft.identifier.trim()!==owner.identifier)payload.identifier=draft.identifier.trim();
    if(draft.password)payload.password=draft.password;
    if(draft.contactEmail.trim()!==owner.contactEmail)payload.contactEmail=draft.contactEmail.trim();
    if(draft.contactPhone.trim()!==owner.contactPhone)payload.contactPhone=draft.contactPhone.trim();
    if(Object.keys(payload).length===2){
      setOwnerMessage(current=>({...current,[owner.userId]:'No hay cambios pendientes.'}));return;
    }
    if(draft.password&&draft.password.length<12){
      setOwnerMessage(current=>({...current,[owner.userId]:'Usa una contraseña de al menos 12 caracteres, con letras y números.'}));return;
    }
    if(!window.confirm('¿Confirmas que deseas actualizar el acceso de '+owner.name+
       '? Si cambias la contraseña, la anterior dejará de funcionar.')){
      return;
    }
    setOwnerBusy(owner.userId);
    try{
      const response=await fetch('/api/platform-admin/companies/owners',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),
      });
      const result=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo actualizar el acceso.');
      setOwnerMessage(current=>({...current,[owner.userId]:
        'Acceso actualizado. Entrega la contraseña nueva al propietario por un canal seguro.'}));
      await loadOwners();
    }catch(error){
      setOwnerMessage(current=>({...current,[owner.userId]:
        error instanceof Error?error.message:'No se pudo actualizar el acceso.'}));
    }finally{setOwnerBusy(null);}
  }

  useEffect(()=>{
    if(authorized===true)void loadOwners();
  },[authorized]);
  useEffect(()=>{
    if(authorized!==true)return;
    fetch('/api/auth/recovery',{cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw new Error('No se pudo consultar recuperación.');
        return response.json();
      })
      .then((result:{ok?:boolean;requests?:RecoveryHelpRequest[]})=>{
        if(result.ok)setRecoveryHelp(result.requests||[]);
      })
      .catch(()=>setRecoveryHelpError('No se pudieron cargar solicitudes de recuperación.'));
  },[authorized]);


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
          const leads=Array.isArray(payload.requests)?payload.requests:[];
          setDemoRequests(leads);
          setLeadDrafts(Object.fromEntries(leads.map(lead=>[lead.id,{
            status:lead.status as LeadFollowupDraft['status'],
            internalNote:lead.internalNote??'',
            followUpOn:lead.followUpOn??'',
          }])));
        }
      })
      .catch(()=>{if(active)setDemoAvailable(false);})
      .finally(()=>{if(active)setDemoLoading(false);});
    return()=>{active=false;};
  },[authorized]);

  function updateLeadDraft(id:string,patch:Partial<LeadFollowupDraft>){
    setLeadDrafts(old=>({...old,[id]:{...old[id],...patch}}));
    setLeadMessage('');
  }

  async function saveLeadFollowup(id:string){
    const draft=leadDrafts[id];
    if(!draft||leadSaving)return;
    setLeadSaving(id);setLeadMessage('');
    try{
      const result=await fetch('/api/platform-admin/demo-requests',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({id,status:draft.status,internalNote:draft.internalNote,followUpOn:draft.followUpOn||null}),
      });
      const payload=await result.json() as {ok?:boolean;error?:string;message?:string};
      if(!result.ok||!payload.ok)throw new Error(payload.error||'No se pudo actualizar la solicitud.');
      setDemoRequests(current=>current.map(lead=>lead.id===id?{
        ...lead,status:draft.status,internalNote:draft.internalNote,followUpOn:draft.followUpOn||null,
      }:lead));
      setLeadMessage('Seguimiento guardado. El estado no activa ningún plan ni inicia una prueba.');
    }catch(e){setLeadMessage(e instanceof Error?e.message:'No se pudo guardar el seguimiento.');}
    finally{setLeadSaving(null);}
  }

  function formWithPilotPlan(plan:PilotPlan):FormState{
    const preset=MW1_PILOT_PRESETS[plan];
    return {...initialForm,planKey:preset.legacyKey,maxUsers:String(preset.users),
      maxWhatsappLines:String(preset.whatsappLines),aiEnabled:preset.ai,
      whatsappEnabled:true,instagramEnabled:preset.instagram,
      messengerEnabled:preset.messenger,automationsEnabled:preset.automation,
      statisticsEnabled:preset.statistics};
  }

  function prepareCompanyFromLead(lead:DemoLead){
    // Draft only. No credentials, plan assignment, subscriptions or companies are created.
    const pilotPlan=resolvePilotPlan(lead.planInterest);
    const base=pilotPlan?formWithPilotPlan(pilotPlan):initialForm;
    setForm({...base,name:lead.companyName,slug:generateSlug(lead.companyName)});
    setReviewedCompanyAccess(false);
    setPreparedFromLead(lead.id);
    setSuccess(pilotPlan
      ?'Propuesta '+MW1_PILOT_PRESETS[pilotPlan].name+' cargada. Comprueba módulos, capacidad y propietario antes de crear la cuenta.'
      :'El interesado no eligió un plan. Revísalo antes de crear la cuenta.');
    setError('');
    document.getElementById('mw1-new-company-form')?.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function setValue<K extends keyof FormState>(key: K, value: FormState[K]) {
    setReviewedCompanyAccess(false);
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
    if(!reviewedCompanyAccess){setError('Confirma primero el plan, los permisos y los datos del propietario.');return;}

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
      setReviewedCompanyAccess(false);
      setPreparedFromLead(null);
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
            <form id="mw1-new-company-form" onSubmit={submit} style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>+ Nueva empresa</h2>
              <p style={{ color: '#667085', marginTop: -6 }}>
                La empresa inicia sin chats, clientes, productos ni credenciales de otra empresa.
              </p>
              {preparedFromLead&&<p style={{background:'#fff6d5',padding:12,borderRadius:10,color:'#49390c',fontSize:13}}>Alta preparada a partir de una solicitud calificada. No se ha creado la empresa ni iniciado la prueba.</p>}

              <div style={{ display: 'grid', gap: 14 }}>
                <label>
                  <strong>Nombre de la empresa</strong>
                  <input
                    style={{ ...inputStyle, marginTop: 6 }}
                    value={form.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      setReviewedCompanyAccess(false);
                      setForm((current) => ({
                        ...current,
                        name,
                        slug: generateSlug(name),
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
                    <select aria-label="Elegir propuesta de plan" style={{ ...inputStyle, marginTop: 6 }}
                      value={form.planKey} onChange={(e)=>{
                        const value=e.target.value;
                        const p=resolvePilotPlan(value);
                        setForm(current=>p?{...current,
                          planKey:MW1_PILOT_PRESETS[p].legacyKey,
                          maxUsers:String(MW1_PILOT_PRESETS[p].users),
                          maxWhatsappLines:String(MW1_PILOT_PRESETS[p].whatsappLines),
                          aiEnabled:MW1_PILOT_PRESETS[p].ai,
                          whatsappEnabled:true,
                          instagramEnabled:MW1_PILOT_PRESETS[p].instagram,
                          messengerEnabled:MW1_PILOT_PRESETS[p].messenger,
                          automationsEnabled:MW1_PILOT_PRESETS[p].automation,
                          statisticsEnabled:MW1_PILOT_PRESETS[p].statistics
                        }:{...current,planKey:value});
                        setReviewedCompanyAccess(false);
                      }}>
                      <option value="custom">Personalizado (revisión manual)</option>
                      <option value="inicial">Básico</option>
                      <option value="pro">Eco</option>
                      <option value="empresa">Pro</option>
                    </select>
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

                <p style={{fontSize:12,lineHeight:1.6,color:'#58677c',margin:'-5px 0 1px'}}>
                  {resolvePilotPlan(form.planKey)
                    ? MW1_PILOT_PRESETS[resolvePilotPlan(form.planKey)!].note
                    :'Plan personalizado: verifica cada límite y capacidad antes de registrar.'}
                  {' '}Las líneas WhatsApp no representan el total de conexiones de distintos canales.
                </p>
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

                <label style={{display:'flex',gap:11,alignItems:'flex-start',padding:12,
                  background:'#f7f8fb',borderRadius:11,fontSize:13,lineHeight:1.6}}>
                  <input type="checkbox" required checked={reviewedCompanyAccess}
                    onChange={e=>setReviewedCompanyAccess(e.target.checked)}
                    style={{marginTop:4}}/>
                  <span>He verificado el nombre y plan, el límite de usuarios, los canales autorizados
                  y los datos de acceso del propietario. Crear esta empresa es una acción separada
                  de aprobar el cobro y de iniciar los días de prueba.</span>
                </label>
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
                      {owners.filter(owner=>owner.companyId===company.id).map(owner=>{
                        const draft=ownerEdits[owner.userId];
                        return <div key={owner.userId} style={{gridColumn:'1 / -1',
                          background:'#fffdf5',border:'1px solid #edd891',borderRadius:12,
                          padding:16,marginTop:10}}>
                          <h4 style={{margin:'0 0 5px',fontSize:15}}>Acceso del propietario · {owner.name}</h4>
                          <p style={{fontSize:12,color:'#63718a',lineHeight:1.65,margin:'0 0 12px'}}>
                            Cambia su código de acceso o establece una contraseña nueva si la olvidó.
                            No se puede consultar la clave anterior. Estos cambios no modifican
                            el plan, los límites ni las integraciones de la empresa.
                          </p>
                          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
                            <label style={{fontSize:12,fontWeight:750}}>Código de acceso
                              <input style={{...inputStyle,marginTop:5}}
                                maxLength={60} value={draft?.identifier??owner.identifier}
                                onChange={e=>ownerChange(owner.userId,'identifier',e.target.value)}/>
                            </label>
                            <label style={{fontSize:12,fontWeight:750}}>Nueva contraseña (si deseas cambiarla)
                              <input style={{...inputStyle,marginTop:5}} type="password"
                                autoComplete="new-password" minLength={12} maxLength={128}
                                value={draft?.password??''}
                                placeholder="Mín. 12, letras y números"
                                onChange={e=>ownerChange(owner.userId,'password',e.target.value)}/>
                            </label>
                            <label style={{fontSize:12,fontWeight:750}}>Correo para recuperación
                              <input style={{...inputStyle,marginTop:5}} type="email"
                                value={draft?.contactEmail??owner.contactEmail}
                                placeholder="correo@empresa.com"
                                onChange={e=>ownerChange(owner.userId,'contactEmail',e.target.value)}/>
                            </label>
                            <label style={{fontSize:12,fontWeight:750}}>Celular de recuperación
                              <input style={{...inputStyle,marginTop:5}} type="tel"
                                value={draft?.contactPhone??owner.contactPhone}
                                placeholder="+573001234567"
                                onChange={e=>ownerChange(owner.userId,'contactPhone',e.target.value)}/>
                            </label>
                          </div>
                          <p style={{fontSize:11,color:'#7c651c',lineHeight:1.5,margin:'10px 0'}}>
                            {owner.emailVerified?'Correo verificado para recuperación.':
                              'Correo no verificado: todavía no permite recuperar contraseñas automáticamente.'}
                            {' '}El celular requiere verificación con SMS/WhatsApp antes de habilitar ese mecanismo.
                          </p>
                          {ownerMessage[owner.userId]&&<p role="status"
                            style={{fontSize:12,padding:9,background:'#eef5ff',borderRadius:8}}>
                            {ownerMessage[owner.userId]}
                          </p>}
                          <button type="button" disabled={ownerBusy!==null||!draft}
                            onClick={()=>void saveOwner(company,owner)}
                            style={{background:'#f4bf00',padding:'11px 16px',fontWeight:800,
                              border:0,borderRadius:10,color:'#172235',cursor:'pointer'}}>
                            {ownerBusy===owner.userId?'Guardando…':'Guardar cambios de acceso'}
                          </button>
                        </div>;
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
        {authorized===true&&demoAvailable?(
          <section style={{...cardStyle,marginTop:24}}>
            <h2 style={{marginTop:0}}>Solicitudes comerciales y pruebas de MW1</h2>
            <p style={{color:'#667085',fontSize:13}}>
              Bandeja de solicitudes de demo y prueba guiada de 14 días. No crean empresas,
              no activan planes, no inician los 14 días y no confirman pagos.
            </p>
            {leadMessage&&<p role="status" style={{fontSize:13,padding:12,borderRadius:10,background:'#edf4ff'}}>{leadMessage}</p>}
            {demoLoading?<p>Cargando solicitudes…</p>:null}
            <p style={{fontSize:13,color:'#58677b',margin:'12px 0'}}>Flujo seguro: solicitud recibida → seguimiento y validación → preparar datos → confirmar propietario y permisos → crear la empresa. Guardar un seguimiento no activa la prueba ni realiza cobros.</p>
            {demoRequests.length===0?<p>Sin solicitudes registradas.</p>:
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead><tr style={{textAlign:'left'}}>
                    <th style={{padding:10}}>Empresa</th>
                    <th style={{padding:10}}>Contacto</th>
                    <th style={{padding:10}}>Solicitud</th>
                    <th style={{padding:10}}>Plan consultado</th>
                    <th style={{padding:10}}>Seguimiento y estado</th>
                    <th style={{padding:10}}>Fecha</th>
                  </tr></thead>
                  <tbody>{demoRequests.map(lead=><tr key={lead.id}
                    style={{borderTop:'1px solid #eceef2'}}>
                    <td style={{padding:10}}>{lead.companyName}</td>
                    <td style={{padding:10}}>{lead.contactName}
                      <div><a href={'mailto:'+lead.contactEmail}>{lead.contactEmail}</a></div>
                      {lead.contactPhone&&<div style={{display:'flex',flexWrap:'wrap',gap:9,marginTop:4}}>
                        <a href={'tel:'+lead.contactPhone}>{lead.contactPhone}</a>
                        <a href={'https://wa.me/'+lead.contactPhone.replace(/[^0-9]/g,'')}
                           target="_blank" rel="noopener noreferrer">Abrir WhatsApp ↗</a>
                      </div>}
                      {lead.whatsappSetup&&<div style={{fontSize:11,color:'#667085'}}>WhatsApp: {({
                        business_app:'Usa WhatsApp Business',
                        cloud_api:'Ya utiliza API',
                        new_number:'Número nuevo',
                        unsure:'Requiere orientación',
                      } as Record<string,string>)[lead.whatsappSetup]??'Por revisar'}</div>}
                    </td>
                    <td style={{padding:10}}>{lead.requestType==='trial'?'Prueba guiada 14 días':'Demo'}</td>
                    <td style={{padding:10}}>{{inicial:'Básico',basico:'Básico',eco:'Eco',pro:'Pro',empresa:'Pro (clave antigua)',sin_definir:'Por definir'}[lead.planInterest]??lead.planInterest}</td>
                    <td style={{padding:10,minWidth:210}}>
                      <div style={{display:'grid',gap:7}}>
                        <select aria-label={'Estado de '+lead.companyName} style={{...inputStyle,padding:7}}
                          value={leadDrafts[lead.id]?.status||lead.status}
                          onChange={e=>updateLeadDraft(lead.id,{status:e.target.value as LeadFollowupDraft['status']})}>
                          {leadStatusOptions.map(status=><option key={status} value={status}>{leadStatusLabels[status]}</option>)}
                        </select>
                        <textarea aria-label={'Notas de '+lead.companyName} rows={2} maxLength={1000}
                          value={leadDrafts[lead.id]?.internalNote??''}
                          onChange={e=>updateLeadDraft(lead.id,{internalNote:e.target.value})}
                          style={{...inputStyle,padding:7,fontSize:12}}
                          placeholder="Seguimiento, requisitos pendientes. Nunca guardes claves ni códigos."/>
                        <label style={{fontSize:11,color:'#667085'}}>Próximo contacto
                          <input type="date" aria-label={'Próximo contacto de '+lead.companyName}
                            value={leadDrafts[lead.id]?.followUpOn??''}
                            onChange={e=>updateLeadDraft(lead.id,{followUpOn:e.target.value})}
                            style={{...inputStyle,padding:7,marginTop:3}}/>
                        </label>
                        <button type="button" disabled={leadSaving!==null}
                          onClick={()=>void saveLeadFollowup(lead.id)}
                          style={{padding:'9px 12px',borderRadius:8,border:0,background:'#172235',color:'#fff',fontWeight:700,cursor:'pointer'}}>
                          {leadSaving===lead.id?'Guardando…':'Guardar seguimiento'}
                        </button>
                        {lead.status==='qualified'&&<button type="button"
                          onClick={()=>prepareCompanyFromLead(lead)}
                          style={{padding:'9px 12px',borderRadius:8,border:'1px solid #c49b1c',background:'#fff5c0',color:'#172235',fontWeight:750,cursor:'pointer'}}>
                          Preparar alta de empresa ↗
                        </button>}
                      </div>
                    </td>
                    <td style={{padding:10}}>{new Date(lead.createdAt).toLocaleString('es-CO')}</td>
                  </tr>)}</tbody>
                </table>
              </div>}
          </section>
        ):null}
        {authorized===true&&<section style={{...cardStyle,marginTop:24}}>
          <h2 style={{marginTop:0}}>Recuperación asistida de accesos</h2>
          <p style={{fontSize:13,color:'#63718a',lineHeight:1.7}}>
            Estas solicitudes pueden enviarse desde el acceso del cliente usando correo o celular.
            <strong> Ninguno de esos datos está verificado por el formulario.</strong> Antes de cambiar
            una contraseña, confirma la identidad del propietario por un canal independiente.
            Después utiliza «Acceso del propietario» en la empresa correspondiente.
            No envíes contraseñas por mensajes públicos.
          </p>
          {recoveryHelpError&&<p role="alert" style={{fontSize:12,color:'#ac3434'}}>{recoveryHelpError}</p>}
          {!recoveryHelp.length?<p style={{fontSize:13,color:'#64748b'}}>No hay solicitudes de recuperación registradas.</p>:
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                <thead><tr style={{textAlign:'left',borderBottom:'1px solid #ddd'}}>
                  <th style={{padding:8}}>Empresa</th><th style={{padding:8}}>Código</th>
                  <th style={{padding:8}}>Contacto declarado</th><th style={{padding:8}}>Fecha</th>
                </tr></thead>
                <tbody>{recoveryHelp.map(item=><tr key={item.id} style={{borderBottom:'1px solid #eee'}}>
                  <td style={{padding:8}}>{item.companySlug}</td>
                  <td style={{padding:8}}>{item.identifier}</td>
                  <td style={{padding:8}}>{item.method==='email'?'Correo':'Celular'}: {item.contact}
                    <p style={{fontSize:11,color:'#8b6111'}}>No verificado</p></td>
                  <td style={{padding:8}}>{new Date(item.createdAt).toLocaleString('es-CO')}</td>
                </tr>)}</tbody>
              </table>
            </div>}
        </section>}
      </main>
    </div>
  );
}
