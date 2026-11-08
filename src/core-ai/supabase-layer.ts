/**
 * Capa de Persistencia Atómica en Supabase Cloud
 * Implementada con fetch nativo sobre PostgREST (PostgreSQL Dialect).
 * Cero dependencias de librerías pesadas o SDKs externos.
 */

import { ChatMessage } from './types.js';

export class SupabaseDataLayer {
  private restUrl: string;
  private headers: Record<string, string>;

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    // Normalizar URL base para PostgREST
    const cleanUrl = supabaseUrl.replace(/\/+$/, '');
    this.restUrl = `${cleanUrl}/rest/v1`;

    this.headers = {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
  }

  /**
   * Crea una nueva conversación atómica en la tabla 'conversations'
   */
  async createConversation(title = 'Nueva Sesión'): Promise<string> {
    const response = await fetch(`${this.restUrl}/conversations`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        title,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { source: 'core-ai-module-v2' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`[Supabase Error] Error al crear conversación: ${response.status} - ${errText}`);
    }

    const rows = await response.json();
    if (!rows || rows.length === 0) {
      throw new Error('[Supabase Error] No se retornó el ID de conversación.');
    }
    return rows[0].id;
  }

  /**
   * Recupera el historial exacto optimizado con filtro por conversation_id
   * y ordenamiento estricto por created_at ASC.
   */
  async getOrderedHistory(conversationId: string, limit = 20): Promise<ChatMessage[]> {
    // PostgREST syntax: conversation_id=eq.{id}&order=created_at.asc&limit={limit}
    const query = new URLSearchParams({
      conversation_id: `eq.${conversationId}`,
      order: 'created_at.asc',
      limit: String(limit),
    });

    const response = await fetch(`${this.restUrl}/messages?${query.toString()}`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`[Supabase Error] Error al leer historial: ${response.status} - ${errText}`);
    }

    const data: Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string; created_at: string }> =
      await response.json();

    return data.map((msg) => ({
      id: msg.id,
      conversationId,
      role: msg.role,
      content: msg.content,
      createdAt: msg.created_at,
    }));
  }

  /**
   * Persistencia atómica de mensaje individual
   */
  async persistMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<string> {
    const response = await fetch(`${this.restUrl}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        conversation_id: conversationId,
        role,
        content,
        created_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`[Supabase Error] Error al persistir mensaje: ${response.status} - ${errText}`);
    }

    const rows = await response.json();
    return rows[0]?.id || '';
  }

  /**
   * Operación de escritura en segundo plano NO BLOQUEANTE.
   * Emite la petición a Supabase sin detener la ejecución del hilo principal.
   */
  persistMessageAsync(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    onError?: (err: Error) => void
  ): void {
    // Delegación en microtarea / promesa desacoplada
    queueMicrotask(() => {
      this.persistMessage(conversationId, role, content).catch((err) => {
        if (onError) onError(err);
        else console.error('[Supabase Non-blocking Write Error]', err);
      });
    });
  }
}
