/**
 * MW1 staging: read-only catalog connection status.
 * This module does not synchronize provider APIs or change product prices.
 */
export const SOURCE_KINDS = [
  'shopify','woocommerce','tiendanube','excel','csv','pdf','manual','website',
] as const;
export type SourceKind = typeof SOURCE_KINDS[number];
export type CatalogSource = {
  id: string;
  kind: SourceKind;
  label: string;
  status: 'draft'|'processing'|'ready'|'error'|'disabled';
  lastSyncedAt: string|null;
  managedBy: 'mw1'|'external';
};
export type SourceHealth={
  level: 'ok'|'attention'|'pending'|'disabled';
  label: string;
  detail: string;
};
export const CONNECTION_TYPES:ReadonlyArray<{
  kind:SourceKind;name:string;description:string;
  group:'external'|'local';link:string|null;
}>=[
  {kind:'shopify',name:'Shopify',description:'Tienda conectada por API. Las credenciales y permisos son independientes por empresa.',group:'external',link:null},
  {kind:'woocommerce',name:'WooCommerce (WordPress)',description:'Catálogo de WordPress con WooCommerce; requiere una API autorizada.',group:'external',link:null},
  {kind:'tiendanube',name:'Tiendanube',description:'Tienda online con productos y variantes mediante una integración autorizada.',group:'external',link:null},
  {kind:'website',name:'Página web',description:'Fuente web de consulta. No se permiten escrituras en páginas externas.',group:'external',link:null},
  {kind:'excel',name:'Excel',description:'Carga una hoja .xlsx con productos e información verificada.',group:'local',link:'/catalogo/importar'},
  {kind:'csv',name:'CSV',description:'Carga listas de productos y actualiza los datos mediante archivos revisados.',group:'local',link:'/catalogo/importar'},
  {kind:'pdf',name:'PDF',description:'Por ahora, tabla digital sencilla. Los PDF escaneados aún requieren lectura visual.',group:'local',link:'/catalogo/importar'},
  {kind:'manual',name:'Manual',description:'Registra productos directamente en MW1.',group:'local',link:'/catalogo'},
];
const validStatus=new Set(['draft','processing','ready','error','disabled']);
const validKinds=new Set<string>(SOURCE_KINDS);
export function sanitizeSources(data:unknown):CatalogSource[]{
  if(!Array.isArray(data)) return [];
  const items:CatalogSource[]=[];
  const seen=new Set<string>();
  for(const value of data.slice(0,100)){
    if(!value||typeof value!=='object'||Array.isArray(value))continue;
    const o=value as Record<string,unknown>;
    if(typeof o.id!=='string'||!/^[0-9a-f-]{36}$/i.test(o.id)||seen.has(o.id)||
       typeof o.kind!=='string'||!validKinds.has(o.kind)||
       typeof o.status!=='string'||!validStatus.has(o.status)) continue;
    const kind=o.kind as SourceKind;
    seen.add(o.id);
    items.push({
      id:o.id,kind,label:typeof o.label==='string'&&o.label.trim()?
        o.label.trim().slice(0,120):kind,
      status:o.status as CatalogSource['status'],
      lastSyncedAt:typeof o.lastSyncedAt==='string'&&Number.isFinite(Date.parse(o.lastSyncedAt))?
        o.lastSyncedAt:null,
      managedBy:['manual','excel','csv','pdf'].includes(kind)?'mw1':'external',
    });
  }
  return items;
}
export function sourceHealth(source:CatalogSource,now=Date.now()):SourceHealth{
  if(source.status==='error')return {level:'attention',label:'Error registrado',
    detail:'Revisa los registros de la fuente. No presupongas que esté actualizada.'};
  if(source.status==='disabled')return {level:'disabled',label:'Desactivada',
    detail:'Esta fuente no debe utilizarse para nuevas recomendaciones.'};
  if(source.status==='draft')return {level:'pending',label:'Borrador',
    detail:'La fuente todavía no está lista para consultar.'};
  if(source.status==='processing')return {level:'pending',label:'Procesando',
    detail:'La importación o sincronización todavía no ha concluido.'};
  if(source.managedBy==='mw1')return {level:'ok',label:'Catálogo cargado',
    detail:source.kind==='manual'?'Productos administrados en MW1.':
      'Datos importados. Volver a subir un archivo no actualiza el original.'};
  if(!source.lastSyncedAt)return {level:'attention',label:'Sin verificación de sincronización',
    detail:'La fuente está registrada, pero no consta cuándo se revisaron sus productos.'};
  const age=now-Date.parse(source.lastSyncedAt);
  if(age<0||age>24*60*60*1000)return {level:'attention',label:'Revisar actualización',
    detail:'La última fecha registrada supera 24 horas o no es válida. No significa que la API esté conectada.'};
  return {level:'pending',label:'Sincronización sin comprobar',
    detail:'Existe una fecha de sincronización registrada, pero todavía hay que verificar el conector de esta fuente.'};
}
export function summarizeSources(sources:CatalogSource[],now=Date.now()){
  const valid=sources.filter(s=>validKinds.has(s.kind));
  return {
    total:valid.length,
    local:valid.filter(s=>s.managedBy==='mw1').length,
    external:valid.filter(s=>s.managedBy==='external').length,
    attention:valid.filter(s=>sourceHealth(s,now).level==='attention').length,
  };
}
