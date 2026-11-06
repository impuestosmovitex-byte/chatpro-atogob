import type {Metadata} from 'next';
import Link from 'next/link';
import {MarketingHeader} from '../components/marketing/MarketingHeader';
import {MarketingIcon,type MarketingIconName} from '../components/marketing/MarketingIcon';
import marketing from '../components/marketing/marketing.module.css';
import styles from './por-que.module.css';

export const metadata:Metadata={
 title:'¿Por qué usar MW1? | Control de conversaciones, clientes e IA',
 description:'Conoce cómo MW1 ayuda a centralizar mensajes, organizar asesores, dar seguimiento a clientes y automatizar la atención de tu empresa.',
};
const capabilities:{icon:MarketingIconName;title:string;description:string}[]=[
 {icon:'whatsapp',title:'Todos tus canales en un solo lugar',description:'Tu equipo puede atender desde una bandeja unificada los canales que hayas conectado, sin saltar entre varias aplicaciones ni perder el hilo de cada conversación.'},
 {icon:'users',title:'Control de asesores y equipos',description:'Organiza usuarios y responsabilidades, identifica quién atiende a cada cliente y facilita la supervisión del trabajo cotidiano.'},
 {icon:'bot',title:'IA que apoya cuando no hay un asesor disponible',description:'La inteligencia artificial puede ayudar a responder preguntas habituales con la información configurada de tu negocio, y derivar consultas que necesitan intervención humana.'},
 {icon:'workflow',title:'Automatizaciones y seguimiento',description:'Disminuye tareas repetitivas y da continuidad a oportunidades comerciales mediante reglas, mensajes y seguimiento, según las funciones habilitadas para tu empresa.'},
 {icon:'database',title:'Información de clientes organizada',description:'Consulta conversaciones, contactos, notas y estados para tener contexto en futuras atenciones. Una buena organización reduce la dependencia de chats aislados.'},
 {icon:'shopping',title:'Catálogo y apoyo a las ventas',description:'Consulta la información de productos conectados y comparte detalles útiles con el cliente. Los pedidos nativos y enlaces de pago automatizados están previstos para fases posteriores.'},
];
const flow=[
 {number:'01',title:'El cliente escribe',description:'Llega una consulta por alguno de tus canales conectados.'},
 {number:'02',title:'La conversación queda organizada',description:'El equipo encuentra el contacto, sus mensajes y el contexto disponible.'},
 {number:'03',title:'Responde la IA o tu asesor',description:'Las consultas repetitivas pueden recibir apoyo automático y los casos especiales pasan a atención humana.'},
 {number:'04',title:'Tu equipo hace seguimiento',description:'Las tareas, el interés comercial y los siguientes pasos dejan de depender de la memoria de una sola persona.'},
];
export default function PorQuePage(){
 return <main className={marketing.site}>
  <MarketingHeader/>
  <section className={styles.hero}>
   <div className={styles.heroText}>
    <div className={marketing.eyebrow}>¿Por qué utilizar MW1?</div>
    <h1>Tu negocio no debería <span>perder oportunidades por no responder a tiempo.</span></h1>
    <p className={styles.lead}>MW1 es una plataforma diseñada para integrar, gestionar y controlar los mensajes y canales de comunicación de tu empresa desde un solo lugar.</p>
    <p className={styles.sublead}>Centraliza la atención, organiza a tus asesores y apóyate en inteligencia artificial para que las conversaciones no dependan de que estés conectado todo el día.</p>
    <div className={styles.actions}>
     <Link href="/prueba-gratis" className={marketing.primaryButton}>Solicitar 14 días de prueba ↗</Link>
     <Link href="/precios" className={marketing.secondaryButton}>Conocer los planes</Link>
    </div>
    <span className={styles.heroDisclaimer}>Disponibilidad según plan, canales conectados y configuración. MW1 apoya a tu equipo; no garantiza ventas ni resultados comerciales específicos.</span>
   </div>
   <div className={styles.visual} aria-label="Ejemplo ilustrativo de atención desde MW1">
    <div className={styles.visualTop}><strong>MW1</strong><span>Atención unificada · Ejemplo</span></div>
    <div className={styles.visualTabs}><span>WhatsApp</span><span>Instagram</span><span>Messenger</span></div>
    <div className={styles.chatBubbleClient}>Hola, ¿todavía tienen disponible este producto? Necesito ayuda.</div>
    <div className={styles.chatBubbleAgent}><span>Asistente MW1</span>¡Hola! Te ayudo con la información del catálogo conectado. ¿Qué referencia o talla buscas?</div>
    <div className={styles.chatBubbleClient}>También quiero hablar con un asesor.</div>
    <div className={styles.handoff}><MarketingIcon name="users"/> <span><strong>Atención humana</strong> · Tu equipo puede continuar la conversación con su contexto.</span></div>
    <div className={styles.visualFooter}>Demostración ilustrativa · No es un chat real</div>
   </div>
  </section>

  <section className={styles.section} aria-labelledby="problem-heading">
   <div className={styles.intro}>
    <p className={styles.kicker}>El reto de atender desde varias plataformas</p>
    <h2 id="problem-heading">Recibir mensajes es fácil. Gestionarlos bien es lo que marca la diferencia.</h2>
    <p>Cuando una empresa administra conversaciones desde cuentas separadas, puede perder el contexto de sus clientes, tardar en responder y dificultar la supervisión de su equipo. Los mensajes sin seguimiento también pueden convertirse en oportunidades desaprovechadas.</p>
    <p style={{marginTop:14}}>Sin trazabilidad, es más difícil detectar usos indebidos, controlar accesos y entender cómo se están gestionando las consultas. Por eso MW1 busca que la información comercial esté más organizada y disponible para las personas autorizadas.</p>
   </div>
   <div className={styles.benefitGrid}>
    {capabilities.map(item=><article className={styles.benefitCard} key={item.title}>
     <span className={styles.benefitIcon}><MarketingIcon name={item.icon}/></span>
     <h3>{item.title}</h3><p>{item.description}</p>
    </article>)}
   </div>
  </section>

  <section className={styles.workflowSection} aria-labelledby="workflow-heading">
   <div className={styles.section}>
    <div className={styles.intro}>
     <p className={styles.kicker}>IA para tu equipo, no en lugar de tu equipo</p>
     <h2 id="workflow-heading">Los clientes no siempre pueden esperar a que abra tu negocio.</h2>
     <p>La IA puede ayudar con preguntas habituales fuera del horario de atención, mientras tu equipo se concentra en consultas que necesitan una respuesta personalizada. El objetivo es atender mejor sin perder el control humano.</p>
    </div>
    <div className={styles.steps}>
     {flow.map(item=><div key={item.number} className={styles.step}>
      <span>{item.number}</span><h3>{item.title}</h3><p>{item.description}</p>
     </div>)}
    </div>
   </div>
  </section>

  <section className={styles.section} aria-labelledby="control-heading">
   <div className={styles.intro}>
    <p className={styles.kicker}>Mucho más que responder mensajes</p>
    <h2 id="control-heading">Organiza a tus asesores y toma decisiones con información.</h2>
    <p>MW1 busca ayudarte a construir una operación más organizada: gestionar información de clientes, registrar usuarios y distribuir responsabilidades, consultar indicadores de atención y entender qué conversaciones necesitan seguimiento.</p>
   </div>
   <div className={styles.benefitGrid}>
    <article className={styles.benefitCard}>
     <span className={styles.benefitIcon}><MarketingIcon name="database"/></span>
     <h3>Tu directorio comercial</h3>
     <p>Conserva datos y notas para facilitar futuras atenciones. Su uso para campañas o comunicaciones comerciales debe respetar los permisos, las autorizaciones y la normativa aplicable.</p>
    </article>
    <article className={styles.benefitCard}>
     <span className={styles.benefitIcon}><MarketingIcon name="users"/></span>
     <h3>Roles y áreas de trabajo</h3>
     <p>Distribuye accesos y responsabilidades entre las personas que atienden a tus clientes, de acuerdo con la configuración disponible en tu cuenta.</p>
    </article>
    <article className={styles.benefitCard}>
     <span className={styles.benefitIcon}><MarketingIcon name="workflow"/></span>
     <h3>Estadísticas y seguimiento</h3>
     <p>Consulta los indicadores de atención disponibles para evaluar la actividad del equipo y detectar oportunidades de mejora. Algunas métricas requieren configuración y validación.</p>
    </article>
   </div>
  </section>

  <section className={styles.section} aria-labelledby="orders-heading">
   <div className={styles.paymentPanel}>
    <div>
     <p className={styles.kicker}>La evolución de MW1 · Plan Pro</p>
     <h2 id="orders-heading">Gestionar pedidos incluso sin tienda virtual.</h2>
     <p>Queremos que un negocio pueda registrar pedidos recibidos por conversación, consultar cuáles están pendientes de preparación y acompañar su despacho desde MW1, incluso si no tiene página web propia.</p>
     <p>También estamos diseñando el envío de enlaces de pago desde el chat mediante la pasarela que configure cada comercio. El cliente pagaría en una página segura del proveedor y el negocio recibiría la confirmación verificada.</p>
     <p className={styles.pendingLabel}><strong>Funciones en desarrollo:</strong> pedidos nativos, preparación y despacho de pedidos, generación automática de enlaces de pago. No forman parte todavía de una capacidad entregada y verificada del Plan Pro.</p>
     <Link href="/demo" className={marketing.primaryButton}>Conocer las funciones disponibles</Link>
    </div>
    <div className={styles.paymentVisual} aria-label="Ilustración de un futuro pago por conversación">
     <div className={styles.paymentMessage}>Cliente: “Listo, quiero pagar”.</div>
     <div className={styles.paymentExample}>
      <span><MarketingIcon name="payment"/> Enlace de pago</span>
      <strong>Tu pedido · Ejemplo</strong>
      <small>Importe confirmado por el comercio</small>
      <div className={styles.fakePayButton}>Continuar al pago ↗</div>
     </div>
     <p>Vista conceptual de una función prevista. No procesa pagos ni genera enlaces reales.</p>
    </div>
   </div>
  </section>

  <section className={styles.workflowSection} aria-labelledby="cost-heading">
   <div className={styles.section}>
    <div className={styles.intro}>
     <p className={styles.kicker}>Piensa en el costo de atender a tus clientes</p>
     <h2 id="cost-heading">¿Cuánto le cuesta a tu empresa responder cada conversación?</h2>
     <p>Imagina un negocio que recibe entre 15 y 20 interesados por hora. La cantidad de asesores necesaria dependerá del volumen, la complejidad y los horarios. A eso se suman salarios, supervisión, tiempos de espera y oportunidades sin seguimiento.</p>
     <p style={{marginTop:14}}>Una plataforma como MW1 puede ayudar a reducir trabajo repetitivo y aprovechar mejor los recursos de tu equipo. El ahorro real no es automático: depende de tus procesos, canales, implementación y uso de la IA.</p>
     <p style={{marginTop:14}}>Con integraciones bien configuradas también puedes mejorar las prácticas de control y seguridad, aunque ninguna plataforma garantiza evitar sanciones, bloqueos o suspensiones de Meta o WhatsApp Business.</p>
    </div>
   </div>
  </section>

  <section className={styles.section} aria-labelledby="night-heading">
   <div className={styles.intro}>
    <p className={styles.kicker}>Tu negocio no debería depender de que estés conectado las 24 horas</p>
    <h2 id="night-heading">¿Cuántas veces le has escrito a una marca y nunca te respondió?</h2>
    <p>Quizás te respondieron una primera vez, hiciste otra pregunta y nadie volvió a contestarte. O escribiste por la noche y tu consulta quedó olvidada hasta el día siguiente.</p>
    <p style={{marginTop:14}}>Con MW1 puedes organizar mejor esas conversaciones, preparar respuestas para preguntas habituales y facilitar el seguimiento cuando regresen tus asesores. Porque una atención más oportuna también forma parte de la experiencia que los clientes esperan.</p>
   </div>
  </section>

  <section className={styles.cta}>
   <p className={styles.kicker}>Empieza a transformar la atención de tu negocio</p>
   <h2>MW1 es más que un CRM. Es una forma de organizar tu empresa para seguir creciendo.</h2>
   <p>Centraliza tus conversaciones, apoya a tus asesores con IA, automatiza tareas repetitivas y da seguimiento a cada oportunidad desde una misma plataforma.</p>
   <div className={styles.actions}><Link href="/prueba-gratis" className={marketing.primaryButton}>Probar MW1 durante 14 días</Link><Link href="/precios" className={marketing.secondaryButton}>Ver planes y precios</Link></div>
  </section>
  <footer className={marketing.footer}>MW1 · Atención más organizada, inteligencia artificial y control para tu empresa</footer>
 </main>;
}
