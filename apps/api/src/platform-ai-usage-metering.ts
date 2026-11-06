/** Tenant-scoped OpenAI usage normalization for future staging instrumentation.
 * This module DOES NOT call OpenAI, bill customers or enforce a quota.
 */
export type AiUsageInput={
 companyId:string;sourceEventId:string;model:string;operation:string;
 inputTokens:number;outputTokens:number;cachedInputTokens:number;
 estimatedCostUsd?:number|null;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeAiUsage(input:AiUsageInput){
 if(!uuid.test(input.companyId))throw new Error('Empresa inválida.');
 for(const [label,value,max] of [['Evento',input.sourceEventId,180],['Modelo',input.model,120],['Operación',input.operation,120]] as const){
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(label+' inválido.');
 }
 for(const n of [input.inputTokens,input.outputTokens,input.cachedInputTokens]){
  if(!Number.isSafeInteger(n)||n<0)throw new Error('Tokens inválidos.');
 }
 if(input.cachedInputTokens>input.inputTokens)throw new Error('Tokens caché exceden entrada.');
 const cost=input.estimatedCostUsd;
 if(cost!==null&&cost!==undefined&&(!Number.isFinite(cost)||cost<0||cost>99999999))
  throw new Error('Costo estimado inválido.');
 return {company_id:input.companyId,source_event_id:input.sourceEventId.trim(),
  provider:'openai' as const,model:input.model.trim(),operation:input.operation.trim(),
  input_tokens:input.inputTokens,output_tokens:input.outputTokens,
  cached_input_tokens:input.cachedInputTokens,estimated_cost_usd:cost??null};
}
