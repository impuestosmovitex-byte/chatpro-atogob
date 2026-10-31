'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useState} from 'react';

const links=[
 {href:'/admin',label:'Resumen MW1',icon:'▦'},
 {href:'/admin/empresas',label:'Empresas',icon:'▤'},
 {href:'/admin/planes',label:'Planes y precios',icon:'◇'},
 {href:'/admin/solicitudes-suscripcion',label:'Solicitudes de suscripción',icon:'▤'},
 {href:'/admin/mercado-pago',label:'Mercado Pago',icon:'◈'},
 {href:'/admin/simulador-financiero',label:'Simulador financiero',icon:'▥'},
 {href:'/admin/rentabilidad-empresas',label:'Rentabilidad por empresa',icon:'◉'},
 {href:'/admin/consumo-ia',label:'Consumo de IA',icon:'◎'},
 {href:'/admin/tarifas-ia',label:'Tarifas OpenAI',icon:'⚙'},
];
export function PlatformSidebar(){
 const pathname=usePathname();
 const [loggingOut,setLoggingOut]=useState(false);
 async function logout(){
  setLoggingOut(true);
  try{await fetch('/api/auth/logout',{method:'POST'});}
  finally{window.location.assign('/login?mode=platform&next=%2Fadmin');}
 }
 return <aside style={{position:'fixed',left:0,top:0,bottom:0,zIndex:20,width:176,
  display:'flex',flexDirection:'column',background:'#fffaf0',color:'#172235',padding:'22px 11px',
  boxSizing:'border-box',overflowY:'auto'}}>
  <Link href="/admin" style={{padding:'9px 12px 18px',fontSize:23,fontWeight:900,textDecoration:'none',color:'#172235'}}>MW1</Link>
  <div style={{fontSize:10,letterSpacing:'0.13em',fontWeight:900,padding:'0 12px 14px',color:'#886b11'}}>PLATAFORMA · SUPERADMIN</div>
  <nav aria-label="Administración global MW1" style={{display:'grid',gap:6}}>
   {links.map(item=><Link key={item.href} href={item.href} style={{
    display:'flex',gap:9,alignItems:'center',textDecoration:'none',fontSize:12,
    color:'#172235',fontWeight:pathname===item.href?800:500,
    background:pathname===item.href?'#f4bf00':'transparent',
    padding:'12px 9px',borderRadius:9
   }}><span aria-hidden="true">{item.icon}</span>{item.label}</Link>)}
  </nav>
  <div style={{flex:1}}/>
  <div style={{borderTop:'1px solid #e6d9b7',padding:'14px 9px',fontSize:11,color:'#5a6372'}}>
   <strong>Administración general</strong>
   <p style={{margin:'7px 0'}}>Sin empresa vinculada</p>
  </div>
  <button type="button" disabled={loggingOut} onClick={()=>void logout()}
   style={{cursor:'pointer',borderRadius:9,padding:11,background:'#f4bf00',color:'#172235',fontWeight:800,border:0}}>
   {loggingOut?'Saliendo…':'Cerrar sesión'}
  </button>
 </aside>;
}
