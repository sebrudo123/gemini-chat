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

  var DEFAULT_PRESENCE = {
    admin: { details: "Administrando Core IA", state: "En el panel de administración" },
    founder: { details: "Modificando cosas en Core IA", state: "Fundador" },
    user: { details: "Usando Core IA", state: "Conversando" },
  };

  var last = null;

  function getUser() {
    try {
      // `currentUser` es una variable global de script.js; se accede de forma
      // segura sin depender de window.
      return typeof currentUser !== "undefined" ? currentUser : null;
    } catch (e) {
      return null;
    }
  }

  function customPresence() {
    try {
      var raw = localStorage.getItem("coreia_rpc_presence");
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
    try {
      if (window.DiscordRPC && typeof window.DiscordRPC.setPresence === "function") {
        window.DiscordRPC.setPresence(details, state);
        last = { details: details, state: state };
      }
    } catch (e) {
      /* sin SDK nativo: ignorar */
    }
  }

  function tick() {
    var next = buildPresence();
    if (!last || last.details !== next.details || last.state !== next.state) {
      push(next.details, next.state);
    }
  }

  // Expone utilidades para que la UI de Ajustes pueda forzar una actualización.
  window.coreiaPresence = {
    refresh: tick,
    setCustom: function (value) {
      try {
        if (value) {
          localStorage.setItem("coreia_rpc_presence", JSON.stringify(value));
        } else {
          localStorage.removeItem("coreia_rpc_presence");
        }
      } catch (e) {
        /* ignorar */
      }
      tick();
    },
  };

  setInterval(tick, 2000);
  tick();
})();
