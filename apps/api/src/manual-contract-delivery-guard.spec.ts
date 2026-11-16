describe('Staging DI bootstrap safety',()=>{
 it('registers manual expiry provider in the actual staging root, not only AppModule',()=>{
  const main=code('main.ts');
  const staging=code('staging-app.module.ts');
  expect(main).toContain("process.env.MW1_STAGING_MODE === 'true'");
  expect(main).toContain("import('./staging-app.module.js')");
  expect(staging).toContain("import { ManualContractAccessService } from './manual-contract-access.service'");
  const providers=staging.slice(staging.indexOf('providers:'));
  expect(providers).toContain('ManualContractAccessService');
  expect(staging).not.toContain('WhatsappWebhookController,');
  expect(staging).not.toContain('ShopifyAutomationProcessorService,');
 });
});
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
 it('keeps WhatsApp inbound records before expiry suspension and delivery receipts untouched',()=>{
  const s=code('whatsapp-webhook.controller.ts');
  for(const name of ['processIncomingLocation','processIncomingAttachment','processIncomingImage','processIncomingAudio','processIncomingText']){
    const begin=s.indexOf('private async '+name+'(');
    const next=s.indexOf('\\n  private ',begin+20);
    const method=s.slice(begin,next<0?undefined:next);
    const check=method.indexOf('manualAccess=await this.manualContractAccess.access(profile.id)');
    expect(begin).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(0);
    expect(method.indexOf('saveMessage(')).toBeLessThan(check);
    if(['processIncomingImage','processIncomingAttachment'].includes(name))
      expect(method.indexOf('persistIncomingMedia(')).toBeLessThan(check);
    expect(method.slice(check,check+150)).toContain('if(!manualAccess.commercialAllowed)return;');
  }
  expect(s.indexOf('this.getDeliveryStatuses(body)')).toBeGreaterThan(0);
  expect(s.indexOf('this.getDeliveryStatuses(body)')).toBeLessThan(s.indexOf('this.getIncomingMessage(body)'));
 });
 it('blocks Instagram media transcription for expired manual contract',()=>{
  const s=code('meta-instagram-media-ai.service.ts');
  const i=s.indexOf('private async processMedia(');
  const part=s.slice(i,i+5000);
  expect(part).toContain('manualContractAccess.access(input.companyId)');
  expect(part).toContain('if(!access.commercialAllowed)return;');
  expect(part.indexOf('manualContractAccess.access(input.companyId)')).toBeLessThan(part.indexOf('this.transcribeAudio('));
 });
 it('checks social multimedia batch before AI analysis while retaining captured events',()=>{
  const s=code('meta-social-batch-message.service.ts');
  const i=s.indexOf('private async flushBatch(');
  const guarded=s.slice(i,i+1200);
  expect(guarded).toContain('manualContractAccess.access(batch.companyId)');
  expect(guarded.indexOf('manualContractAccess.access(batch.companyId)')).toBeLessThan(guarded.indexOf("from('social_conversation_sessions')"));
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
