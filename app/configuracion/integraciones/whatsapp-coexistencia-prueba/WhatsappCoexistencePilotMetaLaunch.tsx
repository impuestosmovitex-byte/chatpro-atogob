'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import styles from '../page.module.css';

type LaunchReadiness={
  ok?:boolean;beginReady?:boolean;metaLaunchEnabled?:boolean;
  codeExchangeEnabled?:boolean;connectionEnabled?:boolean;
  appId?:string|null;configurationId?:string|null;
  apiVersion?:string|null;message?:string;
};
type FacebookResponse={authResponse?:{code?:string};status?:string};
type FacebookSdk={
  init:(options:{appId:string;version:string;cookie:boolean;xfbml:boolean})=>void;
  login:(callback:(response:FacebookResponse)=>void,options:Record<string,unknown>)=>void;
};
type FacebookHost=Window & {FB?:FacebookSdk;fbAsyncInit?:(()=>void)};
const META_ORIGINS=new Set([
  'https://www.facebook.com','https://web.facebook.com',
  'https://business.facebook.com','https://facebook.com',
]);
const META_CODE=/^[^\s\u0000-\u001f\u007f]{20,2048}$/;
const PILOT='/api/integrations/whatsapp/coexistence/pilot';
const RETURN='/api/integrations/whatsapp/coexistence/return';

function loadSdk(appId:string,version:string):Promise<FacebookSdk>{
  return new Promise((resolve,reject)=>{
    const target=window as FacebookHost;
    let done=false;
    const timeout=window.setTimeout(()=>{
      if(done)return;done=true;
      reject(new Error('El SDK de Meta no respondió.'));
    },15000);
    const initialize=()=>{
      if(done||!target.FB)return;
      try{
        target.FB.init({appId,version,cookie:false,xfbml:false});
        done=true;window.clearTimeout(timeout);resolve(target.FB);
      }catch{
        done=true;window.clearTimeout(timeout);
        reject(new Error('No fue posible inicializar el SDK de Meta.'));
      }
    };
    if(target.FB){initialize();return;}
    target.fbAsyncInit=initialize;
    if(document.getElementById('facebook-jssdk'))return;
    const script=document.createElement('script');
    script.id='facebook-jssdk';script.async=true;
    script.src='https://connect.facebook.net/en_US/sdk.js';
    script.onerror=()=>{
      if(done)return;done=true;window.clearTimeout(timeout);
      reject(new Error('No fue posible descargar el SDK de Meta.'));
    };
    document.body.appendChild(script);
  });
}

/**
 * Isolated staging coexistence flow. The SDK is never loaded unless BOTH
 * authorized servers have explicitly enabled the pilot launch. One click
 * prepares the nonce; a SECOND direct click calls FB.login with user gesture.
 * No conventional FINISH event can enter this flow.
 */
export function WhatsappCoexistencePilotMetaLaunch(){
  const [config,setConfig]=useState<LaunchReadiness|null>(null);
  const [checking,setChecking]=useState(true);
  const [sdkReady,setSdkReady]=useState(false);
  const [preparing,setPreparing]=useState(false);
  const [running,setRunning]=useState(false);
  const [until,setUntil]=useState(0);
  const [confirmed,setConfirmed]=useState(false);
  const [message,setMessage]=useState('');
  const sdk=useRef<FacebookSdk|null>(null);
  const cancel=useRef<(()=>void)|null>(null);

  const refresh=useCallback(async()=>{
    setChecking(true);setSdkReady(false);sdk.current=null;
    setUntil(0);setConfirmed(false);setMessage('');
    try{
      const res=await fetch(PILOT,{method:'GET',cache:'no-store',
        credentials:'same-origin'});
      const data=await res.json() as LaunchReadiness;
      if(!res.ok||data.ok!==true)throw Error('unavailable');
      setConfig(data);
    }catch{
      setConfig({ok:false,metaLaunchEnabled:false,beginReady:false});
      setMessage('No se pudo confirmar la autorización del piloto.');
    }finally{setChecking(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    let mounted=true;
    if(config?.metaLaunchEnabled!==true||config.codeExchangeEnabled!==true||
       config.beginReady!==true||config.connectionEnabled!==false||
       config.appId!=='1079916404666757'||
       config.configurationId!=='1431168516739052'||
       config.apiVersion!=='v26.0')return;
    void loadSdk(config.appId,config.apiVersion).then(fb=>{
      if(mounted){sdk.current=fb;setSdkReady(true);}
    }).catch(()=>{
      if(mounted){setSdkReady(false);setMessage('Meta no está disponible para el piloto.');}
    });
    return ()=>{mounted=false;};
  },[config]);
  useEffect(()=>()=>{cancel.current?.();},[]);

  const eligible=config?.metaLaunchEnabled===true &&
    config.codeExchangeEnabled===true &&
    config.beginReady===true && config.connectionEnabled===false &&
    config.appId==='1079916404666757' &&
    config.configurationId==='1431168516739052';

  async function prepare(){
    if(!eligible||!confirmed||preparing||running)return;
    setPreparing(true);setUntil(0);setMessage('');
    try{
      const response=await fetch(PILOT,{method:'POST',cache:'no-store',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},body:'{}',
      });
      const result=await response.json() as {
        ok?:boolean;status?:string;connectionEnabled?:boolean;
        metaLaunchEnabled?:boolean;
      };
      if(!response.ok||result.ok!==true||
         result.status!=='nonce_prepared_only'||
         result.connectionEnabled!==false||result.metaLaunchEnabled!==false){
        throw Error('not authorized');
      }
      // Only an expiry indicator is stored in browser memory. The signed
      // authorization exists exclusively in the Secure HttpOnly cookie.
      setUntil(Date.now()+6*60*1000);
      setMessage('Autorización temporal preparada. Abre Meta con el siguiente botón.');
    }catch{
      setMessage('El servidor no autorizó preparar el piloto. No se abrió Meta.');
    }finally{setPreparing(false);}
  }

  function launch(){
    // MUST remain a synchronous direct button handler for popup activation.
    if(!eligible||!confirmed||!sdk.current||!sdkReady||
       preparing||running||Date.now()>=until){
      setMessage('Prepara de nuevo la autorización y confirma la SIM del piloto.');
      return;
    }
    setRunning(true);setMessage('Abriendo autorización oficial de Meta…');
    let code='';
    let sessionJson='';
    let origin='';
    let stopped=false;
    let submitted=false;
    // Meta's exchangeable code has a short lifetime. Never hold it while
    // waiting indefinitely for an unrelated browser session event.
    let codeExpiry:ReturnType<typeof setTimeout>|null=null;
    const timeout=window.setTimeout(()=>
      fail('La autorización superó el tiempo de seguridad; vuelve a comenzar.'),
      6*60*1000);

    const cleanup=()=>{
      window.clearTimeout(timeout);
      if(codeExpiry!==null){window.clearTimeout(codeExpiry);codeExpiry=null;}
      window.removeEventListener('message',onMessage);
      cancel.current=null;
      code='';sessionJson='';origin='';
    };
    const fail=(reason:string)=>{
      if(stopped)return;stopped=true;
      cleanup();setRunning(false);setUntil(0);setMessage(reason);
    };
    const finish=async()=>{
      if(stopped||submitted||!code||!sessionJson||!origin)return;
      submitted=true;
      const payload=JSON.stringify({
        metaMessageOrigin:origin,metaMessageJson:sessionJson,
        sdkLoginResponse:{authResponse:{code}},
      });
      code='';sessionJson='';origin='';
      try{
        const res=await fetch(RETURN,{method:'POST',
          headers:{'content-type':'application/json'},
          credentials:'same-origin',cache:'no-store',body:payload});
        const result=await res.json() as {ok?:boolean;status?:string};
        if(stopped)return;
        stopped=true;cleanup();setRunning(false);setUntil(0);
        setMessage(res.ok&&result.ok===true&&
          result.status==='meta_evidence_reviewed_only'
          ? 'La evidencia fue revisada. No hay conexión activa, mensajes ni historial sincronizado.'
          : 'Meta no confirmó coexistencia y titularidad; no se conectó ningún número.');
      }catch{
        fail('No se pudo comprobar el resultado con el servidor. Ningún número fue activado desde MW1.');
      }
    };
    const onMessage=(event:MessageEvent)=>{
      if(stopped||!META_ORIGINS.has(event.origin)||
         typeof event.data!=='string'||event.data.length>10000)return;
      try{
        const payload=JSON.parse(event.data) as {
          type?:unknown;event?:unknown;data?:unknown;
        };
        if(payload?.type!=='WA_EMBEDDED_SIGNUP')return;
        if(payload.event==='CANCEL'||payload.event==='ERROR'){
          fail('La autorización de Meta se canceló o informó un error.');
          return;
        }
        if(payload.event==='FINISH'){
          fail('Meta devolvió el registro convencional, no coexistencia. No se aceptó la conexión.');
          return;
        }
        if(payload.event!=='FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING')return;
        if(!payload.data||typeof payload.data!=='object'||
           Array.isArray(payload.data))return;
        sessionJson=event.data;origin=event.origin;
        void finish();
      }catch{ /* SDK also sends unrelated non-JSON messages. */ }
    };
    window.addEventListener('message',onMessage);
    cancel.current=()=>fail('Intento interrumpido. No se guardaron credenciales.');
    try{
      sdk.current.login(response=>{
        if(stopped)return;
        const candidate=response?.authResponse?.code;
        if(typeof candidate!=='string'||!META_CODE.test(candidate)){
          fail('Meta no devolvió un código válido de autorización.');
          return;
        }
        code=candidate;
        // A missing coexistence session event must not leave a Meta code
        // waiting until the popup's six-minute outer timeout.
        codeExpiry=window.setTimeout(()=>
          fail('Meta no confirmó la coexistencia a tiempo. Vuelve a iniciar con el número piloto.'),
          25000);
        void finish();
      },{
        config_id:'1431168516739052',
        auth_type:'rerequest',
        response_type:'code',
        override_default_response_type:true,
        // V4 credentials and permissions are set in Meta's configuration.
        // Only WhatsApp Business App coexistence is permitted here.
        extras:{setup:{},featureType:'whatsapp_business_app_onboarding'},
      });
    }catch{
      fail('El navegador no pudo abrir el registro seguro de Meta.');
    }
  }

  return <div className={styles.testBox}>
    <strong>Registro oficial de coexistencia — solo número piloto</strong>
    <p>
      Abre el registro de WhatsApp Business App con Cloud API. La opción de
      registro convencional queda excluida; esta pantalla no crea conexiones
      automáticas ni permite seleccionar empresas operativas.
    </p>
    <dl className={styles.details}>
      <div><dt>Autorización independiente de Meta</dt><dd>
        {checking?'Verificando…':eligible?'Lista para pruebas controladas':
          'Bloqueada: falta aprobación y configuración del piloto'}
      </dd></div>
      <div><dt>SDK de Meta</dt><dd>{eligible?
        (sdkReady?'Preparado':'Pendiente de iniciar'):'No cargado'}</dd></div>
      <div><dt>Estado temporal de prueba</dt><dd>
        {Date.now()<until?'Preparado, válido por pocos minutos':'No preparado'}
      </dd></div>
      <div><dt>Conexión y sincronización</dt><dd>Deshabilitadas</dd></div>
    </dl>
    <label style={{display:'flex',alignItems:'flex-start',gap:8}}>
      <input type="checkbox" checked={confirmed}
        disabled={!eligible||running||preparing}
        onChange={event=>setConfirmed(event.target.checked)}/>
      Confirmo que usaré exclusivamente un número NUEVO de prueba, activo en
      WhatsApp Business, sin relación con ATOGOB ni MAOGO.
    </label>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}}>
      <button type="button" className={styles.testButton}
        disabled={!eligible||!confirmed||preparing||running}
        onClick={()=>void prepare()}>
        {preparing?'Preparando…':'1. Preparar autorización piloto'}
      </button>
      <button type="button" className={styles.connectButton}
        disabled={!eligible||!confirmed||!sdkReady||running||preparing||
          !(Date.now()<until)}
        onClick={launch}>
        {running?'Verificando autorización…':'2. Abrir Meta para coexistencia'}
      </button>
      <button type="button" className={styles.catalogButton}
        disabled={running||preparing||checking}
        onClick={()=>void refresh()}>Comprobar estado</button>
      {running?<button type="button" className={styles.testButton}
        onClick={()=>cancel.current?.()}>Cancelar intento</button>:null}
    </div>
    {message?<p role="status">{message}</p>:null}
    <small>
      Requiere habilitación expresa en web y API del piloto, una empresa
      autorizada en Meta y un número independiente. No se enviarán mensajes,
      no se importarán contactos y no se modificarán ATOGOB ni MAOGO.
    </small>
  </div>;
}
