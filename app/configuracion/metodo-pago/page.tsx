'use client';
import Link from 'next/link';
import {AppSidebar} from '../../components/AppSidebar';
export default function MetodoPago(){
 return <main style={{display:'flex',minHeight:'100vh',background:'#f6f7fa',color:'#172235'}}>
  <AppSidebar companyName="Empresa"/>
  <section style={{flex:1,padding:'38px 34px',maxWidth:970}}>
   <p style={{fontWeight:800,fontSize:12,color:'#8f710d'}}>CONFIGURACIÓN · SUSCRIPCIÓN MW1</p>
   <h1 style={{fontSize:30,margin:'12px 0'}}>Método de pago</h1>
   <p style={{maxWidth:700,lineHeight:1.65,color:'#58677a'}}>Tus pagos recurrentes se autorizarán directamente en el sitio seguro de Mercado Pago. MW1 no recibirá ni almacenará tu número completo de tarjeta ni tu código de seguridad.</p>
   <section style={{background:'#fff',border:'1px solid #e4e5e8',borderRadius:16,padding:25,maxWidth:700,marginTop:24}}>
    <p style={{fontSize:12,fontWeight:900,color:'#916f0d'}}>PRÓXIMAMENTE</p>
    <h2 style={{margin:'10px 0'}}>Registrar una tarjeta de forma segura</h2>
    <p style={{lineHeight:1.6,color:'#58677a'}}>Cuando la pasarela esté habilitada, podrás continuar al checkout oficial de Mercado Pago para aceptar el monto, la frecuencia y las condiciones de renovación.</p>
    <button type="button" disabled style={{padding:'12px 16px',border:0,borderRadius:9,background:'#f4bf00',fontWeight:800,marginTop:18}}>Ir al checkout seguro (no disponible todavía)</button>
    <p style={{marginTop:16,fontSize:13}}>Nunca introduzcas datos de tarjeta en chats, formularios de soporte ni mensajes de MW1.</p>
   </section>
   <p style={{marginTop:24}}><Link href="/configuracion/mi-plan" style={{color:'#806400'}}>← Volver a Mi plan y facturación</Link></p>
  </section>
 </main>;
}
