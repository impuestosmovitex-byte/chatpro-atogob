import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Controller('statistics')
export class StatisticsController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Get()
  async getStatistics(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('from') from = '',
    @Query('to') to = '',
    @Query('timezone') timezone = 'America/Bogota',
    @Query('bucket') bucket = 'hour',
  ) {
    this.authorize(providedKey);

    const cleanCompanyId = companyId.trim();
    const cleanFrom = from.trim();
    const cleanTo = to.trim();
    const cleanTimezone = timezone.trim() || 'America/Bogota';
    const cleanBucket =
      bucket.trim().toLowerCase() === 'day' ? 'day' : 'hour';

    if (!cleanCompanyId) {
      throw new BadRequestException('Falta la empresa.');
    }

    if (!cleanFrom || !cleanTo) {
      throw new BadRequestException(
        'Debes indicar las fechas from y to.',
      );
    }

    const fromDate = new Date(cleanFrom);
    const toDate = new Date(cleanTo);

    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime())
    ) {
      throw new BadRequestException('Las fechas no son válidas.');
    }

    if (fromDate >= toDate) {
      throw new BadRequestException(
        'La fecha inicial debe ser menor que la fecha final.',
      );
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .rpc('chatpro_statistics_summary', {
        p_company_id: cleanCompanyId,
        p_from: fromDate.toISOString(),
        p_to: toDate.toISOString(),
        p_timezone: cleanTimezone,
        p_bucket: cleanBucket,
      });

    if (error) {
      throw new BadRequestException(
        `No se pudieron calcular las estadísticas: ${error.message}`,
      );
    }

    return {
      ok: true,
      statistics: data,
    };
  }

  private authorize(provided: string) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || provided.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }
}
