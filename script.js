/**
 * Core IA - Frontend
 * Gestión de sesión (Discord OAuth2), historial de chats y envío de mensajes.
 */

const BACKEND_URL = "https://gemini-chat-backend-vyrz.onrender.com";

const TOKEN_KEY = "coreia_token";
const CHATS_KEY = (userId) => `coreia_chats_${userId}`;

const chatEl = document.getElementById("chat");
const welcomeEl = document.getElementById("welcome");
const scrollEl = document.getElementById("chat-scroll");
const historyEl = document.getElementById("history");
const profileEl = document.getElementById("profile");
const formEl = document.getElementById("composer");
const inputEl = document.getElementById("input");
const sendEl = document.getElementById("send");
const sidebarEl = document.getElementById("sidebar");
const overlayEl = document.getElementById("overlay");
const menuBtn = document.getElementById("menu-btn");

let token = localStorage.getItem(TOKEN_KEY) || null;
let currentUser = null;
let chats = [];
let currentChatId = null;
let sending = false;

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearSession();
    throw new Error("Sesión expirada. Vuelve a iniciar sesión.");
  }
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.detail) detail = data.detail;
    } catch (_) { /* respuesta sin JSON */ }
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

/* ------------------------------------------------------------------ */
/* Sesión                                                              */
/* ------------------------------------------------------------------ */

function loginUrl() {
  const returnTo = encodeURIComponent(window.location.origin + window.location.pathname);
  return `${BACKEND_URL}/api/auth/discord/login?return_to=${returnTo}`;
}

function clearSession() {
  token = null;
  currentUser = null;
  chats = [];
  currentChatId = null;
  localStorage.removeItem(TOKEN_KEY);
  renderProfile();
  renderHistory();
  renderChat();
}

function captureTokenFromUrl() {
  const hash = window.location.hash || "";
  const match = hash.match(/token=([^&]+)/);
  if (match) {
    token = decodeURIComponent(match[1]);
    localStorage.setItem(TOKEN_KEY, token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

async function loadSession() {
  if (!token) {
    renderProfile();
    renderChat();
    return;
  }
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
    chats = JSON.parse(localStorage.getItem(CHATS_KEY(currentUser.id)) || "[]");
    if (chats.length) currentChatId = chats[0].id;
    renderProfile();
    renderHistory();
    renderChat();
  } catch (err) {
    clearSession();
    renderChat();
  }
}

/* ------------------------------------------------------------------ */
/* Perfil / Sidebar                                                    */
/* ------------------------------------------------------------------ */

function renderProfile() {
  profileEl.innerHTML = "";

  if (!currentUser) {
    const btn = document.createElement("button");
    btn.className = "login-btn";
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5a18 18 0 0 1 4.4 1.4 15.9 15.9 0 0 0-4.1-1.3 16.6 16.6 0 0 0-6.8 0A15.9 15.9 0 0 0 4.5 4.9 18 18 0 0 1 8.9 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.8 8.6 0 12.6.4 16.6a19.9 19.9 0 0 0 6 3l.8-1.3c-.9-.3-1.7-.7-2.5-1.2l.6-.5a14.3 14.3 0 0 0 12.2 0l.6.5c-.8.5-1.6.9-2.5 1.2l.8 1.3a19.9 19.9 0 0 0 6-3c.5-4.6-.7-8.6-2.9-12.2ZM8.5 14.6c-1.2 0-2.1-1.1-2.1-2.4S7.3 9.8 8.5 9.8s2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Z"/></svg>' +
      "Iniciar sesión con Discord";
    btn.addEventListener("click", () => {
      window.location.href = loginUrl();
    });
    profileEl.appendChild(btn);
    return;
  }

  const card = document.createElement("div");
  card.className = "user-card";

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.alt = currentUser.display_name || currentUser.username || "Usuario";
  avatar.src = currentUser.avatar_url || "";
  avatar.addEventListener("error", () => {
    avatar.style.visibility = "hidden";
  });

  const meta = document.createElement("div");
  meta.className = "user-meta";

  const name = document.createElement("div");
  name.className = "user-name";
  name.textContent = currentUser.display_name || currentUser.username || "Usuario";

  const sub = document.createElement("div");
  sub.className = "user-sub";
  sub.textContent = currentUser.username ? `@${currentUser.username}` : "Discord";

  meta.append(name, sub);

  const logout = document.createElement("button");
  logout.className = "icon-btn";
  logout.title = "Cerrar sesión";
  logout.innerHTML =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';
  logout.addEventListener("click", () => {
    api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearSession();
  });

  card.append(avatar, meta, logout);
  profileEl.appendChild(card);
}

function renderHistory() {
  historyEl.innerHTML = "";
  if (!currentUser) {
    const empty = document.createElement("div");
    empty.className = "history-item";
    empty.style.cursor = "default";
    empty.textContent = "Inicia sesión para guardar chats";
    historyEl.appendChild(empty);
    return;
  }

  chats.forEach((chat) => {
    const item = document.createElement("div");
    item.className = "history-item" + (chat.id === currentChatId ? " active" : "");

    const dot = document.createElement("span");
    dot.className = "dot";

    const label = document.createElement("span");
    label.textContent = chat.title || "Nuevo chat";

    item.append(dot, label);
    item.addEventListener("click", () => {
      currentChatId = chat.id;
      renderHistory();
      renderChat();
      closeSidebar();
    });
    historyEl.appendChild(item);
  });
}

/* ------------------------------------------------------------------ */
/* Chats                                                               */
/* ------------------------------------------------------------------ */

function persistChats() {
  if (!currentUser) return;
  localStorage.setItem(CHATS_KEY(currentUser.id), JSON.stringify(chats));
}

function currentChat() {
  return chats.find((c) => c.id === currentChatId) || null;
}

function startNewChat() {
  if (!currentUser) return;
  const chat = {
    id: `c_${Date.now()}`,
    title: "Nuevo chat",
    messages: [],
    createdAt: Date.now(),
  };
  chats.unshift(chat);
  currentChatId = chat.id;
  persistChats();
  renderHistory();
  renderChat();
  inputEl.focus();
  closeSidebar();
}

function addMessage(role, text, persist = true) {
  let chat = currentChat();
  if (!chat) {
    startNewChat();
    chat = currentChat();
  }
  chat.messages.push({ role, text });
  if (persist) persistChats();
  return chat;
}

function renderChat() {
  chatEl.innerHTML = "";
  const chat = currentChat();
  const hasMessages = chat && chat.messages.length > 0;

  welcomeEl.style.display = hasMessages ? "none" : "flex";

  if (!hasMessages) return;

  chat.messages.forEach((m) => chatEl.appendChild(buildMessage(m.role, m.text)));
  scrollToBottom();
}

function buildMessage(role, text) {
  const row = document.createElement("div");
  row.className = `msg ${role}`;

  if (role === "bot") {
    const icon = document.createElement("div");
    icon.className = "role-icon";
    icon.textContent = "C";
    row.appendChild(icon);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);

  return row;
}

function appendTyping() {
  const row = document.createElement("div");
  row.className = "msg bot";
  row.id = "typing-row";

  const icon = document.createElement("div");
  icon.className = "role-icon";
  icon.textContent = "C";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML =
    '<span class="typing">Core IA está pensando<span class="dots"><span></span><span></span><span></span></span></span>';

  row.append(icon, bubble);
  chatEl.appendChild(row);
  scrollToBottom();
}

function removeTyping() {
  const row = document.getElementById("typing-row");
  if (row) row.remove();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    scrollEl.scrollTop = scrollEl.scrollHeight;
  });
}

/* ------------------------------------------------------------------ */
/* Envío de mensajes                                                   */
/* ------------------------------------------------------------------ */

async function sendMessage(text) {
  if (!currentUser) {
    renderError("Inicia sesión con Discord para chatear.");
    return;
  }
  if (sending) return;

  sending = true;
  updateSendState();

  const chat = addMessage("user", text);
  if (chat.messages.length === 1) {
    chat.title = text.length > 42 ? `${text.slice(0, 42)}...` : text;
    renderHistory();
  }
  renderChat();
  appendTyping();

  try {
    const data = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: text, conversation_id: chat.conversationId || null }),
    });
    if (data.conversation_id) {
      chat.conversationId = data.conversation_id;
      persistChats();
    }
    removeTyping();
    addMessage("bot", data.reply || "Sin respuesta.");
    renderChat();
  } catch (err) {
    removeTyping();
    renderError(err.message);
  } finally {
    sending = false;
    updateSendState();
    inputEl.focus();
  }
}

function renderError(message) {
  const row = document.createElement("div");
  row.className = "msg bot error";

  const icon = document.createElement("div");
  icon.className = "role-icon";
  icon.textContent = "!";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message;

  row.append(icon, bubble);
  chatEl.appendChild(row);
  scrollToBottom();
}

/* ------------------------------------------------------------------ */
/* Composer / UI                                                       */
/* ------------------------------------------------------------------ */

function updateSendState() {
  sendEl.disabled = sending || inputEl.value.trim().length === 0;
}

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text || sending) return;
  inputEl.value = "";
  autoResize();
  updateSendState();
  sendMessage(text);
});

inputEl.addEventListener("input", () => {
  autoResize();
  updateSendState();
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

document.getElementById("new-chat").addEventListener("click", startNewChat);

document.querySelectorAll(".suggestion").forEach((btn) => {
  btn.addEventListener("click", () => {
    const prompt = btn.getAttribute("data-prompt") || btn.textContent;
    if (currentUser) {
      inputEl.value = prompt;
      autoResize();
      updateSendState();
      inputEl.focus();
    } else {
      window.location.href = loginUrl();
    }
  });
});

function openSidebar() {
  sidebarEl.classList.add("open");
  overlayEl.classList.add("show");
}
function closeSidebar() {
  sidebarEl.classList.remove("open");
  overlayEl.classList.remove("show");
}
menuBtn.addEventListener("click", openSidebar);
overlayEl.addEventListener("click", closeSidebar);

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

(async function init() {
  captureTokenFromUrl();
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") === "error") {
    window.history.replaceState(null, "", window.location.pathname);
    setTimeout(() => renderError("El inicio de sesión con Discord fue cancelado."), 300);
  }
  updateSendState();
  autoResize();
  await loadSession();
})();
