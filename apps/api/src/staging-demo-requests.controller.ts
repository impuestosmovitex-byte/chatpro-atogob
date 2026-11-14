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
    const legacyPlanKey=({basico:'inicial',eco:'pro',pro:'empresa',inicial:'inicial',empresa:'empresa',sin_definir:'sin_definir'} as Record<string,string>)[planInterest];
    const requestType=clean(data.requestType,16)||'demo';
    if(requestType!=='demo'&&requestType!=='trial')
      throw new BadRequestException('Tipo de solicitud inválido.');
    const contactPhone=clean(data.contactPhone,20).replace(/[\s()-]/g,'');
    const whatsappSetup=clean(data.whatsappSetup,24);
    const isTrial=requestType==='trial';
    const businessSector=clean(data.businessSector,40);
    const hasOnlineStore=clean(data.hasOnlineStore,20);
    const marketingConsent=data.marketingConsent===true;
    const acceptedSectors=new Set(['moda','retail','servicios','educacion','salud','restaurantes','otro']);
    const acceptedWebOptions=new Set(['tienda','web','no']);
    if(!isTrial&&(!acceptedSectors.has(businessSector)||!acceptedWebOptions.has(hasOnlineStore)))
      throw new BadRequestException('Indica el sector y si tienes tienda virtual.');
    if(contactPhone&&!/^\+?[0-9]{7,19}$/.test(contactPhone))
      throw new BadRequestException('El WhatsApp de contacto no es válido.');
    if(isTrial&&!['inicial','pro'].includes(legacyPlanKey))
      throw new BadRequestException('La prueba gratuita de 14 días solo está disponible para los planes Básico y Eco. Solicita una asesoría para Pro.');
    if(isTrial&&(!/^\+?[0-9]{7,19}$/.test(contactPhone)||
      !['business_app','cloud_api','new_number','unsure'].includes(whatsappSetup)))
      throw new BadRequestException('Indica un número de contacto y cómo usas WhatsApp.');
    const requestedUsers=data.requestedUsers==null?null:Number(data.requestedUsers);
    const requestedConnections=data.requestedConnections==null?null:Number(data.requestedConnections);
    if((requestedUsers!==null&&(!Number.isInteger(requestedUsers)||requestedUsers<1||requestedUsers>20))||
       (requestedConnections!==null&&(!Number.isInteger(requestedConnections)||requestedConnections<1||requestedConnections>10)))
      throw new BadRequestException('La cantidad de usuarios o conexiones es inválida.');
    const visitorDigest=clean(data.visitorDigest,64);
    if(companyName.length<2||companyName.length>100||
      contactName.length<2||contactName.length>100||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)||
      contactEmail.length>180||
      !legacyPlanKey||
      !/^[0-9a-f]{64}$/.test(visitorDigest)||data.consent!==true)
      throw new BadRequestException('Completa la solicitud y autoriza el contacto.');
    const client=this.db.getClient();
    const since=new Date(Date.now()-24*3600*1000).toISOString();
    const {count,error:countError}=await client.from('platform_demo_requests')
      .select('id',{count:'exact',head:true})
      .eq('visitor_digest',visitorDigest).gte('created_at',since);
    if(countError)throw new BadRequestException('No se pudo verificar la solicitud.');
    if((count??0)>=3)return {ok:true,message:'Solicitud recibida. Nuestro equipo revisará tu información.'};
    // Idempotencia básica: evitar duplicar el mismo correo en solicitudes de 24 h.
    // La búsqueda es interna y nunca revela si ese correo ya está registrado.
    const {count:existing,error:duplicateError}=await client.from('platform_demo_requests')
      .select('id',{count:'exact',head:true})
      .eq('contact_email',contactEmail).eq('source','web_demo').gte('created_at',since);
    if(duplicateError)throw new BadRequestException('No se pudo verificar la solicitud.');
    if((existing??0)>0&&!isTrial)return {ok:true,message:'Solicitud recibida. Nuestro equipo revisará tu información.'};
    const {error}=await client.from('platform_demo_requests').insert({
      company_name:companyName,contact_name:contactName,
      contact_email:contactEmail,plan_interest:legacyPlanKey,
      visitor_digest:visitorDigest,consent_at:new Date().toISOString(),
      status:'new',source:isTrial?'web_trial':'web_demo',
      requested_users:requestedUsers,requested_connections:requestedConnections,
      // Se aprovecha temporalmente el campo privado de notas ya existente.
      // No se crean columnas ni se envían mensajes. Migrar a campos propios
      // solo después de autorización y revisión de seguridad.
      ...(!isTrial?{internal_note:[
        `Sector: ${businessSector}`,
        `Presencia web: ${hasOnlineStore}`,
        `Consentimiento para novedades MW1: ${marketingConsent?'Sí':'No'}`,
        `Consentimiento de contacto para demo: Sí`,
      ].join(' | ')}:{}),
      ...(contactPhone?{contact_phone:contactPhone}:{}),
      ...(isTrial?{whatsapp_setup:whatsappSetup,trial_requested_days:14}:{}),
    });
    if(error)throw new BadRequestException('No fue posible registrar la solicitud.');
    // No user account, company, plan or WhatsApp message is created.
    return {ok:true,message:isTrial
      ?'Solicitud de prueba recibida. La prueba de 14 días requiere activación confirmada con un asesor; todavía no ha comenzado.'
      :'Solicitud registrada. Un asesor podrá contactarte para revisar la configuración.'};
  }
}
