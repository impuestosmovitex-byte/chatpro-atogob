'use client';
import {useEffect,useState,type FormEvent} from 'react';
import styles from './demo-request.module.css';

export function DemoRequestForm(){
  const[companyName,setCompanyName]=useState('');
  const[contactName,setContactName]=useState('');
  const[contactEmail,setContactEmail]=useState('');
  const[planInterest,setPlanInterest]=useState('sin_definir');
  const[consent,setConsent]=useState(false);
  const[website,setWebsite]=useState('');
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
        body:JSON.stringify({companyName,contactName,contactEmail,planInterest,consent,website}),
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
    <strong>Solicitud registrada para revisión</strong>
    <p>El equipo de MW1 revisará tu solicitud antes de crear cualquier cuenta o activar un servicio.</p>
  </div>;
  return <form onSubmit={event=>void submit(event)} className={styles.form}>
    <p className={styles.caption}>Formulario de pruebas. No implica contratación ni activa usuarios.</p>
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
        <option value="inicial">Inicial</option>
        <option value="pro">Pro</option>
        <option value="empresa">Empresa</option>
      </select>
    </label>
    <div className={styles.hidden} aria-hidden="true">
      <label>Sitio web <input tabIndex={-1} autoComplete="off"
        value={website} onChange={e=>setWebsite(e.target.value)}/></label>
    </div>
    <label className={styles.consent}>
      <input required type="checkbox" checked={consent}
        onChange={event=>setConsent(event.target.checked)}/>
      <span>Autorizo el uso de mis datos de contacto para responder esta solicitud
        comercial sobre MW1. No se creará una cuenta ni se activará un plan por esta solicitud.</span>
    </label>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" disabled={sending||!consent}>
      {sending?'Enviando…':'Solicitar asesoría de MW1'}
    </button>
  </form>;
}
