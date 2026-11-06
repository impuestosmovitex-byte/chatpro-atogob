/** Cost calculation only. Rates must be explicitly verified and configured; no implicit pricing. */
export type AiModelRate={inputUsdPerMillion:number;cachedInputUsdPerMillion:number;outputUsdPerMillion:number};
export type AiTokens={inputTokens:number;cachedInputTokens:number;outputTokens:number};
export function estimateAiCostUsd(tokens:AiTokens,rate:AiModelRate):number{
 for(const value of [...Object.values(tokens),...Object.values(rate)]){
  if(!Number.isFinite(value)||value<0)throw new Error('Métrica o tarifa inválida.');
 }
 if(![tokens.inputTokens,tokens.cachedInputTokens,tokens.outputTokens].every(Number.isSafeInteger))
  throw new Error('Tokens deben ser enteros.');
 if(tokens.cachedInputTokens>tokens.inputTokens)throw new Error('Caché excede tokens de entrada.');
 return ((tokens.inputTokens-tokens.cachedInputTokens)*rate.inputUsdPerMillion+
 tokens.cachedInputTokens*rate.cachedInputUsdPerMillion+
 tokens.outputTokens*rate.outputUsdPerMillion)/1000000;
}
