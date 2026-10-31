import Link from 'next/link';
import {PlatformSidebar} from '../components/PlatformSidebar';
const sections=[
 {href:'/admin/empresas',title:'Empresas',desc:'Crear empresas y sus propios usuarios, consultar módulos e integraciones.'},
 {href:'/admin/planes',title:'Planes y precios',desc:'Administrar borradores de Básico, Eco y Pro, aprobar y publicar tarifas.'},
 {href:'/admin/simulador-financiero',title:'Rentabilidad',desc:'Proyectar ingresos, infraestructura y costos de cada plan.'},
 {href:'/admin/rentabilidad-empresas',title:'Rentabilidad por empresa',desc:'Registrar ingresos, cobros y costos mensuales de ATOGOB, Emprende con Maogo y otros clientes.'},
 {href:'/admin/consumo-ia',title:'Consumo de inteligencia artificial',desc:'Analizar los registros medidos por empresa; datos parciales.'},
 {href:'/admin/tarifas-ia',title:'Tarifas de OpenAI',desc:'Configurar precios verificados por modelo y tipo de tokens.'},
];
export default function PlatformHome(){
 return <div style={{background:'#f6f8fc',minHeight:'100vh',color:'#16243a'}}>
  <PlatformSidebar/>
  <main style={{marginLeft:176,padding:'48px 40px',maxWidth:1200}}>
   <p style={{fontWeight:900,fontSize:12,letterSpacing:'0.1em',color:'#957013'}}>MW1 · SUPERADMINISTRADOR</p>
   <h1 style={{fontSize:35,margin:'12px 0'}}>Administración general de la plataforma</h1>
   <p style={{maxWidth:720,lineHeight:1.65,color:'#506078'}}>Este espacio administra el SaaS, no pertenece a ninguna tienda ni a las empresas de demostración. Cada empresa utiliza su cuenta empresarial independiente.</p>
   <section style={{marginTop:24,padding:22,borderRadius:18,background:'#fff',border:'1px solid #dce3ec'}}>
    <h2 style={{fontSize:20,margin:'0 0 8px'}}>Alta comercial acompañada · flujo inicial</h2>
    <p style={{color:'#506078',lineHeight:1.6}}>MW1 se comercializa inicialmente por demostración y configuración asistida. El primer pago se gestiona mediante un enlace seguro enviado por el equipo. No se activa ninguna empresa por una captura o comprobante de pago sin verificar.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginTop:16}}>
     {[
      {number:'01',title:'Atender interesados',desc:'Revisar solicitudes y programar la demostración.',href:'/admin/empresas'},
      {number:'02',title:'Confirmar plan y pago',desc:'Verificar el pago con el proveedor antes de habilitar servicios.',href:'/admin/solicitudes-suscripcion'},
      {number:'03',title:'Crear empresa y propietario',desc:'Asignar plan, cupos incluidos y credenciales independientes.',href:'/admin/empresas'},
      {number:'04',title:'Acompañar integraciones',desc:'El propietario inicia sesión, conecta canales y prueba su primera conversación.',href:'/admin/empresas'}
     ].map(step=><Link key={step.number} href={step.href} style={{textDecoration:'none',background:'#f7f9fc',color:'#172235',borderRadius:12,padding:16,border:'1px solid #e2e8f0'}}>
      <strong style={{color:'#8c6a00',fontSize:12}}>{step.number}</strong>
      <h3 style={{fontSize:15,margin:'8px 0'}}>{step.title}</h3>
      <p style={{fontSize:12,color:'#526179',lineHeight:1.6,margin:0}}>{step.desc}</p>
     </Link>)}
    </div>
   </section>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:17,marginTop:30}}>
   {sections.map(item=><Link key={item.href} href={item.href} style={{padding:24,borderRadius:16,border:'1px solid #dce3ec',background:'white',textDecoration:'none',color:'#172235'}}>
    <h2 style={{fontSize:18,margin:'0 0 12px'}}>{item.title} →</h2>
    <p style={{color:'#627187',fontSize:14,lineHeight:1.6}}>{item.desc}</p>
   </Link>)}
   </div>
   <p style={{marginTop:28,color:'#7b8799',fontSize:13}}>Las operaciones de pruebas se realizan entrando con usuarios propios de cada empresa demo; esta sesión no puede ver sus conversaciones ni pedidos.</p>
  </main>
 </div>;
}
