/**
 * Discord Rich Presence (Core IA).
 *
 * Actualiza la presencia en Discord a través del puente nativo expuesto por
 * la app de Android (`window.DiscordRPC.setPresence`). Si la app no está
 * disponible (por ejemplo, en el navegador), todo queda en un no-op silencioso.
 *
 * La presencia se calcula según el rol y la actividad actual:
 *  - Administrador: "Administrando Core IA"
 *  - Fundador:      "Modificando cosas en Core IA"
 *  - Resto:         "Usando Core IA"
 *
 * Los textos de administrador/fundador solo se aplican a esos roles; el texto
 * general puede personalizarse desde Ajustes.
 */
(function () {
  "use strict";

  // Application ID de la app de Discord de Core IA (se puede cambiar en Ajustes).
  var DEFAULT_APP_ID = "1532950355955028110";
  var ENABLED_KEY = "coreia_discord_rpc_enabled";
  var APP_ID_KEY = "coreia_discord_app_id";
  var PRESENCE_KEY = "coreia_rpc_presence";

  var DEFAULT_PRESENCE = {
    admin: { details: "Administrando Core IA", state: "En el panel de administración" },
    founder: { details: "Modificando cosas en Core IA", state: "Fundador" },
    user: { details: "Usando Core IA", state: "Conversando" },
  };

  var last = null;

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* ignorar */
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignorar */
    }
  }

  function getUser() {
    try {
      // `currentUser` es una variable global de script.js; se accede de forma
      // segura sin depender de window.
      return typeof currentUser !== "undefined" ? currentUser : null;
    } catch (e) {
      return null;
    }
  }

  function isEnabled() {
    // La presencia se activa explícitamente desde Ajustes (o al pulsar
    // «Activar presencia»). Así, si algo falla, la app siempre abre.
    return storageGet(ENABLED_KEY) === "1";
  }

  function getAppId() {
    var stored = storageGet(APP_ID_KEY);
    if (stored === null) {
      return DEFAULT_APP_ID;
    }
    return stored;
  }

  function customPresence() {
    try {
      var raw = storageGet(PRESENCE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function buildPresence() {
    var user = getUser() || {};
    var custom = customPresence() || {};
    var isAdmin = !!user.is_admin;
    var isFounder = !!user.is_founder;

    if (isAdmin) {
      return {
        details: custom.adminDetails || DEFAULT_PRESENCE.admin.details,
        state: custom.adminState || DEFAULT_PRESENCE.admin.state,
      };
    }
    if (isFounder) {
      return {
        details: custom.founderDetails || DEFAULT_PRESENCE.founder.details,
        state: custom.founderState || DEFAULT_PRESENCE.founder.state,
      };
    }
    return {
      details: custom.userDetails || DEFAULT_PRESENCE.user.details,
      state: custom.userState || DEFAULT_PRESENCE.user.state,
    };
  }

  function push(details, state) {
    // Sin presencia activada no se llama al puente nativo: así la app no
    // toca el SDK ni el puente de Java al abrirse.
    if (!isEnabled()) {
      return;
    }
    try {
      if (window.DiscordRPC && typeof window.DiscordRPC.setPresence === "function") {
        window.DiscordRPC.setPresence(details, state);
        last = { details: details, state: state };
      }
    } catch (e) {
      /* sin SDK nativo: ignorar */
    }
  }

  function initRpc(force) {
    if (!isEnabled() && !force) {
      return false;
    }
    var native = window.DiscordRPC;
    if (!native || typeof native.initRpc !== "function") {
      return false;
    }
    if (!force && typeof native.autoDisabled === "function" && native.autoDisabled()) {
      // Un arranque anterior terminó de forma inesperada: no reactivar solo.
      storageSet(ENABLED_KEY, "0");
      return false;
    }
    var appId = getAppId();
    if (!appId) {
      return false;
    }
    try {
      return !!native.initRpc(appId);
    } catch (e) {
      return false;
    }
  }

  function nativeStatus() {
    try {
      if (window.DiscordRPC && typeof window.DiscordRPC.getStatus === "function") {
        return window.DiscordRPC.getStatus();
      }
    } catch (e) {
      /* ignorar */
    }
    return "";
  }

  function isAvailable() {
    try {
      return !!(
        window.DiscordRPC &&
        typeof window.DiscordRPC.isAvailable === "function" &&
        window.DiscordRPC.isAvailable()
      );
    } catch (e) {
      return false;
    }
  }

  function refreshStatusUi() {
    if (typeof window.coreiaRefreshRpcStatus === "function") {
      window.coreiaRefreshRpcStatus();
    }
  }

  function tick() {
    var next = buildPresence();
    if (!last || last.details !== next.details || last.state !== next.state) {
      push(next.details, next.state);
    }
  }

  // Expone utilidades para que la UI de Ajustes pueda controlar la presencia.
  window.coreiaPresence = {
    refresh: tick,
    available: isAvailable,
    status: nativeStatus,
    enabled: isEnabled,
    appId: getAppId,
    defaultAppId: DEFAULT_APP_ID,
    enable: function () {
      storageSet(ENABLED_KEY, "1");
      last = null;
      var ok = initRpc(true);
      if (ok) {
        tick();
      } else {
        storageSet(ENABLED_KEY, "0");
      }
      refreshStatusUi();
      return ok;
    },
    disable: function () {
      storageSet(ENABLED_KEY, "0");
      last = null;
      try {
        if (window.DiscordRPC && typeof window.DiscordRPC.stopRpc === "function") {
          window.DiscordRPC.stopRpc();
        }
      } catch (e) {
        /* ignorar */
      }
      refreshStatusUi();
    },
    setAppId: function (appId) {
      storageSet(APP_ID_KEY, String(appId || "").trim());
      last = null;
      var ok = true;
      // Cambiar el ID no altera si la presencia está activada o no.
      if (isEnabled()) {
        ok = initRpc(true);
        if (ok) {
          tick();
        }
      }
      refreshStatusUi();
      return ok;
    },
    setCustom: function (value) {
      if (value) {
        storageSet(PRESENCE_KEY, JSON.stringify(value));
      } else {
        storageRemove(PRESENCE_KEY);
      }
      tick();
    },
    /** Llamado desde Android al pulsar «Desactivar» en la notificación. */
    onNativeStopped: function () {
      storageSet(ENABLED_KEY, "0");
      last = null;
      refreshStatusUi();
      if (typeof window.showToast === "function") {
        window.showToast("Presencia en Discord desactivada.");
      }
    },
  };

  setInterval(tick, 2000);
  if (initRpc()) {
    tick();
  }
})();
