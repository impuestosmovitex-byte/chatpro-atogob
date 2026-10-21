'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import { type CatalogChoice } from '../../lib/staging-catalog-parser';
import orderStyles from '../page.module.css';
import styles from './page.module.css';

type Product={id:string;name:string;sku:string|null;published:boolean;available:boolean};
type Variant={id:string;product_id:string;sku:string|null;variant_label:string;price:number|string;stock_quantity:number|null;available:boolean};
type Message={id:number;from:'customer'|'assistant';text:string};
type CartLine=CatalogChoice & {quantity:number};
type Fulfillment='local_delivery'|'carrier'|'pickup';

function pesos(n:number) {
  return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(n);
}

const welcome='¡Hola! Soy el asistente de demostración de MW1. Puedes pedirme productos del catálogo. Prueba escribir: «2 panes, una cubeta de huevos y 3 chocolates».';

export default function ChatOrderSimulatorPage(){
  const [catalog,setCatalog]=useState<CatalogChoice[]>([]);
  const [cart,setCart]=useState<CartLine[]>([]);
  const [messages,setMessages]=useState<Message[]>([{id:1,from:'assistant',text:welcome}]);
  const [input,setInput]=useState('');
  const [customerName,setCustomerName]=useState('Cliente Demo');
  const [phone,setPhone]=useState('3000000000');
  const [address,setAddress]=useState('Dirección ficticia de pruebas');
  const [method,setMethod]=useState<Fulfillment>('local_delivery');
  const [note,setNote]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [thinking,setThinking]=useState(false);
  const [assistantMode,setAssistantMode]=useState<'ia'|'simulacion'|'catalogo'>('simulacion');
  const [suggestedProducts,setSuggestedProducts]=useState<CatalogChoice[]>([]);
  const [error,setError]=useState('');
  const [savedOrder,setSavedOrder]=useState<{code:string;total:number}|null>(null);
  const idRef=useRef(1);
  const requestKeyRef=useRef<string|null>(null);

  function append(from:'customer'|'assistant',text:string){
    idRef.current+=1;
    setMessages(prev=>[...prev,{id:idRef.current,from,text}]);
  }
  const fetchCatalog=useCallback(async()=>{
    setLoading(true);
    setError('');
    try{
      const [pResponse,vResponse]=await Promise.all([
        fetch('/api/native-commerce/products',{cache:'no-store'}),
        fetch('/api/native-commerce/variants',{cache:'no-store'}),
      ]);
      const [pData,vData]=await Promise.all([pResponse.json(),vResponse.json()]);
      if(!pResponse.ok||!vResponse.ok||!pData.ok||!vData.ok)throw new Error(pData.error||vData.error||'No se pudo cargar el catálogo.');
      const products=(pData.products||[]) as Product[];
      const variants=(vData.variants||[]) as Variant[];
      const choices:CatalogChoice[]=variants.flatMap(v=>{
        const p=products.find(p=>p.id===v.product_id&&p.published&&p.available);
        if(!p||!v.available)return [];
        return [{
          variantId:v.id,
          label:v.variant_label==='Única'?p.name:`${p.name} ${v.variant_label}`,
          unitPrice:Number(v.price),
          stock:v.stock_quantity===null?null:Number(v.stock_quantity),
        }];
      });
      setCatalog(choices);
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Error al cargar el catálogo.');
    }finally{setLoading(false);}
  },[]);
  useEffect(()=>{void fetchCatalog();},[fetchCatalog]);

  const total=cart.reduce((sum,x)=>sum+x.quantity*x.unitPrice,0);
  function changeQuantity(variantId:string,quantity:number){
    setSavedOrder(null);
    setCart(prev=>prev.map(x=>x.variantId===variantId?{...x,quantity}:x).filter(x=>x.quantity>0));
  }
  function addChoice(choice:CatalogChoice,quantity=1){
    setSavedOrder(null);
    let failed=false;
    setCart(prev=>{
      const old=prev.find(x=>x.variantId===choice.variantId);
      const updated=(old?.quantity||0)+quantity;
      if(updated>1000||(choice.stock!==null&&updated>choice.stock)){
        failed=true;
        return prev;
      }
      if(old)return prev.map(x=>x.variantId===choice.variantId?{...x,quantity:updated}:x);
      return [...prev,{...choice,quantity}];
    });
    return !failed;
  }
  async function handleMessage(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const phrase=input.trim().slice(0,450);
    if(!phrase||loading||saving||thinking||savedOrder)return;
    setInput('');
    setError('');
    setSuggestedProducts([]);
    append('customer',phrase);
    setThinking(true);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),18000);
    try{
      const response=await fetch('/api/native-commerce/assistant/plan',{
        method:'POST',
        signal:controller.signal,
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          message:phrase,
          cart:cart.map(x=>({variantId:x.variantId,quantity:x.quantity})),
        }),
      });
      const data=await response.json();
      if(!response.ok||!data.ok){
        throw new Error(data.error||'No pude consultar el catálogo en este momento.');
      }
      if(!Array.isArray(data.cart)||typeof data.reply!=='string'){
        throw new Error('El asistente devolvió un resultado incompleto.');
      }
      const next=data.cart as CartLine[];
      if(next.some(x=>!catalog.some(product=>product.variantId===x.variantId))){
        throw new Error('El catálogo cambió; actualiza el simulador.');
      }
      setCart(next);
      setSavedOrder(null);
      setAssistantMode(data.mode==='ia'?'ia':data.mode==='catalogo'?'catalogo':'simulacion');
      const options=Array.isArray(data.productOptions)?data.productOptions:[];
      setSuggestedProducts(options.slice(0,6).flatMap((item:unknown)=>{
        if(!item||typeof item!=='object')return [];
        const obj=item as Partial<CatalogChoice>;
        const found=catalog.find(p=>p.variantId===obj.variantId);
        return found?[found]:[];
      }));
      append('assistant',data.reply||'No pude interpretar esta solicitud. Indica el producto exacto.');
    }catch(cause){
      const errorMessage=cause instanceof Error&&cause.name==='AbortError'
        ? 'La consulta tardó demasiado. Inténtalo otra vez.'
        :cause instanceof Error?cause.message:'No fue posible consultar el asistente.';
      setError(errorMessage);
      append('assistant','No modifiqué el carrito: '+errorMessage);
    }finally{
      clearTimeout(timeout);
      setThinking(false);
    }
  }

  async function createOrder(){
    if(!cart.length||saving||savedOrder)return;
    setError('');
    if(customerName.trim().length<2||!/^[+]?[0-9]{7,15}$/.test(phone.trim())||
      (method!=='pickup'&&address.trim().length<5)){
      setError('Completa el nombre, el teléfono y la dirección de entrega cuando corresponda.');
      return;
    }
    setSaving(true);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),20000);
    try{
      if(!requestKeyRef.current)requestKeyRef.current=crypto.randomUUID();
      const response=await fetch('/api/native-commerce/orders',{
        method:'POST',signal:controller.signal,
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          requestKey:requestKeyRef.current,
          customerName:customerName.trim(),
          customerPhone:phone.trim(),
          deliveryAddress:address.trim(),
          fulfillmentMethod:method,
          customerNote:`Simulación de chat interno. ${note.trim()}`.slice(0,500),
          items:cart.map(x=>({variantId:x.variantId,quantity:x.quantity})),
        }),
      });
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo guardar el pedido.');
      setSavedOrder({code:result.orderCode,total:Number(result.grandTotal)});
      append('assistant',`Registré el pedido ${result.orderCode} por ${pesos(Number(result.grandTotal))}. Está pendiente de confirmación y sin pagar. Esto fue una simulación interna: no envié ningún WhatsApp.`);
    }catch(cause){
      setError(cause instanceof Error&&cause.name==='AbortError'?
        'El registro está tardando. Revisa Pedidos antes de volver a intentarlo.':
        cause instanceof Error?cause.message:'No se pudo registrar el pedido.');
    }finally{
      clearTimeout(timeout);
      setSaving(false);
    }
  }

  return <div className={orderStyles.shell}>
    <AppSidebar companyName="Empresa de pruebas"/>
    <main className={orderStyles.main}>
      <header className={orderStyles.header}>
        <div>
          <p className={orderStyles.eyebrow}>MW1 COMERCIO · LABORATORIO</p>
          <h1>Simulador de pedidos por chat</h1>
          <p>Prueba solicitudes de compra con catálogo y precios verificados. La IA se activará solo con configuración exclusiva de staging; no se envían mensajes reales.</p>
          <p><Link href="/pedidos">← Volver a Pedidos</Link></p>
        </div>
      </header>
      <div className={styles.columns}>
        <section className={styles.chatPanel}>
          <div className={styles.chatHeader}>
            <span className={styles.avatar}>MW</span>
            <div><strong>Asistente de compras · DEMO</strong><small>{thinking?'Consultando catálogo…':assistantMode==='ia'?'IA supervisada · no es WhatsApp':assistantMode==='catalogo'?'Precios y existencias del catálogo · sin WhatsApp':'Reconocimiento local · no es WhatsApp'}</small></div>
          </div>
          <div className={styles.messages} aria-live="polite">
            {messages.map(m=><div key={m.id} className={m.from==='assistant'?styles.assistantMessage:styles.customerMessage}>
              {m.text}
            </div>)}
          </div>
          {suggestedProducts.length>0 && (
            <div className={styles.recommendations}>
              <strong>Referencias del catálogo</strong>
              {suggestedProducts.map(option=>(
                <div className={styles.recommendation} key={option.variantId}>
                  <span>{option.label}<small>{pesos(option.unitPrice)} · {option.stock===null?'Inventario por confirmar':option.stock===0?'Agotado':`${option.stock} unidades registradas`}</small></span>
                  <button type="button" disabled={thinking||Boolean(savedOrder)||option.stock===0}
                    onClick={()=>addChoice(option)}>Agregar</button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleMessage} className={styles.inputBar}>
            <input aria-label="Mensaje al asistente de demostración" value={input}
              onChange={e=>setInput(e.target.value)} maxLength={450}
              placeholder="Ejemplo: 2 panes y una cubeta de huevos"
              disabled={loading||saving||thinking||Boolean(savedOrder)}/>
            <button type="submit" disabled={!input.trim()||loading||saving||thinking||Boolean(savedOrder)}>{thinking?'Consultando…':'Enviar'}</button>
          </form>
          <p className={styles.hint}>El asistente solo propone cambios al carrito. El pedido requiere confirmación explícita; los precios se verifican nuevamente al guardar.</p>
        </section>
        <section className={styles.cartPanel}>
          <h2>Carrito de compras</h2>
          {loading?<p>Cargando catálogo…</p>:!catalog.length?
            <p>No hay referencias disponibles. <Link href="/catalogo">Agrega productos.</Link></p>:
            <div className={styles.catalogChoices}>
              <small>Agregar productos desde el catálogo</small>
              {catalog.map(p=><div key={p.variantId} className={styles.choice}>
                <span>{p.label}<small>{pesos(p.unitPrice)} · {p.stock===null?'Sin control de stock':`Stock: ${p.stock}`}</small></span>
                <button type="button" onClick={()=>addChoice(p)} disabled={thinking||savedOrder!==null||(p.stock!==null&&p.stock===0)}>+</button>
              </div>)}
            </div>}
          {cart.length===0?<p className={styles.muted}>El carrito está vacío. Puedes escribir una solicitud o agregar productos.</p>:
            <div className={styles.cartItems}>
              {cart.map(x=><div className={styles.cartItem} key={x.variantId}>
                <strong>{x.label}</strong>
                <div>
                  <input aria-label={`Cantidad de ${x.label}`} type="number" step={1} min={0} max={Math.min(1000,x.stock??1000)}
                    value={x.quantity} disabled={thinking||savedOrder!==null} onChange={e=>{
                      const n=Number(e.target.value);
                      if(Number.isInteger(n)&&n>=0&&n<=1000&&(x.stock===null||n<=x.stock))changeQuantity(x.variantId,n);
                    }}/>
                  <span>{pesos(x.quantity*x.unitPrice)}</span>
                </div>
              </div>)}
            </div>}
          <div className={styles.total}><strong>Subtotal</strong><strong>{pesos(total)}</strong></div>
          <p className={styles.muted}>No incluye el envío. Precios verificados nuevamente por el servidor.</p>
          <div className={styles.details}>
            <h3>Datos para registrar el pedido</h3>
            <label>Nombre del cliente<input value={customerName} onChange={e=>setCustomerName(e.target.value)} maxLength={120} disabled={Boolean(savedOrder)}/></label>
            <label>Teléfono ficticio<input value={phone} onChange={e=>setPhone(e.target.value)} disabled={Boolean(savedOrder)}/></label>
            <label>Método de entrega<select value={method} onChange={e=>setMethod(e.target.value as Fulfillment)} disabled={Boolean(savedOrder)}>
              <option value="local_delivery">Domicilio propio</option>
              <option value="carrier">Transportadora</option>
              <option value="pickup">Recogida en tienda</option>
            </select></label>
            {method!=='pickup'&&<label>Dirección ficticia<input value={address} onChange={e=>setAddress(e.target.value)} maxLength={350} disabled={Boolean(savedOrder)}/></label>}
            <label>Observaciones<input value={note} onChange={e=>setNote(e.target.value)} maxLength={400} disabled={Boolean(savedOrder)}/></label>
          </div>
          {error&&<p role="alert" className={orderStyles.error}>{error}</p>}
          {savedOrder?<div className={styles.success}>
            <strong>Pedido registrado: {savedOrder.code}</strong>
            <p>Quedó por confirmar, sin pagar y sin enviar mensajes.</p>
            <Link href="/pedidos">Abrir listado de pedidos →</Link>
          </div>:<button type="button" className={styles.confirm}
            disabled={loading||saving||thinking||cart.length===0} onClick={()=>void createOrder()}>
            {saving?'Guardando…':'Confirmar carrito y crear pedido'}
          </button>}
        </section>
      </div>
    </main>
  </div>;
}
