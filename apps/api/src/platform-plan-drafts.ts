/**
 * Commercial plan drafts for MW1 staging. Deliberately NOT billing, publication,
 * entitlements, payment verification or a promise of a feature to end users.
 * Currency is fixed at Colombian pesos until separate currency support exists.
 */
export type PlanKey='inicial'|'pro'|'empresa';
export type PlanReviewStatus='draft'|'ready_for_review';
export type PlanDraft={
  planKey:PlanKey;
  priceCop:number|null;
  maxUsers:number|null;
  maxWhatsappLines:number|null;
  aiEnabled:boolean;
  whatsappEnabled:boolean;
  instagramEnabled:boolean;
  messengerEnabled:boolean;
  automationsEnabled:boolean;
  statisticsEnabled:boolean;
  notes:string;
  reviewStatus:PlanReviewStatus;
};
export const PLAN_KEYS:readonly PlanKey[]=['inicial','pro','empresa'];
export const PLAN_LABELS:Record<PlanKey,string>={
  inicial:'Inicial',pro:'Pro',empresa:'Empresa',
};
export function emptyPlanDraft(planKey:PlanKey):PlanDraft{
  return {
    planKey,priceCop:null,maxUsers:null,maxWhatsappLines:null,
    aiEnabled:false,whatsappEnabled:false,instagramEnabled:false,
    messengerEnabled:false,automationsEnabled:false,statisticsEnabled:false,
    notes:'',reviewStatus:'draft',
  };
}
export function validatePlanDraft(value:unknown):PlanDraft{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('Configuración de plan inválida.');
  const record=value as Record<string,unknown>;
  const allowed=[
    'planKey','priceCop','maxUsers','maxWhatsappLines','aiEnabled',
    'whatsappEnabled','instagramEnabled','messengerEnabled',
    'automationsEnabled','statisticsEnabled','notes','reviewStatus',
  ];
  if(Object.keys(record).some(k=>!allowed.includes(k)))
    throw new Error('El plan contiene un campo no permitido.');
  const key=record.planKey;
  if(typeof key!=='string'||!PLAN_KEYS.includes(key as PlanKey))
    throw new Error('Plan no reconocido.');
  const numbers=['priceCop','maxUsers','maxWhatsappLines'] as const;
  for(const field of numbers){
    const amount=record[field];
    const min=field==='priceCop'?1:1;
    const max=field==='priceCop'?999999999:1000;
    if(amount!==null&&
      (typeof amount!=='number'||!Number.isSafeInteger(amount)||
      amount<min||amount>max))throw new Error('Límite inválido en '+field+'.');
  }
  const booleans=[
    'aiEnabled','whatsappEnabled','instagramEnabled','messengerEnabled',
    'automationsEnabled','statisticsEnabled',
  ] as const;
  if(booleans.some(k=>typeof record[k]!=='boolean'))
    throw new Error('Las capacidades deben marcarse explícitamente.');
  if(typeof record.notes!=='string'||record.notes.length>1400)
    throw new Error('Las notas no deben superar 1.400 caracteres.');
  if(record.reviewStatus!=='draft'&&record.reviewStatus!=='ready_for_review')
    throw new Error('No se permiten planes publicados o aprobados desde esta pantalla.');
  if(record.reviewStatus==='ready_for_review'&&
    (record.priceCop===null||record.maxUsers===null||
     record.maxWhatsappLines===null||!record.whatsappEnabled))
    throw new Error('Para solicitar revisión define precio, usuarios, líneas y WhatsApp.');
  return {
    planKey:key as PlanKey,
    priceCop:record.priceCop as number|null,
    maxUsers:record.maxUsers as number|null,
    maxWhatsappLines:record.maxWhatsappLines as number|null,
    aiEnabled:record.aiEnabled as boolean,
    whatsappEnabled:record.whatsappEnabled as boolean,
    instagramEnabled:record.instagramEnabled as boolean,
    messengerEnabled:record.messengerEnabled as boolean,
    automationsEnabled:record.automationsEnabled as boolean,
    statisticsEnabled:record.statisticsEnabled as boolean,
    notes:record.notes.trim().replace(/[\u0000-\u001f\u007f]/g,' '),
    reviewStatus:record.reviewStatus as PlanReviewStatus,
  };
}
