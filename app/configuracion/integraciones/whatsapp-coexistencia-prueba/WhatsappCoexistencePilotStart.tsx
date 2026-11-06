'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../page.module.css';

type Readiness = {
  ok?:boolean;
  beginReady?:boolean;
  metaLaunchEnabled?:boolean;
  connectionEnabled?:boolean;
  message?:string;
  error?:string;
};

/**
 * UI for the *real staging server nonce entry point*, but never invokes Meta
 * SDK. The nonce remains in a Secure HttpOnly cookie; the browser receives
 * only a non-sensitive onboarding identifier.
 */
export function WhatsappCoexistencePilotStart() {
  const [status,setStatus]=useState<Readiness|null>(null);
  const [loading,setLoading]=useState(true);
  const [starting,setStarting]=useState(false);
  const [message,setMessage]=useState('');
  const [prepared,setPrepared]=useState(false);

  const refresh=useCallback(async()=>{
    setLoading(true);
    setMessage('');
    try{
      const res=await fetch('/api/integrations/whatsapp/coexistence/pilot',{
        method:'GET',cache:'no-store',
      });
      const data=await res.json() as Readiness;
      if(!res.ok||data.ok!==true)throw Error('not ready');
      setStatus(data);
    }catch{
      setStatus({ok:false,beginReady:false});
      setMessage('No se pudo consultar el inicio seguro del piloto.');
    }finally{setLoading(false);}
  },[]);

  useEffect(()=>{void refresh();},[refresh]);

  async function prepare(){
    if(starting||status?.beginReady!==true)return;
    setStarting(true);
    setMessage('');
    setPrepared(false);
    try{
      const res=await fetch('/api/integrations/whatsapp/coexistence/pilot',{
        method:'POST',
        headers:{'content-type':'application/json'},
        credentials:'same-origin',
        cache:'no-store',
      });
      const data=await res.json() as {
        ok?:boolean;status?:string;connectionEnabled?:boolean;
        metaLaunchEnabled?:boolean;message?:string;
      };
      if(!res.ok||data.ok!==true||data.status!=='nonce_prepared_only'||
          data.connectionEnabled!==false||data.metaLaunchEnabled!==false){
        throw Error('not ready');
      }
      setPrepared(true);
      setMessage('Estado temporal preparado con la API de staging. Meta NO se abrió y ningún número fue conectado.');
    }catch{
      setMessage('El inicio seguro sigue bloqueado. No se realizó ninguna autorización de Meta.');
    }finally{setStarting(false);}
  }

  return <div className={styles.testBox}>
    <strong>Inicio seguro de coexistencia — solo piloto</strong>
    <p>
      Esta prueba comprueba el inicio real web → API y prepara una autorización
      de un solo uso. No abre Facebook Login ni da de alta números.
    </p>
    <dl className={styles.details}>
      <div><dt>Ruta firmada web y API</dt><dd>
        {loading?'Consultando…':status?.ok?'Disponible en staging':'No disponible'}
      </dd></div>
      <div><dt>Emisión de autorización temporal</dt><dd>
        {prepared?'Preparada (caduca en 7 minutos)':
          status?.beginReady?'Disponible para piloto':'Deshabilitada hasta completar seguridad'}
      </dd></div>
      <div><dt>Conexión real de Meta y WhatsApp</dt>
        <dd>No habilitada</dd></div>
    </dl>
    <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
      <button type="button" className={styles.testButton}
        disabled={loading||starting||status?.beginReady!==true}
        onClick={()=>void prepare()}>
        {starting?'Preparando…':'Preparar autorización temporal'}
      </button>
      <button type="button" className={styles.catalogButton}
        disabled={loading||starting} onClick={()=>void refresh()}>
        Verificar preparación
      </button>
    </div>
    {message?<p role="status">{message}</p>:null}
    <small>
      La conexión de WhatsApp Business App con Cloud API requiere todavía
      verificar el acceso avanzado en Meta, autorizar al titular, comprobar la
      cuenta y utilizar exclusivamente una SIM de prueba.
    </small>
  </div>;
}
