/**
 * Core IA - Frontend
 * Sesión (Discord OAuth2 + correo), historial en servidor, ajustes,
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
const authFormEl = document.getElementById("auth-form");
const authNameEl = document.getElementById("auth-name");
const authEmailEl = document.getElementById("auth-email");
const authPasswordEl = document.getElementById("auth-password");
const authSubmitEl = document.getElementById("auth-submit");
const authErrorEl = document.getElementById("auth-error");
const authSwitchBtn = document.getElementById("auth-switch-btn");
const authSwitchText = document.getElementById("auth-switch-text");
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
const settingsDiscordAppId = document.getElementById("settings-discord-appid");
const settingsRpcDetails = document.getElementById("settings-rpc-details");
const settingsRpcState = document.getElementById("settings-rpc-state");
const settingsRpcStaff = document.getElementById("settings-rpc-staff");
const settingsRpcAdminDetails = document.getElementById("settings-rpc-admin-details");
const settingsRpcAdminState = document.getElementById("settings-rpc-admin-state");
const settingsRpcFounderDetails = document.getElementById("settings-rpc-founder-details");
const settingsRpcFounderState = document.getElementById("settings-rpc-founder-state");
const discordRpcStatus = document.getElementById("discord-rpc-status");

const plansModal = document.getElementById("plans-modal");
const plansClose = document.getElementById("plans-close");
const usageList = document.getElementById("usage-list");
const plansList = document.getElementById("plans-list");

const adminModal = document.getElementById("admin-modal");
const adminClose = document.getElementById("admin-close");
const adminStats = document.getElementById("admin-stats");
const adminUsers = document.getElementById("admin-users");
const adminChart = document.getElementById("admin-chart");
const adminFlags = document.getElementById("admin-flags");
const adminNotices = document.getElementById("admin-notices");
const adminAudit = document.getElementById("admin-audit");
const adminTabs = document.getElementById("admin-tabs");
const adminRefresh = document.getElementById("admin-refresh");
const adminUpdated = document.getElementById("admin-updated");
const adminUserSearch = document.getElementById("admin-user-search");
const adminUserPlan = document.getElementById("admin-user-plan");
const adminUserStatus = document.getElementById("admin-user-status");
const adminUserCount = document.getElementById("admin-user-count");
const adminAuditSearch = document.getElementById("admin-audit-search");
const adminAuditLimit = document.getElementById("admin-audit-limit");
const adminChartRange = document.getElementById("admin-chart-range");
const adminChartRangeSelect = document.getElementById("admin-chart-range-select");
const adminExportChart = document.getElementById("admin-export-chart");
const adminTopList = document.getElementById("admin-top-list");
const adminModelList = document.getElementById("admin-model-list");
const adminHealth = document.getElementById("admin-health");
const adminDocs = document.getElementById("admin-docs");
const aiSystemPrompt = document.getElementById("ai-system-prompt");
const aiDefaultModel = document.getElementById("ai-default-model");
const aiTemperature = document.getElementById("ai-temperature");
const aiBannedWords = document.getElementById("ai-banned-words");
const aiSave = document.getElementById("ai-save");
const adminExportCsv = document.getElementById("admin-export-csv");
const adminExportJson = document.getElementById("admin-export-json");
const adminUserModal = document.getElementById("admin-user-modal");
const adminUserDetail = document.getElementById("admin-user-detail");
const adminUserTitle = document.getElementById("admin-user-title");
const adminUserClose = document.getElementById("admin-user-close");
const noticeBanner = document.getElementById("notice-banner");
const noticeInput = document.getElementById("notice-input");
const noticeLevel = document.getElementById("notice-level");
const noticeCreate = document.getElementById("notice-create");

const accountSummary = document.getElementById("account-summary");
const emailStatusText = document.getElementById("email-status-text");
const emailResend = document.getElementById("email-resend");
const twofaStatusText = document.getElementById("twofa-status-text");
const twofaStart = document.getElementById("twofa-start");
const twofaDisable = document.getElementById("twofa-disable");
const twofaSetup = document.getElementById("twofa-setup");
const twofaQr = document.getElementById("twofa-qr");
const twofaSecret = document.getElementById("twofa-secret");
const twofaCode = document.getElementById("twofa-code");
const twofaEnable = document.getElementById("twofa-enable");
const twofaSetupError = document.getElementById("twofa-setup-error");
const twofaRecovery = document.getElementById("twofa-recovery");
const twofaRecoveryList = document.getElementById("twofa-recovery-list");
const twofaModal = document.getElementById("twofa-modal");
const twofaModalClose = document.getElementById("twofa-modal-close");
const twofaModalSub = document.getElementById("twofa-modal-sub");
const twofaLoginCode = document.getElementById("twofa-login-code");
const twofaLoginError = document.getElementById("twofa-login-error");
const twofaLoginSubmit = document.getElementById("twofa-login-submit");
const twofaLoginRecovery = document.getElementById("twofa-login-recovery");

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
let flags = { chat: true, image_generation: true, rag: true };
let twofaState = { enabled: false, pending: false, recovery_codes_remaining: 0 };
let pendingTwofaToken = null;
let adminData = { stats: null, users: [], notices: [], audit: [] };

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
};

function loginUrl(provider) {
  const returnTo = encodeURIComponent(window.location.origin + window.location.pathname);
  return `${BACKEND_URL}/api/auth/${provider}/login?return_to=${returnTo}`;
}

async function loadProviders() {
  try {
    const data = await api("/api/auth/providers");
    providers = (data.providers || []).filter((provider) => PROVIDER_META[provider]);
  } catch (_) {
    providers = [];
  }
  if (!providers.length) providers = ["discord"];
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

let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === "register";
  authNameEl.classList.toggle("hidden", !isRegister);
  authPasswordEl.setAttribute("autocomplete", isRegister ? "new-password" : "current-password");
  authSubmitEl.textContent = isRegister ? "Crear cuenta" : "Entrar";
  authSwitchText.textContent = isRegister ? "¿Ya tienes cuenta?" : "¿No tienes cuenta?";
  authSwitchBtn.textContent = isRegister ? "Iniciar sesión" : "Crear cuenta";
  authErrorEl.textContent = "";
}

async function submitEmailAuth(event) {
  event.preventDefault();
  authErrorEl.textContent = "";
  const email = authEmailEl.value.trim();
  const password = authPasswordEl.value;
  const name = authNameEl.value.trim();
  if (!email || !password) {
    authErrorEl.textContent = "Escribe tu correo y contraseña.";
    return;
  }
  if (authMode === "register" && password.length < 8) {
    authErrorEl.textContent = "La contraseña debe tener al menos 8 caracteres.";
    return;
  }

  const path = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
  const body = authMode === "register" ? { email, password, name: name || null } : { email, password };

  authSubmitEl.disabled = true;
  const previous = authSubmitEl.textContent;
  authSubmitEl.textContent = "Un momento...";
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || "No se pudo completar la operación.");
    }
    if (data.requires_2fa && data.pending_token) {
      authPasswordEl.value = "";
      hideAuthGate();
      openTwofaModal(data.pending_token);
      return;
    }
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    authPasswordEl.value = "";
    hideAuthGate();
    await loadSession();
  } catch (err) {
    authErrorEl.textContent = err.message;
  } finally {
    authSubmitEl.disabled = false;
    authSubmitEl.textContent = previous;
  }
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
  const pending = hash.match(/pending2fa=([^&]+)/);
  if (pending) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    showAuthGate();
    openTwofaModal(decodeURIComponent(pending[1]));
    return;
  }
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
    renderVerificationBanner();
    updateComposerForVerification();
    if (currentUser.must_enable_2fa) {
      showToast("Activa la verificación en dos pasos para continuar usando Core IA.");
      openSettings();
    }
  } catch (err) {
    clearSession();
    renderChat();
  }
}

/* ------------------------------------------------------------------ */
/* Configuración pública (feature flags) y avisos                      */
/* ------------------------------------------------------------------ */

async function loadConfig() {
  try {
    const data = await api("/api/config");
    flags = { ...flags, ...(data.flags || {}) };
  } catch (_) {
    /* mantener valores por defecto */
  }
  applyFlags();
}

function applyFlags() {
  if (imageBtn) imageBtn.classList.toggle("hidden-flag", flags.image_generation === false);
  if (kbBtn) kbBtn.classList.toggle("hidden-flag", flags.rag === false);
  if (inputEl && flags.chat === false) {
    inputEl.placeholder = "El chat está desactivado temporalmente.";
    inputEl.disabled = true;
  } else if (inputEl) {
    inputEl.disabled = founder2faBlocked();
    inputEl.placeholder = founder2faBlocked()
      ? "Activa la verificación en dos pasos para continuar."
      : "Escribe un mensaje a Core IA...";
  }
  updateSendState();
  updateComposerForVerification();
}

async function loadNotices() {
  try {
    const data = await api("/api/notices");
    renderNotices(data.notices || []);
  } catch (_) {
    /* silencioso */
  }
}

function renderNotices(notices) {
  if (!noticeBanner) return;
  const dismissed = JSON.parse(localStorage.getItem("coreia_notices") || "[]");
  const notice = notices.find((item) => !dismissed.includes(item.id));
  if (!notice) {
    noticeBanner.classList.remove("show");
    noticeBanner.innerHTML = "";
    return;
  }
  noticeBanner.className = `notice-banner show level-${notice.level || "info"}`;
  noticeBanner.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = "notice-dot";
  const text = document.createElement("span");
  text.className = "notice-text";
  text.textContent = notice.message;
  const close = document.createElement("button");
  close.className = "notice-close";
  close.type = "button";
  close.setAttribute("aria-label", "Cerrar aviso");
  close.textContent = "✕";
  close.addEventListener("click", () => {
    const current = JSON.parse(localStorage.getItem("coreia_notices") || "[]");
    current.push(notice.id);
    localStorage.setItem("coreia_notices", JSON.stringify(current.slice(-20)));
    noticeBanner.classList.remove("show");
  });
  noticeBanner.append(dot, text, close);
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

function appendCodeAndFormat(parent, text) {
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

function appendInline(parent, text) {
  if (!window.katex || !text.includes("$")) {
    appendCodeAndFormat(parent, text);
    return;
  }
  const re = /\$\$([^$]+)\$\$|\$([^$]+)\$/g;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) appendCodeAndFormat(parent, text.slice(last, match.index));
    const expr = match[1] !== undefined ? match[1] : match[2];
    const span = document.createElement("span");
    try {
      window.katex.render(expr, span, { throwOnError: false, display: match[1] !== undefined });
    } catch (_) {
      span.textContent = match[0];
    }
    parent.appendChild(span);
    last = re.lastIndex;
  }
  if (last < text.length) appendCodeAndFormat(parent, text.slice(last));
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

function isTableRow(line) {
  return line.includes("|") && line.trim().length > 0;
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function buildTable(header, rows) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  header.forEach((cell) => {
    const th = document.createElement("th");
    appendInline(th, cell);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((cells) => {
    const tr = document.createElement("tr");
    cells.forEach((cell) => {
      const td = document.createElement("td");
      appendInline(td, cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
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

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (isTableRow(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushPara();
      flushList();
      const header = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index]) && !isTableSeparator(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      block.appendChild(buildTable(header, rows));
      continue;
    }

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
    } else if (ul) {
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
    } else if (ol) {
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
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
    index += 1;
  }

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
  updateComposerForVerification();

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
      notifyReply(reply);
      await loadConversations();
      loadUsage();
    }
  } catch (err) {
    removeTyping();
    renderError(err.message);
  } finally {
    sending = false;
    updateSendState();
  updateComposerForVerification();
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

function showToast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 3400);
}

/* ------------------------------------------------------------------ */
/* Composer / UI                                                       */
/* ------------------------------------------------------------------ */

function founder2faBlocked() {
  return Boolean(currentUser && currentUser.must_enable_2fa);
}
function renderVerificationBanner() {
  let banner = document.getElementById("verify-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "verify-banner";
    banner.className = "verify-banner";
    banner.innerHTML = '<div class="verify-content"><span>Confirma tu correo electrónico para usar Core IA.</span><button class="verify-btn" type="button">Reenviar verificación</button></div>';
    document.body.appendChild(banner);
    const btn = banner.querySelector(".verify-btn");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api("/api/auth/email/resend", { method: "POST" });
          showToast("Correo de verificación reenviado.");
        } catch (err) {
          renderError(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    }
  }
  const needs = currentUser && currentUser.email && !currentUser.email_verified;
  banner.classList.toggle("show", Boolean(needs));
}

function updateComposerForVerification() {
  if (inputEl && sendEl) {
    const blocked = currentUser && currentUser.email && !currentUser.email_verified;
    inputEl.disabled = blocked || inputEl.disabled;
    sendEl.disabled = blocked || sendEl.disabled;
  }
}


function updateSendState() {
  sendEl.disabled =
    sending || inputEl.disabled || founder2faBlocked() || inputEl.value.trim().length === 0;
}

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  if (flags.chat === false) {
    renderError("El chat está desactivado temporalmente por el administrador.");
    return;
  }
  if (founder2faBlocked()) {
    renderError("Activa la verificación en dos pasos para continuar.");
    openSettings();
    return;
  }
  const text = inputEl.value.trim();
  if (!text || sending) return;
  inputEl.value = "";
  autoResize();
  updateSendState();
  updateComposerForVerification();
  sendMessage(text);
});

inputEl.addEventListener("input", () => {
  autoResize();
  updateSendState();
  updateComposerForVerification();
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
  updateComposerForVerification();
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
  updateComposerForVerification();
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
  if (flags.image_generation === false) {
    renderError("La generación de imágenes está desactivada por el administrador.");
    return;
  }
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

/* Discord Rich Presence: la configuración de presencia vive en el dispositivo. */
const RPC_PRESENCE_KEY = "coreia_rpc_presence";

function readRpcPresence() {
  try {
    const raw = localStorage.getItem(RPC_PRESENCE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function isStaffUser() {
  return !!(currentUser && (currentUser.is_admin || currentUser.is_founder));
}

function renderDiscordRpcSettings() {
  if (!settingsDiscordAppId) return;
  settingsRpcStaff.hidden = !isStaffUser();
  settingsDiscordAppId.value =
    (window.coreiaPresence && window.coreiaPresence.appId && window.coreiaPresence.appId()) || "";
  const custom = readRpcPresence();
  settingsRpcDetails.value = custom.userDetails || "";
  settingsRpcState.value = custom.userState || "";
  settingsRpcAdminDetails.value = custom.adminDetails || "";
  settingsRpcAdminState.value = custom.adminState || "";
  settingsRpcFounderDetails.value = custom.founderDetails || "";
  settingsRpcFounderState.value = custom.founderState || "";

  if (discordRpcStatus) {
    const available =
      window.coreiaPresence && typeof window.coreiaPresence.available === "function"
        ? window.coreiaPresence.available()
        : false;
    if (!available) {
      discordRpcStatus.textContent =
        "La presencia en Discord funciona en la app de Android con la aplicación de Discord instalada.";
    } else {
      const status =
        typeof window.coreiaPresence.status === "function" ? window.coreiaPresence.status() : "";
      discordRpcStatus.textContent = settingsDiscordAppId.value
        ? `Discord listo. Estado: ${status || "sin inicializar"}.`
        : "Discord disponible. Introduce tu Application ID y guarda para activar la presencia.";
    }
  }
}

window.coreiaRefreshRpcStatus = function () {
  if (settingsModal && settingsModal.classList.contains("show")) {
    renderDiscordRpcSettings();
  }
};

function saveDiscordRpcSettings() {
  if (!window.coreiaPresence) return;
  const staff = isStaffUser();
  const custom = {};
  if (settingsRpcDetails.value.trim()) custom.userDetails = settingsRpcDetails.value.trim();
  if (settingsRpcState.value.trim()) custom.userState = settingsRpcState.value.trim();
  if (staff) {
    if (settingsRpcAdminDetails.value.trim()) custom.adminDetails = settingsRpcAdminDetails.value.trim();
    if (settingsRpcAdminState.value.trim()) custom.adminState = settingsRpcAdminState.value.trim();
    if (settingsRpcFounderDetails.value.trim()) custom.founderDetails = settingsRpcFounderDetails.value.trim();
    if (settingsRpcFounderState.value.trim()) custom.founderState = settingsRpcFounderState.value.trim();
  }
  window.coreiaPresence.setAppId(settingsDiscordAppId.value.trim());
  window.coreiaPresence.setCustom(Object.keys(custom).length ? custom : null);
}

function openSettings() {
  if (!currentUser) {
    renderError("Inicia sesión para configurar tu cuenta.");
    return;
  }
  settingsTheme.value = settings.theme || "dark";
  settingsModel.value = settings.preferred_model || "";
  settingsRag.checked = settings.use_rag !== false;
  renderAccountSummary();
  renderEmailStatus();
  renderTwofaStatus();
  renderDiscordRpcSettings();
  settingsModal.classList.add("show");
  loadTwofaStatus();
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
    saveDiscordRpcSettings();
    closeSettings();
  } catch (err) {
    renderError(err.message);
  } finally {
    settingsSave.disabled = false;
    settingsSave.textContent = "Guardar cambios";
  }
}

async function deleteAccount() {
  if (!window.confirm("Esto borrará tu cuenta y todos los datos. ¿Continuar?")) return;
  try {
    await api("/api/account", { method: "DELETE" });
    closeSettings();
    clearSession();
  } catch (err) {
    renderError(err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Seguridad: verificación de correo y 2FA                             */
/* ------------------------------------------------------------------ */

function accountFallbackAvatar() {
  const fb = document.createElement("div");
  fb.className = "fallback-avatar";
  const label = currentUser.display_name || currentUser.username || "?";
  fb.textContent = label.charAt(0).toUpperCase();
  return fb;
}

function renderAccountSummary() {
  if (!accountSummary || !currentUser) return;
  accountSummary.innerHTML = "";
  if (currentUser.avatar_url) {
    const img = document.createElement("img");
    img.src = currentUser.avatar_url;
    img.alt = "";
    img.addEventListener("error", () => img.replaceWith(accountFallbackAvatar()));
    accountSummary.appendChild(img);
  } else {
    accountSummary.appendChild(accountFallbackAvatar());
  }
  const info = document.createElement("div");
  const name = document.createElement("div");
  name.className = "account-name";
  name.textContent = currentUser.display_name || currentUser.username || "Usuario";
  const mail = document.createElement("div");
  mail.className = "account-mail";
  mail.textContent = currentUser.email || "Sin correo asociado";
  info.append(name, mail);
  accountSummary.appendChild(info);
}

function renderEmailStatus() {
  if (!emailStatusText || !currentUser) return;
  const verified = currentUser.provider === "discord" || currentUser.email_verified === true;
  if (verified) {
    emailStatusText.textContent = currentUser.email
      ? `${currentUser.email} · Verificado`
      : "Correo verificado";
    if (emailResend) emailResend.classList.add("hidden");
    return;
  }
  emailStatusText.textContent = currentUser.email
    ? `${currentUser.email} · Sin verificar`
    : "Sin correo asociado";
  if (emailResend) emailResend.classList.toggle("hidden", !currentUser.email);
}

function renderTwofaStatus() {
  if (!twofaStatusText) return;
  if (twofaState.enabled) {
    const remaining = twofaState.recovery_codes_remaining || 0;
    twofaStatusText.textContent = `Activada. Se pedirá un código al iniciar sesión (${remaining} códigos de respaldo).`;
    if (twofaStart) twofaStart.classList.add("hidden");
    if (twofaDisable) twofaDisable.classList.remove("hidden");
  } else {
    twofaStatusText.textContent = "Desactivada. Añade una capa extra de seguridad a tu cuenta.";
    if (twofaStart) twofaStart.classList.remove("hidden");
    if (twofaDisable) twofaDisable.classList.add("hidden");
  }
}

async function loadTwofaStatus() {
  if (!currentUser) return;
  try {
    twofaState = await api("/api/auth/2fa/status");
  } catch (_) {
    twofaState = { enabled: false, pending: false, recovery_codes_remaining: 0 };
  }
  renderTwofaStatus();
}

async function startTwofaSetup() {
  if (!currentUser) return;
  twofaStart.disabled = true;
  try {
    const data = await api("/api/auth/2fa/setup", { method: "POST" });
    twofaQr.innerHTML = data.qr_svg || "";
    twofaSecret.textContent = data.secret || "";
    twofaCode.value = "";
    twofaSetupError.textContent = "";
    twofaRecovery.classList.add("hidden");
    twofaSetup.classList.remove("hidden");
    twofaCode.focus();
  } catch (err) {
    showToast(err.message);
  } finally {
    twofaStart.disabled = false;
  }
}

function showRecoveryCodes(codes) {
  twofaRecoveryList.innerHTML = "";
  codes.forEach((code) => {
    const li = document.createElement("li");
    li.textContent = code;
    twofaRecoveryList.appendChild(li);
  });
  twofaRecovery.classList.remove("hidden");
}

async function enableTwofa() {
  const code = twofaCode.value.trim();
  if (code.length < 6) {
    twofaSetupError.textContent = "Introduce el código de 6 dígitos.";
    return;
  }
  twofaEnable.disabled = true;
  twofaEnable.textContent = "Verificando...";
  try {
    const data = await api("/api/auth/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    const codes = data.recovery_codes || [];
    twofaState = { enabled: true, pending: false, recovery_codes_remaining: codes.length };
    if (currentUser) currentUser.must_enable_2fa = false;
    renderTwofaStatus();
    twofaSetup.classList.add("hidden");
    showRecoveryCodes(codes);
    applyFlags();
    showToast("Autenticación en dos pasos activada.");
  } catch (err) {
    twofaSetupError.textContent = err.message;
  } finally {
    twofaEnable.disabled = false;
    twofaEnable.textContent = "Confirmar";
  }
}

async function disableTwofa() {
  const code = window.prompt(
    "Introduce un código de tu app de autenticación (o un código de respaldo) para desactivar la 2FA:"
  );
  if (code === null) return;
  try {
    await api("/api/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ code: code.trim() }),
    });
    twofaState = { enabled: false, pending: false, recovery_codes_remaining: 0 };
    renderTwofaStatus();
    twofaSetup.classList.add("hidden");
    twofaRecovery.classList.add("hidden");
    showToast("Autenticación en dos pasos desactivada.");
  } catch (err) {
    showToast(err.message);
  }
}

async function resendEmailVerification() {
  if (!emailResend) return;
  emailResend.disabled = true;
  const previous = emailResend.textContent;
  emailResend.textContent = "Enviando...";
  try {
    const data = await api("/api/auth/email/resend", { method: "POST" });
    showToast(
      data.sent
        ? "Te enviamos un correo de confirmación. Revisa tu bandeja de entrada."
        : "No se pudo enviar el correo (el servidor no tiene configurado el envío de correos)."
    );
  } catch (err) {
    showToast(err.message);
  } finally {
    emailResend.disabled = false;
    emailResend.textContent = previous;
  }
}

function openTwofaModal(pendingToken) {
  pendingTwofaToken = pendingToken;
  twofaLoginCode.value = "";
  twofaLoginCode.dataset.mode = "totp";
  twofaLoginCode.maxLength = 6;
  twofaLoginError.textContent = "";
  twofaModalSub.textContent = "Introduce el código de 6 dígitos de tu app de autenticación.";
  twofaModal.classList.add("show");
  setTimeout(() => twofaLoginCode.focus(), 60);
}

function closeTwofaModal() {
  twofaModal.classList.remove("show");
  pendingTwofaToken = null;
  showAuthGate();
}

function toggleTwofaRecoveryMode() {
  const recovery = twofaLoginCode.dataset.mode !== "recovery";
  twofaLoginCode.dataset.mode = recovery ? "recovery" : "totp";
  twofaLoginCode.value = "";
  twofaLoginError.textContent = "";
  if (recovery) {
    twofaLoginCode.maxLength = 11;
    twofaModalSub.textContent = "Introduce uno de tus códigos de respaldo (formato XXXXX-XXXXX).";
  } else {
    twofaLoginCode.maxLength = 6;
    twofaModalSub.textContent = "Introduce el código de 6 dígitos de tu app de autenticación.";
  }
  twofaLoginCode.focus();
}

async function submitTwofaCode() {
  if (!pendingTwofaToken) {
    closeTwofaModal();
    return;
  }
  const code = twofaLoginCode.value.trim();
  if (code.length < 6) {
    twofaLoginError.textContent = "Escribe el código completo.";
    return;
  }
  twofaLoginSubmit.disabled = true;
  twofaLoginSubmit.textContent = "Verificando...";
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/2fa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pending_token: pendingTwofaToken, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "No se pudo verificar el código.");
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    pendingTwofaToken = null;
    twofaModal.classList.remove("show");
    hideAuthGate();
    await loadSession();
  } catch (err) {
    twofaLoginError.textContent = err.message;
  } finally {
    twofaLoginSubmit.disabled = false;
    twofaLoginSubmit.textContent = "Verificar";
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

const ADMIN_TABS = ["overview", "users", "ai", "flags", "notices", "audit"];

async function openAdmin() {
  if (!currentUser || !currentUser.is_admin) {
    renderError("Acceso reservado al fundador.");
    return;
  }
  adminModal.classList.add("show");
  await loadAdmin();
}

function setAdminLoading(loading) {
  if (adminRefresh) {
    adminRefresh.disabled = loading;
    adminRefresh.textContent = loading ? "Cargando…" : "↻ Actualizar";
  }
  adminModal.querySelectorAll(".admin-pane").forEach((pane) => {
    pane.classList.toggle("loading", loading);
  });
}

function adminStatsRange() {
  return adminChartRangeSelect ? adminChartRangeSelect.value : "14";
}

async function loadAdmin() {
  setAdminLoading(true);
  try {
    const [statsData, usersData, flagsData, noticesData, auditData, healthData, settingsData, docsData] =
      await Promise.all([
        api(`/api/admin/stats?range=${encodeURIComponent(adminStatsRange())}`),
        api("/api/admin/users"),
        api("/api/admin/flags"),
        api("/api/admin/notices"),
        api(`/api/admin/audit?limit=${encodeURIComponent(adminAuditLimit.value || "50")}`),
        api("/api/admin/health"),
        api("/api/admin/settings"),
        api("/api/admin/documents"),
      ]);
    adminData.stats = statsData;
    adminData.users = usersData.users || [];
    adminData.notices = noticesData.notices || [];
    adminData.audit = auditData.logs || [];
    renderAdminStats(statsData);
    renderAdminChart(statsData.series || []);
    renderAdminTopUsers(statsData.top_users || []);
    renderAdminModels(statsData.model_breakdown || {});
    renderAdminUsers(adminData.users);
    renderAdminFlags(flagsData.flags || []);
    renderAdminNotices(adminData.notices);
    renderAdminAudit(adminData.audit);
    renderAdminHealth(healthData);
    renderAdminSettings(settingsData.settings || {});
    renderAdminDocs(docsData.documents || []);
    if (adminUpdated) {
      const now = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      adminUpdated.textContent = `Actualizado a las ${now}`;
    }
  } catch (err) {
    renderError(err.message);
  } finally {
    setAdminLoading(false);
  }
}

async function refreshAudit() {
  try {
    const data = await api(`/api/admin/audit?limit=${encodeURIComponent(adminAuditLimit.value || "50")}`);
    renderAdminAudit(data.logs || []);
  } catch (err) {
    renderError(err.message);
  }
}

function closeAdmin() {
  adminModal.classList.remove("show");
}

function switchAdminTab(tab) {
  if (!ADMIN_TABS.includes(tab)) return;
  adminTabs.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  adminModal.querySelectorAll(".admin-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.pane === tab);
  });
}

function renderAdminChart(series) {
  adminChart.innerHTML = "";
  if (adminChartRange) adminChartRange.textContent = "";
  if (!series.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "Sin datos de uso todavía.";
    adminChart.appendChild(empty);
    return;
  }
  const max = Math.max(...series.map((point) => point.messages + point.images), 1);
  series.forEach((point) => {
    const total = point.messages + point.images;
    const wrap = document.createElement("div");
    wrap.className = "bar-wrap";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${total ? Math.max((total / max) * 100, 4) : 0}%`;
    bar.title = `${point.day}: ${point.messages} mensajes, ${point.images} imágenes`;
    if (total > 0) {
      const images = document.createElement("div");
      images.className = "bar-seg images";
      images.style.height = `${(point.images / total) * 100}%`;
      const msgs = document.createElement("div");
      msgs.className = "bar-seg messages";
      msgs.style.height = `${(point.messages / total) * 100}%`;
      bar.append(images, msgs);
    }
    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = point.day ? point.day.slice(5) : "";
    wrap.append(bar, label);
    adminChart.appendChild(wrap);
  });
  if (adminChartRange) {
    adminChartRange.textContent = `${series[0].day} → ${series[series.length - 1].day}`;
  }
}

function renderAdminFlags(list) {
  adminFlags.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "modal-sub";
    empty.textContent = "No hay funciones configurables.";
    adminFlags.appendChild(empty);
    return;
  }
  list.forEach((flag) => {
    const row = document.createElement("div");
    row.className = "admin-flag";

    const info = document.createElement("div");
    info.className = "flag-info";
    const key = document.createElement("div");
    key.className = "flag-key";
    key.textContent = flag.key;
    const desc = document.createElement("div");
    desc.className = "flag-desc";
    desc.textContent = flag.description || "";
    info.append(key, desc);

    const toggle = document.createElement("label");
    toggle.className = "switch";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = flag.enabled !== false;
    const slider = document.createElement("span");
    slider.className = "slider";
    checkbox.addEventListener("change", async () => {
      checkbox.disabled = true;
      try {
        await api(`/api/admin/flags/${encodeURIComponent(flag.key)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: checkbox.checked }),
        });
        flags[flag.key] = checkbox.checked;
        applyFlags();
        showToast(`Función "${flag.key}" ${checkbox.checked ? "activada" : "desactivada"}.`);
      } catch (err) {
        checkbox.checked = !checkbox.checked;
        renderError(err.message);
      } finally {
        checkbox.disabled = false;
      }
    });
    toggle.append(checkbox, slider);

    row.append(info, toggle);
    adminFlags.appendChild(row);
  });
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return value;
  }
}

const NOTICE_LEVELS = { info: "Información", warning: "Aviso", success: "Novedad" };

function adminTag(text, kind) {
  const tag = document.createElement("span");
  tag.className = `admin-tag ${kind || ""}`.trim();
  tag.textContent = text;
  return tag;
}

function renderAdminNotices(list) {
  adminNotices.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "modal-sub";
    empty.textContent = "No hay avisos publicados.";
    adminNotices.appendChild(empty);
    return;
  }
  list.forEach((notice) => adminNotices.appendChild(adminNoticeRow(notice)));
}

function adminNoticeRow(notice) {
  const row = document.createElement("div");
  row.className = "admin-notice";

  const body = document.createElement("div");
  body.className = "notice-body";

  const head = document.createElement("div");
  head.className = "notice-head";
  head.appendChild(adminTag(NOTICE_LEVELS[notice.level] || notice.level, notice.level));
  if (!notice.active) head.appendChild(adminTag("Oculto", "muted"));

  const message = document.createElement("div");
  message.className = "notice-message";
  message.textContent = notice.message;

  const meta = document.createElement("div");
  meta.className = "notice-meta";
  meta.textContent = formatDate(notice.created_at);
  body.append(head, message, meta);

  const actions = document.createElement("div");
  actions.className = "notice-actions";

  const toggle = document.createElement("label");
  toggle.className = "switch";
  toggle.title = notice.active ? "Visible para todos" : "Oculto";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = notice.active !== false;
  const slider = document.createElement("span");
  slider.className = "slider";
  checkbox.addEventListener("change", async () => {
    checkbox.disabled = true;
    try {
      const data = await api(`/api/admin/notices/${notice.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: checkbox.checked }),
      });
      notice.active = data.notice.active;
      row.replaceWith(adminNoticeRow(notice));
      showToast(notice.active ? "Aviso visible para todos." : "Aviso oculto.");
    } catch (err) {
      checkbox.checked = !checkbox.checked;
      renderError(err.message);
    } finally {
      checkbox.disabled = false;
    }
  });
  toggle.append(checkbox, slider);

  const edit = document.createElement("button");
  edit.className = "admin-mini";
  edit.type = "button";
  edit.textContent = "Editar";
  edit.addEventListener("click", () => startNoticeEdit(row, notice, message, actions));

  const del = document.createElement("button");
  del.className = "admin-mini danger";
  del.type = "button";
  del.textContent = "Eliminar";
  del.addEventListener("click", async () => {
    if (!window.confirm("¿Eliminar este aviso?")) return;
    try {
      await api(`/api/admin/notices/${notice.id}`, { method: "DELETE" });
      row.remove();
      showToast("Aviso eliminado.");
    } catch (err) {
      renderError(err.message);
    }
  });

  actions.append(toggle, edit, del);
  row.append(body, actions);
  return row;
}

function startNoticeEdit(row, notice, messageEl, actions) {
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 500;
  input.value = notice.message;
  input.className = "notice-edit-input";
  messageEl.replaceWith(input);
  input.focus();

  const save = document.createElement("button");
  save.className = "admin-mini";
  save.type = "button";
  save.textContent = "Guardar";
  const cancel = document.createElement("button");
  cancel.className = "admin-mini";
  cancel.type = "button";
  cancel.textContent = "Cancelar";
  cancel.addEventListener("click", () => row.replaceWith(adminNoticeRow(notice)));
  save.addEventListener("click", async () => {
    const value = input.value.trim();
    if (!value) {
      renderError("El aviso no puede estar vacío.");
      return;
    }
    save.disabled = true;
    try {
      const data = await api(`/api/admin/notices/${notice.id}`, {
        method: "PATCH",
        body: JSON.stringify({ message: value }),
      });
      notice.message = data.notice.message;
      row.replaceWith(adminNoticeRow(notice));
      showToast("Aviso actualizado.");
    } catch (err) {
      save.disabled = false;
      renderError(err.message);
    }
  });
  actions.replaceChildren(save, cancel);
}

const AUDIT_LABELS = {
  "user.update": "Usuario modificado",
  "user.delete": "Usuario eliminado",
  "flag.update": "Función actualizada",
  "notice.create": "Aviso publicado",
  "notice.update": "Aviso actualizado",
  "notice.delete": "Aviso eliminado",
};
const AUDIT_KINDS = {
  "user.update": "warn",
  "user.delete": "danger",
  "flag.update": "info",
  "notice.create": "ok",
  "notice.update": "info",
  "notice.delete": "danger",
};

function renderAdminAudit(list) {
  adminData.audit = list;
  applyAuditFilter();
}

function applyAuditFilter() {
  const term = (adminAuditSearch.value || "").trim().toLowerCase();
  const rows = adminData.audit.filter((entry) => {
    if (!term) return true;
    const hay = [entry.action, AUDIT_LABELS[entry.action] || "", entry.actor, entry.detail, entry.target]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(term);
  });
  adminAudit.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "modal-sub";
    empty.textContent = adminData.audit.length ? "Ningún registro coincide." : "Sin actividad registrada.";
    adminAudit.appendChild(empty);
    return;
  }
  rows.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "admin-audit-row";
    const action = document.createElement("span");
    action.className = `audit-action ${AUDIT_KINDS[entry.action] || ""}`.trim();
    action.textContent = AUDIT_LABELS[entry.action] || entry.action;
    const detail = document.createElement("span");
    detail.className = "audit-detail";
    detail.textContent = [entry.actor, entry.detail, entry.target ? `#${entry.target}` : ""]
      .filter(Boolean)
      .join(" · ");
    const time = document.createElement("span");
    time.className = "audit-time";
    time.textContent = formatDate(entry.created_at);
    row.append(action, detail, time);
    adminAudit.appendChild(row);
  });
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
  adminStats.appendChild(adminStat(stats.dau ?? stats.active_today ?? 0, "DAU"));
  adminStats.appendChild(adminStat(stats.mau ?? 0, "MAU (30d)"));
  adminStats.appendChild(adminStat(stats.messages_today, "Mensajes hoy"));
  adminStats.appendChild(adminStat(stats.images_today ?? 0, "Imágenes hoy"));
  adminStats.appendChild(adminStat(stats.banned || 0, "Baneados"));
  adminStats.appendChild(adminStat(stats.suspended || 0, "Suspendidos"));
  const plans = stats.plan_breakdown || {};
  const summary = ["free", "pro", "enterprise"]
    .filter((plan) => plans[plan])
    .map((plan) => `${plans[plan]} ${plan}`)
    .join(" · ");
  adminStats.appendChild(adminStat(summary || "—", "Planes"));
}

function adminListEmpty(container, text) {
  container.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "modal-sub";
  empty.textContent = text;
  container.appendChild(empty);
}

function renderAdminTopUsers(top) {
  if (!adminTopList) return;
  if (!top.length) {
    adminListEmpty(adminTopList, "Sin actividad en el periodo.");
    return;
  }
  adminTopList.innerHTML = "";
  top.forEach((user) => {
    const item = document.createElement("div");
    item.className = "admin-list-item";
    const title = document.createElement("span");
    title.className = "admin-list-title";
    title.textContent = user.name;
    title.style.cursor = "pointer";
    title.addEventListener("click", () => openAdminUser(user.id));
    const meta = document.createElement("span");
    meta.className = "admin-list-meta";
    meta.textContent = `${user.messages} mensajes`;
    item.append(title, meta);
    adminTopList.appendChild(item);
  });
}

function renderAdminModels(breakdown) {
  if (!adminModelList) return;
  const entries = Object.entries(breakdown || {});
  if (!entries.length) {
    adminListEmpty(adminModelList, "Sin preferencias registradas.");
    return;
  }
  adminModelList.innerHTML = "";
  entries
    .sort((a, b) => b[1] - a[1])
    .forEach(([model, count]) => {
      const item = document.createElement("div");
      item.className = "admin-list-item";
      const title = document.createElement("span");
      title.className = "admin-list-title";
      title.textContent = model;
      const meta = document.createElement("span");
      meta.className = "admin-list-meta";
      meta.textContent = `${count} usuarios`;
      item.append(title, meta);
      adminModelList.appendChild(item);
    });
}

function renderAdminHealth(health) {
  if (!adminHealth) return;
  adminHealth.innerHTML = "";
  const rows = [
    ["Versión", health.version],
    ["Entorno", health.environment],
    ["Uptime", `${Math.round((health.uptime_seconds || 0) / 60)} min`],
    ["Base de datos", health.database === "ok" ? "OK" : "Error"],
    ["Caché/Redis", health.redis ? "Activa" : "No"],
    ["Gemini", health.gemini ? "Configurado" : "Sin configurar"],
    ["Relevo de correo", health.email_relay ? "Configurado" : "No"],
    ["2FA fundador", health.founder_2fa_required ? "Obligatoria" : "Opcional"],
  ];
  rows.forEach(([key, value]) => adminKvRow(adminHealth, key, value));
}

function renderAdminSettings(settings) {
  if (aiSystemPrompt) aiSystemPrompt.value = settings.system_prompt || "";
  if (aiDefaultModel) aiDefaultModel.value = settings.default_model || "";
  if (aiTemperature) aiTemperature.value = settings.temperature || "";
  if (aiBannedWords) aiBannedWords.value = settings.banned_words || "";
}

function renderAdminDocs(documents) {
  if (!adminDocs) return;
  if (!documents.length) {
    adminListEmpty(adminDocs, "No hay documentos en la base RAG.");
    return;
  }
  adminDocs.innerHTML = "";
  documents.forEach((doc) => {
    const item = document.createElement("div");
    item.className = "admin-list-item";
    const title = document.createElement("span");
    title.className = "admin-list-title";
    title.textContent = doc.title || "Documento";
    const meta = document.createElement("span");
    meta.className = "admin-list-meta";
    meta.textContent = `${doc.owner} · ${doc.chunks} frag.`;
    const remove = adminMiniButton("Eliminar", async () => {
      if (!window.confirm("¿Eliminar este documento de la base RAG?")) return;
      try {
        await api(`/api/admin/documents/${doc.id}`, { method: "DELETE" });
        item.remove();
        showToast("Documento eliminado.");
      } catch (err) {
        renderError(err.message);
      }
    }, true);
    item.append(title, meta, remove);
    adminDocs.appendChild(item);
  });
}

async function refreshAdminStats() {
  try {
    const stats = await api(`/api/admin/stats?range=${encodeURIComponent(adminStatsRange())}`);
    adminData.stats = stats;
    renderAdminStats(stats);
    renderAdminChart(stats.series || []);
    renderAdminTopUsers(stats.top_users || []);
    renderAdminModels(stats.model_breakdown || {});
  } catch (err) {
    renderError(err.message);
  }
}

function exportAdminChartImage() {
  const series = (adminData.stats && adminData.stats.series) || [];
  if (!series.length) {
    renderError("No hay datos para exportar.");
    return;
  }
  const width = 760;
  const height = 380;
  const pad = 44;
  const axisH = 34;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1e1e1e";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "600 16px sans-serif";
  ctx.fillText("Core IA · actividad diaria", pad, 28);
  const max = Math.max(...series.map((s) => (s.messages || 0) + (s.images || 0)), 1);
  const chartH = height - pad - axisH;
  const slot = (width - pad * 2) / series.length;
  const barW = Math.min(slot * 0.7, 34);
  series.forEach((s, i) => {
    const x = pad + i * slot + (slot - barW) / 2;
    const hMessages = ((s.messages || 0) / max) * chartH;
    const hImages = ((s.images || 0) / max) * chartH;
    const baseY = height - axisH;
    ctx.fillStyle = "#8ab4f8";
    ctx.fillRect(x, baseY - hMessages, barW, hMessages);
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(x, baseY - hMessages - hImages, barW, hImages);
  });
  ctx.fillStyle = "#8e8e8e";
  ctx.font = "12px sans-serif";
  ctx.fillText(series[0].day, pad, height - 12);
  const lastDay = series[series.length - 1].day;
  ctx.fillText(lastDay, width - pad - ctx.measureText(lastDay).width, height - 12);
  ctx.fillText(String(max), 6, pad);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "coreia-actividad.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function renderAdminUsers(users) {
  adminData.users = users;
  applyUserFilters();
}

function applyUserFilters() {
  const term = (adminUserSearch.value || "").trim().toLowerCase();
  const plan = adminUserPlan.value;
  const status = adminUserStatus.value;
  const filtered = adminData.users.filter((user) => {
    if (plan && (user.plan || "free") !== plan) return false;
    if (status === "active" && (user.is_banned || user.is_active === false)) return false;
    if (status === "suspended" && user.is_active !== false) return false;
    if (status === "banned" && !user.is_banned) return false;
    if (status === "unverified" && user.email_verified) return false;
    if (status === "twofa" && !user.totp_enabled) return false;
    if (term) {
      const hay = [user.display_name, user.username, user.email, user.discord_id, user.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
  adminUsers.innerHTML = "";
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "modal-sub";
    empty.textContent = adminData.users.length
      ? "Ningún usuario coincide con el filtro."
      : "Todavía no hay usuarios.";
    adminUsers.appendChild(empty);
  } else {
    filtered.forEach((user) => adminUsers.appendChild(adminUserRow(user)));
  }
  if (adminUserCount) {
    adminUserCount.textContent = `${filtered.length} de ${adminData.users.length}`;
  }
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

  const tags = document.createElement("span");
  tags.className = "admin-tags";
  if (user.is_founder) tags.appendChild(adminTag("Fundador", "founder"));
  if (user.plan && user.plan !== "free") tags.appendChild(adminTag(user.plan, `plan-${user.plan}`));
  if (user.is_banned) tags.appendChild(adminTag("Baneado", "banned"));
  else if (user.is_active === false) tags.appendChild(adminTag("Suspendido", "suspended"));
  if (user.email && !user.email_verified) tags.appendChild(adminTag("Correo sin verificar", "warn"));
  if (user.totp_enabled) tags.appendChild(adminTag("2FA", "ok"));
  name.appendChild(tags);

  const sub = document.createElement("div");
  sub.className = "admin-user-sub";
  const bits = [];
  if (user.email) bits.push(user.email);
  else if (user.discord_id) bits.push(`Discord ${user.discord_id}`);
  bits.push(`${user.conversations} chats`, `${user.documents} docs`);
  if (user.created_at) bits.push(`alta ${formatDate(user.created_at)}`);
  sub.textContent = bits.join(" · ");
  info.append(name, sub);
  row.appendChild(info);

  const select = document.createElement("select");
  select.className = "plan-select";
  select.title = "Plan del usuario";
  ["free", "pro", "enterprise"].forEach((plan) => {
    const opt = document.createElement("option");
    opt.value = plan;
    opt.textContent = plan;
    if ((user.plan || "free") === plan) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", async () => {
    select.disabled = true;
    try {
      const data = await api(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ plan: select.value }),
      });
      user.plan = data.user.plan;
      showToast(`Plan actualizado a ${select.value}.`);
      applyUserFilters();
    } catch (err) {
      renderError(err.message);
    } finally {
      select.disabled = false;
    }
  });
  row.appendChild(select);

  const actions = document.createElement("div");
  actions.className = "admin-actions";

  const suspend = document.createElement("button");
  suspend.className = "admin-mini";
  suspend.type = "button";
  suspend.textContent = user.is_active === false ? "Reactivar" : "Suspender";
  suspend.disabled = user.is_founder;
  suspend.addEventListener("click", async () => {
    try {
      const data = await api(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: user.is_active === false }),
      });
      user.is_active = data.user.is_active;
      showToast(user.is_active === false ? "Usuario suspendido." : "Usuario reactivado.");
      applyUserFilters();
    } catch (err) {
      renderError(err.message);
    }
  });

  const ban = document.createElement("button");
  ban.className = "admin-mini danger";
  ban.type = "button";
  ban.textContent = user.is_banned ? "Quitar ban" : "Banear";
  ban.disabled = user.is_founder;
  ban.addEventListener("click", async () => {
    try {
      const data = await api(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_banned: !user.is_banned }),
      });
      user.is_banned = data.user.is_banned;
      showToast(user.is_banned ? "Usuario baneado." : "Ban retirado.");
      applyUserFilters();
    } catch (err) {
      renderError(err.message);
    }
  });

  const del = document.createElement("button");
  del.className = "admin-mini danger";
  del.type = "button";
  del.title = "Eliminar usuario y todos sus datos";
  del.textContent = "Eliminar";
  del.disabled = user.is_founder;
  del.addEventListener("click", async () => {
    if (!window.confirm(`¿Eliminar a ${user.display_name || user.username} y todos sus datos?`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
      adminData.users = adminData.users.filter((item) => item.id !== user.id);
      showToast("Usuario eliminado.");
      applyUserFilters();
    } catch (err) {
      renderError(err.message);
    }
  });

  if (user.is_banned) {
    actions.appendChild(adminTag("Baneado", "banned"));
  } else if (user.is_active === false) {
    actions.appendChild(adminTag("Suspendido", "suspended"));
  }

  const detail = document.createElement("button");
  detail.className = "admin-mini";
  detail.type = "button";
  detail.textContent = "Detalle";
  detail.addEventListener("click", () => openAdminUser(user.id));
  actions.appendChild(detail);

  actions.append(suspend, ban, del);
  row.appendChild(actions);

  return row;
}

/* ------------------------------------------------------------------ */
/* Admin: detalle de usuario                                           */
/* ------------------------------------------------------------------ */

function adminSection(titleText) {
  const section = document.createElement("div");
  section.className = "admin-detail-section";
  if (titleText) {
    const h = document.createElement("h3");
    h.textContent = titleText;
    section.appendChild(h);
  }
  return section;
}

function adminMiniButton(label, onClick, danger = false) {
  const btn = document.createElement("button");
  btn.className = danger ? "admin-mini danger" : "admin-mini";
  btn.type = "button";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function adminKvRow(dl, key, value) {
  const dt = document.createElement("dt");
  dt.textContent = key;
  const dd = document.createElement("dd");
  dd.textContent = value == null || value === "" ? "—" : String(value);
  dl.append(dt, dd);
}

function closeAdminUser() {
  adminUserModal.classList.remove("show");
  adminUserDetail.innerHTML = "";
}

async function openAdminUser(userId) {
  adminUserTitle.textContent = "Cargando…";
  adminUserDetail.innerHTML = "";
  adminUserModal.classList.add("show");
  try {
    const data = await api(`/api/admin/users/${userId}`);
    renderAdminUserDetail(data);
  } catch (err) {
    adminUserTitle.textContent = "Detalle de usuario";
    const error = document.createElement("p");
    error.className = "modal-sub";
    error.textContent = err.message;
    adminUserDetail.appendChild(error);
  }
}

function syncAdminUserLocal(user) {
  const idx = adminData.users.findIndex((item) => item.id === user.id);
  if (idx >= 0) adminData.users[idx] = { ...adminData.users[idx], ...user };
  applyUserFilters();
}

function renderAdminUserDetail(data) {
  const user = data.user;
  adminUserDetail.innerHTML = "";
  adminUserTitle.textContent = user.display_name || user.username || `Usuario #${user.id}`;

  const info = adminSection("Información");
  const dl = document.createElement("dl");
  dl.className = "admin-kv";
  adminKvRow(dl, "ID", user.id);
  adminKvRow(dl, "Usuario", user.username);
  adminKvRow(dl, "Correo", user.email ? `${user.email}${user.email_verified ? " ✔" : ""}` : "");
  adminKvRow(dl, "Proveedor", user.discord_id ? `Discord ${user.discord_id}` : "Correo");
  adminKvRow(dl, "Plan", user.plan);
  adminKvRow(dl, "Estado", user.is_banned ? "Baneado" : user.is_active === false ? "Suspendido" : "Activo");
  adminKvRow(dl, "2FA", user.totp_enabled ? "Activada" : "Desactivada");
  adminKvRow(dl, "Alta", user.created_at ? formatDate(user.created_at) : "");
  adminKvRow(dl, "Fundador", user.is_founder ? "Sí" : "No");
  info.appendChild(dl);
  adminUserDetail.appendChild(info);

  const actionsSection = adminSection("Acciones");
  const actions = document.createElement("div");
  actions.className = "admin-detail-actions";
  if (!user.totp_enabled) {
    actions.appendChild(
      adminMiniButton("Reenviar verificación", async () => {
        try {
          const res = await api(`/api/admin/users/${user.id}/resend-verification`, { method: "POST" });
          showToast(res.already_verified ? "El correo ya estaba verificado." : res.sent ? "Correo reenviado." : "No se pudo enviar el correo.");
        } catch (err) {
          renderError(err.message);
        }
      })
    );
  }
  actions.appendChild(
    adminMiniButton("Restablecer 2FA", async () => {
      if (!window.confirm("¿Desactivar la 2FA de este usuario?")) return;
      try {
        const res = await api(`/api/admin/users/${user.id}/reset-2fa`, { method: "POST" });
        user.totp_enabled = res.user.totp_enabled;
        syncAdminUserLocal(user);
        renderAdminUserDetail(data);
        showToast("2FA restablecida.");
      } catch (err) {
        renderError(err.message);
      }
    })
  );
  actions.appendChild(
    adminMiniButton("Cerrar sesiones", async () => {
      if (!window.confirm("¿Cerrar todas las sesiones activas de este usuario?")) return;
      try {
        await api(`/api/admin/users/${user.id}/logout-all`, { method: "POST" });
        showToast("Sesiones cerradas.");
      } catch (err) {
        renderError(err.message);
      }
    })
  );
  if (!user.is_founder) {
    actions.appendChild(
      adminMiniButton(user.is_active === false ? "Reactivar" : "Suspender", async () => {
        try {
          const res = await api(`/api/admin/users/${user.id}`, {
            method: "PATCH",
            body: JSON.stringify({ is_active: user.is_active === false }),
          });
          user.is_active = res.user.is_active;
          syncAdminUserLocal(user);
          renderAdminUserDetail(data);
        } catch (err) {
          renderError(err.message);
        }
      })
    );
    actions.appendChild(
      adminMiniButton(user.is_banned ? "Quitar ban" : "Banear", async () => {
        try {
          const res = await api(`/api/admin/users/${user.id}`, {
            method: "PATCH",
            body: JSON.stringify({ is_banned: !user.is_banned }),
          });
          user.is_banned = res.user.is_banned;
          syncAdminUserLocal(user);
          renderAdminUserDetail(data);
        } catch (err) {
          renderError(err.message);
        }
      }, true)
    );
  }
  actionsSection.appendChild(actions);
  adminUserDetail.appendChild(actionsSection);

  const edit = adminSection("Editar y notas internas");
  edit.appendChild(adminFieldRow("Nombre visible", "text", user.display_name || "", (v) => (user.display_name = v)));
  edit.appendChild(adminFieldRow("Usuario", "text", user.username || "", (v) => (user.username = v)));
  edit.appendChild(adminFieldRow("Notas internas", "textarea", user.notes || "", (v) => (user.notes = v)));
  edit.appendChild(adminFieldRow("Etiquetas (separadas por comas)", "text", (user.tags || []).join(", "), (v) => (user.tags = v.split(",").map((t) => t.trim()).filter(Boolean))));
  const emailToggle = document.createElement("label");
  emailToggle.className = "admin-field-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = user.email_verified;
  checkbox.addEventListener("change", () => (user.email_verified = checkbox.checked));
  const checkboxLabel = document.createElement("span");
  checkboxLabel.textContent = "Correo verificado";
  emailToggle.append(checkbox, checkboxLabel);
  edit.appendChild(emailToggle);
  const saveRow = document.createElement("div");
  saveRow.className = "admin-detail-actions";
  saveRow.appendChild(
    adminMiniButton("Guardar cambios", async () => {
      try {
        const payload = {
          display_name: user.display_name,
          username: user.username,
          notes: user.notes,
          tags: (user.tags || []).join(","),
          email_verified: user.email_verified,
        };
        const res = await api(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        Object.assign(user, res.user);
        syncAdminUserLocal(res.user);
        renderAdminUserDetail(data);
        showToast("Cambios guardados.");
      } catch (err) {
        renderError(err.message);
      }
    })
  );
  edit.appendChild(saveRow);
  adminUserDetail.appendChild(edit);

  const usage = adminSection("Uso y cuotas");
  const limits = data.limits || {};
  const today = (data.usage && data.usage.today) || { messages: 0, images: 0 };
  const usageBar = document.createElement("div");
  usageBar.className = "admin-usage-bar";
  const addUsage = (label, used, limit) => {
    const span = document.createElement("span");
    span.textContent = `${label}: ${used}${limit == null ? " (ilimitado)" : ` / ${limit}`}`;
    usageBar.appendChild(span);
  };
  addUsage("Mensajes hoy", today.messages, limits.messages_per_day);
  addUsage("Imágenes hoy", today.images, limits.images_per_day);
  usage.appendChild(usageBar);
  adminUserDetail.appendChild(usage);

  const convSection = adminSection(`Conversaciones (${(data.conversations || []).length})`);
  const convList = document.createElement("div");
  convList.className = "admin-list";
  if (!(data.conversations || []).length) {
    const empty = document.createElement("div");
    empty.className = "modal-sub";
    empty.textContent = "Sin conversaciones.";
    convList.appendChild(empty);
  } else {
    data.conversations.forEach((conv) => {
      const item = document.createElement("div");
      item.className = "admin-list-item";
      const title = document.createElement("span");
      title.className = "admin-list-title";
      title.textContent = conv.title || "Sin título";
      const meta = document.createElement("span");
      meta.className = "admin-list-meta";
      meta.textContent = `${conv.messages} mensajes`;
      const view = adminMiniButton("Ver", async () => {
        if (item.nextSibling && item.nextSibling.classList && item.nextSibling.classList.contains("admin-conv-view")) {
          item.nextSibling.remove();
          return;
        }
        try {
          const detail = await api(`/api/admin/conversations/${conv.id}`);
          const viewBox = document.createElement("div");
          viewBox.className = "admin-conv-view admin-list";
          (detail.conversation.items || []).forEach((msg) => {
            const bubble = document.createElement("div");
            bubble.className = `admin-msg ${msg.role === "user" ? "user" : "assistant"}`;
            const role = document.createElement("span");
            role.className = "admin-msg-role";
            role.textContent = msg.role === "user" ? "Usuario" : "Core IA";
            bubble.append(role, document.createTextNode(msg.content));
            viewBox.appendChild(bubble);
          });
          item.after(viewBox);
        } catch (err) {
          renderError(err.message);
        }
      });
      const remove = adminMiniButton("Eliminar", async () => {
        if (!window.confirm("¿Eliminar esta conversación?")) return;
        try {
          await api(`/api/admin/conversations/${conv.id}`, { method: "DELETE" });
          item.remove();
          showToast("Conversación eliminada.");
        } catch (err) {
          renderError(err.message);
        }
      }, true);
      item.append(title, meta, view, remove);
      convList.appendChild(item);
    });
  }
  convSection.appendChild(convList);
  adminUserDetail.appendChild(convSection);

  const docSection = adminSection(`Documentos (${(data.documents || []).length})`);
  const docList = document.createElement("div");
  docList.className = "admin-list";
  if (!(data.documents || []).length) {
    const empty = document.createElement("div");
    empty.className = "modal-sub";
    empty.textContent = "Sin documentos.";
    docList.appendChild(empty);
  } else {
    data.documents.forEach((doc) => {
      const item = document.createElement("div");
      item.className = "admin-list-item";
      const title = document.createElement("span");
      title.className = "admin-list-title";
      title.textContent = doc.title || "Documento";
      const meta = document.createElement("span");
      meta.className = "admin-list-meta";
      meta.textContent = `${doc.chunks} fragmentos`;
      const remove = adminMiniButton("Eliminar", async () => {
        if (!window.confirm("¿Eliminar este documento?")) return;
        try {
          await api(`/api/admin/documents/${doc.id}`, { method: "DELETE" });
          item.remove();
          showToast("Documento eliminado.");
        } catch (err) {
          renderError(err.message);
        }
      }, true);
      item.append(title, meta, remove);
      docList.appendChild(item);
    });
  }
  docSection.appendChild(docList);
  adminUserDetail.appendChild(docSection);
}

function adminFieldRow(labelText, kind, value, onInput) {
  const row = document.createElement("div");
  row.className = "admin-field-row";
  const label = document.createElement("label");
  label.textContent = labelText;
  const field = document.createElement(kind === "textarea" ? "textarea" : "input");
  if (kind !== "textarea") field.type = "text";
  field.value = value;
  field.addEventListener("input", () => onInput(field.value));
  row.append(label, field);
  return row;
}

async function exportAdminUsers(format) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/export/users?format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let detail = `Error ${res.status}`;
      try {
        const data = await res.json();
        if (data && data.detail) detail = data.detail;
      } catch (_) { /* sin JSON */ }
      throw new Error(detail);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `coreia-usuarios.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Exportación lista.");
  } catch (err) {
    renderError(err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Notificaciones, atajos de teclado y arrastrar y soltar             */
/* ------------------------------------------------------------------ */

function notifyReply(text) {
  if (!text || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted" || !document.hidden) return;
  try {
    new Notification("Core IA", { body: text.slice(0, 180), icon: "favicon.svg" });
  } catch (_) {
    /* algunos navegadores requieren service worker */
  }
}

function requestNotifications() {
  if (typeof Notification === "undefined") {
    renderError("Tu navegador no soporta notificaciones.");
    return;
  }
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function anyModalOpen() {
  return Array.from(document.querySelectorAll(".modal.show")).length > 0;
}

function closeTopModal() {
  const open = document.querySelector(".modal.show");
  if (open) {
    open.classList.remove("show");
    return true;
  }
  if (sidebarEl.classList.contains("open")) {
    closeSidebar();
    return true;
  }
  return false;
}

document.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey;

  if (event.key === "Escape") {
    if (closeTopModal()) event.preventDefault();
    return;
  }
  if (mod && event.key.toLowerCase() === "k") {
    event.preventDefault();
    startNewChat();
    return;
  }
  if (mod && event.shiftKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    openSettings();
    return;
  }
  if (event.key === "/" && !isTypingTarget(event.target) && !anyModalOpen()) {
    event.preventDefault();
    inputEl.focus();
  }
});

function handleDroppedFile(file) {
  if (!file) return;
  const name = (file.name || "").toLowerCase();
  const isText =
    file.type.startsWith("text/") ||
    /\.(txt|md|markdown|csv|json|log|py|js|ts|html|css)$/.test(name);
  if (!isText) {
    renderError("Solo puedo adjuntar archivos de texto (txt, md, csv, json...).");
    return;
  }
  if (file.size > 200 * 1024) {
    renderError("El archivo es demasiado grande (máx. 200 KB).");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (!currentUser) {
      showAuthGate();
      return;
    }
    kbTitle.value = file.name.replace(/\.[^.]+$/, "").slice(0, 160);
    kbText.value = String(reader.result || "").slice(0, 50000);
    kbModal.classList.add("show");
    loadDocuments();
  };
  reader.readAsText(file);
}

function initDragAndDrop() {
  const target = scrollEl;
  ["dragenter", "dragover"].forEach((type) => {
    target.addEventListener(type, (event) => {
      event.preventDefault();
      target.classList.add("dragging");
    });
  });
  ["dragleave", "dragend", "drop"].forEach((type) => {
    target.addEventListener(type, () => target.classList.remove("dragging"));
  });
  target.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer && event.dataTransfer.files[0];
    handleDroppedFile(file);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch (_) {
    /* ignora entornos sin soporte */
  }
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
document.getElementById("settings-notify").addEventListener("click", requestNotifications);
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) closeSettings();
});
emailResend.addEventListener("click", resendEmailVerification);
twofaStart.addEventListener("click", startTwofaSetup);
twofaDisable.addEventListener("click", disableTwofa);
twofaEnable.addEventListener("click", enableTwofa);
twofaCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") enableTwofa();
});
twofaModalClose.addEventListener("click", closeTwofaModal);
twofaLoginSubmit.addEventListener("click", submitTwofaCode);
twofaLoginRecovery.addEventListener("click", toggleTwofaRecoveryMode);
twofaLoginCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitTwofaCode();
});
twofaModal.addEventListener("click", (event) => {
  if (event.target === twofaModal) closeTwofaModal();
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

adminTabs.addEventListener("click", (event) => {
  const btn = event.target.closest(".admin-tab");
  if (btn) switchAdminTab(btn.dataset.tab);
});

adminRefresh.addEventListener("click", () => loadAdmin());
adminUserSearch.addEventListener("input", applyUserFilters);
adminUserPlan.addEventListener("change", applyUserFilters);
adminUserStatus.addEventListener("change", applyUserFilters);
adminAuditSearch.addEventListener("input", applyAuditFilter);
adminAuditLimit.addEventListener("change", refreshAudit);

if (adminChartRangeSelect) adminChartRangeSelect.addEventListener("change", refreshAdminStats);
if (adminExportChart) adminExportChart.addEventListener("click", exportAdminChartImage);
if (aiSave) {
  aiSave.addEventListener("click", async () => {
    aiSave.disabled = true;
    try {
      const data = await api("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          system_prompt: aiSystemPrompt ? aiSystemPrompt.value : "",
          default_model: aiDefaultModel ? aiDefaultModel.value : "",
          temperature: aiTemperature ? aiTemperature.value : "",
          banned_words: aiBannedWords ? aiBannedWords.value : "",
        }),
      });
      renderAdminSettings(data.settings || {});
      showToast("Configuración de IA guardada.");
    } catch (err) {
      renderError(err.message);
    } finally {
      aiSave.disabled = false;
    }
  });
}
if (adminExportCsv) adminExportCsv.addEventListener("click", () => exportAdminUsers("csv"));
if (adminExportJson) adminExportJson.addEventListener("click", () => exportAdminUsers("json"));
if (adminUserClose) adminUserClose.addEventListener("click", closeAdminUser);
if (adminUserModal) {
  adminUserModal.addEventListener("click", (event) => {
    if (event.target === adminUserModal) closeAdminUser();
  });
}

noticeCreate.addEventListener("click", async () => {
  const message = noticeInput.value.trim();
  if (!message) return;
  noticeCreate.disabled = true;
  try {
    await api("/api/admin/notices", {
      method: "POST",
      body: JSON.stringify({ message, level: noticeLevel.value }),
    });
    noticeInput.value = "";
    const data = await api("/api/admin/notices");
    renderAdminNotices(data.notices || []);
    loadNotices();
    showToast("Aviso publicado.");
  } catch (err) {
    renderError(err.message);
  } finally {
    noticeCreate.disabled = false;
  }
});

authFormEl.addEventListener("submit", submitEmailAuth);
authSwitchBtn.addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
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
    setTimeout(() => showToast("El inicio de sesión fue cancelado."), 300);
  }
  const hash = window.location.hash || "";
  if (hash.includes("email_verified=1")) {
    window.history.replaceState(null, "", window.location.pathname);
    setTimeout(() => showToast("¡Correo confirmado! Gracias por verificar tu cuenta."), 600);
  } else if (hash.includes("email_verify_error=1")) {
    window.history.replaceState(null, "", window.location.pathname);
    setTimeout(() => showToast("No pudimos verificar tu correo. El enlace pudo haber expirado."), 600);
  }
  applyTtsState();
  updateSendState();
  updateComposerForVerification();
  updatePlanBadge();
  autoResize();
  setAuthMode("login");
  initDragAndDrop();
  registerServiceWorker();
  await Promise.all([loadProviders(), loadConfig(), loadNotices()]);
  if (authProvidersEl) renderLoginButtons(authProvidersEl, "auth-login");
  try {
    await loadSession();
  } finally {
    hideSplash();
  }
})();

window.addEventListener("load", () => setTimeout(hideSplash, 15000));

let swRegistration = null;
function checkForUpdate() {
  if (swRegistration && swRegistration.waiting) {
    showUpdateBanner();
    return;
  }
  if (swRegistration) {
    swRegistration.update().catch(() => {});
  }
}

function showUpdateBanner() {
  let banner = document.getElementById("update-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "update-banner";
    banner.className = "update-banner";
    banner.innerHTML = '<div class="update-content"><span>Nueva actualización disponible. Actualiza para tener la última versión.</span><button class="update-btn" type="button">Actualizar ahora</button></div>';
    document.body.appendChild(banner);
    const btn = banner.querySelector(".update-btn");
    if (btn) {
      btn.addEventListener("click", async () => {
        if (swRegistration && swRegistration.waiting) {
          swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        window.location.reload();
      });
    }
  }
  banner.classList.add("show");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      swRegistration = reg;
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
    } catch (_) {}
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
}
window.addEventListener("focus", checkForUpdate);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForUpdate();
});

