/**
 * Sesiones locales de la app. Se guardan en localStorage y nunca salen
 * del equipo salvo como historial enviado al backend al chatear.
 */

const STORAGE_KEY = "coreia.sessions.v1";
const ACTIVE_KEY = "coreia.active.v1";

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSession(title = "Nueva sesión") {
  const stamp = Date.now();
  return {
    id: uid(),
    title,
    createdAt: stamp,
    updatedAt: stamp,
    messages: [],
  };
}

export function loadSessions() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter(
      (session) =>
        session &&
        typeof session.id === "string" &&
        Array.isArray(session.messages)
    );
  } catch {
    return [];
  }
}

export function saveSessions(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Sin espacio o almacenamiento deshabilitado: la sesión sigue en memoria.
  }
}

export function getActiveId() {
  return localStorage.getItem(ACTIVE_KEY) || "";
}

export function setActiveId(id) {
  localStorage.setItem(ACTIVE_KEY, id || "");
}

export function titleFrom(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Nueva sesión";
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}
