'use client';
import Link from 'next/link';
import {useEffect} from 'react';
import {PlatformSidebar} from '../components/PlatformSidebar';

export default function AdminError({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
 useEffect(()=>{
  // Do not print company data, cookies, or credentials to the console.
  console.error('MW1 admin module failed',error.digest||'unknown');
 },[error]);
 return <div style={{minHeight:'100vh',background:'#f6f7fa',color:'#172235'}}>
  <PlatformSidebar/>
  <main style={{marginLeft:176,padding:'44px 38px',maxWidth:860}}>
   <p style={{fontWeight:800,color:'#8b6910'}}>SUPERADMIN MW1</p>
   <h1 style={{fontSize:27}}>No se pudo mostrar esta sección</h1>
   <p style={{color:'#667085',lineHeight:1.6}}>Tu cuenta y los datos de las empresas no se han modificado. Puedes volver a intentar cargar esta sección o regresar al resumen.</p>
   <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
    <button type="button" onClick={reset} style={{border:0,borderRadius:9,padding:'12px 18px',background:'#172235',color:'#fff',fontWeight:750}}>Intentar de nuevo</button>
    <Link href="/admin" style={{padding:'12px 18px'}}>Volver al resumen MW1</Link>
   </div>
  </main>
 </div>;
}
