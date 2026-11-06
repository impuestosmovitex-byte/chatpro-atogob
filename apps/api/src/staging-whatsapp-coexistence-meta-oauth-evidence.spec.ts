import {
  validateMetaCoexistenceCode,
  parseMetaCoexistenceExchangeResponse,
  chooseMetaCoexistencePhone,
} from './staging-whatsapp-coexistence-meta-oauth-evidence';

describe('Meta coexistence exchange evidence (offline, no real credentials)',()=>{
  it('requires a single-use code with no whitespace or control bytes',()=>{
    expect(validateMetaCoexistenceCode('SYNTHETIC_META_CODE_FOR_STAGING_ONLY_0123')).toBe(true);
    for(const invalid of ['',null,undefined,'short','abc def','x'.repeat(2100),'bad\ncode'.repeat(12)]){
      expect(validateMetaCoexistenceCode(invalid)).toBe(false);
    }
  });
  it('accepts only a correctly structured Meta code exchange response',()=>{
    const token='SYNTHETIC_META_TOKEN_FOR_OFFLINE_TEST_1234567890';
    expect(parseMetaCoexistenceExchangeResponse({access_token:token})).toEqual({
      ok:true,accessToken:token,
    });
    for(const value of [null,{},[],{access_token:'short'},
      {access_token:token+'\rBAD'},{error:{message:'PRIVATE_ERROR'}}]){
      expect(parseMetaCoexistenceExchangeResponse(value)).toEqual({
        ok:false,reason:'invalid_response',
      });
    }
  });
  it('never selects a first phone when multiple, paginated or invalid',()=>{
    const phone='123456789012345';
    expect(chooseMetaCoexistencePhone({data:[{id:phone}]})).toEqual({
      phoneNumberId:phone,
    });
    for(const data of [
      {data:[]},{data:[{id:phone},{id:'999999999999999'}]},
      {data:[{id:phone}],paging:{next:'https://graph.facebook.com/secret'}},
      {data:[{id:'INVALID'}]},{data:[{}]},{data:'bad'},null,
    ]){
      expect(chooseMetaCoexistencePhone(data)).toBeNull();
    }
  });
});
