import assert from 'node:assert/strict';
import { summarizeWhatsappCoexistenceWebhook } from '../app/lib/whatsapp-coexistence-webhook-summary.ts';

const waba='123456789012345';
const phone='987654321098765';
const meta={ messaging_product:'whatsapp',metadata:{phone_number_id:phone} };
const direct=(event, data)=>({id:'event-synthetic',event,data:{id:waba,...meta,...data}});

assert.deepEqual(summarizeWhatsappCoexistenceWebhook(direct('history',{
  history:[{metadata:{phase:1,progress:'100'},threads:[{messages:[{text:{body:'PRIVATE'}}]}]}],
})),[{kind:'history',wabaId:waba,phoneNumberId:phone,itemCount:1,historySharing:'not_determined'}]);
const denied=direct('history',{history:[{errors:[{code:2593109}]}]});
assert.deepEqual(summarizeWhatsappCoexistenceWebhook(denied),[
  {kind:'history',wabaId:waba,phoneNumberId:phone,itemCount:1,historySharing:'declined'},
]);
assert.deepEqual(summarizeWhatsappCoexistenceWebhook(direct('smb_app_state_sync',{
  state_sync:[{type:'contact',contact:{full_name:'DO_NOT_RETURN',phone_number:'PRIVATE'}}],
})),[{kind:'smb_app_state_sync',wabaId:waba,phoneNumberId:phone,
  itemCount:1,historySharing:'not_determined'}]);

const echoChange={
  field:'smb_message_echoes',
  value:{...meta,message_echoes:[{id:'wamid.synthetic',text:{body:'DO_NOT_RETURN'}}]},
};
const standard={object:'whatsapp_business_account',entry:[{
  id:waba,changes:[echoChange],
}]};
const summaries=summarizeWhatsappCoexistenceWebhook(standard);
assert.deepEqual(summaries,[{
  kind:'smb_message_echoes',wabaId:waba,phoneNumberId:phone,
  itemCount:1,historySharing:'not_determined',
}]);
assert.ok(!JSON.stringify(summaries).includes('DO_NOT_RETURN'),
  'No customer names or message content may escape the metadata parser');
assert.deepEqual(summarizeWhatsappCoexistenceWebhook({
  ...standard,entry:[{id:waba,changes:[echoChange,echoChange]}],
}),[summaries[0],summaries[0]]);
for (const invalid of [
  null,{event:'history',data:{history:[]}},
  direct('unknown',{history:[]}),
  {object:'whatsapp_business_account',entry:[]},
  {...standard,entry:[{id:'bad',changes:[echoChange]}]},
  {...standard,entry:[{id:waba,changes:[{...echoChange,field:'messages'}]}]},
  {...standard,entry:[{id:waba,changes:[{...echoChange,value:{...meta,metadata:{phone_number_id:'bad'}}}]}]},
  {...standard,entry:[{id:waba,changes:[echoChange,
    {...echoChange,value:{...meta,metadata:{phone_number_id:'111111111111'}}}]}]},
  {...standard,entry:[{id:waba,changes:[{...echoChange,value:{...meta,message_echoes:'text'}}]}]},
]) assert.equal(summarizeWhatsappCoexistenceWebhook(invalid),null);
console.log('MW1 WhatsApp coexistence webhooks: read-only event classification, history refusal and tenant-safe metadata checks passed.');
