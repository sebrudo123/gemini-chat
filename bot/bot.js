/* Core IA Bot — panel de administración del bot de Discord. */
(function () {
  "use strict";

  var TOKEN_KEY = "coreia_bot_token";
  var FALLBACK_TOKEN_KEY = "coreia_token";

  var state = {
    token: localStorage.getItem(TOKEN_KEY) || localStorage.getItem(FALLBACK_TOKEN_KEY) || "",
    bot: null,
    guilds: [],
    guildId: localStorage.getItem("coreia_bot_guild") || "",
    inventory: null,
    config: {},
  };

  var $ = function (id) { return document.getElementById(id); };

  function toast(message, kind) {
    var el = $("toast");
    el.textContent = message;
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.className = "toast"; }, 2800);
  }

  function busy(button, on) {
    if (!button) return;
    if (on) {
      button.dataset.label = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>';
    } else {
      button.disabled = false;
      if (button.dataset.label) button.innerHTML = button.dataset.label;
    }
  }

  function api(path, options) {
    options = options || {};
    options.headers = options.headers || {};
    if (state.token) options.headers.Authorization = options.headers.Authorization || ("Bearer " + state.token);
    if (options.body && typeof options.body !== "string") {
      options.body = JSON.stringify(options.body);
      options.headers["Content-Type"] = "application/json";
    }
    return fetch(path, options).then(function (res) {
      return res
        .text()
        .then(function (text) {
          var data = {};
          try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { detail: text && text.slice ? text.slice(0, 200) : "" }; }
          if (!res.ok) throw new Error(data.detail || res.statusText || "Error " + res.status);
          return data;
        });
    });
  }

  function showApp(logged) {
    $("loginView").style.display = logged ? "none" : "flex";
    $("appView").style.display = logged ? "block" : "none";
    if (logged) refreshAll();
  }

  function handleAuthSuccess(token) {
    state.token = token;
    localStorage.setItem(TOKEN_KEY, token);
    showApp(true);
  }

  /* ---------------------------------------------------------- */
  /* Login                                                       */
  /* ---------------------------------------------------------- */
  function loginEmail() {
    var email = $("loginEmail").value.trim();
    var pass = $("loginPass").value;
    if (!email || !pass) return $("loginMsg").textContent = "Rellena el correo y la contraseña.";
    $("loginMsg").className = "msgbox";
    busy($("loginBtn"), true);
    api("/api/auth/login", { method: "POST", body: { email: email, password: pass } })
      .then(function (data) {
        if (data.requires_2fa) {
          var code = prompt("Introduce el código de 2 pasos (TOTP):");
          if (!code) throw new Error("Se necesita el código de verificación en dos pasos.");
          return api("/api/auth/2fa/verify", {
            method: "POST",
            body: { pending_token: data.pending_token, code: code.trim() },
          });
        }
        return data;
      })
      .then(function (data) {
        if (data && data.token) handleAuthSuccess(data.token);
      })
      .catch(function (err) {
        $("loginMsg").textContent = err.message || "No se pudo iniciar sesión.";
        $("loginMsg").className = "msgbox err show";
      })
      .finally(function () { busy($("loginBtn"), false); });
  }

  function loginToken() {
    var value = $("loginToken").value.trim();
    if (!value) return toast("Pega primero un token.", "err");
    $("loginMsg").className = "msgbox";
    busy($("tokenBtn"), true);
    // Valida SIEMPRE el token que acaba de pegar el usuario, no el antiguo.
    api("/api/admin/discord-bot", { headers: { Authorization: "Bearer " + value } })
      .then(function (data) {
        state.token = value;
        state.bot = data.bot;
        localStorage.setItem(TOKEN_KEY, value);
        showApp(true);
      })
      .catch(function (err) {
        $("loginMsg").textContent = /403|fundador|permisos/i.test(err.message || "")
          ? "No tienes permisos para usar este panel. Solo el fundador de Core IA."
          : "El token no es válido para usar el panel. " + (err.message || "");
        $("loginMsg").className = "msgbox err show";
      })
      .finally(function () { busy($("tokenBtn"), false); });
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    state.token = "";
    state.bot = null;
    state.guilds = [];
    state.inventory = null;
    showApp(false);
  }

  /* ---------------------------------------------------------- */
  /* Navegación                                                  */
  /* ---------------------------------------------------------- */
  function switchView(name) {
    document.querySelectorAll("nav.tabs button, .gear-btn").forEach(function (btn) {
      if (btn.classList.contains("gear-btn") && btn.dataset.goto === name) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
        if (!btn.classList.contains("gear-btn")) btn.classList.toggle("active", btn.dataset.view === name);
      }
    });
    document.querySelectorAll("section.view").forEach(function (view) {
      view.classList.toggle("active", view.id === "view-" + name);
    });
  }

  /* ---------------------------------------------------------- */
  /* Datos                                                       */
  /* ---------------------------------------------------------- */
  function refreshBot() {
    return api("/api/admin/discord-bot").then(function (data) {
      state.bot = data.bot;
      renderBotStatus();
    });
  }

  function refreshGuilds() {
    return api("/api/admin/discord-bot/guilds").then(function (data) {
      state.guilds = data.guilds || [];
      if (!state.guildId && state.guilds.length) state.guildId = state.guilds[0].id;
      renderGuilds();
      renderStats();
    });
  }

  function refreshInventory() {
    if (!state.guildId) return Promise.resolve();
    return api("/api/admin/discord-bot/guilds/" + state.guildId + "/inventory")
      .then(function (data) {
        state.inventory = data;
        return refreshConfig();
      })
      .then(function () {
        renderGuilds();
        renderChannelSelects();
        renderRoleSelects();
        renderRoleList();
        renderTextSelects();
        renderStats();
        renderConfigTexts();
      });
  }

  function refreshConfig() {
    return api("/api/admin/discord-bot/guilds/" + state.guildId + "/config")
      .then(function (data) { state.config = data.config || {}; });
  }

  function refreshAll() {
    switchView("resumen");
    refreshBot()
      .then(refreshGuilds)
      .then(refreshInventory)
      .catch(function (err) { toast(err.message || "No se pudieron cargar los datos.", "err"); });
  }

  function saveConfig(values, successMessage) {
    if (!state.guildId) {
      toast("Selecciona antes un servidor.", "err");
      return Promise.resolve();
    }
    return api("/api/admin/discord-bot/guilds/" + state.guildId + "/config", {
      method: "PATCH",
      body: { values: values },
    })
      .then(function (data) {
        state.config = data.config || {};
        toast(successMessage || "Guardado.", "ok");
      })
      .catch(function (err) { toast(err.message || "No se pudo guardar.", "err"); });
  }

  /* ---------------------------------------------------------- */
  /* Render                                                      */
  /* ---------------------------------------------------------- */
  function renderBotStatus() {
    var running = !!(state.bot && state.bot.running);
    var ready = !!(state.bot && state.bot.ready);
    var dot = $("botStatusDot");
    dot.className = "dot " + (ready ? "on" : running ? "idle" : "off");
    $("botStatusText").textContent = ready ? "EN LÍNEA" : running ? "CONECTANDO" : "APAGADO";

    $("heroName").textContent = (state.bot && state.bot.user && state.bot.user.split("#")[0]) || "Core IA";
    $("heroUser").textContent = ready ? state.bot.user : "Bot de Discord";
    $("botSub").textContent = ready
      ? "Bot listo y respondiendo comandos"
      : running ? "Conectando con Discord…" : "Bot apagado";

    var start = $("btnStart");
    var stop = $("btnStop");
    start.classList.toggle("on-active", !running);
    stop.classList.toggle("on-active", running);
    stop.classList.toggle("ghostish", !running);

    var hint = state.bot
      ? (ready
        ? "El bot está conectado y responde a los comandos."
        : running
          ? "Conectando… si se queda así, revisa el Server Members Intent en el portal de Discord."
          : "Pulsa Encender para conectar el bot.")
      : "—";
    if (state.bot && state.bot.last_error) hint += " Último error: " + state.bot.last_error;
    $("botHint").textContent = hint;
    $("setBotUser").textContent = state.bot && state.bot.user ? state.bot.user : "—";
  }

  function renderStats() {
    var channels = state.inventory ? state.inventory.channels || [] : [];
    var roles = state.inventory ? state.inventory.roles || [] : [];
    $("statGuilds").textContent = state.guilds.length;
    $("statChannels").textContent = channels.length;
    $("statRoles").textContent = roles.length;
    $("statVerify").textContent = state.config && state.config.verify_role_id ? "ACTIVA" : "—";
    $("setGuildId").textContent = state.guildId || "—";
    var guild = state.guilds.find(function (g) { return g.id === state.guildId; });
    $("guildTitle").textContent = guild ? guild.name : "Core IA Bot";
  }

  function renderGuilds() {
    var wrap = $("guildList");
    wrap.innerHTML = "";
    if (!state.guilds.length) {
      wrap.innerHTML = "<div class='empty'>El bot aún no está en ningún servidor. Invítalo primero desde la app de Discord.</div>";
      return;
    }
    state.guilds.forEach(function (guild) {
      var item = document.createElement("div");
      item.className = "row-item" + (guild.id === state.guildId ? " sel" : "");
      item.onclick = function () {
        state.guildId = guild.id;
        localStorage.setItem("coreia_bot_guild", guild.id);
        renderStats();
        refreshInventory();
        switchView("resumen");
        toast("Servidor activo: " + guild.name, "ok");
      };
      var icon = guild.icon
        ? "<img src='https://cdn.discordapp.com/icons/" + guild.id + "/" + guild.icon + ".png?size=64' alt=''/>"
        : "<svg class='ic'><use href='#ic-globe'/></svg>";
      var members = guild.member_count ? guild.member_count + " miembros" : guild.id;
      item.innerHTML =
        "<div class='ico'>" + icon + "</div>" +
        "<div class='meta'><b>" + escapeHtml(guild.name) + "</b><span>" + escapeHtml(members) + "</span></div>" +
        "<div class='end'>" + (guild.id === state.guildId
          ? "<svg class='ic'><use href='#ic-check'/></svg>"
          : "<svg class='ic'><use href='#ic-chevron'/></svg>") + "</div>";
      wrap.appendChild(item);
    });
  }

  function channelOptions(selectedId) {
    var channels = (state.inventory && state.inventory.channels) || [];
    var options = "<option value=''>— sin canal —</option>";
    channels.filter(function (c) { return c.text; }).forEach(function (channel) {
      options +=
        "<option value='" + channel.id + "'" + (channel.id === selectedId ? " selected" : "") + ">" +
        "#" + escapeHtml(channel.name) + "</option>";
    });
    return options;
  }

  function renderChannelSelects() {
    if (!state.inventory) return;
    $("cfgVerifyChannel").innerHTML = channelOptions(state.config.verify_channel_id);
    $("cfgWelcomeChannel").innerHTML = channelOptions(state.config.welcome_channel_id);
    $("cfgGoodbyeChannel").innerHTML = channelOptions(state.config.goodbye_channel_id);
    $("cfgLogChannel").innerHTML = channelOptions(state.config.log_channel_id);
  }

  function renderTextSelects() {
    if (!state.inventory) return;
    if (!$("testChannel").dataset.ready) {
      $("testChannel").innerHTML = channelOptions(null);
      $("testChannel").dataset.ready = "1";
    }
    if (!$("announceChannel").dataset.ready) {
      $("announceChannel").innerHTML = channelOptions(null);
      $("announceChannel").dataset.ready = "1";
    }
  }

  function roleOptions(selectedId) {
    var roles = (state.inventory && state.inventory.roles) || [];
    var options = "<option value=''>— sin rol —</option>";
    roles.forEach(function (role) {
      if (role.default) return;
      options +=
        "<option value='" + role.id + "'" + (role.id === selectedId ? " selected" : "") + ">" +
        "@" + escapeHtml(role.name) + (role.managed ? " 🔒" : "") + "</option>";
    });
    return options;
  }

  function renderRoleSelects() {
    if (!state.inventory) return;
    $("cfgVerifyRole").innerHTML = roleOptions(state.config.verify_role_id);
    $("cfgUnverifiedRole").innerHTML = roleOptions(state.config.unverified_role_id);
    $("cfgMinAge").value = state.config.min_account_age_days || "0";
  }

  function renderRoleList() {
    var wrap = $("roleList");
    wrap.innerHTML = "";
    if (!state.inventory) {
      wrap.innerHTML = "<div class='skeleton'>Selecciona un servidor primero.</div>";
      return;
    }
    var roles = state.inventory.roles || [];
    if (!roles.length) { wrap.innerHTML = "<div class='empty'>No hay roles en el servidor.</div>"; return; }
    roles.forEach(function (role) {
      var item = document.createElement("div");
      item.className = "row-item";
      var color = role.color ? "#" + role.color.toString(16).padStart(6, "0") : "";
      item.innerHTML =
        "<div class='ico'><span class=\"role-dot\" style=\"width:12px;height:12px;border-radius:50%;background:" +
        (color || "var(--faint)") + "\"></span></div>" +
        "<div class='meta'><b>" + escapeHtml(role.name) +
        (role.managed ? "<span class='tag'>integración</span>" : "") +
        (role.default ? "<span class='tag gray'>@everyone</span>" : "") + "</b>" +
        "<span>" + role.id + "</span></div>" +
        "<div class='end'>" + (state.config.verify_role_id === role.id
          ? "<svg class='ic'><use href='#ic-check'/></svg>" : "") + "</div>";
      wrap.appendChild(item);
    });
  }

  function renderConfigTexts() {
    $("cfgWelcomeMsg").value = state.config.welcome_message || "";
    $("cfgGoodbyeMsg").value = state.config.goodbye_message || "";
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(String(text || "")));
    return div.innerHTML;
  }

  /* ---------------------------------------------------------- */
  /* Acciones                                                    */
  /* ---------------------------------------------------------- */
  function botAction(path, method) {
    return api("/api/admin/discord-bot/" + path, { method: method || "POST" }).then(function (data) {
      state.bot = data.bot || null;
      renderBotStatus();
      return data;
    });
  }

  function start() {
    busy($("btnStart"), true);
    botAction("start").then(function () { toast("Bot en marcha.", "ok"); })
      .catch(function (err) { toast(err.message || "No se pudo encender.", "err"); })
      .finally(function () { busy($("btnStart"), false); });
  }

  function stop() {
    busy($("btnStop"), true);
    botAction("stop").then(function () { toast("Bot apagado.", "ok"); })
      .catch(function (err) { toast(err.message || "No se pudo apagar.", "err"); })
      .finally(function () { busy($("btnStop"), false); });
  }

  function sync() {
    busy($("btnSync"), true);
    botAction("sync").then(function () { toast("Comandos sincronizados.", "ok"); })
      .catch(function (err) { toast(err.message || "No se pudo sincronizar.", "err"); })
      .finally(function () { busy($("btnSync"), false); });
  }

  function sendTest() {
    var channel = $("testChannel").value;
    var content = $("testContent").value.trim();
    if (!channel) return toast("Elige un canal de texto.", "err");
    if (!content) return toast("Escribe el contenido.", "err");
    busy($("btnTest"), true);
    api("/api/admin/discord-bot/guilds/" + state.guildId + "/test-message", {
      method: "POST",
      body: { channel_id: channel, content: content },
    })
      .then(function () { toast("Mensaje enviado.", "ok"); $("testContent").value = ""; })
      .catch(function (err) { toast(err.message || "No se pudo enviar.", "err"); })
      .finally(function () { busy($("btnTest"), false); });
  }

  function sendAnnouncement() {
    var channel = $("announceChannel").value;
    var content = $("announceContent").value.trim();
    if (!channel) return toast("Elige un canal para el anuncio.", "err");
    if (!content) return toast("Escribe el anuncio.", "err");
    busy($("btnAnnounce"), true);
    api("/api/admin/discord-bot/guilds/" + state.guildId + "/test-message", {
      method: "POST",
      body: { channel_id: channel, content: content },
    })
      .then(function () { toast("Anuncio publicado.", "ok"); $("announceContent").value = ""; })
      .catch(function (err) { toast(err.message || "No se pudo publicar el anuncio.", "err"); })
      .finally(function () { busy($("btnAnnounce"), false); });
  }

  /* ---------------------------------------------------------- */
  /* Login con Discord, 2FA y hash de retorno                    */
  /* ---------------------------------------------------------- */
  function handlePending2fa(pendingToken) {
    var code = prompt("Introduce el código de 2 pasos (TOTP):");
    if (!code) return showApp(false);
    busy($("loginBtn"), true);
    api("/api/auth/2fa/verify", {
      method: "POST",
      body: { pending_token: pendingToken, code: code.trim() },
    })
      .then(function (data) { handleAuthSuccess(data.token); })
      .catch(function (err) {
        $("loginMsg").textContent = err.message || "No se pudo completar el login.";
        $("loginMsg").className = "msgbox err show";
        showApp(false);
      })
      .finally(function () { busy($("loginBtn"), false); });
  }

  function consumeHash() {
    var hash = window.location.hash || "";
    if (!hash) return;

    var token = hash.match(/#token=([^&]+)/);
    var pending = hash.match(/#pending2fa=([^&]+)/);

    history.replaceState(null, "", window.location.pathname + window.location.search);

    if (hash.indexOf("#denied=1") !== -1) {
      $("loginMsg").textContent =
        "No tienes permisos para usar este panel. Solo el fundador de Core IA puede entrar.";
      $("loginMsg").className = "msgbox err show";
      localStorage.removeItem(TOKEN_KEY);
      state.token = "";
      showApp(false);
      return;
    }
    if (pending && pending[1]) {
      state.token = "";
      showApp(false);
      handlePending2fa(decodeURIComponent(pending[1]));
      return;
    }
    if (token && token[1]) {
      // Solo guarda el token: la validación ocurre contra el backend al arrancar.
      state.token = decodeURIComponent(token[1]);
      localStorage.setItem(TOKEN_KEY, state.token);
    }
  }

  /* ---------------------------------------------------------- */
  /* Bindings                                                    */
  /* ---------------------------------------------------------- */
  function bind() {
    $("discordBtn").onclick = function () {
      window.location.href = "/api/admin/discord-bot/login";
    };
    $("loginBtn").onclick = loginEmail;
    $("tokenBtn").onclick = loginToken;
    $("btnLogout").onclick = logout;
    $("btnStart").onclick = start;
    $("btnStop").onclick = stop;
    $("btnSync").onclick = sync;
    $("btnTest").onclick = sendTest;
    $("btnAnnounce").onclick = sendAnnouncement;

    $("btnSaveChannels").onclick = function () {
      saveConfig({
        verify_channel_id: $("cfgVerifyChannel").value,
        welcome_channel_id: $("cfgWelcomeChannel").value,
        goodbye_channel_id: $("cfgGoodbyeChannel").value,
        log_channel_id: $("cfgLogChannel").value,
      }, "Canales guardados.").then(renderStats);
    };

    $("btnSaveRoles").onclick = function () {
      saveConfig({
        verify_role_id: $("cfgVerifyRole").value,
        unverified_role_id: $("cfgUnverifiedRole").value,
        min_account_age_days: String(parseInt($("cfgMinAge").value || "0", 10) || 0),
      }, "Roles guardados.").then(function () {
        renderStats();
        renderRoleList();
      });
    };

    $("btnSaveWelcome").onclick = function () {
      saveConfig({ welcome_message: $("cfgWelcomeMsg").value }, "Bienvenida guardada.");
    };

    $("btnSaveGoodbye").onclick = function () {
      saveConfig({ goodbye_message: $("cfgGoodbyeMsg").value }, "Despedida guardada.");
    };

    $("btnReload").onclick = function () {
      busy($("btnReload"), true);
      refreshAll().finally(function () { busy($("btnReload"), false); });
    };

    document.querySelectorAll("nav.tabs button, .gear-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchView(btn.dataset.view || btn.dataset.goto);
      });
    });

    document.querySelectorAll(".chips").forEach(function (group) {
      var target = $(group.dataset.for);
      if (!target) return;
      group.querySelectorAll(".chip").forEach(function (chip) {
        chip.onclick = function () {
          var start2 = target.selectionStart || target.value.length;
          target.value = target.value.slice(0, start2) + chip.textContent +
            target.value.slice(target.selectionEnd || target.value.length);
          target.focus();
          toast("Placeholder " + chip.textContent + " añadido.", "ok");
        };
      });
    });

    $("loginPass").addEventListener("keydown", function (e) {
      if (e.key === "Enter") loginEmail();
    });
    $("loginEmail").addEventListener("keydown", function (e) {
      if (e.key === "Enter") loginEmail();
    });
  }

  bind();
  consumeHash();
  if (state.token) {
    api("/api/admin/discord-bot")
      .then(function (data) {
        state.bot = data.bot;
        showApp(true);
      })
      .catch(function (err) {
        localStorage.removeItem(TOKEN_KEY);
        state.token = "";
        $("loginMsg").textContent =
          err && /403|fundador|permisos/i.test(err.message)
            ? "No tienes permisos para usar este panel. Solo el fundador de Core IA."
            : "Tu sesión ya no es válida. Vuelve a entrar.";
        $("loginMsg").className = "msgbox err show";
        showApp(false);
      });
  } else {
    showApp(false);
  }
})();
