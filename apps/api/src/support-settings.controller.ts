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

const DAYS = [
  { dayOfWeek: 1, label: 'Lunes' },
  { dayOfWeek: 2, label: 'Martes' },
  { dayOfWeek: 3, label: 'Miércoles' },
  { dayOfWeek: 4, label: 'Jueves' },
  { dayOfWeek: 5, label: 'Viernes' },
  { dayOfWeek: 6, label: 'Sábado' },
  { dayOfWeek: 0, label: 'Domingo' },
];

@Controller('support-settings')
export class SupportSettingsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async get(
    @Headers('x-chatpro-inbox-key') key = '',
    @Query('company') slug = '',
  ) {
    const company = await this.company(key, slug);
    const client = this.supabase.getClient();

    const { data: rawSettings, error: settingsError } = await client
      .from('company_support_settings')
      .select(
        [
          'timezone',
          'human_attention_enabled',
          'auto_return_to_ai_hours',
          'outside_hours_message',
          'advisors_can_take_ai',
          'ai_take_after_minutes',
        ].join(','),
      )
      .eq('company_id', company.id)
      .maybeSingle();

    if (settingsError) {
      throw new BadRequestException(settingsError.message);
    }

    const settings = rawSettings as {
      timezone?: string | null;
      human_attention_enabled?: boolean | null;
      auto_return_to_ai_hours?: number | null;
      outside_hours_message?: string | null;
      advisors_can_take_ai?: boolean | null;
      ai_take_after_minutes?: number | null;
    } | null;

    const { data: hours, error: hoursError } = await client
      .from('company_support_hours')
      .select('day_of_week,is_open,start_time,end_time')
      .eq('company_id', company.id);

    if (hoursError) {
      throw new BadRequestException(hoursError.message);
    }

    const hoursByDay = new Map(
      (hours ?? []).map((item) => [item.day_of_week, item]),
    );

    return {
      ok: true,
      company,
      configuration: {
        timezone: settings?.timezone ?? 'America/Bogota',
        humanAttentionEnabled:
          settings?.human_attention_enabled !== false,
        autoReturnToAiHours:
          settings?.auto_return_to_ai_hours ?? 24,
        outsideHoursMessage:
          settings?.outside_hours_message ?? '',
        advisorsCanTakeAi:
          settings?.advisors_can_take_ai === true,
        aiTakeAfterMinutes:
          settings?.ai_take_after_minutes ?? 60,
        hours: DAYS.map((day) => {
          const item: any = hoursByDay.get(day.dayOfWeek);

          return {
            ...day,
            isOpen: item?.is_open ?? false,
            startTime: item?.start_time?.slice(0, 5) ?? '09:00',
            endTime: item?.end_time?.slice(0, 5) ?? '18:00',
          };
        }),
      },
    };
  }

  @Put()
  async put(
    @Headers('x-chatpro-inbox-key') key = '',
    @Query('company') slug = '',
    @Body() body: any = {},
  ) {
    const company = await this.company(key, slug);
    const client = this.supabase.getClient();
    const hours = Array.isArray(body.hours) ? body.hours : [];

    if (hours.length !== 7) {
      throw new BadRequestException('Configura los siete días.');
    }

    const autoReturnToAiHours = Number(body.autoReturnToAiHours);

    if (
      !Number.isInteger(autoReturnToAiHours) ||
      autoReturnToAiHours < 1 ||
      autoReturnToAiHours > 168
    ) {
      throw new BadRequestException(
        'Las horas deben estar entre 1 y 168.',
      );
    }

    const aiTakeAfterMinutes = Number(body.aiTakeAfterMinutes);

    if (
      !Number.isInteger(aiTakeAfterMinutes) ||
      aiTakeAfterMinutes < 1 ||
      aiTakeAfterMinutes > 10080
    ) {
      throw new BadRequestException(
        'Los minutos de inactividad deben estar entre 1 y 10.080.',
      );
    }

    const rows = hours.map((item: any) => {
      const dayOfWeek = Number(item.dayOfWeek);
      const startTime = String(item.startTime ?? '');
      const endTime = String(item.endTime ?? '');

      if (
        !Number.isInteger(dayOfWeek) ||
        dayOfWeek < 0 ||
        dayOfWeek > 6 ||
        !/^\d\d:\d\d$/.test(startTime) ||
        !/^\d\d:\d\d$/.test(endTime) ||
        (item.isOpen === true && endTime <= startTime)
      ) {
        throw new BadRequestException(
          'Revisa las horas configuradas.',
        );
      }

      return {
        company_id: company.id,
        day_of_week: dayOfWeek,
        is_open: item.isOpen === true,
        start_time: item.isOpen === true ? startTime : '00:00',
        end_time: item.isOpen === true ? endTime : '00:00',
        updated_at: new Date().toISOString(),
      };
    });

    const { error: settingsError } = await client
      .from('company_support_settings')
      .upsert(
        {
          company_id: company.id,
          human_attention_enabled:
            body.humanAttentionEnabled !== false,
          auto_return_to_ai_hours: autoReturnToAiHours,
          outside_hours_message:
            typeof body.outsideHoursMessage === 'string'
              ? body.outsideHoursMessage.trim().slice(0, 1200)
              : '',
          advisors_can_take_ai:
            body.advisorsCanTakeAi === true,
          ai_take_after_minutes: aiTakeAfterMinutes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id' },
      );

    if (settingsError) {
      throw new BadRequestException(settingsError.message);
    }

    const { error: hoursError } = await client
      .from('company_support_hours')
      .upsert(rows, {
        onConflict: 'company_id,day_of_week',
      });

    if (hoursError) {
      throw new BadRequestException(hoursError.message);
    }

    return {
      ok: true,
      message: 'Horarios y atención guardados.',
    };
  }

  private async company(
    key: string,
    slug: string,
  ): Promise<any> {
    const expected =
      process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || expected !== key.trim()) {
      throw new UnauthorizedException('No autorizado.');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('companies')
      .select('id,name,slug')
      .eq('slug', slug.trim().toLowerCase())
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Empresa no encontrada.',
      );
    }

    return data;
  }
}
