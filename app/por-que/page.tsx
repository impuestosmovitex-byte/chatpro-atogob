import type {Metadata} from 'next';
import Link from 'next/link';
import {MarketingHeader} from '../components/marketing/MarketingHeader';
import {MarketingIcon,type MarketingIconName} from '../components/marketing/MarketingIcon';
import marketing from '../components/marketing/marketing.module.css';
import styles from './por-que.module.css';

export const metadata:Metadata={
 title:'¿Por qué MW1? | Conversaciones, ventas y atención con IA',
 description:'Organiza los mensajes de tu negocio, coordina a tus asesores y mejora la atención con ayuda de la IA. Conoce por qué usar MW1.',
};
const benefits:{icon:MarketingIconName;title:string;description:string}[]=[
 {icon:'whatsapp',title:'Tus canales en una sola bandeja',description:'Organiza en un mismo espacio los canales de atención conectados, sin obligar a tus asesores a saltar entre aplicaciones.'},
 {icon:'users',title:'Un equipo que trabaja con control',description:'Distribuye la atención, identifica quién gestiona las conversaciones y mantén un historial para hacer seguimiento a cada oportunidad.'},
 {icon:'bot',title:'IA para acompañar a tus clientes',description:'Ofrece respuestas sobre tus productos, horarios y condiciones configuradas, incluso cuando tu equipo no está disponible. El asesor puede tomar el control.'},
 {icon:'database',title:'Información más organizada',description:'Conserva contexto, contactos, notas y estados de atención. Reduce la dependencia de conversaciones aisladas y difíciles de rastrear.'},
 {icon:'workflow',title:'Menos tareas repetitivas',description:'Configura mensajes, reglas y seguimientos para que tu equipo dedique más tiempo a resolver consultas y cerrar oportunidades.'},
 {icon:'shopping',title:'De la conversación a la venta',description:'Comparte información de productos y catálogos dentro del flujo comercial. Enlaces de pago y gestión ampliada de pedidos forman parte de las integraciones previstas.'},
];
const steps=[
 {number:'01',title:'El cliente escribe',description:'Llega un mensaje desde uno de los canales habilitados para tu negocio.'},
 {number:'02',title:'MW1 conserva el contexto',description:'Tu equipo consulta la conversación y la información del cliente desde una misma plataforma.'},
 {number:'03',title:'El asesor y la IA colaboran',description:'La IA puede resolver consultas configuradas y un humano interviene cuando haga falta.'},
 {number:'04',title:'Das seguimiento a la oportunidad',description:'Organiza el interés del cliente, las tareas pendientes y el siguiente paso comercial.'},
];
export default function PorQuePage(){
 return <main className={marketing.site}>
  <MarketingHeader/>
  <section className={styles.hero}>
   <div className={styles.heroText}>
    <div className={marketing.eyebrow}>¿Por qué usar MW1?</div>
    <h1>Que una conversación sin atender <span>no sea una venta perdida.</span></h1>
    <p className={styles.lead}>Cada mensaje es una oportunidad. Cuando tus canales están separados, tus asesores no tienen contexto o nadie responde a tiempo, atender y vender se vuelve más difícil.</p>
    <p className={styles.sublead}><strong>MW1 reúne la atención, el equipo y la IA en un solo lugar</strong> para que tu negocio tenga más organización, seguimiento y control.</p>
    <div className={styles.actions}>
     <Link href="/demo" className={marketing.primaryButton}>Conoce MW1 en una demo ↗</Link>
     <Link href="/precios" className={marketing.secondaryButton}>Conocer los planes</Link>
    </div>
    <span className={styles.heroDisclaimer}>Tu equipo mantiene el control. Las integraciones y funcionalidades dependen del plan y la configuración.</span>
   </div>
   <div className={styles.visual} aria-label="Ejemplo ilustrativo de atención unificada con IA">
    <div className={styles.visualTop}><strong>MW1</strong><span>Ejemplo de conversación</span></div>
    <div className={styles.visualTabs}><span>WhatsApp</span><span>Instagram</span><span>Messenger</span></div>
    <div className={styles.chatBubbleClient}>Hola, quiero información del producto que vi. ¿Todavía lo tienen?</div>
    <div className={styles.chatBubbleAgent}><span>Asistente MW1</span>¡Hola! Puedo ayudarte a revisar la información del catálogo conectado. ¿Qué talla buscas?</div>
    <div className={styles.chatBubbleClient}>Quiero confirmar antes de comprar.</div>
    <div className={styles.handoff}><MarketingIcon name="users"/> <span><strong>Asesor disponible</strong> · Puede continuar la atención con el contexto de esta conversación.</span></div>
    <div className={styles.visualFooter}>Vista demostrativa · No es una conversación real</div>
   </div>
  </section>

  <section className={styles.section} aria-labelledby="problem-heading">
   <div className={styles.intro}>
    <p className={styles.kicker}>El problema no es recibir mensajes</p>
    <h2 id="problem-heading">El reto es responderlos, administrarlos y convertirlos en oportunidades.</h2>
    <p>Cuando la información puede perderse en cuentas individuales, no existe trazabilidad o las respuestas llegan tarde, el negocio asume riesgos comerciales y operativos. Centralizar la atención ayuda a tener más control; ninguna herramienta elimina por completo el riesgo de fraude.</p>
   </div>
   <div className={styles.benefitGrid}>
    {benefits.map(item=><article key={item.title} className={styles.benefitCard}>
     <span className={styles.benefitIcon}><MarketingIcon name={item.icon}/></span>
     <h3>{item.title}</h3><p>{item.description}</p>
    </article>)}
   </div>
  </section>

  <section className={styles.workflowSection} aria-labelledby="process-heading">
   <div className={styles.section}>
    <div className={styles.intro}>
     <p className={styles.kicker}>De mensaje a oportunidad comercial</p>
     <h2 id="process-heading">Un flujo de atención más claro para tu equipo.</h2>
    </div>
    <div className={styles.steps}>
     {steps.map(step=><div key={step.number} className={styles.step}>
      <span>{step.number}</span><h3>{step.title}</h3><p>{step.description}</p>
     </div>)}
    </div>
   </div>
  </section>

  <section className={styles.section} aria-labelledby="payment-heading">
   <div className={styles.paymentPanel}>
    <div>
     <p className={styles.kicker}>El siguiente paso: facilitar el cierre</p>
     <h2 id="payment-heading">Del “quiero pagar” a un enlace de pago seguro.</h2>
     <p>Queremos que MW1 permita generar y compartir enlaces de pago desde el CRM utilizando la pasarela configurada por cada empresa. El cliente pagaría en un entorno seguro del proveedor y el negocio podría consultar el estado de la transacción.</p>
     <p className={styles.pendingLabel}>Integración de pagos en desarrollo · No disponible todavía como cobro nativo desde MW1.</p>
     <Link href="/demo" className={marketing.primaryButton}>Consultar integraciones y disponibilidad</Link>
    </div>
    <div className={styles.paymentVisual} aria-label="Ejemplo ilustrativo del futuro flujo de enlaces de pago">
     <div className={styles.paymentMessage}>Cliente: “Listo, quiero pagar”.</div>
     <div className={styles.paymentExample}>
      <span><MarketingIcon name="payment"/> Enlace de pago</span>
      <strong>Pedido de ejemplo</strong>
      <small>Total y referencia confirmados por la empresa</small>
      <div className={styles.fakePayButton}>Continuar al pago ↗</div>
     </div>
     <p>Ilustración de una función prevista. Este botón no cobra ni abre una pasarela.</p>
    </div>
   </div>
  </section>

  <section className={styles.cta}>
   <p className={styles.kicker}>Tu negocio sigue creciendo. Tu atención también debe mejorar.</p>
   <h2>Menos mensajes perdidos. Más contexto, atención y seguimiento.</h2>
   <p>Conoce cómo MW1 puede adaptarse a los canales, el equipo y las necesidades de tu empresa.</p>
   <div className={styles.actions}><Link className={marketing.primaryButton} href="/demo">Solicitar una demo</Link><Link href="/precios" className={marketing.secondaryButton}>Ver planes</Link></div>
  </section>
  <footer className={marketing.footer}>MW1 · Atención organizada, IA y control para tu negocio</footer>
 </main>;
}
