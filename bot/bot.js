/* Core IA Bot — panel de administración del bot de Discord. */

/* Diagnóstico a la vista: si algo falla al arrancar, se PINTA en pantalla
   (banner rojo) con el error y la versión de la app. Así un fallo silencioso
   del WebView nunca vuelve a parecer "botones muertos". */
(function () {
  function helmet(message, extra) {
    try {
      var box = document.getElementById("bootError");
      if (!box) {
        box = document.createElement("div");
        box.id = "bootError";
        box.style.cssText =
          "position:fixed;top:0;left:0;right:0;z-index:2147483000;" +
          "background:#4a1520;color:#ffd9de;font:12px/1.45 monospace;" +
          "padding:10px 12px;white-space:pre-wrap;max-height:45vh;overflow:auto;";
        (document.body || document.documentElement).appendChild(box);
      }
      var app = "navegador";
      try {
        if (window.CoreIAUpdate && window.CoreIAUpdate.getVersionCode) {
          app = "APK " + window.CoreIAUpdate.getVersionCode();
        }
      } catch (err) { /* sin puente */ }
      box.textContent = (box.textContent ? box.textContent + "\n---\n" : "") +
        "[error] " + message + (extra ? "\n" + String(extra).slice(0, 400) : "") +
        "\n[app] " + app + " · " + String(navigator.userAgent || "").slice(0, 90);
    } catch (err) { /* sin salida posible */ }
  }
  window.__coreiaBootError = helmet;
  window.addEventListener("error", function (e) {
    if (e && e.error) helmet(e.message, e.error.stack);
    else helmet((e && e.message) || "error desconocido");
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    helmet(
      "promesa sin catch: " + ((r && (r.message || r.statusText)) || String(r) || "—"),
      r && r.stack
    );
  });
})();

(function () {
  try {
  "use strict";

  var TOKEN_KEY = "coreia_bot_token";
  var FALLBACK_TOKEN_KEY = "coreia_token";
  var PANEL_VERSION = "1.0.22";

  /* Storage seguro: si el WebView bloquea localStorage (algo que pasa en
     algunos Android viejos), el panel sigue funcionando con memoria. */
  var LS = (function () {
    try {
      window.localStorage.setItem("coreia_ls_test", "1");
      window.localStorage.removeItem("coreia_ls_test");
      return window.localStorage;
    } catch (err) {
      var mem = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; },
      };
    }
  })();

  /* Query string sin URLSearchParams (ausente en WebViews antiguos). */
  var qsParam = function (name) {
    var search = String(window.location.search || "");
    var match = search.match(new RegExp("[?&]" + name + "=([^&]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  };

  /* Cuando el panel vive en Vercel (estático) las llamadas van a la API de
     Render; en Render el origen ya es el correcto. ?api= fuerza otro destino. */
  var API_BASE = (function () {
    var forced = qsParam("api");
    if (forced) {
      LS.setItem("coreia_api", forced);
      return forced;
    }
    var saved = LS.getItem("coreia_api");
    if (saved) return saved;
    return window.location.hostname.indexOf("vercel.app") !== -1
      ? "https://gemini-chat-backend-vyrz.onrender.com"
      : "";
  })();

  var state = {
    token: LS.getItem(TOKEN_KEY) || LS.getItem(FALLBACK_TOKEN_KEY) || "",
    bot: null,
    guilds: [],
    guildId: LS.getItem("coreia_bot_guild") || "",
    inventory: null,
    config: {},
  };

  /* Modo app (la APK abre el panel con ?ui=app): nunca se muestra el login
     web; hay una pantalla de carga y, si la sesión caduca, se le avisa a la
     app nativa (CoreIAAndroid.onAuthFailed) para volver al login propio. */
  var appMode = qsParam("ui") === "app";

  /* Puente con la APK nativa: cuando corre dentro de la app Android, la barra
     inferior y el splash son nativos y el panel adapta su layout. */
  var nativeBridge = window.CoreIAAndroid || null;
  try {
    if (nativeBridge && document.body && !document.body.classList.contains("native-ui")) {
      document.body.classList.add("native-ui");
    }
  } catch (err) { /* navegador normal: sin puente */ }

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
    return fetch(API_BASE + path, options).then(function (res) {
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
    $("loginView").style.display = logged || appMode ? "none" : "flex";
    $("appView").style.display = logged ? "block" : "none";
    if (appMode) appBootOverlay(false);
    try {
      if (nativeBridge && nativeBridge.onLoginState) nativeBridge.onLoginState(!!logged);
    } catch (err) { /* fuera de la APK */ }
    if (logged) refreshAll();
  }

  function appBootOverlay(show) {
    var el = $("appBoot");
    if (el) el.style.display = show ? "flex" : "none";
  }

  function handleAuthSuccess(token) {
    state.token = token;
    LS.setItem(TOKEN_KEY, token);
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
        LS.setItem(TOKEN_KEY, value);
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
    LS.removeItem(TOKEN_KEY);
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
    try {
      if (nativeBridge && nativeBridge.onView) nativeBridge.onView(String(name));
    } catch (err) { /* fuera de la APK */ }
    if (name === "extras") {
      refreshRoleMenus(); refreshPolls(); refreshLevels(); refreshGiveaways(); refreshReminders();
    }
    if (name === "anuncios") { refreshSchedules(); refreshFeeds(); }
    if (name === "ajustes") refreshEvents();
    if (name === "resumen") { refreshBotStats(); refreshMemberStats(); refreshModLog(); }
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
        renderRmRoles();
        renderExtraSelects();
        renderDmTexts();
        refreshBotStats();
        refreshMemberStats();
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
        LS.setItem("coreia_bot_guild", guild.id);
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
    $("cfgUpdateChannel").innerHTML = channelOptions(state.config.update_channel_id);
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
    ["rmChannel", "pollChannel", "schChannel"].forEach(function (id) {
      if (!$(id).dataset.ready) {
        $(id).innerHTML = channelOptions(null);
        $(id).dataset.ready = "1";
      }
    });
    if (!$("schHour").dataset.ready) {
      var hours = "";
      for (var h = 0; h < 24; h++) {
        hours += "<option value='" + h + "'>" + String(h).padStart(2, "0") + ":00 UTC</option>";
      }
      $("schHour").innerHTML = hours;
      $("schHour").dataset.ready = "1";
    }
  }

  function categoryOptions(selectedId) {
    var channels = (state.inventory && state.inventory.channels) || [];
    var options = "<option value=''>— sin categoría —</option>";
    channels.forEach(function (channel) {
      if (channel.type !== 4) return;
      options +=
        "<option value='" + channel.id + "'" + (channel.id === selectedId ? " selected" : "") + ">" +
        escapeHtml(channel.name) + "</option>";
    });
    return options;
  }

  function renderExtraSelects() {
    if (!state.inventory) return;
    $("cfgLevelupChannel").innerHTML = channelOptions(state.config.levelup_channel_id);
    $("cfgTicketCategory").innerHTML = categoryOptions(state.config.ticket_category_id);
    $("cfgTicketStaffRole").innerHTML = roleOptions(state.config.ticket_staff_role_id);
    $("cfgVoiceLobby").innerHTML = voiceOptions(state.config.voice_lobby_id);
    ["ticketChannel", "gwChannel", "fdChannel"].forEach(function (id) {
      if (!$(id).dataset.ready) {
        $(id).innerHTML = channelOptions(null);
        $(id).dataset.ready = "1";
      }
    });
  }

  function renderRmRoles() {
    var wrap = $("rmRoleList");
    wrap.innerHTML = "";
    var roles = ((state.inventory && state.inventory.roles) || []).filter(function (role) {
      return !role.default && !role.managed;
    });
    if (!roles.length) {
      wrap.innerHTML = "<div class='empty'>No hay roles gestionables (sin integración) en este servidor.</div>";
      return;
    }
    roles.slice(0, 25).forEach(function (role) {
      var line = document.createElement("label");
      line.className = "checkrow";
      line.innerHTML = "<input type='checkbox' value='" + role.id + "'>";
      var dot = "<span class='role-dot' style='width:11px;height:11px;border-radius:50%;background:#" +
        (role.color ? role.color.toString(16).padStart(6, "0") : "6b7280") + "'></span>";
      line.insertAdjacentHTML("beforeend", dot + "<span>" + escapeHtml(role.name) + "</span>");
      wrap.appendChild(line);
    });
  }

  function voiceOptions(selectedId) {
    var channels = (state.inventory && state.inventory.channels) || [];
    var options = "<option value=''>— sin lobby —</option>";
    channels.filter(function (c) { return c.type === 2; }).forEach(function (channel) {
      options +=
        "<option value='" + channel.id + "'" + (channel.id === selectedId ? " selected" : "") + ">" +
        escapeHtml(channel.name) + "</option>";
    });
    return options;
  }

  function roleOptions(selectedId) {
    var roles = (state.inventory && state.inventory.roles) || [];
    var options = "<option value=''>— sin rol —</option>";
    roles.forEach(function (role) {
      if (role.default) return;
      options +=
        "<option value='" + role.id + "'" + (role.id === selectedId ? " selected" : "") + ">" +
        "@" + escapeHtml(role.name) + (role.managed ? " (integración)" : "") + "</option>";
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
    var flag = function (key) {
      return ["1", "true", "on"].includes(String(state.config[key] || "").toLowerCase());
    };
    $("cfgWelcomeImage").checked = flag("welcome_image_enabled");
    $("cfgLevelsOn").checked = flag("levels_enabled");
    $("cfgWelcomeDmOn").checked = flag("welcome_dm_enabled");
    $("cfgAntiraidOn").checked = flag("antiraid_enabled");
    $("cfgAntispamOn").checked = flag("antispam_enabled");
    $("cfgVoiceTempOn").checked = flag("voice_temp_enabled");
    $("cfgTranscriptOn").checked = flag("ticket_transcript_enabled");
    $("cfgAntiraidJoins").value = state.config.antiraid_joins || "5";
    $("cfgAntiraidSecs").value = state.config.antiraid_secs || "60";
    $("cfgAntiraidMinAge").value = state.config.antiraid_min_age_days || "7";
    $("cfgAntiraidAction").value = state.config.antiraid_action || "kick";
    $("cfgAntispamMsgs").value = state.config.antispam_msgs || "6";
    $("cfgAntispamSecs").value = state.config.antispam_secs || "8";
    $("cfgAntispamMentions").value = state.config.antispam_mentions || "6";
  }

  function renderDmTexts() {
    $("cfgWelcomeDm").value = state.config.welcome_dm_message || "";
  }

  function refreshMemberStats() {
    api("/api/admin/discord-bot/member-stats").then(function (data) {
      var days = data.days || [];
      var welcomes = 0;
      var goodbyes = 0;
      days.forEach(function (day) {
        welcomes += Number(day.welcomes || 0);
        goodbyes += Number(day.goodbyes || 0);
      });
      $("msWelcomes").textContent = welcomes;
      $("msGoodbyes").textContent = goodbyes;
      $("msUsers").textContent =
        (state.inventory && state.inventory.guild && state.inventory.guild.member_count) || "—";
      $("msNet").textContent = (welcomes >= goodbyes ? "+" : "") + (welcomes - goodbyes);
    }).catch(function () { /* decorativo */ });
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
  /* Extras: stats, programados, menús de roles, encuestas,       */
  /* registros y respaldos                                        */
  /* ---------------------------------------------------------- */
  function refreshBotStats() {
    api("/api/admin/discord-bot/stats").then(function (data) {
      $("stMessages").textContent = data.messages_today;
      $("stVerifications").textContent = data.verifications;
      $("stWelcomes").textContent = data.welcomes;
      $("stScheduled").textContent = data.schedules_active;
      $("stRaid").textContent = data.antiraid_triggers || 0;
      $("stRaidBlocked").textContent = data.antiraid_blocked || 0;
      $("stWarn").textContent = data.antispam_warn || 0;
      $("stTimeout").textContent = (data.antispam_timeout || 0) + (data.antispam_kick || 0);
    }).catch(function () { /* silencioso: es decorativo */ });
  }

  var MOD_KIND_LABELS = {
    antiraid_trigger: "Modo raid activado",
    antiraid_block: "Entrada parada",
    antispam_warn: "Aviso de flood",
    antispam_timeout: "Silenciado (anti-spam)",
    antispam_kick: "Expulsado (anti-spam)",
    ticket_close: "Ticket cerrado",
    ticket_transcript: "Transcripción generada",
    voice_temp_created: "Sala temporal creada",
    voice_temp_closed: "Sala temporal borrada",
  };

  function modLogLabel(kind) {
    return MOD_KIND_LABELS[kind] || kind;
  }

  function refreshModLog() {
    return api("/api/admin/discord-bot/modlog?limit=40").then(function (data) {
      var wrap = $("modLogList");
      wrap.innerHTML = "";
      var events = data.events || [];
      if (!events.length) {
        wrap.innerHTML = "<div class='empty'>Sin sanciones ni incidentes aún. El registro aparecerá en cuanto la protección actúe.</div>";
        return;
      }
      events.forEach(function (event) {
        var row = document.createElement("div");
        row.className = "row-item";
        var icon = String(event.kind || "").indexOf("antiraid") === 0 ? "#ic-flag"
          : String(event.kind || "").indexOf("voice") === 0 ? "#ic-users"
          : String(event.kind || "").indexOf("ticket") === 0 ? "#ic-layers" : "#ic-message";
        row.innerHTML =
          "<div class='ico'><svg class='ic'><use href='" + icon + "'/></svg></div>" +
          "<div class='meta'><b>" + escapeHtml(modLogLabel(event.kind)) + "</b><span>" +
          escapeHtml(String(event.detail || "").slice(0, 80)) + " · " +
          escapeHtml(String(event.t || "").replace("T", " ")) + "</span></div>";
        wrap.appendChild(row);
      });
    }).catch(function (err) {
      $("modLogList").innerHTML = "<div class='empty'>" + escapeHtml(err.message || "Error") + "</div>";
    });
  }

  function scheduleLabel(item) {
    var at = String(item.hour_utc).padStart(2, "0") + ":00 UTC";
    if (item.kind === "weekly") {
      var days = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
      return "Semanal · " + (days[item.weekday] || "?") + " " + at;
    }
    return "Diario · " + at;
  }

  function refreshSchedules() {
    return api("/api/admin/discord-bot/schedules").then(function (data) {
      var wrap = $("scheduleList");
      wrap.innerHTML = "";
      var items = data.schedules || [];
      if (!items.length) {
        wrap.innerHTML = "<div class='empty'>Aún no hay mensajes programados.</div>";
        return;
      }
      items.forEach(function (item) {
        var row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML =
          "<div class='ico'><svg class='ic'><use href='#ic-clock'/></svg></div>" +
          "<div class='meta'><b>" + escapeHtml(scheduleLabel(item)) + "</b>" +
          "<span>" + escapeHtml(String(item.content || "").slice(0, 64)) + "</span></div>" +
          "<button class='btn' style='padding:8px 10px' aria-label='Borrar'>" +
          "<svg class='ic'><use href='#ic-trash'/></svg></button>";
        row.querySelector("button").onclick = function () {
          api("/api/admin/discord-bot/schedules/" + item.id, { method: "DELETE" })
            .then(function () { toast("Programación borrada.", "ok"); refreshSchedules(); })
            .catch(function (err) { toast(err.message || "No se pudo borrar.", "err"); });
        };
        wrap.appendChild(row);
      });
    }).catch(function (err) {
      $("scheduleList").innerHTML = "<div class='empty'>" + escapeHtml(err.message || "Error") + "</div>";
    });
  }

  function createSchedule() {
    var channel = $("schChannel").value;
    var content = $("schContent").value.trim();
    var kind = $("schKind").value;
    if (!state.guildId) return toast("Selecciona antes un servidor.", "err");
    if (!channel) return toast("Elige un canal.", "err");
    if (!content) return toast("Escribe el mensaje.", "err");
    busy($("btnSchedule"), true);
    api("/api/admin/discord-bot/schedules", {
      method: "POST",
      body: {
        guild_id: state.guildId,
        channel_id: channel,
        content: content,
        kind: kind,
        weekday: parseInt($("schWeekday").value || "0", 10),
        hour_utc: parseInt($("schHour").value || "12", 10),
      },
    })
      .then(function () { toast("Mensaje programado.", "ok"); $("schContent").value = ""; refreshSchedules(); })
      .catch(function (err) { toast(err.message || "No se pudo programar.", "err"); })
      .finally(function () { busy($("btnSchedule"), false); });
  }

  function refreshRoleMenus() {
    if (!state.guildId) return Promise.resolve();
    return api("/api/admin/discord-bot/guilds/" + state.guildId + "/role-menu").then(function (data) {
      var wrap = $("roleMenuList");
      wrap.innerHTML = "";
      var items = data.menus || [];
      if (!items.length) {
        wrap.innerHTML = "<div class='empty'>Sin menús de roles publicados.</div>";
        return;
      }
      items.forEach(function (menu) {
        var row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML =
          "<div class='ico'><svg class='ic'><use href='#ic-layers'/></svg></div>" +
          "<div class='meta'><b>" + escapeHtml(menu.title) + "</b>" +
          "<span>" + (menu.roles || []).length + " roles</span></div>" +
          "<button class='btn' style='padding:8px 10px' aria-label='Borrar'>" +
          "<svg class='ic'><use href='#ic-trash'/></svg></button>";
        row.querySelector("button").onclick = function () {
          api("/api/admin/discord-bot/guilds/" + state.guildId + "/role-menu/" + menu.menu_id, { method: "DELETE" })
            .then(function () { toast("Menú borrado del canal.", "ok"); refreshRoleMenus(); })
            .catch(function (err) { toast(err.message || "No se pudo borrar.", "err"); });
        };
        wrap.appendChild(row);
      });
    }).catch(function (err) {
      $("roleMenuList").innerHTML = "<div class='empty'>" + escapeHtml(err.message || "Error") + "</div>";
    });
  }

  function postRoleMenu() {
    var channel = $("rmChannel").value;
    var title = $("rmTitle").value.trim();
    var roleIds = [];
    $("rmRoleList").querySelectorAll("input:checked").forEach(function (input) {
      roleIds.push(input.value);
    });
    if (!state.guildId) return toast("Selecciona antes un servidor.", "err");
    if (!channel) return toast("Elige un canal.", "err");
    if (!title) return toast("Escribe un título para el menú.", "err");
    if (!roleIds.length) return toast("Elige al menos un rol.", "err");
    busy($("btnPostRoleMenu"), true);
    api("/api/admin/discord-bot/guilds/" + state.guildId + "/role-menu", {
      method: "POST",
      body: { channel_id: channel, title: title, role_ids: roleIds },
    })
      .then(function () { toast("Menú de roles publicado.", "ok"); $("rmTitle").value = ""; refreshRoleMenus(); })
      .catch(function (err) { toast(err.message || "No se pudo publicar.", "err"); })
      .finally(function () { busy($("btnPostRoleMenu"), false); });
  }

  function refreshPolls() {
    if (!state.guildId) return Promise.resolve();
    return api("/api/admin/discord-bot/guilds/" + state.guildId + "/polls").then(function (data) {
      var wrap = $("pollList");
      wrap.innerHTML = "";
      var items = data.polls || [];
      if (!items.length) {
        wrap.innerHTML = "<div class='empty'>Sin encuestas activas.</div>";
        return;
      }
      items.forEach(function (poll) {
        var votes = (poll.options || []).reduce(function (sum, option) {
          return sum + (option.votes || 0);
        }, 0);
        var row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML =
          "<div class='ico'><svg class='ic'><use href='#ic-poll'/></svg></div>" +
          "<div class='meta'><b>" + escapeHtml(poll.question) + "</b>" +
          "<span>" + votes + " votos · " + (poll.options || []).length + " opciones</span></div>" +
          "<button class='btn' style='padding:8px 10px' aria-label='Borrar'>" +
          "<svg class='ic'><use href='#ic-trash'/></svg></button>";
        row.querySelector("button").onclick = function () {
          api("/api/admin/discord-bot/guilds/" + state.guildId + "/polls/" + poll.poll_id, { method: "DELETE" })
            .then(function () { toast("Encuesta cerrada y borrada.", "ok"); refreshPolls(); })
            .catch(function (err) { toast(err.message || "No se pudo borrar.", "err"); });
        };
        wrap.appendChild(row);
      });
    }).catch(function (err) {
      $("pollList").innerHTML = "<div class='empty'>" + escapeHtml(err.message || "Error") + "</div>";
    });
  }

  function postPoll() {
    var channel = $("pollChannel").value;
    var question = $("pollQuestion").value.trim();
    var options = [];
    document.querySelectorAll("#pollOptions .optrow").forEach(function (row2, index) {
      var label = row2.querySelector(".polLabel").value.trim();
      var emoji = row2.querySelector(".polEmoji").value.trim();
      if (label) {
        options.push({ label: label, emoji: emoji });
        row2.querySelector(".polLabel").value = "";
        row2.querySelector(".polEmoji").value = "";
      }
    });
    if (!state.guildId) return toast("Selecciona antes un servidor.", "err");
    if (!channel) return toast("Elige un canal.", "err");
    if (!question) return toast("Escribe la pregunta.", "err");
    if (options.length < 2) return toast("Escribe al menos 2 opciones.", "err");
    busy($("btnPostPoll"), true);
    api("/api/admin/discord-bot/guilds/" + state.guildId + "/polls", {
      method: "POST",
      body: { channel_id: channel, question: question, options: options },
    })
      .then(function () { toast("Encuesta publicada.", "ok"); $("pollQuestion").value = ""; refreshPolls(); })
      .catch(function (err) { toast(err.message || "No se pudo publicar.", "err"); })
      .finally(function () { busy($("btnPostPoll"), false); });
  }

  function refreshEvents() {
    api("/api/admin/discord-bot/events").then(function (data) {
      var wrap = $("eventList");
      wrap.innerHTML = "";
      var items = data.events || [];
      if (!items.length) {
        wrap.innerHTML = "<div class='empty'>Sin eventos todavía.</div>";
        return;
      }
      var labels = {
        welcome: "Bienvenida",
        goodbye: "Despedida",
        verified: "Verificación",
        rolemenu_create: "Menú de roles creado",
        rolemenu_delete: "Menú de roles borrado",
        poll_create: "Encuesta creada",
        poll_delete: "Encuesta borrada",
        schedule_create: "Mensaje programado creado",
        schedule_sent: "Programado enviado",
        schedule_error: "Error de programado",
        backup_auto: "Respaldo automático",
        backup_restore: "Respaldo restaurado",
      };
      items.slice(0, 40).forEach(function (event) {
        var when = String(event.t || "").replace("T", " ").slice(0, 16);
        var row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML =
          "<div class='ico'><svg class='ic'><use href='#ic-list'/></svg></div>" +
          "<div class='meta'><b>" + escapeHtml(labels[event.kind] || event.kind) + "</b>" +
          "<span>" + escapeHtml(event.detail || "—") + " · " + escapeHtml(when) + " UTC</span></div>";
        wrap.appendChild(row);
      });
    }).catch(function (err) {
      $("eventList").innerHTML = "<div class='empty'>" + escapeHtml(err.message || "Error") + "</div>";
    });
  }

  function downloadBackup() {
    busy($("btnBackup"), true);
    fetch("/api/admin/discord-bot/backup", { headers: { Authorization: "Bearer " + state.token } })
      .then(function (res) {
        if (!res.ok) throw new Error("No se pudo generar el respaldo.");
        return res.blob();
      })
      .then(function (blob) {
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "coreia-bot-backup.json";
        link.click();
        URL.revokeObjectURL(link.href);
        toast("Respaldo descargado.", "ok");
      })
      .catch(function (err) { toast(err.message || "No se pudo descargar.", "err"); })
      .finally(function () { busy($("btnBackup"), false); });
  }

  function restoreBackup() {
    var file = $("backupFile").files && $("backupFile").files[0];
    if (!file) return toast("Elige antes el archivo .json del respaldo.", "err");
    busy($("btnBackupRestore"), true);
    var reader = new FileReader();
    reader.onload = function () {
      var payload;
      try {
        payload = JSON.parse(String(reader.result));
      } catch (err) {
        busy($("btnBackupRestore"), false);
        return toast("El archivo no es un respaldo JSON válido.", "err");
      }
      api("/api/admin/discord-bot/backup", { method: "POST", body: payload })
        .then(function (data) {
          toast("Respaldo restaurado: " + data.restored + " opciones.", "ok");
          refreshAll();
        })
        .catch(function (err) { toast(err.message || "No se pudo restaurar.", "err"); })
        .finally(function () { busy($("btnBackupRestore"), false); });
    };
    reader.readAsText(file);
  }

  /* ---------------------------------------------------------- */
  /* Tanda 2: niveles, tickets, sorteos, recordatorios y feeds    */
  /* ---------------------------------------------------------- */
  function refreshLevels() {
    if (!state.guildId) return Promise.resolve();
    return api("/api/admin/discord-bot/guilds/" + state.guildId + "/levels").then(function (data) {
      var wrap = $("levelList");
      wrap.innerHTML = "";
      var top = data.top || [];
      if (!top.length) {
        wrap.innerHTML = "<div class='empty'>Sin niveles todavía.</div>";
        return;
      }
      top.forEach(function (entry, index) {
        var row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML =
          "<div class='ico'>" + (index + 1) + "</div>" +
          "<div class='meta'><b>" + escapeHtml(entry.name) + "</b>" +
          "<span>" + entry.xp + " XP</span></div>" +
          "<div class='end'><b style='font-size:13px'>Nv " + entry.level + "</b></div>";
        wrap.appendChild(row);
      });
    }).catch(function (err) {
      $("levelList").innerHTML = "<div class='empty'>" + escapeHtml(err.message || "Error") + "</div>";
    });
  }

  function saveLevelsConfig() {
    saveConfig({
      levels_enabled: $("cfgLevelsOn").checked ? "1" : "",
      levelup_channel_id: $("cfgLevelupChannel").value,
    }, "Niveles guardados.").then(function () {
      refreshLevels();
    });
  }

  function postTicketPanel() {
    var channel = $("ticketChannel").value;
    if (!state.guildId) return toast("Selecciona antes un servidor.", "err");
    if (!channel) return toast("Elige un canal de texto para el panel.", "err");
    busy($("btnPostTicketPanel"), true);
    api("/api/admin/discord-bot/guilds/" + state.guildId + "/test-message", {
      method: "POST",
      body: {
        channel_id: channel,
        content: "Tickets de soporte",
        ticket_panel: true,
      },
    })
      .then(function () { toast("Panel de tickets publicado.", "ok"); })
      .catch(function (err) { toast(err.message || "No se pudo publicar.", "err"); })
      .finally(function () { busy($("btnPostTicketPanel"), false); });
  }

  function refreshGiveaways() {
    if (!state.guildId) return Promise.resolve();
    return api("/api/admin/discord-bot/guilds/" + state.guildId + "/giveaways").then(function (data) {
      var wrap = $("giveawayList");
      wrap.innerHTML = "";
      var items = (data.giveaways || []).filter(function (entry) { return !entry.closed; });
      if (!items.length) {
        wrap.innerHTML = "<div class='empty'>Sin sorteos activos.</div>";
        return;
      }
      items.forEach(function (entry) {
        var row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML =
          "<div class='ico'><svg class='ic'><use href='#ic-poll'/></svg></div>" +
          "<div class='meta'><b>" + escapeHtml(entry.prize) + "</b>" +
          "<span>" + (entry.entrants || []).length + " participantes · termina " + escapeHtml(String(entry.ends_at).slice(0, 16)) + " UTC</span></div>" +
          "<button class='btn' style='padding:8px 10px' aria-label='Borrar'>" +
          "<svg class='ic'><use href='#ic-trash'/></svg></button>";
        row.querySelector("button").onclick = function () {
          api("/api/admin/discord-bot/guilds/" + state.guildId + "/giveaways/" + entry.giveaway_id, { method: "DELETE" })
            .then(function () { toast("Sorteo cancelado.", "ok"); refreshGiveaways(); })
            .catch(function (err) { toast(err.message || "No se pudo borrar.", "err"); });
        };
        wrap.appendChild(row);
      });
    }).catch(function (err) {
      $("giveawayList").innerHTML = "<div class='empty'>" + escapeHtml(err.message || "Error") + "</div>";
    });
  }

  function postGiveaway() {
    var channel = $("gwChannel").value;
    var prize = $("gwPrize").value.trim();
    var minutes = parseInt($("gwMinutes").value || "60", 10) || 60;
    var winners = parseInt($("gwWinners").value || "1", 10) || 1;
    if (!state.guildId) return toast("Selecciona antes un servidor.", "err");
    if (!channel) return toast("Elige un canal.", "err");
    if (!prize) return toast("Escribe el premio.", "err");
    if (minutes < 1 || minutes > 43200) return toast("Duración: 1 min a 30 días.", "err");
    busy($("btnPostGiveaway"), true);
    api("/api/admin/discord-bot/guilds/" + state.guildId + "/giveaways", {
      method: "POST",
      body: { channel_id: channel, prize: prize, minutes: minutes, winners: winners },
    })
      .then(function () { toast("Sorteo publicado.", "ok"); $("gwPrize").value = ""; refreshGiveaways(); })
      .catch(function (err) { toast(err.message || "No se pudo publicar.", "err"); })
      .finally(function () { busy($("btnPostGiveaway"), false); });
  }

  function refreshReminders() {
    return api("/api/admin/discord-bot/reminders" + (state.guildId ? "?guild_id=" + state.guildId : "")).then(function (data) {
      var wrap = $("reminderList");
      wrap.innerHTML = "";
      var items = data.reminders || [];
      if (!items.length) {
        wrap.innerHTML = "<div class='empty'>Sin recordatorios pendientes.</div>";
        return;
      }
      items.forEach(function (item) {
        var row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML =
          "<div class='ico'><svg class='ic'><use href='#ic-clock'/></svg></div>" +
          "<div class='meta'><b>" + escapeHtml(String(item.content || "").slice(0, 60)) + "</b>" +
          "<span>" + escapeHtml(String(item.due_at).slice(0, 16)) + " UTC</span></div>" +
          "<button class='btn' style='padding:8px 10px' aria-label='Borrar'>" +
          "<svg class='ic'><use href='#ic-trash'/></svg></button>";
        row.querySelector("button").onclick = function () {
          api("/api/admin/discord-bot/reminders/" + item.id, { method: "DELETE" })
            .then(function () { toast("Recordatorio borrado.", "ok"); refreshReminders(); })
            .catch(function (err) { toast(err.message || "No se pudo borrar.", "err"); });
        };
        wrap.appendChild(row);
      });
    }).catch(function (err) {
      $("reminderList").innerHTML = "<div class='empty'>" + escapeHtml(err.message || "Error") + "</div>";
    });
  }

  function refreshFeeds() {
    if (!state.guildId) return Promise.resolve();
    return api("/api/admin/discord-bot/guilds/" + state.guildId + "/feeds").then(function (data) {
      var wrap = $("feedList");
      wrap.innerHTML = "";
      var items = data.feeds || [];
      if (!items.length) {
        wrap.innerHTML = "<div class='empty'>Sin avisos configurados.</div>";
        return;
      }
      items.forEach(function (feed) {
        var row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML =
          "<div class='ico'><svg class='ic'><use href='#ic-globe'/></svg></div>" +
          "<div class='meta'><b>" + (feed.kind === "twitch" ? "Twitch" : "YouTube") + " · " + escapeHtml(feed.name || feed.target) + "</b>" +
          "<span>" + (feed.last_at ? "última revisión " + escapeHtml(String(feed.last_at).slice(0, 16)) : "sin revisar") + "</span></div>" +
          "<button class='btn' style='padding:8px 10px' aria-label='Borrar'>" +
          "<svg class='ic'><use href='#ic-trash'/></svg></button>";
        row.querySelector("button").onclick = function () {
          api("/api/admin/discord-bot/guilds/" + state.guildId + "/feeds/" + feed.feed_id, { method: "DELETE" })
            .then(function () { toast("Aviso eliminado.", "ok"); refreshFeeds(); })
            .catch(function (err) { toast(err.message || "No se pudo borrar.", "err"); });
        };
        wrap.appendChild(row);
      });
    }).catch(function (err) {
      $("feedList").innerHTML = "<div class='empty'>" + escapeHtml(err.message || "Error") + "</div>";
    });
  }

  function addFeed() {
    var channel = $("fdChannel").value;
    var kind = $("fdKind").value;
    var target = $("fdTarget").value.trim();
    if (!state.guildId) return toast("Selecciona antes un servidor.", "err");
    if (!channel) return toast("Elige un canal donde avisar.", "err");
    if (!target) return toast("Escribe la URL o el nombre del canal.", "err");
    busy($("btnAddFeed"), true);
    api("/api/admin/discord-bot/guilds/" + state.guildId + "/feeds", {
      method: "POST",
      body: { channel_id: channel, kind: kind, target: target },
    })
      .then(function () { toast("Aviso añadido.", "ok"); $("fdTarget").value = ""; refreshFeeds(); })
      .catch(function (err) { toast(err.message || "No se pudo añadir.", "err"); })
      .finally(function () { busy($("btnAddFeed"), false); });
  }

  /* ---------------------------------------------------------- */
  /* Actualizaciones de la app (Android / instalador del APK)      */
  /* ---------------------------------------------------------- */
  function androidVersionCode() {
    try {
      if (window.CoreIAUpdate && window.CoreIAUpdate.getVersionCode) {
        return parseInt(window.CoreIAUpdate.getVersionCode(), 10) || 0;
      }
    } catch (err) { /* navegador normal: no hay puente nativo */ }
    return 0;
  }

  function onUpdateProgress(pct) {
    var clamped = Math.min(100, Math.max(0, Number(pct) || 0));
    $("updProgressBox").hidden = false;
    $("updPct").textContent = Math.round(clamped) + "%";
    $("updFill").style.width = clamped + "%";
  }

  function onUpdateError(message) {
    var btn = $("updInstall");
    btn.disabled = false;
    $("updateView").classList.remove("locked");
    $("updStatus").textContent = message || "No se pudo descargar la actualización.";
  }

  function closeUpdateView() {
    $("updateView").classList.remove("show");
    $("updStatus").textContent = "";
    try {
      if (nativeBridge && nativeBridge.onOverlay) nativeBridge.onOverlay(false);
    } catch (err) { /* fuera de la APK */ }
  }

  function showUpdate(data) {
    $("updVersion").textContent = "Versión " + (data.version_name || "desconocida");
    $("updNotes").textContent =
      (data.changelog || "").trim() || "Mejoras y arreglos de errores.";
    try {
      if (nativeBridge && nativeBridge.onOverlay) nativeBridge.onOverlay(true);
    } catch (err) { /* fuera de la APK */ }
    var btn = $("updInstall");
    btn.disabled = false;
    $("updProgressBox").hidden = true;
    $("updFill").style.width = "0%";
    if (window.CoreIAUpdate && window.CoreIAUpdate.installApk) {
      btn.onclick = function () {
        btn.disabled = true;
        $("updateView").classList.add("locked");
        $("updProgressBox").hidden = false;
        try {
          window.CoreIAUpdate.installApk(String(data.apk_url));
        } catch (err) {
          onUpdateError("El instalador no respondió.");
        }
      };
    } else {
      // Navegador normal: descarga directa del APK.
      btn.onclick = function () { window.open(String(data.apk_url), "_blank"); };
    }
    $("updLater").onclick = closeUpdateView;
    $("updateView").classList.add("show");
  }

  function checkUpdate() {
    if (!window.CoreIAUpdate) return; // solo avisa dentro del APK
    var current = androidVersionCode();
    // El APK se busca en GitHub: el workflow de Actions publica una release
    // pública (etiqueta bot-vX.Y.Z con el APK). Si GitHub falla, se usa el
    // manifiesto del backend como respaldo.
    checkUpdateGithub(current)
      .then(function (handled) {
        if (!handled) checkUpdateBackend(current);
      })
      .catch(function () {
        checkUpdateBackend(current);
      });
  }

  /* Última release del APK en GitHub (pública, sin autenticación). */
  function checkUpdateGithub(current) {
    var url = "https://api.github.com/repos/sebrudo123/gemini-chat/releases?per_page=30";
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("GitHub no respondió.");
        return res.json();
      })
      .then(function (releases) {
        var latest = null;
        (releases || []).forEach(function (release) {
          var match = /^bot-v(\d+)\.(\d+)\.(\d+)$/.exec(String(release && release.tag_name || ""));
          if (!match) return;
          if (!latest || Number(match[3]) > latest.code) {
            latest = {
              code: Number(match[3]),
              name: match[1] + "." + match[2] + "." + match[3],
              release: release,
            };
          }
        });
        if (!latest || latest.code <= current) {
          updateVerBadge(latest && latest.code);
          return false;
        }
        updateVerBadge(latest.code);
        var asset = null;
        (latest.release.assets || []).forEach(function (item) {
          if (!asset && /\.apk$/i.test(String(item && item.name || ""))) asset = item;
        });
        if (!asset) return false; // release sin APK: pasa al respaldo
        showUpdate({
          version_name: latest.name,
          changelog: String(latest.release.body || "").trim() || "Mejoras y arreglos de errores.",
          apk_url: asset.browser_download_url,
        });
        return true;
      });
  }

  /* Respaldo: manifiesto guardado en el backend por el mismo workflow. */
  function checkUpdateBackend(current) {
    fetch(API_BASE + "/bot/update/check?current=" + current)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.has_update) showUpdate(data);
      })
      .catch(function () { /* sin conexión: no molesta */ });
  }

  window.CoreIAUI = {
    onDownload: onUpdateProgress,
    onInstalling: function () {
      onUpdateProgress(100);
      $("updStatus").textContent = "Abriendo el instalador de Android…";
    },
    onError: onUpdateError,
  };

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
      if (appMode && nativeBridge && nativeBridge.onAuthFailed) {
        try { nativeBridge.onAuthFailed(); } catch (err) { /* sin puente */ }
        return;
      }
      $("loginMsg").textContent =
        "No tienes permisos para usar este panel. Solo el fundador de Core IA puede entrar.";
      $("loginMsg").className = "msgbox err show";
      LS.removeItem(TOKEN_KEY);
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
      LS.setItem(TOKEN_KEY, state.token);
    }
  }

  /* ---------------------------------------------------------- */
  /* Bindings                                                    */
  /* ---------------------------------------------------------- */
  function updateVerBadge(code) {
    var verEl = $("panelVer");
    if (verEl) {
      verEl.textContent =
        "Panel " + PANEL_VERSION + " · APK build " + (code || "web");
    }
  }

  function bind() {
    /* Insignia de versión: confirma en pantalla qué corre el dispositivo. */
    try {
      updateVerBadge(androidVersionCode());
    } catch (err) { /* sin puente nativo */ }
    $("discordBtn").onclick = function () {
      window.location.href =
        API_BASE + "/api/admin/discord-bot/login?panel_origin=" + encodeURIComponent(window.location.origin);
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
        update_channel_id: $("cfgUpdateChannel").value,
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
      saveConfig({
        welcome_message: $("cfgWelcomeMsg").value,
        welcome_image_enabled: $("cfgWelcomeImage").checked ? "1" : "",
        welcome_dm_message: $("cfgWelcomeDm").value,
        welcome_dm_enabled: $("cfgWelcomeDmOn").checked ? "1" : "",
      }, "Bienvenida guardada.");
    };

    $("btnBackup").onclick = downloadBackup;
    $("btnBackupRestore").onclick = restoreBackup;
    $("btnEvents").onclick = function () {
      busy($("btnEvents"), true);
      refreshEvents();
      setTimeout(function () { busy($("btnEvents"), false); }, 500);
    };
    $("btnPostRoleMenu").onclick = postRoleMenu;
    $("btnPostPoll").onclick = postPoll;
    $("btnSchedule").onclick = createSchedule;
    $("btnAddFeed").onclick = addFeed;
    $("btnPostGiveaway").onclick = postGiveaway;
    $("btnSaveLevels").onclick = saveLevelsConfig;
    $("btnSaveAntiraid").onclick = function () {
      saveConfig({
        antiraid_enabled: $("cfgAntiraidOn").checked ? "1" : "0",
        antiraid_joins: $("cfgAntiraidJoins").value || "5",
        antiraid_secs: $("cfgAntiraidSecs").value || "60",
        antiraid_min_age_days: $("cfgAntiraidMinAge").value || "0",
        antiraid_action: $("cfgAntiraidAction").value || "kick",
      }, "Anti-raid guardado.");
    };
    $("btnSaveAntispam").onclick = function () {
      saveConfig({
        antispam_enabled: $("cfgAntispamOn").checked ? "1" : "0",
        antispam_msgs: $("cfgAntispamMsgs").value || "6",
        antispam_secs: $("cfgAntispamSecs").value || "8",
        antispam_mentions: $("cfgAntispamMentions").value || "6",
      }, "Anti-spam guardado.");
    };
    $("btnSaveVoice").onclick = function () {
      saveConfig({
        voice_temp_enabled: $("cfgVoiceTempOn").checked ? "1" : "0",
        voice_lobby_id: $("cfgVoiceLobby").value,
      }, "Salas de voz guardadas.");
    };
    $("btnPostTicketPanel").onclick = function () {
      if (!state.guildId) return toast("Selecciona antes un servidor.", "err");
      saveConfig({
        ticket_category_id: $("cfgTicketCategory").value,
        ticket_staff_role_id: $("cfgTicketStaffRole").value,
        ticket_transcript_enabled: $("cfgTranscriptOn").checked ? "1" : "0",
      }, "Configuración de tickets guardada.").then(postTicketPanel);
    };
    $("schKind").addEventListener("change", function () {
      $("schWeekday").hidden = $("schKind").value !== "weekly";
    });

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
  setTimeout(checkUpdate, 700);
  /* Puente nativo → web: la barra inferior de la APK cambia de pestaña aquí. */
  window.CoreIAJS = { switchView: switchView };
  if (state.token) {
    if (appMode) appBootOverlay(true);
    api("/api/admin/discord-bot")
      .then(function (data) {
        state.bot = data.bot;
        showApp(true);
      })
      .catch(function (err) {
        LS.removeItem(TOKEN_KEY);
        state.token = "";
        if (appMode && nativeBridge && nativeBridge.onAuthFailed) {
          appBootOverlay(false);
          try { nativeBridge.onAuthFailed(); } catch (err2) { /* sin puente */ }
          return;
        }
        $("loginMsg").textContent =
          err && /403|fundador|permisos/i.test(err.message)
            ? "No tienes permisos para usar este panel. Solo el fundador de Core IA."
            : "Tu sesión ya no es válida. Vuelve a entrar.";
        $("loginMsg").className = "msgbox err show";
        showApp(false);
      });
  } else if (appMode && qsParam("open") === "discord") {
    // Login Discord desde la app nativa: arranca el OAuth solo, sin mostrar
    // el login web. El callback vuelve con ?ui=app#token=... (panel + appMode).
    appBootOverlay(true);
    var bootMsg = document.querySelector("#appBoot div:last-child");
    if (bootMsg) bootMsg.textContent = "Abriendo Discord…";
    setTimeout(function () {
      window.location.href = API_BASE + "/api/admin/discord-bot/login?panel_origin="
        + encodeURIComponent(window.location.origin) + "&ui_app=1";
    }, 250);
  } else if (appMode) {
    // En modo app siempre llega un token (el login nativo lo valida antes);
    // si por algo no llegó, pedimos reingreso en vez del login web.
    try {
      if (nativeBridge && nativeBridge.onAuthFailed) nativeBridge.onAuthFailed();
    } catch (err) { /* sin puente */ }
  } else {
    showApp(false);
  }
  } catch (err) {
    if (window.__coreiaBootError) {
      window.__coreiaBootError("bloque principal del panel: " + err.message, err.stack);
    }
    throw err;
  }
})();
