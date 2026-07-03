import { BadRequestException, Body, Controller, Get, Headers, Put, Query, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
const DAYS=[{dayOfWeek:1,label:'Lunes'},{dayOfWeek:2,label:'Martes'},{dayOfWeek:3,label:'Miércoles'},{dayOfWeek:4,label:'Jueves'},{dayOfWeek:5,label:'Viernes'},{dayOfWeek:6,label:'Sábado'},{dayOfWeek:0,label:'Domingo'}];
@Controller('support-settings')
export class SupportSettingsController {
  constructor(private readonly supabase: SupabaseService) {}
  @Get() async get(@Headers('x-chatpro-inbox-key') key='', @Query('company') slug='') {
    const company=await this.company(key,slug), c=this.supabase.getClient();
    const {data:s,error:e}=await c.from('company_support_settings').select('timezone,human_attention_enabled,auto_return_to_ai_hours,outside_hours_message').eq('company_id',company.id).maybeSingle();
    if(e) throw new BadRequestException(e.message);
    const {data:h,error:he}=await c.from('company_support_hours').select('day_of_week,is_open,start_time,end_time').eq('company_id',company.id);
    if(he) throw new BadRequestException(he.message);
    const m=new Map((h??[]).map(x=>[x.day_of_week,x]));
    return {ok:true,company,configuration:{timezone:s?.timezone??'America/Bogota',humanAttentionEnabled:s?.human_attention_enabled!==false,autoReturnToAiHours:s?.auto_return_to_ai_hours??24,outsideHoursMessage:s?.outside_hours_message??'',hours:DAYS.map(d=>{const x:any=m.get(d.dayOfWeek);return {...d,isOpen:x?.is_open??false,startTime:x?.start_time?.slice(0,5)??'09:00',endTime:x?.end_time?.slice(0,5)??'18:00'}})}};
  }
  @Put() async put(@Headers('x-chatpro-inbox-key') key='',@Query('company') slug='',@Body() b:any={}) {
    const company=await this.company(key,slug),c=this.supabase.getClient(), hrs=Array.isArray(b.hours)?b.hours:[];
    if(hrs.length!==7) throw new BadRequestException('Configura los siete días.');
    const auto=Number(b.autoReturnToAiHours); if(!Number.isInteger(auto)||auto<1||auto>168) throw new BadRequestException('Las horas deben estar entre 1 y 168.');
    const rows=hrs.map((x:any)=>{const d=Number(x.dayOfWeek),a=String(x.startTime??''),z=String(x.endTime??'');if(!Number.isInteger(d)||d<0||d>6||!/^\\d\\d:\\d\\d$/.test(a)||!/^\\d\\d:\\d\\d$/.test(z)||(x.isOpen===true&&z<=a))throw new BadRequestException('Revisa las horas configuradas.');return {company_id:company.id,day_of_week:d,is_open:x.isOpen===true,start_time:x.isOpen===true?a:null,end_time:x.isOpen===true?z:null,updated_at:new Date().toISOString()};});
    const {error:e}=await c.from('company_support_settings').upsert({company_id:company.id,human_attention_enabled:b.humanAttentionEnabled!==false,auto_return_to_ai_hours:auto,outside_hours_message:typeof b.outsideHoursMessage==='string'?b.outsideHoursMessage.trim().slice(0,1200):'',updated_at:new Date().toISOString()},{onConflict:'company_id'});
    if(e) throw new BadRequestException(e.message);
    const {error:he}=await c.from('company_support_hours').upsert(rows,{onConflict:'company_id,day_of_week'});
    if(he) throw new BadRequestException(he.message);
    return {ok:true,message:'Horarios y atención guardados.'};
  }
  private async company(key:string,slug:string):Promise<any>{const exp=process.env.CHATPRO_INBOX_KEY?.trim();if(!exp||exp!==key.trim())throw new UnauthorizedException('No autorizado.');const {data,error}=await this.supabase.getClient().from('companies').select('id,name,slug').eq('slug',slug.trim().toLowerCase()).maybeSingle();if(error||!data)throw new BadRequestException(error?.message??'Empresa no encontrada.');return data;}
}
