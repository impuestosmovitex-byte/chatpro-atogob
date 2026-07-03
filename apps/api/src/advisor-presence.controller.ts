import { BadRequestException, Body, Controller, Get, Headers, Put, Query, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { ConversationMemoryService } from './conversation-memory.service';

type PresenceStatus = 'available' | 'busy' | 'away' | 'offline';
const STATUSES: PresenceStatus[] = ['available', 'busy', 'away', 'offline'];

@Controller('advisor-presence')
export class AdvisorPresenceController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  @Get()
  async get(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Query('company') slug = '',
  ) {
    this.authorize(key);
    const company = await this.company(slug);
    this.user(userId, fullName, headerCompanyId, company.id);
    const { data, error } = await this.supabase.getClient().from('advisor_availability')
      .select('status,last_seen_at,status_changed_at').eq('company_id',company.id).eq('user_id',userId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return { ok:true, company, advisor:{ userId, fullName, status:this.status(data?.status ?? 'offline'), lastSeenAt:data?.last_seen_at ?? null, statusChangedAt:data?.status_changed_at ?? null } };
  }

  @Put()
  async update(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Query('company') slug = '',
    @Body() body: { status?: unknown } = {},
  ) {
    this.authorize(key);
    const company = await this.company(slug);
    this.user(userId, fullName, headerCompanyId, company.id);
    const status=this.status(body.status);
    const now=new Date().toISOString();
    const {data,error}=await this.supabase.getClient().from('advisor_availability').upsert({company_id:company.id,user_id:userId,status,last_seen_at:now,status_changed_at:now,updated_at:now},{onConflict:'company_id,user_id'}).select('status,last_seen_at,status_changed_at').single();
    if(error||!data) throw new BadRequestException(error?.message ?? 'No se pudo guardar.');

    const savedStatus = this.status(data.status);
    const assignedPendingCount =
      savedStatus === 'available'
        ? await this.conversationMemoryService.assignWaitingSessionsToAdvisor(
            company.id,
            { userId, fullName },
          )
        : 0;

    return {
      ok:true,
      advisor:{
        userId,
        fullName,
        status:savedStatus,
        lastSeenAt:data.last_seen_at ?? null,
        statusChangedAt:data.status_changed_at ?? null,
      },
      assignedPendingCount,
    };
  }

  private authorize(value:string){const expected=process.env.CHATPRO_INBOX_KEY?.trim();if(!expected||value.trim()!==expected)throw new UnauthorizedException('No autorizado.');}
  private async company(slugValue:string){const slug=slugValue.trim().toLowerCase();const {data,error}=await this.supabase.getClient().from('companies').select('id,slug,name').eq('slug',slug).maybeSingle();if(error||!data)throw new BadRequestException(error?.message ?? 'Empresa no encontrada.');return data as {id:string;slug:string;name:string};}
  private user(userId:string,fullName:string,headerCompanyId:string,actualCompanyId:string){if(!userId.trim()||!fullName.trim()||headerCompanyId.trim()!==actualCompanyId)throw new UnauthorizedException('Sesión de asesor no válida.');}
  private status(value:unknown):PresenceStatus{const clean=typeof value==='string'?value.trim().toLowerCase():'';if(!STATUSES.includes(clean as PresenceStatus))throw new BadRequestException('Estado no válido.');return clean as PresenceStatus;}
}
