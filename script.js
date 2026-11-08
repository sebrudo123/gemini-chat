/**
 * Core AI Studio V2 — Frontend Controller
 * 100% Desacoplado • Cero Emojis (SVG Vectorial) • Autenticación • Panel Admin
 */

(function () {
  'use strict';

  const API_ENDPOINT = '/.netlify/functions/chat';

  // Elementos DOM Principales
  const sidebar = document.getElementById('sidebar');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const searchHistory = document.getElementById('search-history');
  const historyFeed = document.getElementById('history-feed');

  // Perfil y Autenticación
  const profileName = document.getElementById('profile-name');
  const profileRole = document.getElementById('profile-role');
  const authModalOpenBtn = document.getElementById('auth-modal-open-btn');
  const authModal = document.getElementById('auth-modal');
  const closeAuthModal = document.getElementById('close-auth-modal');
  const tabLoginBtn = document.getElementById('tab-login-btn');
  const tabRegisterBtn = document.getElementById('tab-register-btn');
  const groupName = document.getElementById('group-name');
  const authForm = document.getElementById('auth-form');
  const authName = document.getElementById('auth-name');
  const authEmail = document.getElementById('auth-email');
  const authPassword = document.getElementById('auth-password');
  const authSubmitBtn = document.getElementById('auth-submit-btn');
  const authGuestQuickBtn = document.getElementById('auth-guest-quick-btn');

  // Modales y Ajustes
  const themeBtn = document.getElementById('theme-btn');
  const themeIcon = document.getElementById('theme-icon');
  const settingsModalBtn = document.getElementById('settings-modal-btn');
  const personaModal = document.getElementById('persona-modal');
  const closePersonaModal = document.getElementById('close-persona-modal');
  const savePersonaBtn = document.getElementById('save-persona-btn');
  const activePersonaPill = document.getElementById('active-persona-pill');
  const activePersonaText = document.getElementById('active-persona-text');
  const customSystemPromptText = document.getElementById('custom-system-prompt-text');
  const exportBtn = document.getElementById('export-btn');

  // Panel Admin
  const adminPanelBtn = document.getElementById('admin-panel-btn');
  const headerAdminBtn = document.getElementById('header-admin-btn');
  const adminModal = document.getElementById('admin-modal');
  const closeAdminModal = document.getElementById('close-admin-modal');
  const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
  const adminTabPanes = document.querySelectorAll('.admin-tab-pane');
  const statSessions = document.getElementById('stat-sessions');
  const adminSessionsTableBody = document.getElementById('admin-sessions-table-body');
  const adminModelSelect = document.getElementById('admin-model-select');
  const adminTempSlider = document.getElementById('admin-temp-slider');
  const adminTempVal = document.getElementById('admin-temp-val');
  const adminGlobalPrompt = document.getElementById('admin-global-prompt');
  const adminSaveAiBtn = document.getElementById('admin-save-ai-btn');

  // Área de Mensajes y Composer
  const chatScrollArea = document.getElementById('chat-scroll-area');
  const chatMaxWidth = document.getElementById('chat-max-width');
  const heroWelcome = document.getElementById('hero-welcome');
  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('send-btn');
  const sendIcon = document.getElementById('send-icon');
  const voiceBtn = document.getElementById('voice-btn');
  const clearChatBtn = document.getElementById('clear-chat-btn');

  // Estado Local
  let currentChatId = null;
  let conversations = [];
  let isStreaming = false;
  let abortController = null;
  let isListening = false;
  let speechRec = null;

  // Estado de Usuario
  let currentUser = JSON.parse(localStorage.getItem('coreai_user')) || {
    name: 'Invitado',
    email: 'invitado@coreai.local',
    role: 'Usuario',
  };

  // Parámetros de Inferencia
  let activeModel = localStorage.getItem('coreai_model') || 'llama-3.3-70b-versatile';
  let activeTemperature = parseFloat(localStorage.getItem('coreai_temp') || '0.7');
  let activeSystemPrompt =
    localStorage.getItem('coreai_system_prompt') ||
    'Eres Core AI Studio V2, un asistente de inteligencia artificial de nivel enterprise, preciso, elegante y útil.';
  let activePersona = localStorage.getItem('coreai_persona_name') || 'General';

  // Inicializar Marked.js
  if (window.marked) {
    marked.setOptions({ gfm: true, breaks: true });
  }

  /* ------------------------------------------------------------------ */
  /* 1. Gestión de Tema Visual (Dark / Light)                           */
  /* ------------------------------------------------------------------ */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('coreai_theme', theme);
    if (theme === 'light') {
      themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
    } else {
      themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
  }

  themeBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  /* ------------------------------------------------------------------ */
  /* 2. Autenticación y Perfil de Usuario                               */
  /* ------------------------------------------------------------------ */
  function renderUserProfile() {
    profileName.textContent = currentUser.name || 'Invitado';
    profileRole.textContent = currentUser.role || 'Usuario';
  }

  function setAuthTab(mode) {
    if (mode === 'login') {
      tabLoginBtn.classList.add('active');
      tabRegisterBtn.classList.remove('active');
      groupName.style.display = 'none';
      authSubmitBtn.textContent = 'Entrar';
    } else {
      tabRegisterBtn.classList.add('active');
      tabLoginBtn.classList.remove('active');
      groupName.style.display = 'flex';
      authSubmitBtn.textContent = 'Crear Cuenta';
    }
  }

  tabLoginBtn.addEventListener('click', () => setAuthTab('login'));
  tabRegisterBtn.addEventListener('click', () => setAuthTab('register'));

  authModalOpenBtn.addEventListener('click', () => {
    authModal.classList.add('open');
  });
  closeAuthModal.addEventListener('click', () => authModal.classList.remove('open'));

  authGuestQuickBtn.addEventListener('click', () => {
    currentUser = { name: 'Invitado', email: 'invitado@coreai.local', role: 'Usuario' };
    localStorage.setItem('coreai_user', JSON.stringify(currentUser));
    renderUserProfile();
    authModal.classList.remove('open');
  });

  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = authEmail.value.trim();
    const name = authName.value.trim() || email.split('@')[0];
    const role = email.includes('admin') ? 'Administrador' : 'Usuario';

    currentUser = { name, email, role };
    localStorage.setItem('coreai_user', JSON.stringify(currentUser));
    renderUserProfile();
    authModal.classList.remove('open');
    alert(`Sesión iniciada con éxito como ${name} (${role})`);
  });

  /* ------------------------------------------------------------------ */
  /* 3. Panel de Administración Enterprise                              */
  /* ------------------------------------------------------------------ */
  function openAdminDashboard() {
    adminModal.classList.add('open');
    adminModelSelect.value = activeModel;
    adminTempSlider.value = activeTemperature;
    adminTempVal.textContent = activeTemperature;
    adminGlobalPrompt.value = activeSystemPrompt;
    loadAdminMetrics();
  }

  adminPanelBtn.addEventListener('click', openAdminDashboard);
  headerAdminBtn.addEventListener('click', openAdminDashboard);
  closeAdminModal.addEventListener('click', () => adminModal.classList.remove('open'));

  adminTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      adminTabBtns.forEach((b) => b.classList.remove('active'));
      adminTabPanes.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const targetPane = document.getElementById(`pane-${btn.dataset.tab}`);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  adminTempSlider.addEventListener('input', (e) => {
    adminTempVal.textContent = e.target.value;
  });

  adminSaveAiBtn.addEventListener('click', () => {
    activeModel = adminModelSelect.value;
    activeTemperature = parseFloat(adminTempSlider.value);
    activeSystemPrompt = adminGlobalPrompt.value.trim();

    localStorage.setItem('coreai_model', activeModel);
    localStorage.setItem('coreai_temp', activeTemperature.toString());
    localStorage.setItem('coreai_system_prompt', activeSystemPrompt);
    alert('Parámetros de IA actualizados correctamente.');
  });

  async function loadAdminMetrics() {
    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin_stats' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.stats) {
        statSessions.textContent = data.stats.totalSessions;
        renderAdminSessionsTable(data.recentSessions || []);
      }
    } catch (err) {
      console.warn('[Admin] Error al cargar métricas:', err);
    }
  }

  function renderAdminSessionsTable(sessions) {
    adminSessionsTableBody.innerHTML = '';
    if (!sessions.length) {
      adminSessionsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-faint);padding:20px;">Sin sesiones registradas en Supabase</td></tr>';
      return;
    }

    sessions.forEach((s) => {
      const tr = document.createElement('tr');
      const dateStr = s.created_at ? new Date(s.created_at).toLocaleString() : 'Reciente';
      tr.innerHTML = `
        <td style="font-family:var(--font-mono);font-size:11px;">${s.id.slice(0, 8)}...</td>
        <td style="font-weight:600;">${s.title || 'Conversación'}</td>
        <td style="font-size:12px;color:var(--text-faint);">${dateStr}</td>
        <td>
          <button class="history-btn delete-session-btn" data-id="${s.id}" title="Eliminar de Supabase">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </td>
      `;
      tr.querySelector('.delete-session-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('¿Eliminar sesión de Supabase?')) {
          await deleteConversation(s.id);
          loadAdminMetrics();
        }
      });
      adminSessionsTableBody.appendChild(tr);
    });
  }

  /* ------------------------------------------------------------------ */
  /* 4. Gestión de Historial con Supabase Cloud                         */
  /* ------------------------------------------------------------------ */
  async function fetchHistory() {
    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_sessions' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.sessions)) {
        conversations = data.sessions;
        renderHistoryList(conversations);
      }
    } catch (err) {
      console.warn('[History] Error al obtener historial:', err);
    }
  }

  function renderHistoryList(list) {
    historyFeed.innerHTML = '<div class="history-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg> Historial en Supabase</div>';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:14px 8px;font-size:12px;color:var(--text-faint);text-align:center;';
      empty.textContent = 'Sin conversaciones aún';
      historyFeed.appendChild(empty);
      return;
    }

    list.forEach((chat) => {
      const item = document.createElement('div');
      item.className = 'history-entry' + (chat.id === currentChatId ? ' active' : '');
      item.dataset.id = chat.id;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'history-title';
      titleSpan.textContent = chat.title || 'Conversación';

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'history-actions';

      const delBtn = document.createElement('button');
      delBtn.className = 'history-btn';
      delBtn.title = 'Eliminar';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(chat.id);
      });

      actionsDiv.appendChild(delBtn);
      item.appendChild(titleSpan);
      item.appendChild(actionsDiv);

      item.addEventListener('click', () => {
        loadConversation(chat.id);
        if (window.innerWidth <= 768) sidebar.classList.remove('open');
      });

      historyFeed.appendChild(item);
    });
  }

  async function loadConversation(chatId) {
    if (isStreaming) return;
    currentChatId = chatId;
    updateActiveHistoryItem();

    chatMaxWidth.innerHTML = '';
    heroWelcome.style.display = 'none';

    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_messages', chatId }),
      });
      if (!res.ok) throw new Error('Error al recuperar mensajes');
      const data = await res.json();
      const msgs = data.messages || [];

      if (!msgs.length) {
        chatMaxWidth.appendChild(heroWelcome);
        heroWelcome.style.display = 'block';
      } else {
        msgs.forEach((m) => {
          appendBubble(m.role === 'user' ? 'user' : 'ai', m.content, false);
        });
        scrollToBottom();
      }
    } catch (err) {
      appendBubble('ai', `Error al cargar la conversación: ${err.message}`, false);
    }
  }

  async function deleteConversation(chatId) {
    if (!confirm('¿Deseas eliminar esta conversación de Supabase?')) return;
    try {
      await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_session', chatId }),
      });
      if (currentChatId === chatId) startNewChat();
      fetchHistory();
    } catch (err) {
      alert('No se pudo eliminar la conversación');
    }
  }

  function startNewChat() {
    if (isStreaming && abortController) abortController.abort();
    currentChatId = null;
    updateActiveHistoryItem();
    chatMaxWidth.innerHTML = '';
    chatMaxWidth.appendChild(heroWelcome);
    heroWelcome.style.display = 'block';
    promptInput.value = '';
    autoResizeTextarea();
    promptInput.focus();
  }

  function updateActiveHistoryItem() {
    const items = historyFeed.querySelectorAll('.history-entry');
    items.forEach((item) => {
      item.classList.toggle('active', item.dataset.id === currentChatId);
    });
  }

  searchHistory.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderHistoryList(conversations);
      return;
    }
    const filtered = conversations.filter((c) => (c.title || '').toLowerCase().includes(q));
    renderHistoryList(filtered);
  });

  newChatBtn.addEventListener('click', startNewChat);

  /* ------------------------------------------------------------------ */
  /* 5. Renderizado de Mensajes con Iconos Vectoriales (Cero Emojis)   */
  /* ------------------------------------------------------------------ */
  function appendBubble(role, initialText = '', showCursor = false) {
    const row = document.createElement('div');
    row.className = `chat-bubble-row ${role}`;

    const avatar = document.createElement('div');
    avatar.className = `chat-avatar ${role}`;
    if (role === 'user') {
      avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    } else {
      avatar.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
    }

    const col = document.createElement('div');
    col.className = 'chat-body-column';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    if (role === 'user') {
      bubble.textContent = initialText;
    } else {
      bubble.innerHTML = formatMarkdown(initialText);
      if (showCursor) {
        const cursor = document.createElement('span');
        cursor.className = 'stream-cursor';
        bubble.appendChild(cursor);
      }
    }

    col.appendChild(bubble);

    // Acciones de mensaje para la IA
    if (role === 'ai') {
      const actions = document.createElement('div');
      actions.className = 'msg-actions-row';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'action-sub-btn';
      copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(bubble.innerText);
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copiado';
        setTimeout(() => {
          copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar';
        }, 1600);
      });

      actions.appendChild(copyBtn);
      col.appendChild(actions);
    }

    if (role === 'ai') {
      row.appendChild(avatar);
      row.appendChild(col);
    } else {
      row.appendChild(col);
      row.appendChild(avatar);
    }

    chatMaxWidth.appendChild(row);
    scrollToBottom();
    enhanceCodeBlocks(bubble);
    return bubble;
  }

  function formatMarkdown(text) {
    if (!window.marked) return text;
    try {
      return marked.parse(text);
    } catch {
      return text;
    }
  }

  function enhanceCodeBlocks(container) {
    container.querySelectorAll('pre code').forEach((codeBlock) => {
      if (window.hljs) hljs.highlightElement(codeBlock);
      const pre = codeBlock.parentElement;
      if (!pre || pre.querySelector('.code-top-header')) return;

      const lang = codeBlock.className.replace('language-', '').replace('hljs', '').trim() || 'código';
      const header = document.createElement('div');
      header.className = 'code-top-header';
      header.innerHTML = `
        <span>${lang}</span>
        <button class="btn-copy-code">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copiar código
        </button>
      `;

      const copyBtn = header.querySelector('.btn-copy-code');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeBlock.innerText);
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> ¡Copiado!';
        setTimeout(() => {
          copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar código';
        }, 1800);
      });

      pre.insertBefore(header, codeBlock);
    });
  }

  function scrollToBottom() {
    chatScrollArea.scrollTop = chatScrollArea.scrollHeight;
  }

  /* ------------------------------------------------------------------ */
  /* 6. Enviar Mensaje y Streaming Reactivo con Groq                    */
  /* ------------------------------------------------------------------ */
  async function sendMessage() {
    const text = promptInput.value.trim();
    if (!text || isStreaming) return;

    if (isStreaming) {
      if (abortController) abortController.abort();
      return;
    }

    heroWelcome.style.display = 'none';
    appendBubble('user', text);
    promptInput.value = '';
    autoResizeTextarea();

    const aiBubble = appendBubble('ai', '', true);
    setStreamingState(true);
    abortController = new AbortController();

    let accumulated = '';

    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversation_id: currentChatId,
          model: activeModel,
          temperature: activeTemperature,
          systemPrompt: activeSystemPrompt,
          stream: true,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || `Error HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === 'start') {
              if (data.conversation_id && !currentChatId) {
                currentChatId = data.conversation_id;
                fetchHistory();
              }
            } else if (data.type === 'delta') {
              accumulated += data.text || '';
              aiBubble.innerHTML = formatMarkdown(accumulated);
              const cursor = document.createElement('span');
              cursor.className = 'stream-cursor';
              aiBubble.appendChild(cursor);
              scrollToBottom();
            } else if (data.type === 'error') {
              throw new Error(data.message || 'Error en la respuesta del modelo');
            }
          } catch {
            // Ignorar líneas no JSON intermedias
          }
        }
      }

      aiBubble.innerHTML = formatMarkdown(accumulated || 'Sin respuesta.');
      enhanceCodeBlocks(aiBubble);
      fetchHistory();
    } catch (err) {
      if (err.name === 'AbortError') {
        aiBubble.innerHTML = formatMarkdown(accumulated + '\n\n*(Generación detenida por el usuario)*');
      } else {
        aiBubble.innerHTML = `<span style="color:var(--danger)">Error: ${err.message}</span>`;
      }
    } finally {
      setStreamingState(false);
      abortController = null;
      scrollToBottom();
      promptInput.focus();
    }
  }

  function setStreamingState(streaming) {
    isStreaming = streaming;
    if (streaming) {
      sendBtn.classList.add('stop');
      sendBtn.title = 'Detener respuesta';
      sendIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" fill="white" stroke="none"/>';
    } else {
      sendBtn.classList.remove('stop');
      sendBtn.title = 'Enviar mensaje';
      sendIcon.innerHTML = '<path d="M5 12h14M12 5l7 7-7 7"/>';
    }
  }

  /* ------------------------------------------------------------------ */
  /* 7. Composer y Comportamiento                                       */
  /* ------------------------------------------------------------------ */
  function autoResizeTextarea() {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + 'px';
  }

  promptInput.addEventListener('input', autoResizeTextarea);

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        if (abortController) abortController.abort();
      } else {
        sendMessage();
      }
    }
  });

  sendBtn.addEventListener('click', () => {
    if (isStreaming) {
      if (abortController) abortController.abort();
    } else {
      sendMessage();
    }
  });

  clearChatBtn.addEventListener('click', () => {
    if (confirm('¿Deseas limpiar la pantalla actual?')) startNewChat();
  });

  document.querySelectorAll('.starter-card').forEach((card) => {
    card.addEventListener('click', () => {
      const p = card.getAttribute('data-prompt');
      if (p) {
        promptInput.value = p;
        autoResizeTextarea();
        sendMessage();
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /* 8. Dictado por Voz (Web Speech API)                                */
  /* ------------------------------------------------------------------ */
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRec = new SpeechAPI();
    speechRec.lang = 'es-ES';
    speechRec.continuous = false;

    speechRec.onstart = () => {
      isListening = true;
      voiceBtn.classList.add('active');
    };
    speechRec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      if (text) {
        promptInput.value = (promptInput.value ? promptInput.value + ' ' : '') + text;
        autoResizeTextarea();
      }
    };
    speechRec.onend = () => {
      isListening = false;
      voiceBtn.classList.remove('active');
    };

    voiceBtn.addEventListener('click', () => {
      if (isListening) speechRec.stop();
      else speechRec.start();
    });
  } else {
    voiceBtn.style.display = 'none';
  }

  /* ------------------------------------------------------------------ */
  /* 9. Especialidades / Modal de Personas                              */
  /* ------------------------------------------------------------------ */
  function openPersonaModal() {
    customSystemPromptText.value = activeSystemPrompt;
    personaModal.classList.add('open');
  }

  activePersonaPill.addEventListener('click', openPersonaModal);
  settingsModalBtn.addEventListener('click', openPersonaModal);
  closePersonaModal.addEventListener('click', () => personaModal.classList.remove('open'));

  document.querySelectorAll('.persona-card-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.persona-card-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      const p = item.getAttribute('data-prompt');
      const title = item.getAttribute('data-persona');
      if (p) customSystemPromptText.value = p;
      activePersona = title;
    });
  });

  savePersonaBtn.addEventListener('click', () => {
    activeSystemPrompt = customSystemPromptText.value.trim() || 'Eres Core AI Studio V2.';
    localStorage.setItem('coreai_system_prompt', activeSystemPrompt);
    localStorage.setItem('coreai_persona_name', activePersona);
    activePersonaText.textContent = activePersona;
    personaModal.classList.remove('open');
  });

  /* ------------------------------------------------------------------ */
  /* 10. Exportar Chat Actual (.md)                                     */
  /* ------------------------------------------------------------------ */
  exportBtn.addEventListener('click', () => {
    const rows = chatMaxWidth.querySelectorAll('.chat-bubble-row');
    if (!rows.length) {
      alert('No hay mensajes para exportar.');
      return;
    }
    let md = `# Conversación Core AI Studio V2\n*Exportado el ${new Date().toLocaleString()}*\n\n---\n\n`;
    rows.forEach((r) => {
      const isU = r.classList.contains('user');
      const b = r.querySelector('.chat-bubble');
      if (b) md += `### ${isU ? 'Usuario' : 'Core AI'}:\n${b.innerText}\n\n`;
    });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });

  /* ------------------------------------------------------------------ */
  /* 11. Responsive Sidebar                                             */
  /* ------------------------------------------------------------------ */
  mobileMenuBtn.addEventListener('click', () => sidebar.classList.add('open'));
  closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));

  /* ------------------------------------------------------------------ */
  /* 12. Arranque Inicial                                               */
  /* ------------------------------------------------------------------ */
  applyTheme(localStorage.getItem('coreai_theme') || 'dark');
  renderUserProfile();
  activePersonaText.textContent = activePersona;
  fetchHistory();
  autoResizeTextarea();
})();
