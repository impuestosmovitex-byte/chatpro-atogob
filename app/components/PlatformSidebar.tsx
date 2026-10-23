'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useState} from 'react';

const links=[
 {href:'/admin',label:'Resumen MW1',icon:'▦'},
 {href:'/admin/empresas',label:'Empresas',icon:'▤'},
 {href:'/admin/planes',label:'Planes y precios',icon:'◇'},
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
  display:'flex',flexDirection:'column',background:'#111d30',color:'#f4f6fa',padding:'22px 11px',
  boxSizing:'border-box',overflowY:'auto'}}>
  <Link href="/admin" style={{padding:'9px 12px 18px',fontSize:23,fontWeight:900,textDecoration:'none',color:'white'}}>MW1</Link>
  <div style={{fontSize:10,letterSpacing:'0.13em',fontWeight:900,padding:'0 12px 14px',color:'#a8b9ce'}}>PLATAFORMA · SUPERADMIN</div>
  <nav aria-label="Administración global MW1" style={{display:'grid',gap:6}}>
   {links.map(item=><Link key={item.href} href={item.href} style={{
    display:'flex',gap:9,alignItems:'center',textDecoration:'none',fontSize:12,
    color:'#eff3f9',fontWeight:pathname===item.href?800:500,
    background:pathname===item.href?'#314867':'transparent',
    padding:'12px 9px',borderRadius:9
   }}><span aria-hidden="true">{item.icon}</span>{item.label}</Link>)}
  </nav>
  <div style={{flex:1}}/>
  <div style={{borderTop:'1px solid #3c5067',padding:'14px 9px',fontSize:11,color:'#cad4e2'}}>
   <strong>Administración general</strong>
   <p style={{margin:'7px 0'}}>Sin empresa vinculada</p>
  </div>
  <button type="button" disabled={loggingOut} onClick={()=>void logout()}
   style={{cursor:'pointer',borderRadius:9,padding:11,background:'#e9eef6',color:'#152135',fontWeight:800,border:0}}>
   {loggingOut?'Saliendo…':'Cerrar sesión'}
  </button>
 </aside>;
}
