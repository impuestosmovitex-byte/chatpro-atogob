'use client';
import Link from 'next/link';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {AppSidebar} from '../../components/AppSidebar';
import styles from '../../pedidos/page.module.css';
import pageStyles from './page.module.css';

type PriceChoice={
  productId:string;variantId:string;name:string;sku:string|null;
  variantLabel:string;price:number;currency:string;sourceKind:string;
  sourceLabel:string;canApply:boolean;blockedReason:string|null;
};
type Plan={
  ok:boolean;mode:string;reply:string;choices:PriceChoice[];
  newPrice?:number;error?:string;
};
type Source={
  id:string;kind:string;label:string;status:string;
  managedBy:'mw1'|'external';updateMethod:string;canEditPrice:boolean;
  lastSyncedAt:string|null;
};
const money=(value:number)=>new Intl.NumberFormat('es-CO',{
  style:'currency',currency:'COP',maximumFractionDigits:0,
}).format(value);

export default function CatalogAdminAssistant(){
  const[message,setMessage]=useState('Cambia el precio del arroz blanco Diana a 20 mil pesos');
  const[plan,setPlan]=useState<Plan|null>(null);
  const[selected,setSelected]=useState<PriceChoice|null>(null);
  const[working,setWorking]=useState(false);
  const[reply,setReply]=useState('');
  const[error,setError]=useState('');
  const[sources,setSources]=useState<Source[]>([]);
  const requestKey=useRef<string|null>(null);

  useEffect(()=>{
    let active=true;
    fetch('/api/native-commerce/catalog/sources',{cache:'no-store'})
      .then(async response=>{
        const data=await response.json();
        if(active&&response.ok&&data.ok)setSources(data.sources||[]);
      }).catch(()=>undefined);
    return()=>{active=false;};
  },[]);
  async function preview(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(working||!message.trim())return;
    setWorking(true);setError('');setReply('');setPlan(null);setSelected(null);
    requestKey.current=null;
    try{
      const response=await fetch('/api/native-commerce/catalog/admin/price/preview',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({message}),
      });
      const data=await response.json() as Plan;
      if(!response.ok||!data.ok)throw new Error(data.error||'No pude consultar el catálogo.');
      setPlan(data);setReply(data.reply);
      if(data.mode==='confirm'&&data.choices?.length===1)
        setSelected(data.choices[0]);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo analizar la solicitud.');}
    finally{setWorking(false);}
  }
  async function confirm(){
    if(!plan||!selected||!selected.canApply||plan.mode==='stale'||
       typeof plan.newPrice!=='number'||working)return;
    setWorking(true);setError('');
    try{
      if(!requestKey.current)requestKey.current=crypto.randomUUID();
      const response=await fetch('/api/native-commerce/catalog/admin/price/confirm',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({
          confirm:true,requestKey:requestKey.current,
          variantId:selected.variantId,expectedPrice:selected.price,
          newPrice:plan.newPrice,
        }),
      });
      const data=await response.json() as {
        ok?:boolean;error?:string;oldPrice?:number;newPrice?:number;
        alreadyApplied?:boolean;
      };
      if(!response.ok||!data.ok)throw new Error(data.error||'No se pudo actualizar el precio.');
      setReply(data.alreadyApplied?'Esta confirmación ya se había aplicado; no se repitió el cambio.':
        'Precio actualizado: de '+money(Number(data.oldPrice))+
        ' a '+money(Number(data.newPrice))+'. El cambio quedó registrado en auditoría.');
      setPlan(null);setSelected(null);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo confirmar. Actualiza el catálogo.');}
    finally{setWorking(false);}
  }
  return <div className={styles.shell}>
    <AppSidebar companyName="Empresa de pruebas"/>
    <main className={styles.main}>
      <header className={styles.header}><div>
        <p className={styles.eyebrow}>MW1 · ADMINISTRADOR DE CATÁLOGO</p>
        <h1>Cambios por conversación</h1>
        <p>Describe el ajuste. MW1 buscará la variante y te pedirá confirmar antes de cambiar el precio.</p>
        <p><Link href="/catalogo">← Catálogo</Link> · <Link href="/catalogo/fichas">Fichas de productos</Link></p>
      </div></header>
      <section className={styles.panel}>
        <h2>Asistente de precios · demo</h2>
        <p className={styles.note}>Por ahora interpreta instrucciones de precios de venta en español. No usa OpenAI externo ni modifica precios sin aprobación explícita.</p>
        <form onSubmit={event=>void preview(event)} className={pageStyles.chatForm}>
          <label htmlFor="catalog-admin-command">Escribe tu solicitud</label>
          <textarea id="catalog-admin-command" rows={3} maxLength={450}
            placeholder="Cambia el precio del arroz blanco Diana a 20 mil pesos"
            value={message} onChange={e=>setMessage(e.target.value)} disabled={working}/>
          <button className={styles.action} disabled={working||message.trim().length<10} type="submit">
            {working?'Consultando…':'Revisar cambio'}
          </button>
        </form>
        {error&&<p className={styles.error} role="alert">{error}</p>}
        {reply&&<p className={pageStyles.reply} role="status">{reply}</p>}
      </section>
      {plan?.choices?.length? <section className={styles.panel}>
        <h2>{plan.choices.length>1?'Elige la referencia exacta':'Propuesta de actualización'}</h2>
        <p className={styles.note}>Los precios y las fuentes se consultan desde tu empresa. No se han modificado datos.</p>
        <div className={pageStyles.choices}>
          {plan.choices.map(item=><div className={pageStyles.choice} key={item.variantId}>
            <div>
              <strong>{item.name} · {item.variantLabel}</strong>
              <small>SKU: {item.sku||'Sin SKU'} · Fuente: {item.sourceLabel}</small>
              <small>Actual: {money(item.price)} · Nuevo: {money(plan.newPrice||0)}</small>
              {!item.canApply&&<small className={pageStyles.blocked}>{item.blockedReason}</small>}
            </div>
            {item.canApply&&plan.mode!=='stale'&&
              <button type="button" disabled={working}
                onClick={()=>{setSelected(item);requestKey.current=null;}}>
                {selected?.variantId===item.variantId?'Seleccionado':'Seleccionar'}
              </button>}
          </div>)}
        </div>
        {selected?.canApply&&plan.mode!=='stale'&&typeof plan.newPrice==='number'&&
        <div className={pageStyles.confirm}>
          <p><strong>¿Confirmas?</strong> Solo cambiará {selected.name}, variante {selected.variantLabel},
            de {money(selected.price)} a {money(plan.newPrice)}.</p>
          <button className={styles.action} disabled={working} type="button"
            onClick={()=>void confirm()}>{working?'Actualizando…':'Confirmar cambio de precio'}</button>
        </div>}
      </section>:null}
      <section className={styles.panel}>
        <h2>¿De dónde vienen los productos?</h2>
        <p className={styles.note}>MW1 conserva la fuente original. Shopify, WooCommerce/WordPress y Tiendanube necesitan sincronización y permisos específicos para escribir precios. Nunca editamos esas tiendas en esta demo.</p>
        {sources.length?<div className={pageStyles.sources}>
          {sources.map(source=><div key={source.id} className={pageStyles.source}>
            <strong>{source.label}</strong>
            <small>{source.kind} · {source.status} · {source.managedBy==='mw1'?'Administrado en MW1':'Gestionado externamente'}</small>
          </div>)}
        </div>:<p className={styles.empty}>No se encontraron fuentes configuradas en esta sesión o aún no están disponibles.</p>}
      </section>
      <p className={styles.disclaimer}>Versión preparada en la rama de pruebas. No afecta los catálogos reales ni los mensajes de ATOGOB.</p>
    </main>
  </div>;
}
