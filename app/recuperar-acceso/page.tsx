'use client';
import {FormEvent,useEffect,useState} from 'react';
import Link from 'next/link';
import styles from '../login/page.module.css';
export default function RecoveryPage(){
 const [companySlug,setCompanySlug]=useState('');
 const [identifier,setIdentifier]=useState('');
 const [method,setMethod]=useState<'email'|'phone'>('email');
 const [contact,setContact]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>{setCompanySlug(new URLSearchParams(window.location.search).get('company')||'');},[]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setMessage('');setError('');setBusy(true);
  try{
   const result=await fetch('/api/auth/recovery',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({companySlug,identifier,method,contact}),
   });
   const data=await result.json() as {ok?:boolean;error?:string;message?:string};
   if(!result.ok||!data.ok)throw new Error(data.error||'No se pudo registrar.');
   setMessage(data.message||'Solicitud recibida.');
  }catch(err){setError(err instanceof Error?err.message:'No se pudo registrar.');}
  finally{setBusy(false);}
 }
 return <main className={styles.shell}>
  <section className={styles.card}>
   <div className={styles.mark}>MW1</div>
   <p className={styles.eyebrow}>MW1 · RECUPERAR ACCESO</p>
   <h1>¿Olvidaste tu contraseña?</h1>
   <p className={styles.copy}>Solicita ayuda para recuperar tu empresa. Un asesor verificará tu identidad antes de cambiar la contraseña.</p>
   <form className={styles.form} onSubmit={submit}>
    <label htmlFor="company">Identificador de la empresa</label>
    <input id="company" value={companySlug} onChange={e=>setCompanySlug(e.target.value)}
      placeholder="ej. piloto-mw1-prueba" required maxLength={60}/>
    <label htmlFor="identifier">Tu código de acceso</label>
    <input id="identifier" value={identifier} onChange={e=>setIdentifier(e.target.value)}
      placeholder="Código con el que ingresas" required maxLength={60}/>
    <label htmlFor="method">¿Cómo podemos contactarte?</label>
    <select id="method" value={method} onChange={e=>{setMethod(e.target.value as 'email'|'phone');setContact('');}}
      style={{padding:12,borderRadius:10,border:'1px solid #dfe4ec',fontSize:14}}>
     <option value="email">Correo electrónico</option>
     <option value="phone">Celular</option>
    </select>
    <label htmlFor="contact">{method==='email'?'Correo de contacto':'Celular de contacto'}</label>
    <input id="contact" type={method==='email'?'email':'tel'} required
      value={contact} maxLength={254} onChange={e=>setContact(e.target.value)}
      placeholder={method==='email'?'correo@empresa.com':'+573001234567'}/>
    <p className={styles.copy} style={{margin:'5px 0 2px'}}>
     Esta solicitud no restablece tu contraseña automáticamente ni confirma la propiedad del correo o celular.
     No envíes contraseñas, códigos de seguridad ni datos bancarios. El equipo te ayudará a validar tu identidad.
    </p>
    {message&&<p role="status" style={{fontSize:13,color:'#246442'}}>{message}</p>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" disabled={busy}>{busy?'Enviando…':'Solicitar recuperación'}</button>
   </form>
   <p className={styles.copy}><Link href={companySlug?'/login?company='+encodeURIComponent(companySlug):'/login'}>
    Volver a iniciar sesión
   </Link></p>
  </section>
 </main>;
}
