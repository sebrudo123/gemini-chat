/**
 * Core AI Studio V2 — Frontend Controller
 * 100% Desacoplado • Streaming con Groq Engine • Persistencia Atómica en Supabase
 */

(function () {
  'use strict';

  // Configuración de endpoint relativo (Netlify Functions)
  const API_ENDPOINT = '/.netlify/functions/chat';

  // Elementos DOM
  const sidebar = document.getElementById('sidebar');
  const menuToggleBtn = document.getElementById('menu-toggle-btn');
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const searchHistoryInput = document.getElementById('search-history');
  const historyListEl = document.getElementById('history-list');
  const themeBtn = document.getElementById('theme-btn');
  const themeIcon = document.getElementById('theme-icon');
  const exportBtn = document.getElementById('export-btn');
  const settingsModalBtn = document.getElementById('settings-modal-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const activePersonaPill = document.getElementById('active-persona-pill');
  const customPromptInput = document.getElementById('custom-prompt-input');

  const messagesScroll = document.getElementById('messages-scroll');
  const messagesWrapper = document.getElementById('messages-wrapper');
  const heroWelcome = document.getElementById('hero-welcome');

  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('send-btn');
  const sendIcon = document.getElementById('send-icon');
  const voiceBtn = document.getElementById('voice-btn');
  const clearChatBtn = document.getElementById('clear-chat-btn');

  // Estado de la aplicación
  let currentChatId = null;
  let conversations = [];
  let isStreaming = false;
  let abortController = null;
  let speechRecognition = null;
  let isListening = false;

  // Preferencias de usuario
  let activeSystemPrompt =
    localStorage.getItem('coreai_system_prompt') ||
    'Eres Core AI Studio V2, un asistente inteligente de nivel enterprise, preciso, elegante y útil.';
  let activePersonaTitle = localStorage.getItem('coreai_persona_title') || '🧠 Asistente General';

  // Inicializar Marked.js
  if (window.marked) {
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
  }

  /* ------------------------------------------------------------------ */
  /* 1. Gestión de Tema (Oscuro / Claro)                                 */
  /* ------------------------------------------------------------------ */
  function initTheme() {
    const savedTheme = localStorage.getItem('coreai_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }

  function updateThemeIcon(theme) {
    if (theme === 'light') {
      themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
    } else {
      themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
  }

  themeBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('coreai_theme', next);
    updateThemeIcon(next);
  });

  /* ------------------------------------------------------------------ */
  /* 2. Cargar y Administrar Sesiones de Supabase                       */
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
      console.warn('[CoreAI] No se pudo cargar el historial:', err);
    }
  }

  function renderHistoryList(list) {
    historyListEl.innerHTML = '<div class="history-group-title">Historial en Supabase</div>';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:14px 8px;font-size:12px;color:var(--text-faint);text-align:center;';
      empty.textContent = 'Sin conversaciones aún';
      historyListEl.appendChild(empty);
      return;
    }

    list.forEach((chat) => {
      const item = document.createElement('div');
      item.className = 'history-item' + (chat.id === currentChatId ? ' active' : '');
      item.dataset.id = chat.id;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'history-title';
      titleSpan.textContent = chat.title || 'Conversación';

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'history-actions';

      const delBtn = document.createElement('button');
      delBtn.className = 'history-btn';
      delBtn.title = 'Eliminar';
      delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(chat.id);
      });

      actionsDiv.appendChild(delBtn);
      item.appendChild(titleSpan);
      item.appendChild(actionsDiv);

      item.addEventListener('click', () => {
        loadConversation(chat.id);
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('open');
        }
      });

      historyListEl.appendChild(item);
    });
  }

  async function loadConversation(chatId) {
    if (isStreaming) return;
    currentChatId = chatId;
    updateActiveHistoryItem();

    // Limpiar pantalla y ocultar hero
    messagesWrapper.innerHTML = '';
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

      if (msgs.length === 0) {
        messagesWrapper.appendChild(heroWelcome);
        heroWelcome.style.display = 'block';
      } else {
        msgs.forEach((m) => {
          appendMessageBubble(m.role === 'user' ? 'user' : 'ai', m.content, false);
        });
        scrollToBottom();
      }
    } catch (err) {
      console.error(err);
      appendMessageBubble('ai', `⚠️ Error al cargar la conversación: ${err.message}`, false);
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
      if (currentChatId === chatId) {
        startNewChat();
      }
      fetchHistory();
    } catch (err) {
      alert('No se pudo eliminar la conversación');
    }
  }

  function startNewChat() {
    if (isStreaming && abortController) {
      abortController.abort();
    }
    currentChatId = null;
    updateActiveHistoryItem();
    messagesWrapper.innerHTML = '';
    messagesWrapper.appendChild(heroWelcome);
    heroWelcome.style.display = 'block';
    promptInput.value = '';
    autoResizeTextarea();
    promptInput.focus();
  }

  function updateActiveHistoryItem() {
    const items = historyListEl.querySelectorAll('.history-item');
    items.forEach((item) => {
      item.classList.toggle('active', item.dataset.id === currentChatId);
    });
  }

  searchHistoryInput.addEventListener('input', (e) => {
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
  /* 3. Renderizado de Mensajes y Código                                 */
  /* ------------------------------------------------------------------ */
  function appendMessageBubble(role, initialText = '', showCursor = false) {
    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const avatar = document.createElement('div');
    avatar.className = `avatar ${role}`;
    avatar.textContent = role === 'user' ? 'Tú' : 'AI';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (role === 'user') {
      bubble.textContent = initialText;
    } else {
      bubble.innerHTML = formatMarkdown(initialText);
      if (showCursor) {
        const cursor = document.createElement('span');
        cursor.className = 'typing-cursor';
        bubble.appendChild(cursor);
      }
    }

    contentDiv.appendChild(bubble);

    // Acciones del mensaje
    if (role === 'ai') {
      const actions = document.createElement('div');
      actions.className = 'message-actions';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'msg-btn';
      copyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(bubble.innerText);
        copyBtn.innerHTML = '✓ Copiado';
        setTimeout(() => {
          copyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar';
        }, 1500);
      });

      actions.appendChild(copyBtn);
      contentDiv.appendChild(actions);
    }

    if (role === 'ai') {
      row.appendChild(avatar);
      row.appendChild(contentDiv);
    } else {
      row.appendChild(contentDiv);
      row.appendChild(avatar);
    }

    messagesWrapper.appendChild(row);
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
      if (!pre || pre.querySelector('.code-header')) return;

      const lang = codeBlock.className.replace('language-', '').replace('hljs', '').trim() || 'code';
      const header = document.createElement('div');
      header.className = 'code-header';
      header.innerHTML = `<span>${lang}</span><button class="code-copy-btn">Copiar código</button>`;

      const copyBtn = header.querySelector('.code-copy-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeBlock.innerText);
        copyBtn.textContent = '✓ ¡Copiado!';
        setTimeout(() => (copyBtn.textContent = 'Copiar código'), 1800);
      });

      pre.insertBefore(header, codeBlock);
    });
  }

  function scrollToBottom() {
    messagesScroll.scrollTop = messagesScroll.scrollHeight;
  }

  /* ------------------------------------------------------------------ */
  /* 4. Envío de Mensajes y Streaming en Tiempo Real (Groq Engine)       */
  /* ------------------------------------------------------------------ */
  async function sendMessage() {
    const text = promptInput.value.trim();
    if (!text || isStreaming) return;

    // Si el usuario pulsa detener mientras transmite
    if (isStreaming) {
      if (abortController) abortController.abort();
      return;
    }

    // Ocultar hero
    heroWelcome.style.display = 'none';

    // Insertar burbuja de usuario
    appendMessageBubble('user', text);
    promptInput.value = '';
    autoResizeTextarea();

    // Crear burbuja de IA vacía con cursor
    const aiBubble = appendMessageBubble('ai', '', true);

    // Cambiar estado a streaming
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
              cursor.className = 'typing-cursor';
              aiBubble.appendChild(cursor);
              scrollToBottom();
            } else if (data.type === 'done') {
              // Finalización exitosa
            } else if (data.type === 'error') {
              throw new Error(data.message || 'Error en la respuesta del modelo');
            }
          } catch (parseErr) {
            // Ignorar líneas no JSON intermedias
          }
        }
      }

      // Remover cursor final y destacar código
      aiBubble.innerHTML = formatMarkdown(accumulated || 'Sin respuesta.');
      enhanceCodeBlocks(aiBubble);
      fetchHistory();
    } catch (err) {
      if (err.name === 'AbortError') {
        aiBubble.innerHTML = formatMarkdown(accumulated + '\n\n*(Generación detenida por el usuario)*');
      } else {
        aiBubble.innerHTML = `<span style="color:var(--danger)">⚠️ Error: ${err.message}</span>`;
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
  /* 5. Comportamiento del Composer e Inputs                            */
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
    if (confirm('¿Deseas limpiar la pantalla actual?')) {
      startNewChat();
    }
  });

  // Tarjetas de sugerencia
  document.querySelectorAll('.prompt-card').forEach((card) => {
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
  /* 6. Dictado por Voz (Web Speech API)                                */
  /* ------------------------------------------------------------------ */
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognition = new SpeechRec();
    speechRecognition.lang = 'es-ES';
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;

    speechRecognition.onstart = () => {
      isListening = true;
      voiceBtn.classList.add('active');
      voiceBtn.title = 'Escuchando... Haz clic para parar';
    };

    speechRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) {
        promptInput.value = (promptInput.value ? promptInput.value + ' ' : '') + transcript;
        autoResizeTextarea();
      }
    };

    speechRecognition.onend = () => {
      isListening = false;
      voiceBtn.classList.remove('active');
      voiceBtn.title = 'Dictado por voz';
    };

    voiceBtn.addEventListener('click', () => {
      if (isListening) {
        speechRecognition.stop();
      } else {
        speechRecognition.start();
      }
    });
  } else {
    voiceBtn.style.display = 'none';
  }

  /* ------------------------------------------------------------------ */
  /* 7. Modal de Ajustes y Selección de Personas                        */
  /* ------------------------------------------------------------------ */
  function openSettingsModal() {
    customPromptInput.value = activeSystemPrompt;
    settingsModal.classList.add('open');
  }

  function closeSettingsModal() {
    settingsModal.classList.remove('open');
  }

  settingsModalBtn.addEventListener('click', openSettingsModal);
  activePersonaPill.addEventListener('click', openSettingsModal);
  closeModalBtn.addEventListener('click', closeSettingsModal);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });

  document.querySelectorAll('.persona-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.persona-option').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      const p = opt.getAttribute('data-prompt');
      const t = opt.querySelector('.persona-option-title').innerText;
      if (p) customPromptInput.value = p;
      activePersonaTitle = t;
    });
  });

  saveSettingsBtn.addEventListener('click', () => {
    activeSystemPrompt = customPromptInput.value.trim() || 'Eres Core AI Studio V2.';
    localStorage.setItem('coreai_system_prompt', activeSystemPrompt);
    localStorage.setItem('coreai_persona_title', activePersonaTitle);
    activePersonaPill.querySelector('span').innerText = activePersonaTitle;
    closeSettingsModal();
  });

  /* ------------------------------------------------------------------ */
  /* 8. Exportar Chat Actual a Markdown                                 */
  /* ------------------------------------------------------------------ */
  exportBtn.addEventListener('click', () => {
    const rows = messagesWrapper.querySelectorAll('.message-row');
    if (!rows.length) {
      alert('No hay mensajes para exportar en esta conversación.');
      return;
    }

    let mdContent = `# Conversación Core AI Studio V2\n*Exportado el ${new Date().toLocaleString()}*\n\n---\n\n`;
    rows.forEach((row) => {
      const isUser = row.classList.contains('user');
      const bubble = row.querySelector('.bubble');
      if (bubble) {
        mdContent += `### ${isUser ? 'Usuario' : 'Core AI'}:\n${bubble.innerText}\n\n`;
      }
    });

    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-coreai-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });

  /* ------------------------------------------------------------------ */
  /* 9. Navegación Móvil                                                */
  /* ------------------------------------------------------------------ */
  menuToggleBtn.addEventListener('click', () => sidebar.classList.add('open'));
  closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));

  /* ------------------------------------------------------------------ */
  /* 10. Inicialización                                                 */
  /* ------------------------------------------------------------------ */
  initTheme();
  activePersonaPill.querySelector('span').innerText = activePersonaTitle;
  fetchHistory();
  autoResizeTextarea();
})();
