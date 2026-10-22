import {normalizeAiUsage} from './platform-ai-usage-metering';
const valid=()=>({companyId:'d55817a3-d104-48e7-8efb-c7736e9c8aa4',sourceEventId:'response-test-1',
 model:'gpt-4.1-mini',operation:'assistant_reply',inputTokens:1100,outputTokens:250,cachedInputTokens:200});
describe('MW1 staging AI usage boundaries',()=>{
 test('normalized usage retains the tenant, tokens and idempotency key',()=>{
  expect(normalizeAiUsage(valid())).toMatchObject({
   company_id:valid().companyId,source_event_id:'response-test-1',
   input_tokens:1100,output_tokens:250,cached_input_tokens:200,estimated_cost_usd:null
  });
 });
 test('rejects invalid tenants, negative tokens and invalid cached counts',()=>{
  expect(()=>normalizeAiUsage({...valid(),companyId:'other-company'})).toThrow();
  expect(()=>normalizeAiUsage({...valid(),inputTokens:-1})).toThrow();
  expect(()=>normalizeAiUsage({...valid(),cachedInputTokens:1101})).toThrow();
 });
 test('does not invent monetary costs',()=>{
  expect(normalizeAiUsage({...valid(),estimatedCostUsd:0.025}).estimated_cost_usd).toBe(.025);
  expect(()=>normalizeAiUsage({...valid(),estimatedCostUsd:Number.NaN})).toThrow();
 });
});
