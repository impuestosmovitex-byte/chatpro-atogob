import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { verifyStatisticsContext } from './statistics-context';
import { requireStatisticsMembership } from './statistics-membership';

@Controller('statistics')
export class StatisticsController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Get()
  async getStatistics(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Headers('x-mw1-stats-context') signedContext = '',
    @Query('from') from = '',
    @Query('to') to = '',
    @Query('timezone') timezone = 'America/Bogota',
    @Query('bucket') bucket = 'hour',
  ) {
    this.authorize(providedKey);

    const verified = verifyStatisticsContext(
      signedContext,
      process.env.MW1_STATS_CONTEXT_SECRET,
    );
    // Bind the signed identity to the actual requested company and query.
    // A changed company ID, date, timezone or bucket invalidates the request.
    if (
      !verified ||
      companyId.trim() !== verified.companyId ||
      from.trim() !== verified.from ||
      to.trim() !== verified.to ||
      timezone.trim() !== verified.timezone ||
      bucket.trim() !== verified.bucket
    ) {
      throw new UnauthorizedException('Contexto de estadísticas no autorizado.');
    }

    const cleanCompanyId = verified.companyId;
    const cleanFrom = verified.from;
    const cleanTo = verified.to;
    const cleanTimezone = verified.timezone || 'America/Bogota';
    const cleanBucket =
      verified.bucket.trim().toLowerCase() === 'day' ? 'day' : 'hour';

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

    const client = this.supabaseService.getClient();
    // Recompute permissions from the database, not from cached role claims.
    await requireStatisticsMembership(client, cleanCompanyId, verified.userId);

    const { data, error } = await client
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
