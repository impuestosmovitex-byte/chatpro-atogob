import assert from 'node:assert/strict';
import { verifyCoexistenceMetaPhone } from '../app/lib/whatsapp-coexistence-meta-phone-check.ts';

const waba = '123456789012345';
const selected = '987654321098765';
const other = '567890123456789';
const phones = { data:[{id:selected}, {id:other}], paging:{cursors:{before:'first',after:'last'}} };
const meta = {id:selected,is_on_biz_app:true,platform_type:'CLOUD_API'};
const check = (id=selected,list=phones,details=meta,account=waba) =>
  verifyCoexistenceMetaPhone(account,id,list,details);
assert.deepEqual(check(),{verified:true,wabaId:waba,phoneNumberId:selected});
assert.deepEqual(check(selected,{data:[{id:selected}]},meta),{verified:true,wabaId:waba,phoneNumberId:selected});
const rejected = (expected,actual) =>
  assert.deepEqual(actual,{verified:false,reason:expected});
rejected('invalid_identifiers',check('invalid'));
rejected('invalid_identifiers',check(selected,phones,meta,'bad'));
rejected('invalid_response',check(selected,null,meta));
rejected('invalid_response',check(selected,{data:'not-array'},meta));
rejected('invalid_response',check(selected,{data:[{id:'bad'}]},meta));
rejected('invalid_response',check(selected,{data:[{id:selected}],paging:{next:'https://graph.facebook.com/next-page'}},meta));
rejected('invalid_response',check(selected,phones,null));
rejected('ambiguous_phone',check(selected,{data:[{id:selected},{id:selected}]},meta));
rejected('phone_not_in_waba',check(selected,{data:[{id:other}]},meta));
rejected('phone_mismatch',check(selected,phones,{...meta,id:other}));
rejected('not_coexistence',check(selected,phones,{...meta,is_on_biz_app:false}));
rejected('not_coexistence',check(selected,phones,{...meta,is_on_biz_app:'true'}));
rejected('not_coexistence',check(selected,phones,{...meta,platform_type:'ON_PREMISE'}));
rejected('not_coexistence',check(selected,phones,{id:selected,platform_type:'CLOUD_API'}));
const secret = JSON.stringify({...meta,access_token:'NEVER_LEAK'});
const result = check(selected,phones,JSON.parse(secret));
assert.equal(JSON.stringify(result).includes('NEVER_LEAK'),false,
  'No credentials or phone content can be returned');
console.log('MW1 Meta coexistence phone check passed: trusted status pair, membership, pagination, ambiguity and fail-closed errors.');
