'use client';
import {useEffect,useState,type FormEvent} from 'react';
import styles from './demo-request.module.css';

export function DemoRequestForm({mode='demo'}:{mode?:'demo'|'trial'}){
  const isTrial=mode==='trial';
  const[companyName,setCompanyName]=useState('');
  const[contactName,setContactName]=useState('');
  const[contactEmail,setContactEmail]=useState('');
  const[planInterest,setPlanInterest]=useState('sin_definir');
  const[consent,setConsent]=useState(false);
  const[contactPhone,setContactPhone]=useState('');
  const[whatsappSetup,setWhatsappSetup]=useState('unsure');
  const[website,setWebsite]=useState('');
  useEffect(()=>{
    const requested=new URLSearchParams(window.location.search).get('plan');
    if(requested&&['basico','eco','pro'].includes(requested))
      setPlanInterest(requested);
  },[]);
  const[sending,setSending]=useState(false);
  const[error,setError]=useState('');
  const[success,setSuccess]=useState(false);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(sending||!consent)return;
    setError('');setSending(true);
    try{
      const response=await fetch('/api/marketing/demo-request',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({companyName,contactName,contactEmail,planInterest,consent,website,requestType:mode,contactPhone,whatsappSetup}),
      });
      const data=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!data.ok)throw new Error(data.error||'No se pudo registrar.');
      setSuccess(true);
      setContactEmail('');setContactName('');setCompanyName('');
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Error al enviar la solicitud.');
    }finally{setSending(false);}
  }
  if(success)return <div role="status" className={styles.success}>
    <strong>{isTrial?'Recibimos tu solicitud de prueba de 14 días':'Solicitud registrada para revisión'}</strong>
    <p>{isTrial?'Nuestro equipo revisará tu número, el plan y la conexión de canales. Los 14 días comenzarán únicamente después de que confirmemos y activemos la cuenta. Aún no se han creado usuarios ni iniciado cobros.':'El equipo de MW1 revisará tu solicitud antes de crear cualquier cuenta o activar un servicio.'}</p>
  </div>;
  return <form onSubmit={event=>void submit(event)} className={styles.form}>
    <p className={styles.caption}>{isTrial
      ?'Solicita 14 días de prueba guiada del plan que elijas. No necesitas tarjeta. La prueba no empieza al enviar este formulario; primero coordinaremos la activación contigo.'
      :'Formulario de solicitud. No implica contratación ni activa usuarios.'}</p>
    <label>Empresa
      <input required minLength={2} maxLength={100} autoComplete="organization"
        value={companyName} onChange={event=>setCompanyName(event.target.value)}
        placeholder="Nombre de tu empresa"/>
    </label>
    <label>Persona de contacto
      <input required minLength={2} maxLength={100} autoComplete="name"
        value={contactName} onChange={event=>setContactName(event.target.value)}
        placeholder="Nombre y apellido"/>
    </label>
    <label>Correo de contacto
      <input required type="email" maxLength={180} autoComplete="email"
        value={contactEmail} onChange={event=>setContactEmail(event.target.value)}
        placeholder="correo@empresa.com"/>
    </label>
    <label>Plan de interés
      <select value={planInterest} onChange={event=>setPlanInterest(event.target.value)}>
        <option value="sin_definir">No estoy seguro</option>
        <option value="basico">Básico</option>
        <option value="eco">Eco</option>
        <option value="pro">Pro</option>
      </select>
    </label>
    {isTrial&&<>
      <label>WhatsApp para que podamos contactarte
        <input required type="tel" inputMode="tel" autoComplete="tel" maxLength={20}
          value={contactPhone} onChange={event=>setContactPhone(event.target.value)}
          placeholder="Ej. +573001234567"/>
      </label>
      <label>¿Cómo utilizas WhatsApp actualmente?
        <select value={whatsappSetup} onChange={event=>setWhatsappSetup(event.target.value)}>
          <option value="business_app">Tengo WhatsApp Business en mi celular</option>
          <option value="cloud_api">Mi número ya está conectado a una API</option>
          <option value="new_number">Voy a conectar un número nuevo</option>
          <option value="unsure">No estoy seguro; necesito asesoría</option>
        </select>
      </label>
      <p className={styles.caption}>No desinstales WhatsApp Business ni borres tus chats. Revisaremos primero si tu número puede usar coexistencia o necesita otro procedimiento.</p>
    </>}
    <div className={styles.hidden} aria-hidden="true">
      <label>Sitio web <input tabIndex={-1} autoComplete="off"
        value={website} onChange={e=>setWebsite(e.target.value)}/></label>
    </div>
    <label className={styles.consent}>
      <input required type="checkbox" checked={consent}
        onChange={event=>setConsent(event.target.checked)}/>
      <span>Autorizo a MW1 a contactarme por correo o WhatsApp para responder esta solicitud
        comercial y coordinar, si corresponde, la prueba guiada. Enviarla no crea una cuenta, no activa un plan ni genera cargos.</span>
    </label>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" disabled={sending||!consent}>
      {sending?'Enviando…':isTrial?'Solicitar mis 14 días de prueba':'Solicitar asesoría de MW1'}
    </button>
  </form>;
}
