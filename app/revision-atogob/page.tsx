import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { INBOX_SESSION_COOKIE, getInboxSession } from '../lib/inbox-auth';

export const dynamic = 'force-dynamic';

export default async function AtogobMetaReview() {
  const store = await cookies();
  const session = await getInboxSession(store.get(INBOX_SESSION_COOKIE)?.value);
  if (!session) redirect('/login?company=atogob&next=%2Frevision-atogob');
  if (session.companySlug !== 'atogob' || session.roleKey !== 'meta_reviewer_atogob') redirect('/');
  return <main style={{fontFamily:'Arial, sans-serif',maxWidth:920,margin:'auto',padding:'42px 20px',color:'#172235'}}>
    <p style={{fontWeight:700,color:'#8d6500'}}>ChatPro MW1 · ATOGOB · Cuenta de revisión</p>
    <h1>Acceso de solo lectura para Meta</h1>
    <p>Esta cuenta nueva pertenece exclusivamente a ATOGOB y no tiene acceso a las cuentas de otras empresas.</p>
    <section style={{background:'#fff8df',padding:20,borderRadius:14,margin:'20px 0',lineHeight:1.6}}>
      <strong>Protección de la operación comercial:</strong> los mensajes reales, datos de clientes, envíos,
      plantillas, automatizaciones, usuarios y configuraciones están bloqueados para este acceso.
      Ninguna acción de esta pantalla puede cambiar la atención de ATOGOB.
    </section>
    <h2>Funciones del producto que se presentan a revisión</h2>
    <ul style={{lineHeight:2}}>
      <li>Bandeja omnicanal para conversaciones autorizadas de WhatsApp Business.</li>
      <li>Respuestas asistidas por inteligencia artificial.</li>
      <li>Gestión de plantillas y automatizaciones de WhatsApp.</li>
      <li>Conexión voluntaria de números mediante el registro oficial de Meta.</li>
    </ul>
    <p style={{marginTop:25}}>Las demostraciones reales están adjuntas a la solicitud de permisos de la aplicación MW1 Chat Pro en Meta. Esta página de acceso restringido <strong>no es una prueba de envío de mensajes ni de administración por la API</strong>.</p>
    <form action="/api/auth/logout" method="post"><button style={{border:0,background:'#172235',color:'white',padding:'12px 20px',borderRadius:9,cursor:'pointer'}}>Cerrar sesión</button></form>
  </main>;
}
