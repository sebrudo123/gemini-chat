/**
 * Core IA - Frontend
 * Sesión (Discord/Google/Microsoft OAuth2), historial en servidor, ajustes,
 * planes, panel de administración y chat.
 */

const BACKEND_URL = "https://gemini-chat-backend-vyrz.onrender.com";

const TOKEN_KEY = "coreia_token";
const THEME_KEY = "coreia_theme";
const TTS_KEY = "coreia_tts";

const chatEl = document.getElementById("chat");
const welcomeEl = document.getElementById("welcome");
const splashEl = document.getElementById("splash");
const authGateEl = document.getElementById("auth-gate");
const authProvidersEl = document.getElementById("auth-providers");
const scrollEl = document.getElementById("chat-scroll");
const historyEl = document.getElementById("history");
const profileEl = document.getElementById("profile");
const formEl = document.getElementById("composer");
const inputEl = document.getElementById("input");
const sendEl = document.getElementById("send");
const sidebarEl = document.getElementById("sidebar");
const overlayEl = document.getElementById("overlay");
const menuBtn = document.getElementById("menu-btn");

const micBtn = document.getElementById("mic-btn");
const imageBtn = document.getElementById("image-btn");
const kbBtn = document.getElementById("kb-btn");
const ttsToggle = document.getElementById("tts-toggle");
const settingsBtn = document.getElementById("settings-btn");
const plansBtn = document.getElementById("plans-btn");
const planBadge = document.getElementById("plan-badge");

const kbModal = document.getElementById("kb-modal");
const kbClose = document.getElementById("kb-close");
const kbTitle = document.getElementById("kb-title");
const kbText = document.getElementById("kb-text");
const kbSave = document.getElementById("kb-save");
const kbList = document.getElementById("kb-list");

const settingsModal = document.getElementById("settings-modal");
const settingsClose = document.getElementById("settings-close");
const settingsTheme = document.getElementById("settings-theme");
const settingsModel = document.getElementById("settings-model");
const settingsRag = document.getElementById("settings-rag");
const settingsSave = document.getElementById("settings-save");
const deleteAccountBtn = document.getElementById("delete-account");

const plansModal = document.getElementById("plans-modal");
const plansClose = document.getElementById("plans-close");
const usageList = document.getElementById("usage-list");
const plansList = document.getElementById("plans-list");

const adminModal = document.getElementById("admin-modal");
const adminClose = document.getElementById("admin-close");
const adminStats = document.getElementById("admin-stats");
const adminUsers = document.getElementById("admin-users");

let token = localStorage.getItem(TOKEN_KEY) || null;
let currentUser = null;
let conversations = [];
let messages = [];
let currentChatId = null;
let sending = false;
let imageMode = false;
let ttsEnabled = localStorage.getItem(TTS_KEY) === "1";
let settings = { theme: "dark", preferred_model: null, use_rag: true };
let usage = null;
let catalog = null;
let providers = null;

const splashStart = performance.now();
let splashHidden = false;

function hideSplash() {
  if (splashHidden || !splashEl) return;
  splashHidden = true;
  const elapsed = performance.now() - splashStart;
  const wait = Math.max(0, 2300 - elapsed);
  setTimeout(() => splashEl.classList.add("hide"), wait);
}

function showAuthGate() {
  if (authGateEl) authGateEl.classList.add("show");
}

function hideAuthGate() {
  if (authGateEl) authGateEl.classList.remove("show");
}

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

const PROVIDER_META = {
  discord: {
    label: "Discord",
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5a18 18 0 0 1 4.4 1.4 15.9 15.9 0 0 0-4.1-1.3 16.6 16.6 0 0 0-6.8 0A15.9 15.9 0 0 0 4.5 4.9 18 18 0 0 1 8.9 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.8 8.6 0 12.6.4 16.6a19.9 19.9 0 0 0 6 3l.8-1.3c-.9-.3-1.7-.7-2.5-1.2l.6-.5a14.3 14.3 0 0 0 12.2 0l.6.5c-.8.5-1.6.9-2.5 1.2l.8 1.3a19.9 19.9 0 0 0 6-3c.5-4.6-.7-8.6-2.9-12.2ZM8.5 14.6c-1.2 0-2.1-1.1-2.1-2.4S7.3 9.8 8.5 9.8s2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Z"/></svg>',
  },
  google: {
    label: "Google",
    icon: '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C41.1 35.9 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>',
  },
  microsoft: {
    label: "Microsoft",
    icon: '<svg width="20" height="20" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>',
  },
};

function loginUrl(provider) {
  const returnTo = encodeURIComponent(window.location.origin + window.location.pathname);
  return `${BACKEND_URL}/api/auth/${provider}/login?return_to=${returnTo}`;
}

async function loadProviders() {
  try {
    const data = await api("/api/auth/providers");
    providers = data.providers && data.providers.length ? data.providers : ["discord"];
  } catch (_) {
    providers = ["discord"];
  }
}

function renderLoginButtons(container, variant) {
  container.innerHTML = "";
  const list = providers && providers.length ? providers : ["discord"];
  list.forEach((provider) => {
    const meta = PROVIDER_META[provider];
    if (!meta) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${variant} provider-${provider}`;
    btn.innerHTML = `${meta.icon}<span>Continuar con ${meta.label}</span>`;
    btn.addEventListener("click", () => {
      window.location.href = loginUrl(provider);
    });
    container.appendChild(btn);
  });
}

function clearSession() {
  token = null;
  currentUser = null;
  conversations = [];
  messages = [];
  currentChatId = null;
  usage = null;
  localStorage.removeItem(TOKEN_KEY);
  renderProfile();
  renderHistory();
  renderChat();
  updatePlanBadge();
  showAuthGate();
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
    showAuthGate();
    return;
  }
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
    hideAuthGate();
    await Promise.all([loadSettings(), loadConversations(), loadUsage()]);
    if (conversations.length) {
      await openConversation(conversations[0].id);
    } else {
      renderChat();
    }
    renderProfile();
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
    const box = document.createElement("div");
    box.className = "auth-providers-side";
    renderLoginButtons(box, "login-btn");
    profileEl.appendChild(box);
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
  sub.textContent = currentUser.username ? `@${currentUser.username}` : "Cuenta";

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

  if (currentUser.is_admin) {
    const admin = document.createElement("button");
    admin.className = "icon-btn";
    admin.title = "Panel de administración";
    admin.innerHTML =
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>';
    admin.addEventListener("click", openAdmin);
    card.append(avatar, meta, admin, logout);
  } else {
    card.append(avatar, meta, logout);
  }
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

  if (!conversations.length) {
    const empty = document.createElement("div");
    empty.className = "history-item";
    empty.style.cursor = "default";
    empty.textContent = "Sin conversaciones todavía";
    historyEl.appendChild(empty);
    return;
  }

  conversations.forEach((chat) => {
    const item = document.createElement("div");
    item.className = "history-item" + (chat.id === currentChatId ? " active" : "");

    const dot = document.createElement("span");
    dot.className = "dot";

    const label = document.createElement("span");
    label.className = "history-label";
    label.textContent = chat.title || "Nuevo chat";

    const actions = document.createElement("button");
    actions.className = "history-action";
    actions.title = "Opciones";
    actions.textContent = "⋯";
    actions.addEventListener("click", (event) => {
      event.stopPropagation();
      const choice = window.prompt(
        "Escribe 'r' para renombrar o 'x' para eliminar esta conversación:",
        "r"
      );
      if (choice === null) return;
      if (choice.trim().toLowerCase() === "x") deleteConversation(chat.id);
      else if (choice.trim().toLowerCase() === "r") renameConversation(chat.id);
    });

    item.append(dot, label, actions);
    item.addEventListener("click", () => {
      openConversation(chat.id);
      closeSidebar();
    });
    historyEl.appendChild(item);
  });
}

/* ------------------------------------------------------------------ */
/* Conversaciones (servidor)                                           */
/* ------------------------------------------------------------------ */

async function loadConversations() {
  try {
    const data = await api("/api/conversations");
    conversations = data.conversations || [];
  } catch (err) {
    conversations = [];
  }
  renderHistory();
}

async function openConversation(id) {
  try {
    const data = await api(`/api/conversations/${id}`);
    const conversation = data.conversation;
    currentChatId = conversation.id;
    messages = (conversation.items || []).map((m) => ({
      role: m.role === "assistant" ? "bot" : "user",
      text: m.content,
    }));
    renderHistory();
    renderChat();
  } catch (err) {
    renderError(err.message);
  }
}

async function renameConversation(id) {
  const current = conversations.find((c) => c.id === id);
  const title = window.prompt("Nuevo título:", current ? current.title : "");
  if (!title) return;
  try {
    await api(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    await loadConversations();
  } catch (err) {
    renderError(err.message);
  }
}

async function deleteConversation(id) {
  if (!window.confirm("¿Eliminar esta conversación definitivamente?")) return;
  try {
    await api(`/api/conversations/${id}`, { method: "DELETE" });
    if (currentChatId === id) startNewChat();
    await loadConversations();
  } catch (err) {
    renderError(err.message);
  }
}

function startNewChat() {
  if (!currentUser) return;
  currentChatId = null;
  messages = [];
  renderHistory();
  renderChat();
  inputEl.focus();
  closeSidebar();
}

function addMessage(role, text, image = null) {
  messages.push({ role, text, image: image || undefined });
}

function renderChat() {
  chatEl.innerHTML = "";
  const hasMessages = messages.length > 0;

  welcomeEl.style.display = hasMessages ? "none" : "flex";

  if (!hasMessages) return;

  messages.forEach((m) => chatEl.appendChild(buildMessage(m.role, m.text, m.image)));
  scrollToBottom();
}

/* ------------------------------------------------------------------ */
/* Markdown mínimo (seguro, sin dependencias)                          */
/* ------------------------------------------------------------------ */

function appendInline(parent, text) {
  const parts = text.split(/(`[^`]+`)/g);
  parts.forEach((part) => {
    if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) {
      const code = document.createElement("code");
      code.className = "inline-code";
      code.textContent = part.slice(1, -1);
      parent.appendChild(code);
    } else {
      appendFormatted(parent, part);
    }
  });
}

function appendFormatted(parent, text) {
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    if (match[1] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = match[1];
      parent.appendChild(strong);
    } else if (match[2] !== undefined) {
      const em = document.createElement("em");
      em.textContent = match[2];
      parent.appendChild(em);
    } else {
      const a = document.createElement("a");
      a.href = match[3];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = match[4];
      parent.appendChild(a);
    }
    last = re.lastIndex;
  }
  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}

function buildCodeBlock(lang, code) {
  const wrap = document.createElement("div");
  wrap.className = "code-block";

  const head = document.createElement("div");
  head.className = "code-head";
  const label = document.createElement("span");
  label.textContent = lang || "code";
  const copy = document.createElement("button");
  copy.className = "code-copy";
  copy.type = "button";
  copy.textContent = "Copiar";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = "Copiado";
      setTimeout(() => {
        copy.textContent = "Copiar";
      }, 1500);
    } catch (_) {
      copy.textContent = "Error";
    }
  });
  head.append(label, copy);

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.textContent = code;
  pre.appendChild(codeEl);

  wrap.append(head, pre);
  return wrap;
}

function buildTextBlock(text) {
  const block = document.createElement("div");
  block.className = "md";
  const lines = text.split("\n");
  let para = [];
  let list = null;
  let listType = null;

  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement("div");
    p.className = "md-p";
    para.forEach((line, index) => {
      if (index > 0) p.appendChild(document.createElement("br"));
      appendInline(p, line);
    });
    block.appendChild(p);
    para = [];
  };
  const flushList = () => {
    list = null;
    listType = null;
  };

  lines.forEach((line) => {
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (heading) {
      flushPara();
      flushList();
      const el = document.createElement("div");
      el.className = `md-h md-h${heading[1].length}`;
      appendInline(el, heading[2]);
      block.appendChild(el);
      return;
    }
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        flushList();
        list = document.createElement("ul");
        listType = "ul";
        block.appendChild(list);
      }
      const li = document.createElement("li");
      appendInline(li, ul[1]);
      list.appendChild(li);
      return;
    }
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        flushList();
        list = document.createElement("ol");
        listType = "ol";
        block.appendChild(list);
      }
      const li = document.createElement("li");
      appendInline(li, ol[1]);
      list.appendChild(li);
      return;
    }
    if (line.trim() === "") {
      flushPara();
      flushList();
      return;
    }
    flushList();
    para.push(line);
  });

  flushPara();
  return block;
}

function renderRich(container, text) {
  let last = 0;
  const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      container.appendChild(buildTextBlock(text.slice(last, match.index)));
    }
    container.appendChild(buildCodeBlock(match[1].trim(), match[2]));
    last = re.lastIndex;
  }
  if (last < text.length) {
    container.appendChild(buildTextBlock(text.slice(last)));
  }
}

function buildMessage(role, text, image) {
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
  if (text) {
    if (role === "bot") {
      renderRich(bubble, text);
    } else {
      const block = buildTextBlock(text);
      bubble.appendChild(block);
    }
  }
  if (image) {
    const img = document.createElement("img");
    img.src = image;
    img.alt = text || "Imagen generada";
    bubble.appendChild(img);
  }
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

  addMessage("user", text);
  renderChat();
  appendTyping();

  try {
    if (imageMode) {
      const data = await api("/api/image", {
        method: "POST",
        body: JSON.stringify({ prompt: text }),
      });
      removeTyping();
      addMessage("bot", text, data.image);
      renderChat();
      loadUsage();
    } else {
      const data = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, conversation_id: currentChatId }),
      });
      removeTyping();
      if (data.conversation_id) currentChatId = data.conversation_id;
      const reply = data.reply || "Sin respuesta.";
      addMessage("bot", reply);
      renderChat();
      if (ttsEnabled) speak(reply);
      await loadConversations();
      loadUsage();
    }
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
      showAuthGate();
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
/* Voz (síntesis y dictado)                                            */
/* ------------------------------------------------------------------ */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionActive = false;

function toggleTts() {
  ttsEnabled = !ttsEnabled;
  localStorage.setItem(TTS_KEY, ttsEnabled ? "1" : "0");
  applyTtsState();
  if (!ttsEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
}

function applyTtsState() {
  ttsToggle.classList.toggle("active", ttsEnabled);
  ttsToggle.setAttribute("aria-pressed", String(ttsEnabled));
}

function speak(text) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-ES";
  window.speechSynthesis.speak(utterance);
}

function initSpeechRecognition() {
  if (!SpeechRecognition) return false;
  recognition = new SpeechRecognition();
  recognition.lang = "es-ES";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    inputEl.value = (inputEl.value ? `${inputEl.value} ` : "") + transcript;
    autoResize();
    updateSendState();
    inputEl.focus();
  });
  recognition.addEventListener("end", stopDictation);
  recognition.addEventListener("error", stopDictation);
  return true;
}

function stopDictation() {
  recognitionActive = false;
  micBtn.classList.remove("recording");
}

function toggleDictation() {
  if (!recognition && !initSpeechRecognition()) {
    renderError("Tu navegador no soporta dictado por voz.");
    return;
  }
  if (recognitionActive) {
    recognition.stop();
    return;
  }
  try {
    recognition.start();
    recognitionActive = true;
    micBtn.classList.add("recording");
  } catch (_) {
    stopDictation();
  }
}

/* ------------------------------------------------------------------ */
/* Modo imagen                                                         */
/* ------------------------------------------------------------------ */

function toggleImageMode() {
  imageMode = !imageMode;
  imageBtn.classList.toggle("active", imageMode);
  inputEl.placeholder = imageMode
    ? "Describe la imagen que quieres generar..."
    : "Escribe un mensaje a Core IA...";
  inputEl.focus();
}

/* ------------------------------------------------------------------ */
/* Base de conocimiento (RAG)                                          */
/* ------------------------------------------------------------------ */

function openKb() {
  if (!currentUser) {
    renderError("Inicia sesión para usar tu base de conocimiento.");
    return;
  }
  kbModal.classList.add("show");
  loadDocuments();
}

function closeKb() {
  kbModal.classList.remove("show");
}

async function loadDocuments() {
  kbList.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "kb-empty";
  loading.textContent = "Cargando...";
  kbList.appendChild(loading);
  try {
    const data = await api("/api/rag/documents");
    renderDocuments(data.documents || []);
  } catch (err) {
    kbList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "kb-empty";
    empty.textContent = err.message;
    kbList.appendChild(empty);
  }
}

function renderDocuments(docs) {
  kbList.innerHTML = "";
  if (!docs.length) {
    const empty = document.createElement("div");
    empty.className = "kb-empty";
    empty.textContent = "Todavía no hay documentos.";
    kbList.appendChild(empty);
    return;
  }
  docs.forEach((doc) => {
    const item = document.createElement("div");
    item.className = "kb-item";

    const meta = document.createElement("div");
    meta.className = "kb-meta";
    const name = document.createElement("div");
    name.className = "kb-name";
    name.textContent = doc.title;
    const sub = document.createElement("div");
    sub.className = "kb-sub";
    sub.textContent = `${doc.chunks} fragmentos`;
    meta.append(name, sub);

    const del = document.createElement("button");
    del.className = "icon-btn";
    del.title = "Eliminar";
    del.textContent = "✕";
    del.addEventListener("click", () => deleteDocument(doc.id));

    item.append(meta, del);
    kbList.appendChild(item);
  });
}

async function saveDocument() {
  const text = kbText.value.trim();
  if (!text) return;
  kbSave.disabled = true;
  kbSave.textContent = "Guardando...";
  try {
    await api("/api/rag/documents", {
      method: "POST",
      body: JSON.stringify({ title: kbTitle.value.trim() || "Documento", text }),
    });
    kbTitle.value = "";
    kbText.value = "";
    loadDocuments();
    loadUsage();
  } catch (err) {
    renderError(err.message);
  } finally {
    kbSave.disabled = false;
    kbSave.textContent = "Guardar documento";
  }
}

async function deleteDocument(id) {
  try {
    await api(`/api/rag/documents/${id}`, { method: "DELETE" });
    loadDocuments();
    loadUsage();
  } catch (err) {
    renderError(err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Ajustes de usuario                                                  */
/* ------------------------------------------------------------------ */

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  localStorage.setItem(THEME_KEY, theme);
}

async function loadSettings() {
  try {
    const data = await api("/api/settings");
    settings = data.settings;
    applyTheme(settings.theme);
  } catch (_) { /* mantener valores por defecto */ }
}

function openSettings() {
  if (!currentUser) {
    renderError("Inicia sesión para configurar tu cuenta.");
    return;
  }
  settingsTheme.value = settings.theme || "dark";
  settingsModel.value = settings.preferred_model || "";
  settingsRag.checked = settings.use_rag !== false;
  settingsModal.classList.add("show");
}

function closeSettings() {
  settingsModal.classList.remove("show");
}

async function saveSettings() {
  settingsSave.disabled = true;
  settingsSave.textContent = "Guardando...";
  try {
    const data = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        theme: settingsTheme.value,
        preferred_model: settingsModel.value,
        use_rag: settingsRag.checked,
      }),
    });
    settings = data.settings;
    applyTheme(settings.theme);
    closeSettings();
  } catch (err) {
    renderError(err.message);
  } finally {
    settingsSave.disabled = false;
    settingsSave.textContent = "Guardar cambios";
  }
}

async function deleteAccount() {
  if (!window.confirm("Esto borrará tu cuenta y todos tus datos. ¿Continuar?")) return;
  try {
    await api("/api/account", { method: "DELETE" });
    closeSettings();
    clearSession();
  } catch (err) {
    renderError(err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Planes y uso                                                        */
/* ------------------------------------------------------------------ */

function updatePlanBadge() {
  if (!planBadge) return;
  const plan = usage ? usage.plan : null;
  planBadge.textContent = plan ? `Plan ${plan}` : "Plan";
}

async function loadUsage() {
  if (!currentUser) return;
  try {
    usage = await api("/api/usage");
    updatePlanBadge();
  } catch (_) { /* silencioso */ }
}

async function openPlans() {
  if (!currentUser) {
    renderError("Inicia sesión para ver tu plan.");
    return;
  }
  plansModal.classList.add("show");
  usageList.innerHTML = "";
  plansList.innerHTML = "";
  await loadUsage();
  try {
    if (!catalog) {
      const data = await api("/api/plans");
      catalog = data.plans;
    }
  } catch (_) { /* sin catálogo */ }
  renderUsage();
  renderPlans();
}

function closePlans() {
  plansModal.classList.remove("show");
}

function usageRow(label, used, limit) {
  const row = document.createElement("div");
  row.className = "usage-row";

  const head = document.createElement("div");
  head.className = "usage-head";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("span");
  value.textContent = limit === null ? `${used} / ∞` : `${used} / ${limit}`;
  head.append(name, value);

  const bar = document.createElement("div");
  bar.className = "usage-bar";
  const fill = document.createElement("div");
  fill.className = "usage-fill";
  const pct = limit === null ? 8 : Math.min(100, Math.round((used / limit) * 100));
  fill.style.width = `${pct}%`;
  if (limit !== null && used >= limit) fill.classList.add("full");
  bar.appendChild(fill);

  row.append(head, bar);
  return row;
}

function renderUsage() {
  usageList.innerHTML = "";
  if (!usage) return;
  const limits = usage.limits || {};
  usageList.appendChild(usageRow("Mensajes hoy", usage.usage.messages, limits.messages_per_day));
  usageList.appendChild(usageRow("Imágenes hoy", usage.usage.images, limits.images_per_day));
  usageList.appendChild(usageRow("Documentos", usage.usage.documents, limits.documents));
}

function renderPlans() {
  plansList.innerHTML = "";
  if (!catalog) return;
  Object.entries(catalog).forEach(([key, plan]) => {
    const card = document.createElement("div");
    card.className = "plan-card" + (usage && usage.plan === key ? " current" : "");

    const head = document.createElement("div");
    head.className = "plan-head";
    const name = document.createElement("strong");
    name.textContent = plan.name;
    const price = document.createElement("span");
    price.textContent = plan.price;
    head.append(name, price);

    const limits = plan.limits || {};
    const list = document.createElement("ul");
    list.className = "plan-features";
    [
      ["Mensajes/día", limits.messages_per_day],
      ["Imágenes/día", limits.images_per_day],
      ["Documentos", limits.documents],
    ].forEach(([label, value]) => {
      const li = document.createElement("li");
      li.textContent = `${label}: ${value === null ? "ilimitado" : value}`;
      list.appendChild(li);
    });

    card.append(head, list);
    if (usage && usage.plan === key) {
      const tag = document.createElement("div");
      tag.className = "plan-current";
      tag.textContent = "Plan actual";
      card.appendChild(tag);
    }
    plansList.appendChild(card);
  });
}

/* ------------------------------------------------------------------ */
/* Administración                                                      */
/* ------------------------------------------------------------------ */

async function openAdmin() {
  if (!currentUser || !currentUser.is_admin) {
    renderError("Acceso reservado al fundador.");
    return;
  }
  adminModal.classList.add("show");
  adminStats.innerHTML = "";
  adminUsers.innerHTML = "";
  try {
    const [statsData, usersData] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/users"),
    ]);
    renderAdminStats(statsData);
    renderAdminUsers(usersData.users || []);
  } catch (err) {
    renderError(err.message);
  }
}

function closeAdmin() {
  adminModal.classList.remove("show");
}

function adminStat(value, label) {
  const box = document.createElement("div");
  box.className = "admin-stat";
  const v = document.createElement("div");
  v.className = "value";
  v.textContent = value;
  const l = document.createElement("div");
  l.className = "label";
  l.textContent = label;
  box.append(v, l);
  return box;
}

function renderAdminStats(stats) {
  adminStats.innerHTML = "";
  adminStats.appendChild(adminStat(stats.users, "Usuarios"));
  adminStats.appendChild(adminStat(stats.conversations, "Conversaciones"));
  adminStats.appendChild(adminStat(stats.messages, "Mensajes"));
  adminStats.appendChild(adminStat(stats.documents, "Documentos"));
  adminStats.appendChild(adminStat(stats.active_today, "Activos hoy"));
  adminStats.appendChild(adminStat(stats.messages_today, "Mensajes hoy"));
}

function renderAdminUsers(users) {
  adminUsers.innerHTML = "";
  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "modal-sub";
    empty.textContent = "Todavía no hay usuarios.";
    adminUsers.appendChild(empty);
    return;
  }
  users.forEach((user) => adminUsers.appendChild(adminUserRow(user)));
}

function adminUserRow(user) {
  const row = document.createElement("div");
  row.className = "admin-user";

  if (user.avatar_url) {
    const img = document.createElement("img");
    img.src = user.avatar_url;
    img.alt = "";
    img.addEventListener("error", () => {
      img.style.display = "none";
    });
    row.appendChild(img);
  } else {
    const fb = document.createElement("div");
    fb.className = "fallback-avatar";
    fb.textContent = (user.display_name || user.username || "?").charAt(0).toUpperCase();
    row.appendChild(fb);
  }

  const info = document.createElement("div");
  info.className = "admin-user-info";
  const name = document.createElement("div");
  name.className = "admin-user-name";
  name.textContent = user.display_name || user.username || "Usuario";
  if (user.is_founder) {
    const tag = document.createElement("span");
    tag.className = "admin-tag";
    tag.textContent = "Fundador";
    name.appendChild(tag);
  }
  const sub = document.createElement("div");
  sub.className = "admin-user-sub";
  sub.textContent = `${user.conversations} chats · ${user.documents} docs · ${user.discord_id || ""}`;
  info.append(name, sub);
  row.appendChild(info);

  const select = document.createElement("select");
  ["free", "pro", "enterprise"].forEach((plan) => {
    const opt = document.createElement("option");
    opt.value = plan;
    opt.textContent = plan;
    if (user.plan === plan) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", async () => {
    select.disabled = true;
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ plan: select.value }),
      });
    } catch (err) {
      renderError(err.message);
    } finally {
      select.disabled = false;
    }
  });
  row.appendChild(select);

  const del = document.createElement("button");
  del.className = "admin-del";
  del.title = "Eliminar usuario";
  del.textContent = "🗑";
  del.disabled = user.is_founder;
  del.addEventListener("click", async () => {
    if (!window.confirm(`¿Eliminar a ${user.display_name || user.username} y todos sus datos?`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
      row.remove();
    } catch (err) {
      renderError(err.message);
    }
  });
  row.appendChild(del);

  return row;
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */

ttsToggle.addEventListener("click", toggleTts);
micBtn.addEventListener("click", toggleDictation);
imageBtn.addEventListener("click", toggleImageMode);
kbBtn.addEventListener("click", openKb);
kbClose.addEventListener("click", closeKb);
kbSave.addEventListener("click", saveDocument);
kbModal.addEventListener("click", (event) => {
  if (event.target === kbModal) closeKb();
});

settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsSave.addEventListener("click", saveSettings);
deleteAccountBtn.addEventListener("click", deleteAccount);
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) closeSettings();
});

plansBtn.addEventListener("click", openPlans);
plansClose.addEventListener("click", closePlans);
plansModal.addEventListener("click", (event) => {
  if (event.target === plansModal) closePlans();
});

adminClose.addEventListener("click", closeAdmin);
adminModal.addEventListener("click", (event) => {
  if (event.target === adminModal) closeAdmin();
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

(async function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  captureTokenFromUrl();
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") === "error") {
    window.history.replaceState(null, "", window.location.pathname);
    setTimeout(() => renderError("El inicio de sesión fue cancelado."), 300);
  }
  applyTtsState();
  updateSendState();
  updatePlanBadge();
  autoResize();
  await loadProviders();
  if (authProvidersEl) renderLoginButtons(authProvidersEl, "auth-login");
  try {
    await loadSession();
  } finally {
    hideSplash();
  }
})();

window.addEventListener("load", () => setTimeout(hideSplash, 15000));
