import Link from 'next/link';
import styles from './demo-visuals.module.css';

const demos=[
 {number:'01',title:'Bandeja omnicanal y asesores',description:'Consulta los mensajes de tus canales habilitados y continúa la conversación con tu equipo.',type:'inbox'},
 {number:'02',title:'Inteligencia artificial respondiendo',description:'La IA utiliza el contexto configurado y puede dar paso a un asesor cuando se necesite.',type:'ai'},
 {number:'03',title:'Clientes y seguimiento',description:'Organiza contactos, notas y próximos pasos para no perder el contexto comercial.',type:'crm'},
] as const;

function IllustratedScreen({type}:{type:'inbox'|'ai'|'crm'}){
 if(type==='inbox')return <div className={styles.screen} aria-label="Ejemplo ilustrativo de bandeja de MW1">
  <div className={styles.screenTop}>MW1 · Bandeja de ejemplo <span>● ● ●</span></div>
  <div className={styles.screenBody}><div className={styles.screenRail}><b>Conversaciones</b><span>WhatsApp</span><span>Instagram</span><span>Messenger*</span></div>
   <div className={styles.screenChat}><span>Consulta de ejemplo recibida</span><strong>Atención asignada al equipo</strong><small>*La conexión depende de validación</small></div></div>
 </div>;
 if(type==='ai')return <div className={styles.screen} aria-label="Ejemplo ilustrativo de respuesta de IA">
  <div className={styles.screenTop}>MW1 · Asistente con IA <span>Ejemplo</span></div>
  <div className={styles.bubbles}><span>Cliente: ¿Me pueden explicar cómo funciona?</span><strong>IA: Claro. Puedo orientarte con la información configurada.</strong><span>Atención humana disponible según configuración</span></div>
 </div>;
 return <div className={styles.screen} aria-label="Ejemplo ilustrativo de seguimiento comercial">
  <div className={styles.screenTop}>MW1 · Clientes <span>Ejemplo</span></div>
  <div className={styles.crmGrid}><div><small>Contacto</small><strong>Cliente de ejemplo</strong></div><div><small>Estado</small><strong>Por contactar</strong></div><div><small>Seguimiento</small><strong>Coordinar próxima atención</strong></div></div>
 </div>;
}

export function DemoVisuals(){
 return <section className={styles.section} aria-labelledby="mw1-demo-visuals">
  <div className={styles.intro}><span>Recorrido visual de MW1</span><h2 id="mw1-demo-visuals">Tres formas de conocer cómo trabaja tu equipo.</h2><p>Vistas conceptuales elaboradas con datos ficticios. No son grabaciones ni capturas de conversaciones de clientes reales.</p></div>
  <div className={styles.grid}>{demos.map(item=><article className={styles.card} key={item.number}>
   <div className={styles.number}>{item.number}</div><h3>{item.title}</h3><p>{item.description}</p>
   <IllustratedScreen type={item.type}/>
   <Link href="/agendar-demo">Agendar una demostración <span aria-hidden="true">↗</span></Link>
  </article>)}</div>
 </section>;
}
