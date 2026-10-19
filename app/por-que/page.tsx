import Link from "next/link";
import { MarketingHeader } from "../components/marketing/MarketingHeader";
import { MarketingIcon, type MarketingIconName } from "../components/marketing/MarketingIcon";
import styles from "../components/marketing/marketing.module.css";

const benefits: {icon: MarketingIconName; title: string; copy: string}[] = [
  { icon: "sparkles", title: "Atiende a tiempo, incluso cuando tu equipo no está", copy: "Automatiza respuestas y deja que la IA ayude a tus clientes con información de tu negocio." },
  { icon: "users", title: "Cada interesado queda organizado", copy: "Reúne clientes, notas, intereses, estados y seguimientos para cuidar cada oportunidad." },
  { icon: "shopping", title: "Vende dentro de la conversación", copy: "Comparte catálogo, opciones de pago y la información que el cliente necesita para avanzar." },
  { icon: "workflow", title: "Automatiza procesos repetitivos", copy: "Apóyate en respuestas, seguimientos y procesos para liberar tiempo de tu equipo." },
];

export default function PorQuePage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />
      <section className={styles.section}>
        <div className={styles.sectionIntro}>
          <div className={styles.eyebrow}>¿Por qué MW1?</div>
          <h2>Tu equipo atiende mejor cuando toda la información está en el mismo lugar.</h2>
          <p>MW1 reúne conversaciones, clientes y procesos para responder de forma más organizada, con apoyo de la IA y sin perder el trato humano.</p>
        </div>
        <div className={styles.benefitGrid}>
          {benefits.map(benefit=>(
            <article className={styles.benefitCard} key={benefit.title}>
              <div className={styles.benefitIcon}><MarketingIcon name={benefit.icon}/></div>
              <h3>{benefit.title}</h3><p>{benefit.copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className={styles.homeCta}>
        <div className={styles.homeCtaContent}>
          <h2>Conoce MW1 en acción.</h2>
          <p>Explora la vista ilustrativa del CRM y descubre cómo sería la atención de tu negocio.</p>
          <div className={styles.homeCtaActions}><Link href="/demo" className={styles.primaryButton}>Ver demostración</Link></div>
        </div>
      </section>
      <footer className={styles.footer}>MW1 · ¿Por qué elegirlo?</footer>
    </main>
  );
}
