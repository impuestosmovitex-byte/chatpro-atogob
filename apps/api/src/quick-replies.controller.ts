import {
  BadRequestException, Body, Controller, Delete, Get, Headers,
  HttpCode, Param, Post, Put, Query, UnauthorizedException,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';
import { SupabaseService } from './supabase.service';

type ReplyBody = {
  shortcut?: unknown; title?: unknown; body?: unknown; category?: unknown; isActive?: unknown;
};

@Controller('quick-replies')
export class QuickRepliesController {
  constructor(
    private readonly memory: ConversationMemoryService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get()
  async list(@Headers('x-chatpro-inbox-key') key = '', @Query('company') company = '') {
    this.auth(key);
    const profile = await this.memory.getCompanyProfile(this.company(company));
    const { data, error } = await this.supabase.getClient()
      .from('quick_replies')
      .select('id, company_id, shortcut, title, body, category, sort_order, is_active')
      .eq('company_id', profile.id)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return { ok: true, company: { id: profile.id, slug: profile.slug, name: profile.name }, quickReplies: (data ?? []).map((row) => this.reply(row)) };
  }

  @Post()
  @HttpCode(201)
  async create(@Headers('x-chatpro-inbox-key') key = '', @Query('company') company = '', @Body() body: ReplyBody = {}) {
    this.auth(key);
    const profile = await this.memory.getCompanyProfile(this.company(company));
    const payload = this.payload(body);
    const { data, error } = await this.supabase.getClient()
      .from('quick_replies')
      .insert({ company_id: profile.id, ...payload })
      .select('id, company_id, shortcut, title, body, category, sort_order, is_active')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'No se pudo crear.');
    return { ok: true, quickReply: this.reply(data) };
  }

  @Put(':id')
  async update(@Headers('x-chatpro-inbox-key') key = '', @Query('company') company = '', @Param('id') id = '', @Body() body: ReplyBody = {}) {
    this.auth(key);
    const profile = await this.memory.getCompanyProfile(this.company(company));
    const changes: Record<string, unknown> = {};
    if (body.shortcut !== undefined || body.title !== undefined || body.body !== undefined || body.category !== undefined) Object.assign(changes, this.payload(body));
    if (typeof body.isActive === 'boolean') changes.is_active = body.isActive;
    if (!Object.keys(changes).length) throw new BadRequestException('No hay cambios.');
    const { data, error } = await this.supabase.getClient()
      .from('quick_replies').update(changes).eq('id', id).eq('company_id', profile.id)
      .select('id, company_id, shortcut, title, body, category, sort_order, is_active').single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'No se encontró la respuesta.');
    return { ok: true, quickReply: this.reply(data) };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Headers('x-chatpro-inbox-key') key = '', @Query('company') company = '', @Param('id') id = '') {
    this.auth(key);
    const profile = await this.memory.getCompanyProfile(this.company(company));
    const { error } = await this.supabase.getClient().from('quick_replies').delete().eq('id', id).eq('company_id', profile.id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  private auth(key: string) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();
    if (!expected || key.trim() !== expected) throw new UnauthorizedException('No autorizado.');
  }
  private company(value: string) {
    const clean = value.trim().toLowerCase();
    if (!clean) throw new BadRequestException('Falta la empresa.');
    return clean;
  }
  private text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
  private payload(input: ReplyBody) {
    const shortcut = this.text(input.shortcut).replace(/^\//, '').toLowerCase();
    const title = this.text(input.title);
    const body = this.text(input.body);
    const category = this.text(input.category) || 'General';
    if (!/^[a-z0-9_-]{1,40}$/.test(shortcut)) throw new BadRequestException('El atajo solo puede usar letras minúsculas, números, guion o guion bajo.');
    if (!title || !body) throw new BadRequestException('Completa título y texto.');
    return { shortcut, title: title.slice(0,80), body: body.slice(0,4000), category: category.slice(0,60) };
  }
  private reply(row: Record<string, unknown>) {
    return {
      id: String(row.id), companyId: String(row.company_id), shortcut: String(row.shortcut),
      title: String(row.title), body: String(row.body),
      category: typeof row.category === 'string' && row.category ? row.category : 'General',
      sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
      isActive: row.is_active !== false,
    };
  }
}
