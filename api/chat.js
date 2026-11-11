/**
 * Vercel Serverless / Edge Function: Gateway para Core AI Studio V2
 * 100% Nativo en Web Standard Request/Response y Streams.
 */

import { CoreAIFactory } from '../lib/core-ai.js';

function getCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

export default async function handler(req) {
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
    const action = body.action;

    const coreAI = await CoreAIFactory.create({
      apiEndpoint: process.env.CORE_AI_ENDPOINT || 'https://api.groq.com/openai/v1',
      apiKey: process.env.CORE_AI_API_KEY || '',
      model: body.model || process.env.CORE_AI_MODEL || 'llama-3.3-70b-versatile',
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      systemPrompt: body.systemPrompt || process.env.CORE_AI_SYSTEM_PROMPT || 'Eres Core AI Studio V2, un asistente de inteligencia artificial de nivel enterprise, preciso, elegante y útil.',
      temperature: parseFloat(body.temperature || process.env.CORE_AI_TEMPERATURE || '0.7'),
      maxHistoryTurns: 30,
    });

    if (action === 'admin_stats') {
      const sessions = await coreAI.listSessions(100);
      return new Response(JSON.stringify({
        success: true,
        stats: {
          totalSessions: sessions.length,
          modelActive: body.model || process.env.CORE_AI_MODEL || 'llama-3.3-70b-versatile',
          engineSpeed: '~310 tokens/seg',
          groqStatus: 'Operativo (LPU)',
          supabaseStatus: 'Conectado (PostgreSQL)',
          environment: 'Vercel Serverless',
        },
        recentSessions: sessions.slice(0, 10),
      }), {
        status: 200,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      });
    }

    if (action === 'list_sessions') {
      const list = await coreAI.listSessions(50);
      return new Response(JSON.stringify({ success: true, sessions: list }), {
        status: 200,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_messages') {
      if (!body.chatId) {
        return new Response(JSON.stringify({ error: 'chatId es requerido' }), { status: 400, headers: getCORSHeaders() });
      }
      const messages = await coreAI.getMessages(body.chatId, 100);
      return new Response(JSON.stringify({ success: true, messages }), {
        status: 200,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create_session') {
      const sessionId = await coreAI.createSession(body.title || 'Nueva Conversación');
      return new Response(JSON.stringify({ success: true, sessionId, conversation_id: sessionId }), {
        status: 200,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      });
    }

    if (action === 'delete_session') {
      if (!body.chatId) {
        return new Response(JSON.stringify({ error: 'chatId es requerido' }), { status: 400, headers: getCORSHeaders() });
      }
      await coreAI.deleteSession(body.chatId);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const message = body.message || body.prompt;
    let chatId = body.conversation_id || body.chatId;

    if (!message) {
      return new Response(JSON.stringify({ detail: 'El campo message es obligatorio.' }), {
        status: 400,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      });
    }

    if (!chatId) {
      const titlePrompt = message.trim().slice(0, 45) || 'Nueva Conversación';
      chatId = await coreAI.createSession(titlePrompt);
    }

    const encoder = new TextEncoder();
    let accumulatedText = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'start',
                conversation_id: chatId,
                user_message_id: Date.now(),
              })}\n\n`
            )
          );

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

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'done',
                conversation_id: chatId,
                reply: accumulatedText,
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
    console.error('[Vercel Function Error]', err);
    return new Response(
      JSON.stringify({ detail: err.message || 'Error interno del servidor.' }),
      {
        status: 500,
        headers: { ...getCORSHeaders(), 'Content-Type': 'application/json' },
      }
    );
  }
}
