'use client';

import Link from 'next/link';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {AppSidebar} from '../../components/AppSidebar';
import styles from '../../pedidos/page.module.css';
import pageStyles from './page.module.css';
import {
  CONNECTION_TYPES,sanitizeSources,sourceHealth,summarizeSources,
  type CatalogSource,
} from '../../lib/staging-catalog-connections';

export default function CatalogConnectionsPage(){
  const[sources,setSources]=useState<CatalogSource[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  const [refreshedAt,setRefreshedAt]=useState<Date|null>(null);
  const summary=useMemo(()=>summarizeSources(sources),[sources]);
  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/native-commerce/catalog/sources',{cache:'no-store'});
      const payload=await response.json() as {
        ok?:boolean;error?:string;sources?:unknown;
      };
      if(!response.ok||!payload.ok)
        throw new Error(payload.error||'No fue posible consultar las fuentes de esta empresa.');
      setSources(sanitizeSources(payload.sources));
      setRefreshedAt(new Date());
    }catch(cause){
      setSources([]);
      setError(cause instanceof Error?cause.message:'No fue posible cargar las conexiones.');
    }finally{setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);

  return <div className={styles.shell}>
    <AppSidebar companyName="Empresa de pruebas"/>
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MW1 · CATÁLOGOS UNIVERSALES</p>
          <h1>Fuentes y conexiones</h1>
          <p>Consulta qué catálogos tiene registrada tu empresa, su origen y los datos que necesitan revisión.</p>
          <p><Link href="/catalogo">← Catálogo</Link> · <Link href="/catalogo/importar">Importar archivo</Link> · <Link href="/catalogo/asistente">Asistente de catálogo</Link></p>
        </div>
        <button type="button" onClick={()=>void reload()} disabled={loading}
          className={styles.reload}>{loading?'Consultando…':'Actualizar estado'}</button>
      </header>

      <section className={styles.panel}>
        <h2>Estado de las fuentes registradas</h2>
        <p className={styles.note}>Los indicadores provienen del catálogo de MW1. Una fuente registrada no implica que el conector de su plataforma ya esté funcionando.</p>
        <div className={pageStyles.metrics}>
          <div><strong>{summary.total}</strong><span>Fuentes registradas</span></div>
          <div><strong>{summary.local}</strong><span>Archivos o manuales</span></div>
          <div><strong>{summary.external}</strong><span>Fuentes externas</span></div>
          <div><strong>{summary.attention}</strong><span>Necesitan revisión</span></div>
        </div>
        {error&&<p className={styles.error} role="alert">{error}</p>}
        {!loading&&!error&&sources.length===0&&
          <p className={styles.empty}>Esta empresa todavía no tiene fuentes registradas. Puedes comenzar importando un Excel o CSV.</p>}
        {sources.length>0&&<div className={pageStyles.sourceList}>
          {sources.map(source=>{
            const health=sourceHealth(source);
            return <article key={source.id} className={pageStyles.source}>
              <div className={pageStyles.sourceHeader}>
                <strong>{source.label}</strong>
                <span className={pageStyles[health.level]}>{health.label}</span>
              </div>
              <p className={pageStyles.metadata}>
                {CONNECTION_TYPES.find(item=>item.kind===source.kind)?.name||source.kind}
                {' · '}{source.managedBy==='mw1'?'Administrado localmente':'Origen externo'}
              </p>
              <p>{health.detail}</p>
              {source.lastSyncedAt&&<p className={pageStyles.metadata}>
                Fecha registrada: {new Date(source.lastSyncedAt).toLocaleString('es-CO')}
              </p>}
            </article>;
          })}
        </div>}
        {refreshedAt&&<p className={styles.note}>Consulta realizada: {refreshedAt.toLocaleString('es-CO')}. No se ha ejecutado ninguna sincronización.</p>}
      </section>

      <section className={styles.panel}>
        <h2>Formas de conectar un catálogo</h2>
        <p className={styles.note}>Un solo catálogo comercial puede reunir distintas fuentes de una empresa. Esta pantalla es informativa: no solicita contraseñas ni modifica tiendas.</p>
        <div className={pageStyles.catalogGrid}>
          {CONNECTION_TYPES.map(item=>{
            const count=sources.filter(source=>source.kind===item.kind).length;
            return <article key={item.kind} className={pageStyles.type}>
              <div className={pageStyles.typeHeader}>
                <strong>{item.name}</strong>
                <span>{count?count+' registrada'+(count!==1?'s':''):'Sin registrar'}</span>
              </div>
              <p>{item.description}</p>
              <div className={pageStyles.foot}>
                {item.link?<Link href={item.link}>Abrir importación o catálogo →</Link>
                  :<small>Conector de escritura y actualización pendiente de implementar</small>}
              </div>
            </article>;
          })}
        </div>
      </section>
      <p className={styles.disclaimer}>
        Entorno de pruebas: lectura únicamente. No se conecta a Shopify, WooCommerce ni Tiendanube desde esta página; tampoco modifica precios ni afecta ATOGOB.
      </p>
    </main>
  </div>;
}
