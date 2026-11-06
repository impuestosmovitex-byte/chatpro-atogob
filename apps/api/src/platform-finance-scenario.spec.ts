import {calculateFinanceScenario,validateFinanceActual,validateFinanceScenario,type FinanceScenario} from './platform-finance-scenario';
const scenario:FinanceScenario={
 counts:[2,3,5],prices:[149000,259000,599000],railway:25000,supabase:110000,otherFixed:10000,
 supportPerCompany:20000,openAiPerCompany:30000,fxRate:4000,usdOpenAi:false,
 technicianMonthly:350000,administrationMonthly:100000,marketingMonthly:120000,
 toolsMonthly:30000,newCustomers:2,onboardingCostPerCustomer:70000,
 onboardingFeePerCustomer:0,paymentProcessingPercent:3,targetMarginPercent:25,
};
describe('MW1 finance: separated assumptions, not client billing',()=>{
 test('calculates all costs including labor, support, onboarding and payment fees',()=>{
  const r=calculateFinanceScenario(validateFinanceScenario(scenario));
  expect(r.clients).toBe(10);
  expect(r.recurringRevenue).toBe(4070000);
  expect(r.fixed).toBe(745000);
  expect(r.variable).toBe(500000);
  expect(r.onboardingCost).toBe(140000);
  expect(r.processingCost).toBe(122100);
  expect(r.costs).toBe(1507100);
  expect(r.contribution).toBe(2562900);
  expect(r.breakEvenClients).toBeGreaterThan(0);
 });
 test('refuses invalid percentages, negative assumptions and unknown keys',()=>{
  expect(()=>validateFinanceScenario({...scenario,targetMarginPercent:101})).toThrow();
  expect(()=>validateFinanceScenario({...scenario,counts:[-1,2,3]})).toThrow();
  expect(()=>validateFinanceScenario({...scenario,planKey:'pro'})).toThrow();
 });
 test('nullable actuals distinguish missing values from true zero, reject negative',()=>{
  const input={periodMonth:'2026-10-01',evidenceNote:'Facturas comprobadas',
   receivedCop:null,railwayCop:0,supabaseCop:null,openaiCop:null,
   technicalSupportCop:null,personnelCop:null,marketingCop:null,otherCop:null};
  expect(validateFinanceActual(input).receivedCop).toBeNull();
  expect(()=>validateFinanceActual({...input,receivedCop:-1})).toThrow();
  expect(()=>validateFinanceActual({...input,periodMonth:'2026-10-23'})).toThrow();
 });
 test('does not fabricate break-even when per-client revenue cannot cover variable costs',()=>{
  const r=calculateFinanceScenario({...scenario,counts:[0,0,1],prices:[0,0,100],
   openAiPerCompany:1000,supportPerCompany:2000});
  expect(r.breakEvenClients).toBeNull();
 });
});
