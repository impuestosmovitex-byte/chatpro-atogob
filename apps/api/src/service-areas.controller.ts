import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type AreaBody = { name?: unknown; description?: unknown; isActive?: unknown };

@Controller('service-areas')
export class ServiceAreasController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async list(@Headers('x-chatpro-inbox-key') key='', @Query('company') slug='') {
    this.auth(key); const company = await this.company(slug);
    const {data,error}=await this.supabase.getClient().from('service_areas')
      .select('id,name,description,is_active,is_default,created_at').eq('company_id',company.id).order('created_at');
    if(error) throw new BadRequestException(error.message);
    return {ok:true,company,areas:(data??[]).map((x:any)=>this.out(x))};
  }

  @Post()
  async create(@Headers('x-chatpro-inbox-key') key='', @Query('company') slug='', @Body() body:AreaBody={}) {
    this.auth(key); const company=await this.company(slug); const name=this.name(body.name); const description=this.desc(body.description);
    const {data,error}=await this.supabase.getClient().from('service_areas').insert({company_id:company.id,name,description,is_active:true,is_default:false}).select('id,name,description,is_active,is_default,created_at').single();
    if(error||!data) throw new BadRequestException(error?.code==='23505'?'Ya existe un área con ese nombre.':error?.message??'No se pudo crear.');
    return {ok:true,message:'Área creada correctamente.',area:this.out(data)};
  }

  @Patch(':areaId')
  async update(@Headers('x-chatpro-inbox-key') key='', @Query('company') slug='', @Param('areaId') areaId='', @Body() body:AreaBody={}) {
    this.auth(key); const company=await this.company(slug); const existing=await this.area(company.id,areaId);
    const changes:any={}; if(body.name!==undefined) changes.name=this.name(body.name); if(body.description!==undefined) changes.description=this.desc(body.description);
    if(body.isActive!==undefined){if(typeof body.isActive!=='boolean')throw new BadRequestException('Estado no válido.');changes.is_active=body.isActive;}
    if(!Object.keys(changes).length)throw new BadRequestException('No hay cambios.');
    const {data,error}=await this.supabase.getClient().from('service_areas').update(changes).eq('id',existing.id).eq('company_id',company.id).select('id,name,description,is_active,is_default,created_at').single();
    if(error||!data)throw new BadRequestException(error?.code==='23505'?'Ya existe un área con ese nombre.':error?.message??'No se pudo actualizar.');
    return {ok:true,message:'Área actualizada.',area:this.out(data)};
  }

  @Delete(':areaId')
  async remove(@Headers('x-chatpro-inbox-key') key='', @Query('company') slug='', @Param('areaId') areaId='') {
    this.auth(key); const company=await this.company(slug); const area=await this.area(company.id,areaId);
    if(area.is_default)throw new BadRequestException('Las áreas iniciales no se eliminan. Puedes renombrarlas o desactivarlas.');
    const {error}=await this.supabase.getClient().from('service_areas').delete().eq('id',area.id).eq('company_id',company.id);
    if(error)throw new BadRequestException(error.message); return {ok:true,message:'Área eliminada.'};
  }

  private auth(value:string){const key=process.env.CHATPRO_INBOX_KEY?.trim();if(!key||value.trim()!==key)throw new UnauthorizedException('No autorizado.');}
  private async company(value:string){const slug=value.trim().toLowerCase();if(!slug)throw new BadRequestException('Falta la empresa.');const {data,error}=await this.supabase.getClient().from('companies').select('id,slug,name').eq('slug',slug).maybeSingle();if(error||!data)throw new BadRequestException(error?.message??'Empresa no encontrada.');return data as {id:string;slug:string;name:string};}
  private async area(companyId:string,id:string){if(!id.trim())throw new BadRequestException('Falta el área.');const {data,error}=await this.supabase.getClient().from('service_areas').select('id,is_default').eq('company_id',companyId).eq('id',id.trim()).maybeSingle();if(error||!data)throw new BadRequestException(error?.message??'Área no encontrada.');return data as {id:string;is_default:boolean};}
  private name(v:unknown){const x=typeof v==='string'?v.trim().replace(/\s+/g,' '):'';if(x.length<2||x.length>80)throw new BadRequestException('El nombre debe tener entre 2 y 80 caracteres.');return x;}
  private desc(v:unknown){const x=typeof v==='string'?v.trim():'';if(x.length>300)throw new BadRequestException('La descripción no puede superar 300 caracteres.');return x;}
  private out(x:any){return{id:x.id,name:x.name,description:x.description??'',isActive:x.is_active!==false,isDefault:x.is_default===true,createdAt:x.created_at??null};}
}
