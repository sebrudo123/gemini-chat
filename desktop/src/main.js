import "./styles.css";

import {
  checkHealth,
  getWorkspace,
  invokeTool,
  isTauri,
  loadConfig,
  MODEL_LABEL,
  saveConfig,
  setWorkspace,
  streamChat,
} from "./api.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";
import {
  BlockFilter,
  describeTool,
  extractQuestions,
  extractTools,
  isDestructive,
  toolResult,
  visibleText,
} from "./protocol.js";
import {
  createSession,
  getActiveId,
  loadSessions,
  saveSessions,
  setActiveId,
  titleFrom,
  uid,
} from "./sessions.js";

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */
const $ = (selector) => document.querySelector(selector);

const els = {
  sidebar: $("#sidebar"),
  sessions: $("#sessions"),
  search: $("#search"),
  newChat: $("#new-chat"),
  settingsBtn: $("#settings-btn"),
  status: $("#conn-status"),
  title: $("#session-title"),
  workspace: $("#workspace-label"),
  messages: $("#messages"),
  input: $("#input"),
  send: $("#send"),
  stop: $("#stop"),
  hint: $("#hint"),
  rename: $("#rename-btn"),
  remove: $("#delete-btn"),
  theme: $("#theme-btn"),
  toggle: $("#toggle-sidebar"),
  modalRoot: $("#modal-root"),
  toast: $("#toast"),
};

let sessions = loadSessions();
if (!sessions.length) {
  sessions = [createSession()];
  saveSessions(sessions);
}

let activeId = getActiveId();
if (!sessions.some((session) => session.id === activeId)) {
  activeId = sessions[0].id;
}
setActiveId(activeId);

let sending = false;
let controller = null;
let currentWorkspace = "…";
let streamFrame = null;
let toastTimer = null;

const SUGGESTIONS = [
  {
    title: "Crea una API",
    prompt: "Crea una API REST en Python con FastAPI, con tests y un README.",
  },
  {
    title: "Analiza mi proyecto",
    prompt:
      "Analiza la carpeta actual y explícame su estructura, qué hace y qué puedo mejorar.",
  },
  {
    title: "Corrige un error",
    prompt: "Ayúdame a encontrar y corregir un error en este proyecto.",
  },
  {
    title: "Juego en Godot",
    prompt:
      "Crea la estructura base de un juego 2D en Godot 4 con jugador, cámara y un nivel de prueba.",
  },
];

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */
function activeSession() {
  let session = sessions.find((item) => item.id === activeId);
  if (!session) {
    session = sessions[0] || createSession();
    if (!sessions.length) sessions.push(session);
    activeId = session.id;
    setActiveId(activeId);
  }
  return session;
}

function persist() {
  const session = activeSession();
  session.updatedAt = Date.now();
  saveSessions(sessions);
}

function toast(message, duration = 2800) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), duration);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

function setStatus(kind, text) {
  els.status.className = `status${kind ? ` ${kind}` : ""}`;
  els.status.innerHTML = `<span class="dot"></span> ${escapeHtml(text)}`;
}

function scrollToBottom(force = false) {
  const el = els.messages;
  if (!el) return;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 180;
  if (force || near) {
    el.scrollTop = el.scrollHeight;
  }
}

function resizeInput() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 180)}px`;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */
function renderSidebar() {
  const query = els.search.value.trim().toLowerCase();
  const list = sessions
    .filter((session) => !query || session.title.toLowerCase().includes(query))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (!list.length) {
    els.sessions.innerHTML = '<div class="session-empty">No hay sesiones.</div>';
    return;
  }

  els.sessions.innerHTML = list
    .map(
      (session) => `
      <button class="session-item ${session.id === activeId ? "active" : ""}"
              data-id="${escapeHtml(session.id)}" type="button">
        <span class="title">${escapeHtml(session.title)}</span>
        <span class="count">${session.messages.length}</span>
      </button>`
    )
    .join("");

  els.sessions.querySelectorAll(".session-item").forEach((button) => {
    button.addEventListener("click", () => selectSession(button.dataset.id));
  });
}

function renderEmpty() {
  return `
    <div class="empty">
      <div class="empty-logo">C</div>
      <h2>¿Qué construimos hoy?</h2>
      <p>Describe el proyecto y el agente lo hará paso a paso, pidiéndote permiso antes de tocar archivos.</p>
      <div class="suggestions">
        ${SUGGESTIONS.map(
          (item) => `
          <button class="suggestion" type="button" data-prompt="${escapeHtml(item.prompt)}">
            <strong>${escapeHtml(item.title)}</strong>
            ${escapeHtml(item.prompt)}
          </button>`
        ).join("")}
      </div>
    </div>`;
}

function questionHtml(raw, messageIndex, message) {
  const questions = extractQuestions(raw);
  if (!questions.length) return "";

  return questions
    .map((question) => {
      const options = question.options
        .map((option) => {
          const answered = message.answeredOption === option.label;
          return `
            <button class="q-option ${answered ? "answered" : ""}" type="button"
                    data-message="${messageIndex}" data-option="${escapeHtml(option.label)}"
                    ${sending || message.answeredOption ? "disabled" : ""}>
              <strong>${escapeHtml(option.label)}</strong>
              ${option.description ? `<span>${escapeHtml(option.description)}</span>` : ""}
            </button>`;
        })
        .join("");

      return `
        <div class="question-card">
          <div class="q-header">${escapeHtml(question.header)}</div>
          <div class="q-prompt">${escapeHtml(question.prompt)}</div>
          <div class="q-options">${options}</div>
        </div>`;
    })
    .join("");
}

function renderMessage(message, index) {
  const id = escapeHtml(message.id || `m-${index}`);

  if (message.role === "user") {
    return `
      <div class="msg user" data-id="${id}">
        <div class="bubble">${escapeHtml(message.content)}</div>
      </div>`;
  }

  if (message.role === "tool") {
    return `
      <details class="tool-result">
        <summary>Resultado de herramienta</summary>
        <pre>${escapeHtml(message.content)}</pre>
      </details>`;
  }

  const raw = message.raw || message.content || "";
  const display = message.content || visibleText(raw);
  const questions = questionHtml(raw, index, message);
  const badge = message.toolsRun
    ? `<div class="tool-badge">⚙ ${message.toolsRun} herramienta${
        message.toolsRun === 1 ? "" : "s"
      } ejecutada${message.toolsRun === 1 ? "" : "s"}</div>`
    : "";

  return `
    <div class="msg assistant" data-id="${id}">
      <div class="avatar">C</div>
      <div class="bubble ${message.streaming ? "cursor" : ""}">
        ${renderMarkdown(display)}${questions}${badge}
      </div>
    </div>`;
}

function renderChat() {
  const session = activeSession();
  els.title.textContent = session.title;
  els.workspace.textContent = currentWorkspace;

  const config = loadConfig();
  els.hint.textContent = config.apiKey
    ? "El agente puede leer y escribir archivos en tu espacio de trabajo. Te pedirá permiso antes de cambiar algo."
    : "Configura tu clave de agente en Ajustes para empezar. Todo se procesa con Core Model V1.";

  if (!session.messages.length) {
    els.messages.innerHTML = renderEmpty();
    els.messages.querySelectorAll(".suggestion").forEach((button) => {
      button.addEventListener("click", () => sendMessage(button.dataset.prompt || ""));
    });
    return;
  }

  els.messages.innerHTML = session.messages
    .map((message, index) => renderMessage(message, index))
    .join("");
  scrollToBottom();
}

function renderAll() {
  renderSidebar();
  renderChat();
  updateComposer();
}

function updateComposer() {
  els.send.classList.toggle("hidden", sending);
  els.stop.classList.toggle("hidden", !sending);
  els.input.disabled = false;
  els.send.disabled = !els.input.value.trim() || sending;
  renderChat();
}

function scheduleStreamUpdate(message) {
  if (streamFrame) return;
  streamFrame = requestAnimationFrame(() => {
    streamFrame = null;
    const bubble = els.messages.querySelector(
      `.msg[data-id="${message.id}"] .bubble`
    );
    if (!bubble) return;
    bubble.innerHTML = renderMarkdown(message.content);
    bubble.classList.toggle("cursor", Boolean(message.streaming));
    scrollToBottom();
  });
}

/* ------------------------------------------------------------------ */
/* Sesiones                                                            */
/* ------------------------------------------------------------------ */
function selectSession(id) {
  if (sending) {
    toast("Espera a que termine la respuesta o deténla.");
    return;
  }
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  activeId = session.id;
  setActiveId(activeId);
  renderAll();
  if (window.matchMedia("(max-width: 900px)").matches) {
    els.sidebar.classList.remove("open");
  }
}

function newSession() {
  if (sending) {
    toast("Detén la respuesta actual antes de crear otra sesión.");
    return;
  }
  const session = createSession();
  sessions.unshift(session);
  activeId = session.id;
  setActiveId(activeId);
  saveSessions(sessions);
  renderAll();
  els.input.focus();
}

async function renameSession() {
  const session = activeSession();
  const value = await askText({
    title: "Renombrar sesión",
    label: "Título",
    value: session.title,
  });
  if (value === null) return;
  const clean = value.trim();
  if (!clean) return;
  session.title = clean.slice(0, 80);
  persist();
  renderAll();
}

async function deleteSession() {
  if (sending) {
    toast("Detén la respuesta actual antes de eliminar la sesión.");
    return;
  }
  const session = activeSession();
  const confirmed = await askConfirm({
    title: "Eliminar sesión",
    text: `Se borrará «${session.title}» de este equipo. Esta acción no se puede deshacer.`,
    confirmLabel: "Eliminar",
  });
  if (!confirmed) return;

  sessions = sessions.filter((item) => item.id !== session.id);
  if (!sessions.length) sessions = [createSession()];
  activeId = sessions[0].id;
  setActiveId(activeId);
  saveSessions(sessions);
  renderAll();
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */
function apiMessages(session, exclude) {
  return session.messages
    .filter((message) => message !== exclude)
    .map((message) => ({
      role: message.role,
      content: String(
        message.role === "assistant"
          ? message.raw ?? message.content
          : message.content ?? ""
      ),
    }))
    .filter((message) => message.content.trim());
}

async function streamCompletion(session, message) {
  const filter = new BlockFilter();
  let raw = "";
  controller = new AbortController();

  try {
    await streamChat({
      messages: apiMessages(session, message),
      signal: controller.signal,
      onDelta: (delta) => {
        raw += delta;
        const visible = filter.feed(delta);
        if (visible) {
          message.content += visible;
          scheduleStreamUpdate(message);
        }
      },
    });
  } finally {
    const tail = filter.flush();
    if (tail) message.content += tail;
    message.raw = raw;
    message.streaming = false;
    controller = null;
    persist();
    renderChat();
  }

  return raw;
}

async function runAgent() {
  sending = true;
  updateComposer();
  const session = activeSession();

  try {
    for (let step = 0; step < 8; step += 1) {
      const message = {
        id: uid(),
        role: "assistant",
        content: "",
        raw: "",
        ts: Date.now(),
        streaming: true,
      };
      session.messages.push(message);
      persist();
      renderChat();
      scrollToBottom(true);

      try {
        await streamCompletion(session, message);
      } catch (error) {
        if (error?.name === "AbortError") {
          message.content += message.content ? "\n\n_(detenido)_" : "_(detenido)_";
        } else {
          message.content = message.content || `⚠ ${error.message || error}`;
        }
        message.streaming = false;
        break;
      }

      if (!message.raw.trim()) {
        session.messages.pop();
        break;
      }

      if (extractQuestions(message.raw).length) break;

      const tools = extractTools(message.raw);
      if (!tools.length) break;

      message.toolsRun = tools.length;
      persist();

      const results = [];
      for (const tool of tools) {
        if (!isTauri && isDestructive(tool.tool)) {
          toast("Las herramientas locales solo están disponibles en la app de escritorio.");
          results.push(
            toolResult(tool.tool, false, "Requiere la app de escritorio Core IA Studio.")
          );
          continue;
        }

        const allowed = isDestructive(tool.tool) ? await confirmTool(tool) : true;
        if (!allowed) {
          results.push(
            toolResult(
              tool.tool,
              false,
              "El usuario rechazó esta acción. No la repitas sin pedir permiso."
            )
          );
          continue;
        }

        try {
          const output = await invokeTool({ tool: tool.tool, args: tool.args });
          results.push(toolResult(tool.tool, true, output));
        } catch (error) {
          results.push(
            toolResult(tool.tool, false, error?.message || String(error))
          );
        }
      }

      session.messages.push({
        id: uid(),
        role: "tool",
        content: results.join("\n\n"),
        ts: Date.now(),
      });
      persist();
      renderChat();
      scrollToBottom();
    }
  } finally {
    sending = false;
    controller = null;
    persist();
    updateComposer();
    renderChat();
    els.input.focus();
  }
}

async function sendMessage(rawText) {
  const text = String(rawText || els.input.value || "").trim();
  if (!text || sending) return;

  const config = loadConfig();
  if (!config.apiKey) {
    toast("Configura tu clave de agente en Ajustes.");
    openSettings("Falta la clave del agente.");
    return;
  }

  const session = activeSession();
  if (session.title === "Nueva sesión") {
    session.title = titleFrom(text);
  }
  session.messages.push({
    id: uid(),
    role: "user",
    content: text,
    ts: Date.now(),
  });
  els.input.value = "";
  resizeInput();
  persist();
  renderAll();
  scrollToBottom(true);

  await runAgent();
}

/* ------------------------------------------------------------------ */
/* Modales                                                             */
/* ------------------------------------------------------------------ */
function modalShell(content) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="modal">${content}</div>`;
  els.modalRoot.append(overlay);
  return overlay;
}

function askConfirm({ title, text, confirmLabel = "Aceptar" }) {
  return new Promise((resolve) => {
    const overlay = modalShell(`
      <h3>${escapeHtml(title)}</h3>
      <p class="sub">${escapeHtml(text)}</p>
      <div class="modal-actions">
        <button class="btn" data-action="cancel" type="button">Cancelar</button>
        <button class="btn danger" data-action="ok" type="button">${escapeHtml(confirmLabel)}</button>
      </div>`);
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('[data-action="cancel"]').onclick = () => finish(false);
    overlay.querySelector('[data-action="ok"]').onclick = () => finish(true);
    overlay.onclick = (event) => {
      if (event.target === overlay) finish(false);
    };
  });
}

function askText({ title, label, value = "" }) {
  return new Promise((resolve) => {
    const overlay = modalShell(`
      <h3>${escapeHtml(title)}</h3>
      <div class="field">
        <label>${escapeHtml(label)}</label>
        <input id="ask-text-input" type="text" value="${escapeHtml(value)}" />
      </div>
      <div class="modal-actions">
        <button class="btn" data-action="cancel" type="button">Cancelar</button>
        <button class="btn primary" data-action="ok" type="button">Guardar</button>
      </div>`);
    const input = overlay.querySelector("#ask-text-input");
    input.focus();
    input.select();
    const finish = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('[data-action="cancel"]').onclick = () => finish(null);
    overlay.querySelector('[data-action="ok"]').onclick = () => finish(input.value);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(input.value);
      if (event.key === "Escape") finish(null);
    });
    overlay.onclick = (event) => {
      if (event.target === overlay) finish(null);
    };
  });
}

function confirmTool(tool) {
  return new Promise((resolve) => {
    const danger = ["write_file", "delete_path", "run_command"].includes(tool.tool);
    const overlay = modalShell(`
      <h3>${danger ? "Permiso para cambiar archivos" : "Permiso de herramienta"}</h3>
      <p class="sub">${escapeHtml(describeTool(tool.tool, tool.args))}</p>
      <div class="tool-preview">${escapeHtml(
        JSON.stringify(tool.args, null, 2)
      ).slice(0, 2600)}</div>
      ${
        tool.reason
          ? `<p class="tool-reason"><strong>Motivo:</strong> ${escapeHtml(tool.reason)}</p>`
          : ""
      }
      <div class="warn-box">Solo se permite dentro del espacio de trabajo: ${escapeHtml(
        currentWorkspace
      )}</div>
      <div class="modal-actions">
        <button class="btn" data-action="reject" type="button">Rechazar</button>
        <button class="btn primary" data-action="allow" type="button">Permitir</button>
      </div>`);
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('[data-action="reject"]').onclick = () => finish(false);
    overlay.querySelector('[data-action="allow"]').onclick = () => finish(true);
    overlay.onclick = (event) => {
      if (event.target === overlay) finish(false);
    };
  });
}

function openSettings(reason = "") {
  const config = loadConfig();
  const overlay = modalShell(`
    <h3>Ajustes</h3>
    <p class="sub">${
      reason
        ? escapeHtml(reason)
        : "Conecta la app con tu backend de Core IA. La clave se guarda solo en este equipo."
    }</p>

    <div class="field">
      <label>Backend</label>
      <input id="cfg-backend" type="url" value="${escapeHtml(
        config.backend
      )}" placeholder="https://gemini-chat-backend-vyrz.onrender.com" />
      <span class="note">URL del backend de Core IA (sin barra final).</span>
    </div>

    <div class="field">
      <label>Clave del agente</label>
      <input id="cfg-key" type="password" value="${escapeHtml(
        config.apiKey
      )}" placeholder="AGENT_API_KEY" autocomplete="off" />
      <span class="note">Es la variable AGENT_API_KEY del backend. Nunca se envía a terceros.</span>
    </div>

    <div class="field">
      <label>Tema</label>
      <select id="cfg-theme">
        <option value="dark" ${config.theme !== "light" ? "selected" : ""}>Oscuro</option>
        <option value="light" ${config.theme === "light" ? "selected" : ""}>Claro</option>
      </select>
    </div>

    <div class="field">
      <label>Espacio de trabajo</label>
      <input id="cfg-workspace" type="text" value="${escapeHtml(
        currentWorkspace
      )}" ${isTauri ? "" : "disabled"} />
      <span class="note">${
        isTauri
          ? "Carpeta donde el agente puede leer y escribir. Solo se permite dentro de ella."
          : "Las herramientas locales solo funcionan en la app de escritorio."
      }</span>
    </div>

    <div class="field">
      <label>Estado de la conexión</label>
      <div class="note" id="cfg-result">Sin comprobar.</div>
    </div>

    <div class="modal-actions">
      <button class="btn" id="cfg-test" type="button">Probar conexión</button>
      <button class="btn" data-action="cancel" type="button">Cancelar</button>
      <button class="btn primary" data-action="save" type="button">Guardar</button>
    </div>`);

  const $id = (id) => overlay.querySelector(id);
  const result = $id("#cfg-result");

  $id("#cfg-test").onclick = async () => {
    result.textContent = "Comprobando…";
    try {
      const data = await checkHealth({
        backend: $id("#cfg-backend").value,
        apiKey: $id("#cfg-key").value,
      });
      result.textContent = `✓ Conectado con ${MODEL_LABEL}. ${data.tools?.length || 0} herramientas disponibles.`;
    } catch (error) {
      result.textContent = `✗ ${error.message}`;
    }
  };

  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove();
  overlay.querySelector('[data-action="save"]').onclick = async () => {
    const backend = $id("#cfg-backend").value.trim();
    const apiKey = $id("#cfg-key").value.trim();
    const theme = $id("#cfg-theme").value;
    const workspace = $id("#cfg-workspace").value.trim();

    saveConfig({ backend, apiKey, theme });
    applyTheme(theme);

    if (isTauri && workspace && workspace !== currentWorkspace) {
      try {
        currentWorkspace = await setWorkspace(workspace);
        els.workspace.textContent = currentWorkspace;
        toast("Espacio de trabajo actualizado.");
      } catch (error) {
        toast(`No se pudo cambiar la carpeta: ${error.message || error}`);
      }
    }

    overlay.remove();
    renderChat();
    verifyConnection();
    toast("Ajustes guardados.");
  };

  overlay.onclick = (event) => {
    if (event.target === overlay) overlay.remove();
  };
}

/* ------------------------------------------------------------------ */
/* Conexión                                                            */
/* ------------------------------------------------------------------ */
async function verifyConnection() {
  const config = loadConfig();
  if (!config.apiKey) {
    setStatus("bad", "Sin clave");
    return;
  }
  setStatus("", "Verificando…");
  try {
    await checkHealth();
    setStatus("ok", "Conectado");
  } catch (error) {
    setStatus("bad", error.message.includes("clave") ? "Clave inválida" : "Sin conexión");
  }
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */
els.newChat.addEventListener("click", newSession);
els.rename.addEventListener("click", renameSession);
els.remove.addEventListener("click", deleteSession);
els.settingsBtn.addEventListener("click", () => openSettings());
els.theme.addEventListener("click", () => {
  const config = loadConfig();
  const theme = config.theme === "light" ? "dark" : "light";
  saveConfig({ theme });
  applyTheme(theme);
});
els.toggle.addEventListener("click", () => els.sidebar.classList.toggle("open"));

els.search.addEventListener("input", renderSidebar);

els.input.addEventListener("input", () => {
  resizeInput();
  els.send.disabled = !els.input.value.trim() || sending;
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

els.send.addEventListener("click", () => sendMessage());
els.stop.addEventListener("click", () => {
  controller?.abort();
  toast("Deteniendo…");
});

els.messages.addEventListener("click", async (event) => {
  const copy = event.target.closest(".copy-code");
  if (copy) {
    const code = copy.parentElement.querySelector("code")?.textContent || "";
    try {
      await navigator.clipboard.writeText(code);
      toast("Código copiado.");
    } catch {
      toast("No se pudo copiar.");
    }
    return;
  }

  const option = event.target.closest(".q-option");
  if (!option || sending) return;

  const session = activeSession();
  const index = Number(option.dataset.message);
  const message = session.messages[index];
  if (!message || message.answeredOption) return;
  message.answeredOption = option.dataset.option || "";
  persist();
  renderChat();
  await sendMessage(option.dataset.option || "");
});

window.addEventListener("beforeunload", () => {
  persist();
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */
async function init() {
  applyTheme(loadConfig().theme);

  if (isTauri) {
    try {
      currentWorkspace = await getWorkspace();
    } catch {
      currentWorkspace = "No disponible";
    }
  } else {
    currentWorkspace = "solo chat (sin herramientas)";
  }
  els.workspace.textContent = currentWorkspace;

  renderAll();
  resizeInput();
  await verifyConnection();

  if (!loadConfig().apiKey) {
    setTimeout(() => {
      toast("Pega tu clave de agente en Ajustes para empezar.", 4200);
    }, 800);
  }
}

init();
