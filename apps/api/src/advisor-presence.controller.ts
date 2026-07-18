import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { ConversationMemoryService } from './conversation-memory.service';

type PresenceStatus = 'available' | 'busy' | 'away' | 'offline';

const STATUSES: PresenceStatus[] = [
  'available',
  'busy',
  'away',
  'offline',
];

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

    const { data, error } = await this.supabase
      .getClient()
      .from('advisor_availability')
      .select('status, last_seen_at, status_changed_at')
      .eq('company_id', company.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      ok: true,
      company,
      advisor: {
        userId,
        fullName,
        status: this.effectiveStatus(
          data?.status ?? 'offline',
          data?.last_seen_at,
        ),
        lastSeenAt: data?.last_seen_at ?? null,
        statusChangedAt: data?.status_changed_at ?? null,
      },
    };
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

    const status = this.status(body.status);
    const now = new Date().toISOString();
    const client = this.supabase.getClient();
    const { data: previous, error: previousError } = await client
      .from('advisor_availability')
      .select('status, last_seen_at, status_changed_at')
      .eq('company_id', company.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (previousError) {
      throw new BadRequestException(previousError.message);
    }

    const previousEffectiveStatus = this.effectiveStatus(
      previous?.status ?? 'offline',
      previous?.last_seen_at,
    );
    const statusChangedAt =
      previousEffectiveStatus === status &&
      typeof previous?.status_changed_at === 'string' &&
      previous.status_changed_at.trim()
        ? previous.status_changed_at
        : now;

    const { data, error } = await client
      .from('advisor_availability')
      .upsert(
        {
          company_id: company.id,
          user_id: userId,
          status,
          last_seen_at: now,
          status_changed_at: statusChangedAt,
          updated_at: now,
        },
        { onConflict: 'company_id,user_id' },
      )
      .select('status, last_seen_at, status_changed_at')
      .single();

    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'No se pudo guardar.',
      );
    }

    const savedStatus = this.status(data.status);
    const assignedPendingCount =
      savedStatus === 'available'
        ? await this.conversationMemoryService
            .assignWaitingSessionsToAdvisor(
              company.id,
              { userId, fullName },
            )
        : 0;

    return {
      ok: true,
      advisor: {
        userId,
        fullName,
        status: savedStatus,
        lastSeenAt: data.last_seen_at ?? null,
        statusChangedAt: data.status_changed_at ?? null,
      },
      assignedPendingCount,
    };
  }

  private presenceMaxAgeMilliseconds(): number {
    const configured =
      Number(process.env.CHATPRO_ADVISOR_PRESENCE_MAX_AGE_SECONDS);
    const seconds =
      Number.isFinite(configured) &&
      configured >= 90 &&
      configured <= 900
        ? Math.trunc(configured)
        : 180;

    return seconds * 1000;
  }

  private effectiveStatus(
    value: unknown,
    lastSeenAt: unknown,
  ): PresenceStatus {
    const status = this.status(value);

    if (status === 'offline') {
      return status;
    }

    const lastSeenTime =
      typeof lastSeenAt === 'string'
        ? new Date(lastSeenAt).getTime()
        : Number.NaN;

    if (
      !Number.isFinite(lastSeenTime) ||
      Date.now() - lastSeenTime >
        this.presenceMaxAgeMilliseconds()
    ) {
      return 'offline';
    }

    return status;
  }

  private authorize(value: string) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || value.trim() !== expected) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  private async company(slugValue: string) {
    const slug = slugValue.trim().toLowerCase();
    const { data, error } = await this.supabase
      .getClient()
      .from('companies')
      .select('id, slug, name')
      .eq('slug', slug)
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Empresa no encontrada.',
      );
    }

    return data as {
      id: string;
      slug: string;
      name: string;
    };
  }

  private user(
    userId: string,
    fullName: string,
    headerCompanyId: string,
    actualCompanyId: string,
  ) {
    if (
      !userId.trim() ||
      !fullName.trim() ||
      headerCompanyId.trim() !== actualCompanyId
    ) {
      throw new UnauthorizedException(
        'Sesión de asesor no válida.',
      );
    }
  }

  private status(value: unknown): PresenceStatus {
    const clean =
      typeof value === 'string'
        ? value.trim().toLowerCase()
        : '';

    if (!STATUSES.includes(clean as PresenceStatus)) {
      throw new BadRequestException('Estado no válido.');
    }

    return clean as PresenceStatus;
  }
}
