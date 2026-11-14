/**
 * Contract validation is intentionally independent of providers and existing
 * CRM integrations. All money amounts are integer Colombian pesos.
 */
export type ManualContractInput={
  companyId:string;tier:'basico'|'eco'|'pro';paymentReference:string;
  amountCop:number;verifiedAt:string;startsAt:string;expiresAt:string;
  additionalUsers:number;reason:string;confirmation:string;
};
export function validateManualContract(value:unknown,now=new Date()):ManualContractInput{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('Contrato inválido.');
  const v=value as Record<string,unknown>;
  const allowed=['companyId','tier','paymentReference','amountCop','verifiedAt',
    'startsAt','expiresAt','additionalUsers','reason','confirmation'];
  if(Object.keys(v).some(key=>!allowed.includes(key)))
    throw new Error('Campos no permitidos.');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(typeof v.companyId!=='string'||!uuid.test(v.companyId))
    throw new Error('Empresa inválida.');
  if(!['basico','eco','pro'].includes(String(v.tier)))
    throw new Error('Plan inválido.');
  if(typeof v.paymentReference!=='string'||!/^[-a-zA-Z0-9_/.]{6,100}$/.test(v.paymentReference))
    throw new Error('Referencia de pago inválida.');
  if(!Number.isSafeInteger(v.amountCop)||Number(v.amountCop)<1||Number(v.amountCop)>999999999)
    throw new Error('Importe COP inválido.');
  if(!Number.isInteger(v.additionalUsers)||Number(v.additionalUsers)<0||Number(v.additionalUsers)>100)
    throw new Error('Usuarios adicionales inválidos.');
  if(typeof v.reason!=='string'||v.reason.trim().length<8||v.reason.length>500)
    throw new Error('Justificación insuficiente.');
  if(v.confirmation!=='CONFIRMO PAGO VERIFICADO Y ACTIVACION')
    throw new Error('Confirmación explícita requerida.');
  for(const key of ['verifiedAt','startsAt','expiresAt'] as const){
    if(typeof v[key]!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(v[key] as string)||
      !Number.isFinite(Date.parse(v[key] as string)))
      throw new Error('Fecha inválida: '+key);
  }
  const verified=new Date(v.verifiedAt as string),starts=new Date(v.startsAt as string),
    expires=new Date(v.expiresAt as string);
  if(verified.getTime()>now.getTime()+60000)throw new Error('La verificación no puede ser futura.');
  if(expires.getTime()<=starts.getTime())throw new Error('El vencimiento debe ser posterior al inicio.');
  if(expires.getTime()-starts.getTime()>366*86400000)
    throw new Error('No se permiten periodos superiores a 366 días.');
  return {...v,reason:(v.reason as string).trim()} as ManualContractInput;
}
