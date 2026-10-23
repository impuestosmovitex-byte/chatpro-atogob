import {companyFinancialResult,validateFinanceCompanyEntry} from './platform-company-finance';
const valid={periodMonth:'2026-10-01',companySource:'operational',companySlug:'atogob',
 billedCop:null,receivedCop:null,openaiCop:null,supportCop:null,onboardingCop:null,
 otherDirectCop:null,allocationWeight:1,evidenceNote:''};
describe('financial tenant entries without automatic billing',()=>{
 test('retains unknown amounts as null, never treats them as zero',()=>{
  const value=validateFinanceCompanyEntry(valid);
  expect(value.openaiCop).toBeNull();
  expect(companyFinancialResult(value,null).contribution).toBeNull();
  expect(companyFinancialResult({...value,billedCop:599000,receivedCop:599000},10000).contribution).toBeNull();
 });
 test('distinguishes invoiced revenue from collected payments and computes fully known costs',()=>{
  const value=validateFinanceCompanyEntry({...valid,billedCop:599000,receivedCop:400000,
   openaiCop:50000,supportCop:15000,onboardingCop:0,otherDirectCop:0});
  expect(companyFinancialResult(value,100000)).toMatchObject({
   directCost:65000,allocatedShared:100000,contribution:434000,collected:400000});
 });
 test('refuses forged company source, extra privileges, wrong month, negative amount',()=>{
  expect(()=>validateFinanceCompanyEntry({...valid,companySource:'production-write'})).toThrow();
  expect(()=>validateFinanceCompanyEntry({...valid,companyEntitlements:'pro'})).toThrow();
  expect(()=>validateFinanceCompanyEntry({...valid,periodMonth:'2026-10-23'})).toThrow();
  expect(()=>validateFinanceCompanyEntry({...valid,receivedCop:-1})).toThrow();
  expect(()=>validateFinanceCompanyEntry({...valid,allocationWeight:0})).toThrow();
 });
});
