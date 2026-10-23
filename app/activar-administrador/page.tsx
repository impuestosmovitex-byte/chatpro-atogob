'use client';
import {useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';

export default function ActivateStagingAdmin(){
 const [token,setToken]=useState('');
 const [codeCopied,setCodeCopied]=useState(false);
 const [password,setPassword]=useState('');
 const [confirm,setConfirm]=useState('');
 const [error,setError]=useState('');
 const [done,setDone]=useState(false);
 const [loading,setLoading]=useState(false);
 useEffect(()=>{
  const parsed=/^#token=([0-9a-f]{64})$/.exec(window.location.hash);
  if(parsed)setToken(parsed[1]);
  window.history.replaceState(null,'','/activar-administrador');
 },[]);
 function generateCode(){
  const bytes=new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  setToken(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''));
  setCodeCopied(false);setError('');
 }
 async function copyCode(){
  try{await navigator.clipboard.writeText(token);setCodeCopied(true);}
  catch{setError('Copia el código manualmente si el navegador bloquea el portapapeles.');}
 }
 async function activate(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setError('');
  if(!token){setError('El enlace no contiene una invitación válida.');return;}
  if(password.length<14||password.length>128){setError('La contraseña debe tener entre 14 y 128 caracteres.');return;}
  if(password!==confirm){setError('Las contraseñas no coinciden.');return;}
  setLoading(true);
  try{
   const response=await fetch('/api/staging-admin-setup',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({token,password}),cache:'no-store',
   });
   const result=await response.json() as {ok?:boolean;error?:string};
   if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo crear el acceso.');
   setDone(true);setToken('');setPassword('');setConfirm('');
  }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo activar la cuenta.');}
  finally{setLoading(false);}
 }
 return <main style={{minHeight:'100vh',background:'#f6f7fa',padding:'70px 18px',display:'grid',placeItems:'start center',color:'#172235'}}>
  <section style={{width:'100%',maxWidth:480,background:'#fff',borderRadius:18,padding:30,border:'1px solid #dce2ec',boxShadow:'0 12px 35px rgba(0,0,0,.05)'}}>
   <p style={{fontSize:13,fontWeight:800,color:'#947100'}}>MW1 · STAGING</p>
   <h1 style={{fontSize:28}}>Configura tu acceso de administrador</h1>
   <p>Usuario asignado: <strong>1018453680</strong></p>
   {done?<div role="status">
    <p style={{color:'#087443'}}>Tu usuario fue activado en el entorno de pruebas.</p>
    <Link href="/login?mode=platform&next=%2Fadmin">Ir al inicio de sesión de MW1</Link>
   </div>:<form onSubmit={e=>void activate(e)} style={{display:'grid',gap:16,marginTop:22}}>
    <p style={{fontSize:13,color:'#596779'}}>Elige una contraseña exclusiva para MW1. No la compartas por ChatGPT. Esta activación solo funciona una vez.</p>
    <div style={{padding:14,background:'#f5f7fb',borderRadius:10,display:'grid',gap:9}}>
     <strong>Código privado de activación</strong>
     <p style={{fontSize:13,margin:0}}>Genera el código aquí y configúralo en <a href="https://railway.com/project/4cc3fcfb-a07e-42d4-9dd3-28ae80b4dc91/service/06abd540-7a74-4391-a608-513b48de6b7f?environmentId=119d67ce-a983-4215-98cd-84ffc6c8ec47" target="_blank" rel="noreferrer">Railway → mw1-api-staging → Variables</a> con el nombre <code>MW1_STAGING_ADMIN_SETUP_TOKEN</code>. No lo compartas en el chat.</p>
     <button type="button" onClick={generateCode} style={{padding:10,borderRadius:8,border:'1px solid #cdd5e1',background:'white'}}>Generar código seguro</button>
     {token&&<><input aria-label="Código de activación" type="text" readOnly value={token} style={{padding:10,width:'100%',fontSize:12,borderRadius:7,border:'1px solid #cdd5e1'}}/><button type="button" onClick={()=>void copyCode()} style={{padding:9,borderRadius:7,background:'white',border:'1px solid #cdd5e1'}}>{codeCopied?'Código copiado':'Copiar código para Railway'}</button></>}
     <p style={{fontSize:12,margin:0,color:'#657187'}}>Después de guardar la variable y verificar que la API de staging esté en línea, regresa a esta página y establece tu contraseña. No actualices la página: el código se conserva únicamente en esta pestaña.</p>
    </div>
    <label style={{display:'grid',gap:6}}>Contraseña nueva
     <input type="password" autoComplete="new-password" minLength={14} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)} style={{padding:12,border:'1px solid #cfd6e4',borderRadius:8}}/>
    </label>
    <label style={{display:'grid',gap:6}}>Confirmar contraseña
     <input type="password" autoComplete="new-password" minLength={14} maxLength={128} required value={confirm} onChange={e=>setConfirm(e.target.value)} style={{padding:12,border:'1px solid #cfd6e4',borderRadius:8}}/>
    </label>
    {error&&<p role="alert" style={{color:'#a32323'}}>{error}</p>}
    {!token&&!error&&<p style={{color:'#986500'}}>Primero genera el código privado y configúralo en Railway staging.</p>}
    <button type="submit" disabled={!token||loading} style={{background:'#172235',color:'white',border:0,borderRadius:10,padding:13,fontWeight:800,cursor:'pointer'}}>{loading?'Activando…':'Activar usuario'}</button>
   </form>}
   <p style={{fontSize:12,color:'#7b879b',marginTop:24}}>Esta configuración solo corresponde a MW1 staging. No cambia la producción de ATOGOB.</p>
  </section>
 </main>;
}
