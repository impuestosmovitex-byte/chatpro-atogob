import {PlatformSidebar} from '../components/PlatformSidebar';

export default function AdminLoading(){
 return <div style={{minHeight:'100vh',background:'#f6f7fa',color:'#172235'}}>
  <PlatformSidebar/>
  <main style={{marginLeft:176,padding:'44px 38px'}} aria-live="polite" role="status">
   <p style={{fontWeight:800,color:'#8b6910'}}>SUPERADMIN MW1</p>
   <h1 style={{fontSize:25}}>Cargando módulo administrativo…</h1>
   <p style={{color:'#667085'}}>Estamos preparando el contenido de esta sección.</p>
  </main>
 </div>;
}
