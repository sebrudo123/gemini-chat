/**
 * Motor Propietario de Inferencia y Streaming Reactivo
 * 100% Nativo en Fetch y Streams de Web APIs (Sin SDKs externos).
 * Compatible con cualquier servidor de inferencia de pesos abiertos, vLLM, Ollama, o custom LLM.
 */

import { ChatMessage } from './types.js';

export class ProprietaryInferenceEngine {
  private endpoint: string;
  private apiKey?: string;
  private model: string;
  private temperature: number;
  private maxRetries: number;

  constructor(config: {
    endpoint: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxRetries?: number;
  }) {
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model || 'deepseek-chat';
    this.temperature = config.temperature ?? 0.7;
    this.maxRetries = config.maxRetries ?? 2;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Ejecución síncrona/completa de inferencia con reintentos
   */
  async generateCompletion(
    messages: ChatMessage[],
    systemInstruction?: string
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    const payload = this.buildPayload(messages, systemInstruction, false);
    const url = `${this.endpoint}/chat/completions`;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Inference HTTP ${response.status}: ${errorBody}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const usage = data.usage || {};

        return {
          content,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
        };
      } catch (err: any) {
        lastError = err;
        if (attempt <= this.maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
    }
    throw lastError || new Error('Fallo crítico en motor de inferencia');
  }

  /**
   * Orquestación de streaming en tiempo real (generateContentStream)
   * emite segmentos en vivo mediante onChunk.
   */
  async streamCompletion(
    messages: ChatMessage[],
    systemInstruction: string | undefined,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const payload = this.buildPayload(messages, systemInstruction, true);
    const url = `${this.endpoint}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      const errorBody = await response.text();
      throw new Error(`Inference Stream HTTP ${response.status}: ${errorBody}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Conservar el último fragmento incompleto en el buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed === 'data: [DONE]') {
          return accumulatedText;
        }

        if (trimmed.startsWith('data: ')) {
          try {
            const jsonStr = trimmed.slice(6);
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedText += delta;
              onChunk(delta);
            }
          } catch {
            // Ignorar fragmentos no JSON intermedios del protocolo SSE
          }
        }
      }
    }

    return accumulatedText;
  }

  private buildPayload(messages: ChatMessage[], systemPrompt?: string, stream = false) {
    const formatted = [];

    if (systemPrompt) {
      formatted.push({ role: 'system', content: systemPrompt });
    }

    for (const m of messages) {
      formatted.push({ role: m.role, content: m.content });
    }

    return {
      model: this.model,
      messages: formatted,
      temperature: this.temperature,
      stream,
    };
  }
}
