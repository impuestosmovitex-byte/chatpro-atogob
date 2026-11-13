import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { verifyInternalAttestation, InternalAction } from './internal-attestation';

const base: InternalAction = {
  kind: 'user',userId:'alpha-owner',companyId:'alpha',companySlug:'alpha',
  method:'PATCH',path:'/users',body:{userId:'alpha-advisor',active:false},
};
function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).filter(x=>obj[x]!==undefined).sort()
    .map(x=>JSON.stringify(x)+':'+canonical(obj[x])).join(',') + '}';
}
const bodyHash=(value: unknown)=>createHash('sha256').update(canonical(value??null)).digest('hex');
describe('SEG-003C asymmetric assertion guard (synthetic only)',()=>{
  const first=generateKeyPairSync('ed25519');
  const other=generateKeyPairSync('ed25519');
  const original=process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY;
  const now=1763060400000;
  const seconds=Math.floor(now/1000);
  let nonceCounter=0;
  const claims=(action:InternalAction=base)=>({
    v:1,...action,body:undefined,
    iat:seconds,exp:seconds+20,nonce:(++nonceCounter).toString(16).padStart(32,'0'),bodyHash:bodyHash(action.body),
  });
  function token(payload:Record<string,unknown>=claims(),key=first.privateKey){
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return encoded+'.'+sign(null,Buffer.from(encoded),key).toString('base64url');
  }
  const originalReplay = process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK;
  beforeEach(()=>{
    process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK='true';
    process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY=
    first.publicKey.export({type:'spki',format:'pem'}).toString();});
  afterAll(()=>{if(original===undefined)delete process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY;
    else process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY=original;
    if(originalReplay===undefined)delete process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK;
    else process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK=originalReplay;
  });
  it('accepts correctly signed tenant action',()=>{
    expect(()=>verifyInternalAttestation(token(),base,now)).not.toThrow();
  });
  it('rejects missing assertion and missing verifier key',()=>{
    expect(()=>verifyInternalAttestation(undefined,base,now)).toThrow(UnauthorizedException);
    delete process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY;
    expect(()=>verifyInternalAttestation(token(),base,now)).toThrow(UnauthorizedException);
  });
  it('rejects tampering without resigning',()=>{
    const [encoded,sig]=token().split('.');
    const forged={...claims(),userId:'beta-admin'};
    expect(()=>verifyInternalAttestation(
      Buffer.from(JSON.stringify(forged)).toString('base64url')+'.'+sig,
      base,now)).toThrow(UnauthorizedException);
  });
  it('rejects a different signatory even with the right role',()=>{
    expect(()=>verifyInternalAttestation(token(claims(),other.privateKey),base,now))
      .toThrow(UnauthorizedException);
  });
  it('binds tenant, subject, route, verb and body independently',()=>{
    for(const edit of [
      {companyId:'beta'},{companySlug:'beta'},{userId:'other'},
      {method:'GET' as const},{path:'/roles'},
      {body:{userId:'alpha-advisor',active:true}},
    ]) expect(()=>verifyInternalAttestation(token(),{...base,...edit},now))
      .toThrow(UnauthorizedException);
  });
  it('rejects expired, future, overlong and malformed timestamps',()=>{
    for(const altered of [
      {exp:seconds-1},{iat:seconds+10},{exp:seconds+300},
      {iat:seconds-40},{nonce:'invalid'},
    ]) expect(()=>verifyInternalAttestation(token({...claims(),...altered}),base,now))
      .toThrow(UnauthorizedException);
  });
  it('rejects invalid token formats and refuses overlong assertions',()=>{
    for(const input of ['bogus','a.b.c','!#.$','x'.repeat(8200)])
      expect(()=>verifyInternalAttestation(input,base,now))
        .toThrow(UnauthorizedException);
  });
  it('rejects replay of a previously accepted assertion',()=>{
    const signed = token();
    expect(()=>verifyInternalAttestation(signed,base,now)).not.toThrow();
    expect(()=>verifyInternalAttestation(signed,base,now)).toThrow(UnauthorizedException);
  });
  it('fails closed without single-replica confirmation',()=>{
    const signed=token();
    delete process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK;
    expect(()=>verifyInternalAttestation(signed,base,now)).toThrow(UnauthorizedException);
    process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK='true';
  });
  it('does not reserve an assertion if the request body was rejected',()=>{
    const signed=token();
    expect(()=>verifyInternalAttestation(signed,{...base,body:{active:true}},now))
      .toThrow(UnauthorizedException);
    expect(()=>verifyInternalAttestation(signed,base,now)).not.toThrow();
  });
  it('allows platform owner-creation action and binds operation',()=>{
    const action:InternalAction={kind:'platform',userId:'platform-admin',companyId:'',
      companySlug:'',method:'POST',path:'/platform-admin/companies',
      body:{slug:'new-test',ownerIdentifier:'synthetic',ownerPassword:'not-a-real-password'}};
    expect(()=>verifyInternalAttestation(token(claims(action)),action,now)).not.toThrow();
    expect(()=>verifyInternalAttestation(token(claims(action)),{...action,kind:'user'},now))
      .toThrow(UnauthorizedException);
  });
});
