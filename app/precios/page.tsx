import Link from "next/link";
import { MarketingHeader } from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";

// Oferta comercial en revisión. No activar cobros ni entitlements desde esta página.
// Las capacidades en desarrollo se identifican expresamente.
const plans = [
  {
    key: "basico", name: "Básico", eyebrow: "Para comenzar", price: "$149.000",
    users: "2 usuarios incluidos", connections: "1 conexión de WhatsApp",
    featured: false, summary: "Organiza conversaciones y clientes sin complicaciones.",
    highlights: ["CRM y bandeja de conversaciones", "Contactos, etiquetas e historial", "Asignación a asesores", "Soporte técnico", "Capacitación básica"],
    included: ["WhatsApp (según configuración autorizada)", "Bandeja compartida y atención humana", "Gestión de contactos y clientes", "Notas, etiquetas y seguimiento", "Usuarios y permisos de empresa", "Soporte técnico y capacitación básica"],
    conditional: ["Consumo de Meta/WhatsApp: facturado por Meta a cada empresa"],
  },
  {
    key: "eco", name: "Eco", eyebrow: "Para impulsar tus ventas", price: "$259.000",
    users: "3 usuarios incluidos", connections: "Hasta 3 conexiones",
    featured: true, summary: "Atiende con IA, automatiza y da seguimiento a tus oportunidades.",
    highlights: ["Todo lo del plan Básico", "IA comercial y de servicio", "Automatizaciones", "Leads y estadísticas", "Soporte técnico", "Capacitación avanzada"],
    included: ["Bandeja unificada: WhatsApp, Instagram y Messenger según conexión disponible", "Asistente de IA configurable por empresa", "Base de conocimiento e instrucciones de atención", "Transferencia de IA a asesor humano", "Flujos de automatización habilitados", "Seguimiento comercial y leads", "Reportes y actividad de asesores", "Capacitación avanzada y soporte técnico"],
    conditional: ["Envío automático de guías y seguimiento de envíos: sujeto a integración y configuración", "Consumo de IA incluido: cupo pendiente de aprobación", "Consumo Meta/WhatsApp facturado por Meta a cada empresa"],
  },
  {
    key: "pro", name: "Pro", eyebrow: "Para operaciones que crecen", price: "$599.000",
    users: "3 usuarios incluidos", connections: "Hasta 5 conexiones",
    featured: false, summary: "Más canales, acompañamiento y funciones comerciales avanzadas.",
    highlights: ["Todo lo del plan Eco", "Mayor capacidad de conexiones", "Automatizaciones avanzadas", "Acompañamiento premium", "Gestión de pedidos en desarrollo"],
    included: ["CRM, bandeja y gestión de clientes", "IA de ventas y servicio", "Automatizaciones y reportes", "Configuración asistida de canales", "Capacitación premium y soporte técnico"],
    conditional: ["Carritos y creación de pedidos internos: en desarrollo", "Enlaces para completar pedidos y pagos: en desarrollo", "Integraciones ampliadas de catálogos: sujetas a disponibilidad", "Consumo de IA y conexiones adicionales: límites por aprobar", "Meta/WhatsApp facturado por Meta a cada empresa"],
  },
];

export default function PreciosPage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />
      <section className={styles.section}>
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Planes MW1</div>
          <h2>Elige el plan que se ajusta a tu negocio.</h2>
          <p>Desde un pequeño comercio hasta un equipo de ventas: organiza clientes, conversaciones y atención desde una sola plataforma.</p>
          <p className={styles.pricingClarification}>Propuesta comercial en revisión: precios y límites orientativos, sujetos a confirmación. Las funciones todavía no disponibles están indicadas como «en desarrollo».</p>
        </div>
        <div className={styles.priceGrid}>
          {plans.map(plan => (
            <article key={plan.key} className={plan.featured ? `${styles.priceCard} ${styles.priceCardFeatured}` : styles.priceCard}>
              <span className={styles.priceLabel}>{plan.eyebrow}</span>
              <h3>{plan.name}</h3>
              <div className={styles.price}>{plan.price}<span style={{fontSize:14,fontWeight:500}}> / mes</span></div>
              <p style={{margin:"10px 0 14px",color:"#657187",fontSize:14}}>{plan.summary}</p>
              <p style={{fontWeight:800,marginBottom:6}}>{plan.users} · {plan.connections}</p>
              <ul>{plan.highlights.map(detail => <li key={detail}>{detail}</li>)}</ul>
              <details style={{margin:"18px 0",padding:"12px",background:"#f7f8fb",borderRadius:12}}>
                <summary style={{cursor:"pointer",fontWeight:800}}>Ver más: todas las funciones del plan</summary>
                <h4 style={{margin:"16px 0 8px"}}>Incluye</h4>
                <ul>{plan.included.map(detail => <li key={detail}>{detail}</li>)}</ul>
                <h4 style={{margin:"16px 0 8px"}}>Condiciones y disponibilidad</h4>
                <ul>{plan.conditional.map(detail => <li key={detail}>{detail}</li>)}</ul>
              </details>
              <Link href={`/demo?plan=${plan.key}`} className={plan.featured ? styles.primaryButton : styles.secondaryButton}>Solicitar demo</Link>
            </article>
          ))}
        </div>
      </section>
      <footer className={styles.footer}>MW1 · Planes y precios sujetos a confirmación</footer>
    </main>
  );
}
