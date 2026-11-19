/**
 * Cliente del backend de Core IA.
 *
 * La app nunca habla directo con el proveedor de IA: solo con
 * `/api/agent/*` y la clave pública `X-Agent-API-Key`.
 */

export const MODEL_LABEL = "Core Model V1";
export const DEFAULT_BACKEND = "https://coreiabackend.onrender.com";

const CONFIG_KEY = "coreia.config.v1";

export const isTauri =
  typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

let invokeFn = null;

async function tauriInvoke(command, args) {
  if (!isTauri) {
    throw new Error(
      "Las herramientas locales solo están disponibles en la app de escritorio."
    );
  }
  if (!invokeFn) {
    ({ invoke: invokeFn } = await import("@tauri-apps/api/core"));
  }
  return invokeFn(command, args);
}

export function loadConfig() {
  const defaults = { backend: DEFAULT_BACKEND, apiKey: "", theme: "dark" };
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    return { ...defaults, ...(stored && typeof stored === "object" ? stored : {}) };
  } catch {
    return defaults;
  }
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  next.backend = String(next.backend || DEFAULT_BACKEND)
    .trim()
    .replace(/\/+$/, "");
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

function headers(apiKey, accept) {
  return {
    Accept: accept,
    "Content-Type": "application/json",
    "X-Agent-API-Key": apiKey,
  };
}

async function readError(response) {
  try {
    const data = await response.json();
    return data.detail || data.message || `Error ${response.status}`;
  } catch {
    return `Error ${response.status}`;
  }
}

export async function checkHealth(overrides = {}) {
  const config = loadConfig();
  const backend = String(overrides.backend ?? config.backend).replace(/\/+$/, "");
  const apiKey = String(overrides.apiKey ?? config.apiKey);
  if (!apiKey) {
    throw new Error("Falta la clave del agente. Configúrala en Ajustes.");
  }
  const response = await fetch(`${backend}/api/agent/health`, {
    headers: headers(apiKey, "application/json"),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const data = await response.json();
  return { ...data, model: MODEL_LABEL };
}

/**
 * Envía el historial y consume los eventos SSE del backend.
 *
 * @param {{messages: Array, signal?: AbortSignal, onDelta: (text: string) => void}} options
 */
export async function streamChat({ messages, signal, onDelta }) {
  const config = loadConfig();
  if (!config.apiKey) {
    throw new Error("Falta la clave del agente. Configúrala en Ajustes.");
  }

  const response = await fetch(`${config.backend}/api/agent/chat/stream`, {
    method: "POST",
    headers: headers(config.apiKey, "text/event-stream"),
    body: JSON.stringify({ messages, mode: "agent", stream: true }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (!response.body) {
    throw new Error("El backend no devolvió un flujo de datos.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (block) => {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      if (event.delta) onDelta(String(event.delta));
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) consume(block);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // El flujo ya estaba cerrado.
    }
    throw error;
  }
}

export async function invokeTool(call) {
  return tauriInvoke("execute_tool", { request: call });
}

export async function getWorkspace() {
  return tauriInvoke("get_workspace");
}

export async function setWorkspace(path) {
  return tauriInvoke("set_workspace", { path });
}
