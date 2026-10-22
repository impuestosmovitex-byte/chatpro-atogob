import Link from "next/link";
import { MarketingHeader } from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";

const plans = [
  {
    eyebrow: "Para comenzar",
    name: "Inicial",
    featured: false,
    price: "Por definir",
    details: ["Bandeja centralizada", "Leads y seguimiento", "Etiquetas y notas", "Catálogo", "Automatizaciones esenciales", "Soporte"],
  },
  {
    eyebrow: "Recomendado",
    name: "Pro",
    featured: true,
    price: "Por definir",
    details: ["Todo lo de Inicial", "IA para atención y ventas", "Automatizaciones avanzadas", "Más usuarios", "Reportes", "Integraciones"],
  },
  {
    eyebrow: "Para equipos",
    name: "Empresa",
    featured: false,
    price: "Personalizado",
    details: ["Todo lo de Pro", "Roles y permisos", "Integraciones avanzadas", "Flujos personalizados", "Analítica", "Acompañamiento"],
  },
];

export default function PreciosPage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />
      <section className={styles.section}>
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Planes MW1</div>
          <h2>Conoce los planes de MW1 para tu empresa.</h2>
          <p>
            Mejora la atención de tus clientes, impulsa tus ventas y organiza las oportunidades comerciales con MW1.
            Si tu meta es aumentar hasta un 20% las conversiones, empieza por reducir los tiempos de respuesta y mejorar el seguimiento.
          </p>
          <p className={styles.pricingClarification}>El 20% es una meta comercial posible de plantear, no un resultado garantizado.</p>
        </div>

        <div className={styles.priceGrid}>
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={plan.featured ? `${styles.priceCard} ${styles.priceCardFeatured}` : styles.priceCard}
            >
              <span className={styles.priceLabel}>{plan.eyebrow}</span>
              <h3>{plan.name}</h3>
              <div className={styles.price}>{plan.price}</div>
              <ul>
                {plan.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
              <Link href="/demo" className={plan.featured ? styles.primaryButton : styles.secondaryButton}>
                Solicitar demo
              </Link>
            </article>
          ))}
        </div>
      </section>
      <footer className={styles.footer}>MW1 · Precios y planes</footer>
    </main>
  );
}
