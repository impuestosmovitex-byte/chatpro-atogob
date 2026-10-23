import Link from 'next/link';
import {PlatformSidebar} from '../components/PlatformSidebar';
const sections=[
 {href:'/admin/empresas',title:'Empresas',desc:'Crear empresas y sus propios usuarios, consultar módulos e integraciones.'},
 {href:'/admin/planes',title:'Planes y precios',desc:'Administrar borradores de Básico, Eco y Pro, aprobar y publicar tarifas.'},
 {href:'/admin/simulador-financiero',title:'Rentabilidad',desc:'Proyectar ingresos, infraestructura y costos de cada plan.'},
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
