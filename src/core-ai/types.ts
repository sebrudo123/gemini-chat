/**
 * Core AI Platform Optimization (V2)
 * Contratos de Interfaz del Módulo Propio (API Pública Externa)
 * 100% Libre de SDKs de terceros (Sin dependencias de Google Gen AI).
 */

export interface AIServiceConfig {
  /**
   * Endpoint HTTP del motor de inferencia propietario o compatible
   * (ej. Ollama local http://localhost:11434/v1, DeepSeek, vLLM, Groq, o servidor propio)
   */
  apiEndpoint: string;

  /** Clave de autenticación para el endpoint de inferencia (opcional si es local) */
  apiKey?: string;

  /** Nombre del modelo fundacional a utilizar (ej. deepseek-chat, llama-3.3-70b, qwen2.5, mistral) */
  model?: string;

  /** URL del proyecto en Supabase Enterprise Cloud */
  supabaseUrl: string;

  /** Clave pública anónima o service role de Supabase */
  supabaseAnonKey: string;

  /** Instrucción de sistema para el comportamiento del modelo */
  systemPrompt?: string;

  /** Parámetro de temperatura (0.0 a 2.0) */
  temperature?: number;

  /** Máximo de turnos de conversación para el contexto */
  maxHistoryTurns?: number;

  /** Límite de reintentos en caso de fallos de red */
  maxRetries?: number;
}

export interface AIResponse {
  sessionId: string;
  messageId: string;
  content: string;
  role: 'assistant';
  tokensUsed?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  createdAt: string;
}

export interface ChatMessage {
  id?: string;
  conversationId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens?: number;
  createdAt?: string;
}

/**
 * Contrato público mandatorio de la plataforma Core AI
 */
export interface CoreAIModule {
  initialize(config: AIServiceConfig): Promise<void>;
  createSession(title?: string): Promise<string>;
  processPrompt(chatId: string, message: string): Promise<AIResponse>;
  processStream(chatId: string, message: string, onChunk: (chunk: string) => void): Promise<void>;
}
