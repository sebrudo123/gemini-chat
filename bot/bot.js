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
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>';
    } else {
      button.disabled = false;
      if (button.dataset.label) button.textContent = button.dataset.label;
    }
  }

  function api(path, options) {
    options = options || {};
    options.headers = options.headers || {};
    if (state.token) options.headers.Authorization = "Bearer " + state.token;
    if (options.body && typeof options.body !== "string") {
      options.body = JSON.stringify(options.body);
      options.headers["Content-Type"] = "application/json";
    }
    return fetch(path, options).then(function (res) {
      return res
        .json()
        .catch(function () { return {}; })
        .then(function (data) {
          if (!res.ok) throw new Error(data.detail || res.statusText || "Error " + res.status);
          return data;
        });
    });
  }

  function showApp(logged) {
    $("loginView").style.display = logged ? "none" : "flex";
    $("appView").style.display = logged ? "flex" : "none";
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
    api("/api/admin/discord-bot")
      .then(function () { handleAuthSuccess(value); })
      .catch(function (err) {
        $("loginMsg").textContent = "El token no es válido para usar el panel. " + (err.message || "");
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
    document.querySelectorAll("nav.tabs button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.view === name);
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
        renderTestChannels();
        renderStats();
        renderConfigTexts();
      });
  }

  function refreshConfig() {
    return api("/api/admin/discord-bot/guilds/" + state.guildId + "/config")
      .then(function (data) { state.config = data.config || {}; });
  }

  function refreshAll() {
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
    $("botSub").textContent = state.bot && state.bot.user ? (state.bot.user + " · Core IA") : "Bot de Discord · panel de control";
    var hint = state.bot
      ? (ready
        ? "El bot está conectado y respondiendo comandos."
        : running
          ? "Conectando con Discord… si tarda, revisa el Server Members Intent."
          : "El bot está apagado. Enciéndelo con el botón de abajo.")
      : "—";
    if (state.bot && state.bot.last_error) hint += " Último error: " + state.bot.last_error;
    $("botHint").textContent = hint;
    $("setBotUser").textContent = state.bot && state.bot.user ? state.bot.user : "—";
  }

  function renderStats() {
    $("statGuilds").textContent = state.guilds.length;
    var channels = state.inventory ? state.inventory.channels || [] : [];
    var roles = state.inventory ? state.inventory.roles || [] : [];
    $("statChannels").textContent = channels.length;
    $("statRoles").textContent = roles.length;
    $("statVerify").textContent = state.config && state.config.verify_role_id ? "ACTIVA" : "—";
    $("setGuildId").textContent = state.guildId || "—";
    var guild = state.guilds.find(function (g) { return g.id === state.guildId; });
    $("guildTitle").textContent = guild ? guild.name : "Core IA Bot";
  }

  function guildIcon(guild) {
    if (guild.icon) return "https://cdn.discordapp.com/icons/" + guild.id + "/" + guild.icon + ".png?size=64";
    return "";
  }

  function renderGuilds() {
    var wrap = $("guildList");
    wrap.innerHTML = "";
    if (!state.guilds.length) {
      wrap.innerHTML = "<div class='empty'>El bot aún no está en ningún servidor. Invítalo primero.</div>";
      return;
    }
    state.guilds.forEach(function (guild) {
      var item = document.createElement("div");
      item.className = "item" + (guild.id === state.guildId ? " sel" : "");
      item.onclick = function () {
        state.guildId = guild.id;
        localStorage.setItem("coreia_bot_guild", guild.id);
        renderStats();
        refreshInventory();
        toast("Servidor cambiado a " + guild.name, "ok");
      };
      var icon = guildIcon(guild);
      item.innerHTML =
        "<div class='ico'>" + (icon ? "<img src='" + icon + "' style='width:100%;height:100%;border-radius:10px'/>" : "🏰") + "</div>" +
        "<div class='meta'><b>" + escapeHtml(guild.name) + "</b>" +
        "<span>" + (guild.member_count ? guild.member_count + " miembros" : guild.id) + "</span></div>" +
        "<div class='right'>" + guild.id + (guild.id === state.guildId ? "<br><span class='badge-check'>✓ activo</span>" : "") + "</div>";
      wrap.appendChild(item);
    });
  }

  function channelOptions(kind, selectedId) {
    var channels = (state.inventory && state.inventory.channels) || [];
    var text = channels.filter(function (c) { return c.text; });
    var options = "<option value=''>— sin canal —</option>";
    text.forEach(function (channel) {
      var isNumber = kind === "number";
      options +=
        "<option value='" + channel.id + "'" +
        (channel.id === selectedId ? " selected" : "") + ">" +
        "#" + escapeHtml(channel.name) +
        (isNumber ? " (" + channel.id + ")" : "") + "</option>";
    });
    return options;
  }

  function renderChannelSelects() {
    if (!state.inventory) return;
    $("cfgVerifyChannel").innerHTML = channelOptions("name", state.config.verify_channel_id);
    $("cfgWelcomeChannel").innerHTML = channelOptions("name", state.config.welcome_channel_id);
    $("cfgGoodbyeChannel").innerHTML = channelOptions("name", state.config.goodbye_channel_id);
    $("cfgLogChannel").innerHTML = channelOptions("name", state.config.log_channel_id);
    $("noChannels").style.display = "none";
    $("channelConfig").style.display = "block";
  }

  function renderTestChannels() {
    if (!state.inventory) return;
    if (!$("testChannel").dataset.ready) {
      $("testChannel").innerHTML = channelOptions("name", null);
      $("testChannel").dataset.ready = "1";
    }
  }

  function roleOptions(selectedId) {
    var roles = (state.inventory && state.inventory.roles) || [];
    var options = "<option value=''>— sin rol —</option>";
    roles.forEach(function (role) {
      if (role.default) return;
      options +=
        "<option value='" + role.id + "'" +
        (role.id === selectedId ? " selected" : "") + ">" +
        "@" + escapeHtml(role.name) +
        (role.managed ? " 🔒" : "") + "</option>";
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
      var color = role.color ? "#" + role.color.toString(16).padStart(6, "0") : "";
      item.className = "item";
      item.innerHTML =
        "<div class='role-dot' " + (color ? "style='background:" + color + "'" : "") + "></div>" +
        "<div class='meta'><b>" + escapeHtml(role.name) +
        (role.managed ? "<span class='tag'>integración</span>" : "") +
        (role.default ? "<span class='tag muted'>@everyone</span>" : "") + "</b>" +
        "<span>" + role.id + "</span></div>" +
        "<div class='right'>" + (state.config.verify_role_id === role.id ? "✅ verificado" : "") + "</div>";
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
  /* Acciones del bot                                            */
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
    botAction("sync").then(function () { toast("Comandos de barra sincronizados.", "ok"); })
      .catch(function (err) { toast(err.message || "No se pudo sincronizar.", "err"); })
      .finally(function () { busy($("btnSync"), false); });
  }

  function sendMessage() {
    var channel = $("testChannel").value;
    var content = $("testContent").value.trim();
    if (!channel) return toast("Elige un canal de texto para la prueba.", "err");
    if (!content) return toast("Escribe el contenido del mensaje.", "err");
    busy($("btnTest"), true);
    api("/api/admin/discord-bot/guilds/" + state.guildId + "/test-message", {
      method: "POST",
      body: { channel_id: channel, content: content },
    })
      .then(function () {
        toast("Mensaje enviado.", "ok");
        $("testContent").value = "";
      })
      .catch(function (err) { toast(err.message || "No se pudo enviar.", "err"); })
      .finally(function () { busy($("btnTest"), false); });
  }

  /* ---------------------------------------------------------- */
  /* Arranque                                                    */
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

    // Limpia el hash para que el token no quede en la barra ni en el historial.
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
      // Solo guarda el token: el bloque de arranque valida la sesión contra el backend.
      state.token = decodeURIComponent(token[1]);
      localStorage.setItem(TOKEN_KEY, state.token);
    }
  }

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
    $("btnTest").onclick = sendMessage;

    $("btnSaveChannels").onclick = function () {
      saveConfig({
        verify_channel_id: $("cfgVerifyChannel").value,
        welcome_channel_id: $("cfgWelcomeChannel").value,
        goodbye_channel_id: $("cfgGoodbyeChannel").value,
        log_channel_id: $("cfgLogChannel").value,
      }, "Canales guardados.").then(function () {
        renderStats();
      });
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

    document.querySelectorAll("nav.tabs button").forEach(function (btn) {
      btn.onclick = function () { switchView(btn.dataset.view); };
    });

    document.querySelectorAll(".chips").forEach(function (group) {
      var target = $(group.dataset.for);
      if (!target) return;
      group.querySelectorAll(".chip").forEach(function (chip) {
        chip.onclick = function () {
          var start = target.selectionStart || target.value.length;
          target.value = target.value.slice(0, start) + chip.textContent + target.value.slice(target.selectionEnd || target.value.length);
          target.focus();
          toast("Placeholder " + chip.textContent + " añadido.", "ok");
        };
      });
    });

    $("loginPass").addEventListener("keydown", function (e) {
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
