/**
 * Core AI Platform Optimization (V2) - Módulo Propio y Propietario (ESM)
 * 100% Nativo en Fetch y Web Streams.
 * Cero dependencias de Google Gen AI SDK o librerías de terceros.
 * Implementa patrones Wrapper y Singleton / Factory.
 */

export class SupabaseDataLayer {
  constructor(supabaseUrl, supabaseAnonKey) {
    const cleanUrl = supabaseUrl.replace(/\/+$/, '');
    this.restUrl = `${cleanUrl}/rest/v1`;
    this.headers = {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
  }

  async createConversation(title = 'Nueva Sesión') {
    const res = await fetch(`${this.restUrl}/conversations`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        title,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { source: 'core-ai-module-v2' },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[Supabase Error] Fallo al crear sesión: ${res.status} - ${err}`);
    }
    const data = await res.json();
    return data[0]?.id;
  }

  async getOrderedHistory(conversationId, limit = 20) {
    const query = new URLSearchParams({
      conversation_id: `eq.${conversationId}`,
      order: 'created_at.asc',
      limit: String(limit),
    });

    const res = await fetch(`${this.restUrl}/messages?${query.toString()}`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[Supabase Error] Fallo al leer mensajes: ${res.status} - ${err}`);
    }
    return await res.json();
  }

  async persistMessage(conversationId, role, content) {
    const res = await fetch(`${this.restUrl}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        conversation_id: conversationId,
        role,
        content,
        created_at: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[Supabase Error] Fallo al guardar mensaje: ${res.status} - ${err}`);
    }
    const data = await res.json();
    return data[0]?.id || '';
  }

  persistMessageAsync(conversationId, role, content, onError) {
    queueMicrotask(() => {
      this.persistMessage(conversationId, role, content).catch((err) => {
        if (onError) onError(err);
        else console.error('[Supabase Non-blocking Write Error]', err);
      });
    });
  }
}

export class ProprietaryInferenceEngine {
  constructor(config) {
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'deepseek-chat';
    this.temperature = config.temperature ?? 0.7;
    this.maxRetries = config.maxRetries ?? 2;
  }

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async generateCompletion(messages, systemInstruction) {
    const payload = this.buildPayload(messages, systemInstruction, false);
    const url = `${this.endpoint}/chat/completions`;

    let lastError = null;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Inference HTTP ${res.status}: ${body}`);
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        const usage = data.usage || {};
        return {
          content,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
        };
      } catch (err) {
        lastError = err;
        if (attempt <= this.maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
    }
    throw lastError || new Error('Fallo crítico de inferencia');
  }

  async streamCompletion(messages, systemInstruction, onChunk) {
    const payload = this.buildPayload(messages, systemInstruction, true);
    const url = `${this.endpoint}/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok || !res.body) {
      const body = await res.text();
      throw new Error(`Inference Stream HTTP ${res.status}: ${body}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed === 'data: [DONE]') {
          return accumulatedText;
        }

        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedText += delta;
              onChunk(delta);
            }
          } catch {
            // Fragmento intermedio SSE omitido
          }
        }
      }
    }
    return accumulatedText;
  }

  buildPayload(messages, systemPrompt, stream = false) {
    const formatted = [];
    if (systemPrompt) formatted.push({ role: 'system', content: systemPrompt });
    for (const m of messages) formatted.push({ role: m.role, content: m.content });
    return {
      model: this.model,
      messages: formatted,
      temperature: this.temperature,
      stream,
    };
  }
}

export class CoreAIWrapper {
  constructor() {
    this.initialized = false;
  }

  async initialize(config) {
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

  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('[CoreAIModule] Llame a initialize() antes de operar.');
    }
  }

  async createSession(title = 'Nueva Sesión V2') {
    this.ensureInitialized();
    return await this.db.createConversation(title);
  }

  async processPrompt(chatId, message) {
    this.ensureInitialized();
    await this.db.persistMessage(chatId, 'user', message);
    const maxTurns = this.config.maxHistoryTurns || 15;
    const history = await this.db.getOrderedHistory(chatId, maxTurns);
    const result = await this.engine.generateCompletion(history, this.config.systemPrompt);
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

  async processStream(chatId, message, onChunk) {
    this.ensureInitialized();
    await this.db.persistMessage(chatId, 'user', message);
    const maxTurns = this.config.maxHistoryTurns || 15;
    const history = await this.db.getOrderedHistory(chatId, maxTurns);

    const fullResponse = await this.engine.streamCompletion(
      history,
      this.config.systemPrompt,
      onChunk
    );

    // Persistencia asíncrona no bloqueante
    if (fullResponse && fullResponse.trim().length > 0) {
      this.db.persistMessageAsync(chatId, 'assistant', fullResponse.trim());
    }
  }
}

export class CoreAIFactory {
  static instance = null;

  static getInstance() {
    if (!CoreAIFactory.instance) {
      CoreAIFactory.instance = new CoreAIWrapper();
    }
    return CoreAIFactory.instance;
  }

  static async create(config) {
    const module = CoreAIFactory.getInstance();
    await module.initialize(config);
    return module;
  }
}

export default CoreAIFactory;
