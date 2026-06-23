import { Injectable } from '@nestjs/common';
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private client: SupabaseClient | null = null;

  getClient(): SupabaseClient {
    if (this.client) {
      return this.client;
    }

    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

    if (!supabaseUrl) {
      throw new Error('Falta la variable SUPABASE_URL en Railway.');
    }

    if (!secretKey) {
      throw new Error('Falta la variable SUPABASE_SECRET_KEY en Railway.');
    }

    this.client = createClient(supabaseUrl, secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    return this.client;
  }

  async checkConnection(): Promise<boolean> {
    const { error } = await this.getClient()
      .from('customers')
      .select('id', { head: true, count: 'exact' })
      .limit(1);

    if (error) {
      throw new Error(`No se pudo conectar a Supabase: ${error.message}`);
    }

    return true;
  }
}