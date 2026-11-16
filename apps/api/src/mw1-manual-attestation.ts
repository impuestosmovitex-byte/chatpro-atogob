import {createHash,verify} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';

export type ManualAttestationInput={
 signature:string;userId:string;method:'POST'|'GET';path:string;body?:unknown;
};
function canonical(value:unknown):string {
 if(value===undefined)return 'null';
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 const obj=value as Record<string,unknown>;
 return '{'+Object.keys(obj).filter(k=>obj[k]!==undefined).sort()
  .map(k=>JSON.stringify(k)+':'+canonical(obj[k])).join(',')+'}';
}
/** Verify the web session identity attested by the independent web private key.
 * Neither the API request query parameter nor the shared API key is sufficient.
 */
export function verifyManualAdminAttestation(input:ManualAttestationInput,now=Date.now()):void{
 const key=process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY;
 if(!key)throw new UnauthorizedException('Verificación de identidad no configurada.');
 const parts=input.signature.split('.');
 if(parts.length!==2||parts.some(v=>!v)||parts[0].length>4096||parts[1].length>512)
  throw new UnauthorizedException('Identidad no comprobada.');
 let signed:Record<string,unknown>;
 try {
  signed=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')) as Record<string,unknown>;
  if(!verify(null,Buffer.from(parts[0]),key,Buffer.from(parts[1],'base64url')))
   throw new Error('signature');
 } catch {throw new UnauthorizedException('Firma de identidad inválida.');}
 const nowSec=Math.floor(now/1000);
 if(signed.v!==1||signed.kind!=='platform'||signed.userId!==input.userId||
  signed.method!==input.method||signed.path!==input.path||
  signed.companyId!==''||signed.companySlug!==''||
  typeof signed.iat!=='number'||typeof signed.exp!=='number'||
  signed.iat>nowSec+2||signed.exp<=nowSec||signed.exp-signed.iat>20||
  typeof signed.nonce!=='string'||!/^[a-f0-9]{32}$/.test(signed.nonce)||
  signed.bodyHash!==createHash('sha256').update(canonical(input.body??null)).digest('hex'))
  throw new UnauthorizedException('La sesión firmada no corresponde a esta operación.');
}
