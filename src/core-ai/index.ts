/**
 * Core AI Platform Optimization (V2)
 * Módulo Propio y Propietario (Wrapper y Singleton / Factory)
 * Totalmente desacoplado de SDKs de terceros (Sin Google Gen AI).
 */

import { AIServiceConfig, AIResponse, CoreAIModule, ChatMessage } from './types.js';
import { SupabaseDataLayer } from './supabase-layer.js';
import { ProprietaryInferenceEngine } from './inference-engine.js';

export * from './types.js';
export { SupabaseDataLayer } from './supabase-layer.js';
export { ProprietaryInferenceEngine } from './inference-engine.js';

export class CoreAIWrapper implements CoreAIModule {
  private config!: AIServiceConfig;
  private db!: SupabaseDataLayer;
  private engine!: ProprietaryInferenceEngine;
  private initialized = false;

  async initialize(config: AIServiceConfig): Promise<void> {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('[CoreAIModule] Credenciales de Supabase obligatorias (supabaseUrl, supabaseAnonKey).');
    }
    if (!config.apiEndpoint) {
      throw new Error('[CoreAIModule] Endpoint de inferencia obligatorio (apiEndpoint).');
    }

    this.config = config;
    this.db = new SupabaseDataLayer(config.supabaseUrl, config.supabaseAnonKey);
    this.engine = new ProprietaryInferenceEngine({
      endpoint: config.apiEndpoint,
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxRetries: config.maxRetries,
    });

    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[CoreAIModule] El módulo no ha sido inicializado. Llame a initialize() primero.');
    }
  }

  /**
   * Crea una nueva sesión relacional en Supabase de forma atómica
   */
  async createSession(title = 'Nueva Sesión V2'): Promise<string> {
    this.ensureInitialized();
    return await this.db.createConversation(title);
  }

  /**
   * Procesa un prompt de manera síncrona/completa
   */
  async processPrompt(chatId: string, message: string): Promise<AIResponse> {
    this.ensureInitialized();

    // 1. Guardar mensaje de usuario en Supabase
    const userMsgId = await this.db.persistMessage(chatId, 'user', message);

    // 2. Cargar historial ordenado por created_at ASC
    const maxTurns = this.config.maxHistoryTurns || 15;
    const history = await this.db.getOrderedHistory(chatId, maxTurns);

    // 3. Ejecutar inferencia propietaria
    const result = await this.engine.generateCompletion(history, this.config.systemPrompt);

    // 4. Guardar respuesta del asistente en Supabase
    const assistantMsgId = await this.db.persistMessage(chatId, 'assistant', result.content);

    return {
      sessionId: chatId,
      messageId: assistantMsgId,
      content: result.content,
      role: 'assistant',
      tokensUsed: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.promptTokens + result.completionTokens,
      },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Orquestación de streaming en tiempo real (generateContentStream)
   * con persistencia asíncrona no bloqueante hacia Supabase al finalizar.
   */
  async processStream(
    chatId: string,
    message: string,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    this.ensureInitialized();

    // 1. Persistir mensaje del usuario
    await this.db.persistMessage(chatId, 'user', message);

    // 2. Reconstruir la memoria exacta filtrando por conversation_id (ORDER BY created_at ASC)
    const maxTurns = this.config.maxHistoryTurns || 15;
    const history = await this.db.getOrderedHistory(chatId, maxTurns);

    // 3. Iniciar streaming en vivo hacia la interfaz mediante onChunk
    const fullResponse = await this.engine.streamCompletion(
      history,
      this.config.systemPrompt,
      onChunk
    );

    // 4. PERSISTENCIA NO BLOQUEANTE EN SEGUNDO PLANO
    // Al emitirse la finalización del stream, consolidamos la respuesta completa
    // y disparamos la escritura asíncrona hacia Supabase sin retener la UI.
    if (fullResponse && fullResponse.trim().length > 0) {
      this.db.persistMessageAsync(chatId, 'assistant', fullResponse.trim(), (err) => {
        console.error(`[CoreAIModule] Error guardando respuesta consolidada en chatId ${chatId}:`, err);
      });
    }
  }
}

/**
 * Patrón Singleton / Factory para acceso unificado y desacoplado
 */
export class CoreAIFactory {
  private static instance: CoreAIWrapper | null = null;

  public static getInstance(): CoreAIModule {
    if (!CoreAIFactory.instance) {
      CoreAIFactory.instance = new CoreAIWrapper();
    }
    return CoreAIFactory.instance;
  }

  public static async create(config: AIServiceConfig): Promise<CoreAIModule> {
    const module = CoreAIFactory.getInstance();
    await module.initialize(config);
    return module;
  }
}

// Exportación por defecto conforme a la especificación V2
export default CoreAIFactory;
