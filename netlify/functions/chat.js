/**
 * Netlify Function: Gateway Seguro para Core AI V2
 * Conecta el frontend con el Servidor Privado/Groq y Supabase Cloud.
 * Emite Server-Sent Events (SSE) 100% compatibles con la UI existente.
 */

import { CoreAIFactory } from '../../lib/core-ai.js';

function getCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export default async (req) => {
  // Manejo de Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCORSHeaders(),
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use POST.' }), {
      status: 405,
      headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const message = body.message || body.prompt;
    let chatId = body.conversation_id || body.chatId;
    const action = body.action;

    // Inicializar módulo propio con las variables de Netlify
    const coreAI = await CoreAIFactory.create({
      apiEndpoint: process.env.CORE_AI_ENDPOINT || 'https://api.groq.com/openai/v1',
      apiKey: process.env.CORE_AI_API_KEY || '',
      model: process.env.CORE_AI_MODEL || 'llama-3.3-70b-versatile',
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      systemPrompt: process.env.CORE_AI_SYSTEM_PROMPT || 'Eres Core AI V2, una plataforma de inteligencia artificial propia, rápida y precisa.',
      temperature: parseFloat(process.env.CORE_AI_TEMPERATURE || '0.7'),
      maxHistoryTurns: parseInt(process.env.CORE_AI_MAX_HISTORY_TURNS || '15', 10),
    });

    // Acción para crear sesión explícita
    if (action === 'create_session') {
      const sessionId = await coreAI.createSession(body.title || 'Nueva Conversación');
      return new Response(JSON.stringify({ success: true, sessionId, conversation_id: sessionId }), {
        status: 200,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      });
    }

    if (!message) {
      return new Response(JSON.stringify({ detail: 'El campo message es obligatorio.' }), {
        status: 400,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // Si no hay chatId, creamos una nueva sesión en Supabase de forma transparente
    if (!chatId) {
      chatId = await coreAI.createSession(message.slice(0, 30) || 'Nuevo Chat');
    }

    // Streaming SSE en tiempo real
    const encoder = new TextEncoder();
    let accumulatedText = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 1. Evento 'start' compatible con script.js
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'start',
                conversation_id: chatId,
                user_message_id: Date.now(),
                web_sources: [],
              })}\n\n`
            )
          );

          // 2. Transmisión reactiva de tokens ('delta')
          await coreAI.processStream(chatId, message, (chunk) => {
            accumulatedText += chunk;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'delta',
                  text: chunk,
                })}\n\n`
              )
            );
          });

          // 3. Evento 'done' compatible con script.js
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'done',
                conversation_id: chatId,
                assistant_message_id: Date.now() + 1,
                reply: accumulatedText,
                web_sources: [],
              })}\n\n`
            )
          );
        } catch (streamErr) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                message: streamErr.message || 'Error en el motor de inferencia.',
              })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...getCORSHeaders(),
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[Netlify Function Error]', err);
    return new Response(
      JSON.stringify({ detail: err.message || 'Error interno del servidor.' }),
      {
        status: 500,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      }
    );
  }
};
