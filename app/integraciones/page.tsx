import Link from "next/link";
import { MarketingIcon, type MarketingIconName } from "../components/marketing/MarketingIcon";
import { MarketingHeader } from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";

const channels: {name:string;icon:MarketingIconName;description:string}[] = [
  {name:"WhatsApp",icon:"whatsapp",description:"Conversaciones y seguimiento con clientes."},
  {name:"Instagram",icon:"instagram",description:"Mensajes desde tu comunidad."},
  {name:"Messenger",icon:"messenger",description:"Consultas desde Facebook."},
  {name:"Telegram",icon:"telegram",description:"Otro canal para centralizar atención."},
  {name:"Chat web",icon:"web",description:"Consultas desde tu sitio."},
];
const stores: {name:string;icon:MarketingIconName;description:string}[] = [
  {name:"Shopify",icon:"shopping",description:"Explora opciones para vincular tu tienda y productos."},
  {name:"WordPress / WooCommerce",icon:"web",description:"Consulta alternativas de integración para tu comercio electrónico."},
  {name:"Tiendanube",icon:"shopping",description:"Evalúa cómo conectar tu tienda y sus catálogos."},
];
const catalogs: {name:string;icon:MarketingIconName;description:string}[] = [
  {name:"Catálogos PDF",icon:"catalog",description:"Consulta cómo aprovechar los archivos de tus productos."},
  {name:"Catálogos de productos",icon:"shopping",description:"Presenta información de productos en la conversación."},
  {name:"Datos de tu negocio",icon:"database",description:"Organiza horarios, políticas y respuestas frecuentes."},
];
const groups=[
  {number:"01",id:"canales",title:"Canales de atención",description:"Conversa con clientes donde ya te escriben.",items:channels},
  {number:"02",id:"tiendas",title:"Tiendas virtuales",description:"Conecta las herramientas con las que vendes.",items:stores},
  {number:"03",id:"catalogos",title:"Catálogos e información",description:"Da respuestas útiles con el contexto de tu empresa.",items:catalogs},
];

export default function IntegracionesPage(){
  return <main className={styles.site}>
    <MarketingHeader />
    <section className={styles.section}>
      <div className={styles.sectionIntroCentered}>
        <div className={styles.eyebrow}>Integraciones MW1</div>
        <h2>Conecta los canales y herramientas con las que tu empresa ya funciona.</h2>
        <p>Centraliza tus canales de atención, tu tienda virtual, tus catálogos y tu información comercial desde un mismo lugar.</p>
      </div>
      <div className={styles.integrationGroups}>
        {groups.map(group=><section key={group.id} className={styles.integrationGroup} aria-labelledby={group.id}>
          <div className={styles.integrationGroupHeading}>
            <span className={styles.integrationStep}>{group.number}</span>
            <div><h3 id={group.id}>{group.title}</h3><p>{group.description}</p></div>
          </div>
          <div className={styles.integrationOptionGrid}>
            {group.items.map(item=><article key={item.name} className={styles.integrationOptionCard} data-channel={item.icon}>
              <span className={styles.integrationOptionIcon}><MarketingIcon name={item.icon}/></span>
              <h4>{item.name}</h4><p>{item.description}</p>
            </article>)}
          </div>
        </section>)}
      </div>
      <div className={styles.integrationNotice}>
        <div>
          <strong>¿Quieres conectar alguna de estas herramientas?</strong>
          <p>La disponibilidad y el alcance de cada integración dependen de su compatibilidad y configuración. Consulta cuáles están habilitadas para tu negocio.</p>
        </div>
        <Link href="/demo" className={styles.primaryButton}>Conocer MW1</Link>
      </div>
    </section>
    <footer className={styles.footer}>MW1 · Canales, tiendas y catálogos</footer>
  </main>;
}
