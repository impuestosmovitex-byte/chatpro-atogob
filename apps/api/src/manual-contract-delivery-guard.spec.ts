import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const code=(name:string)=>readFileSync(join(__dirname,name),'utf8');
describe('Staging manual expiry gates on commercial delivery paths',()=>{
 it('guards all WhatsApp outbound methods without blocking connection status checks',()=>{
  const s=code('whatsapp-messaging.service.ts');
  expect((s.match(/this\.manualContractAccess\.assertCommercial\(companyId\)/g)||[]).length).toBe(6);
  for(const method of ['sendText','sendAudio','sendImage','sendFile','sendTemplate','sendTemplateComponents']){
   const start=s.indexOf('  async '+method+'(');
   const end=s.indexOf('  async ',start+6);
   expect(start).toBeGreaterThan(0);
   expect(s.slice(start,end<0?undefined:end)).toContain('await this.manualContractAccess.assertCommercial(companyId)');
  }
 });
 it('pauses Shopify queue processing before claim to retain pending evidence',()=>{
  const s=code('shopify-automation-processor.service.ts');
  const start=s.indexOf('private async processOne(row: WebhookRow)');
  const guarded=s.slice(start,start+850);
  expect(guarded.indexOf('manualContractAccess.access(row.company_id)')).toBeGreaterThan(0);
  expect(guarded.indexOf('manualContractAccess.access(row.company_id)')).toBeLessThan(guarded.indexOf('this.claim(row)'));
 });
 it('pauses cart recovery before consuming pending recovery work',()=>{
  const s=code('cart-recovery.service.ts');
  const start=s.indexOf('private async processRule(');
  const guarded=s.slice(start,start+600);
  expect(guarded).toContain('manualContractAccess.access(rule.company_id)');
  expect(guarded).toContain('if(!access.commercialAllowed)return;');
 });
 it('returns blocked before loading an automatic Shopify execution for an expired tenant',()=>{
  const s=code('shopify-automatic-test-send.service.ts');
  const i=s.indexOf('async sendIfAllowed(');
  const segment=s.slice(i,i+650);
  expect(segment).toContain('manualContractAccess.access(companyId)');
  expect(segment).toContain("if(!access.commercialAllowed)return 'blocked';");
  expect(segment.indexOf('manualContractAccess.access(companyId)')).toBeLessThan(segment.indexOf("from('automation_executions')"));
 });
 it('checks social AI and advisor messaging per sending operation',()=>{
  for(const name of ['meta-social-ai.service.ts','meta-social-messaging.service.ts']){
   const s=code(name);
   expect((s.match(/manualContractAccess\.assertCommercial\(input\.companyId\)/g)||[]).length).toBe(3);
  }
 });
});
