import {
  BadRequestException, Body, Controller, ForbiddenException,
  Headers, HttpCode, Post, UnauthorizedException,
} from '@nestjs/common';
import {timingSafeEqual} from 'node:crypto';
import {SupabaseService} from './supabase.service';

function validKey(provided:string):boolean{
  const expected=process.env.CHATPRO_INBOX_KEY?.trim()||'';
  if(!expected||!provided)return false;
  const a=Buffer.from(expected),b=Buffer.from(provided);
  return a.length===b.length&&timingSafeEqual(a,b);
}
const clean=(value:unknown,max:number)=>
  typeof value==='string'
    ?value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max+1)
    :'';

@Controller('marketing/demo-requests')
export class StagingDemoRequestsController {
  constructor(private readonly db:SupabaseService){}

  @Post()
  @HttpCode(200)
  async submit(
    @Headers('x-chatpro-inbox-key') key='',
    @Body() data:Record<string,unknown>={},
  ){
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new ForbiddenException('Disponible solo en el sitio comercial de pruebas.');
    if(!validKey(key))throw new UnauthorizedException('No autorizado.');
    if(!data||typeof data!=='object'||Array.isArray(data))
      throw new BadRequestException('Solicitud inválida.');
    const companyName=clean(data.companyName,100);
    const contactName=clean(data.contactName,100);
    const contactEmail=clean(data.contactEmail,180).toLowerCase();
    const planInterest=clean(data.planInterest,20);
    const visitorDigest=clean(data.visitorDigest,64);
    if(companyName.length<2||companyName.length>100||
      contactName.length<2||contactName.length>100||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)||
      contactEmail.length>180||
      !['inicial','pro','empresa','sin_definir'].includes(planInterest)||
      !/^[0-9a-f]{64}$/.test(visitorDigest)||data.consent!==true)
      throw new BadRequestException('Completa la solicitud y autoriza el contacto.');
    const client=this.db.getClient();
    const since=new Date(Date.now()-24*3600*1000).toISOString();
    const {count,error:countError}=await client.from('platform_demo_requests')
      .select('id',{count:'exact',head:true})
      .eq('visitor_digest',visitorDigest).gte('created_at',since);
    if(countError)throw new BadRequestException('No se pudo verificar la solicitud.');
    if((count??0)>=3)return {ok:true,message:'Solicitud recibida. Nuestro equipo revisará tu información.'};
    const {error}=await client.from('platform_demo_requests').insert({
      company_name:companyName,contact_name:contactName,
      contact_email:contactEmail,plan_interest:planInterest,
      visitor_digest:visitorDigest,consent_at:new Date().toISOString(),
      status:'new',source:'web_demo',
    });
    if(error)throw new BadRequestException('No fue posible registrar la solicitud.');
    // No user account, company, plan or WhatsApp message is created.
    return {ok:true,message:'Solicitud registrada. Un asesor podrá contactarte para revisar la configuración.'};
  }
}
