import {estimateAiCostUsd} from './platform-ai-cost';
describe('staging OpenAI cost estimator',()=>{
 test('separates cached and uncached tokens',()=>{
  expect(estimateAiCostUsd({inputTokens:1000000,cachedInputTokens:200000,outputTokens:100000},
   {inputUsdPerMillion:1,cachedInputUsdPerMillion:.2,outputUsdPerMillion:4})).toBeCloseTo(1.24);
 });
 test('refuses malformed prices and cached token counts',()=>{
  const t={inputTokens:100,cachedInputTokens:101,outputTokens:0};
  const r={inputUsdPerMillion:1,cachedInputUsdPerMillion:1,outputUsdPerMillion:1};
  expect(()=>estimateAiCostUsd(t,r)).toThrow();
  expect(()=>estimateAiCostUsd({...t,cachedInputTokens:0},{...r,inputUsdPerMillion:-1})).toThrow();
 });
});
