/** Pilot onboarding: safe suggested form defaults only, NEVER entitlements or billing. */
export type PilotPlan='basico'|'eco'|'pro';
type Preset={
 name:string;legacyKey:'inicial'|'pro'|'empresa';users:number;
 whatsappLines:number;ai:boolean;instagram:boolean;messenger:boolean;
 automation:boolean;statistics:boolean;note:string;
};
export const MW1_PILOT_PRESETS:Record<PilotPlan,Preset>={
 basico:{name:'Básico',legacyKey:'inicial',users:2,whatsappLines:1,
  ai:false,instagram:false,messenger:false,automation:false,statistics:false,
  note:'Atención humana y CRM; la IA y los módulos superiores no vienen incluidos.'},
 eco:{name:'Eco',legacyKey:'pro',users:3,whatsappLines:1,
  ai:true,instagram:true,messenger:true,automation:true,statistics:true,
  note:'Los tres canales comerciales son distintos de las líneas adicionales de WhatsApp.'},
 pro:{name:'Pro',legacyKey:'empresa',users:3,whatsappLines:1,
  ai:true,instagram:true,messenger:true,automation:true,statistics:true,
  note:'La cantidad comercial de conexiones NO equivale a cinco líneas WhatsApp; valida el alcance antes de activar.'},
};
/** Legacy DB values are NOT the same as public plan names. */
export function resolvePilotPlan(legacy:string):PilotPlan|null{
 if(legacy==='inicial')return 'basico';
 if(legacy==='pro')return 'eco';
 if(legacy==='empresa')return 'pro';
 return null;
}
