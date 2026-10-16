(function(){
  let last = null;
  function set(details, state){
    try {
      if (window.DiscordRPC && window.DiscordRPC.setPresence) {
        window.DiscordRPC.setPresence(details, state);
        last = {details,state};
      }
    } catch(e){}
  }
  window.coreiaSetRPC = set;
  function role(){
    const u = window.currentUser || {};
    if (u.is_admin && u.is_founder) return {details:'Administrando Core IA', state:'Fundador'};
    if (u.is_admin) return {details:'Administrando Core IA', state:'Admin'};
    if (u.is_founder) return {details:'Modificando cosas en Core IA', state:'Fundador'};
    return {details:'Usando Core IA', state:'Conversando'};
  }
  setInterval(function(){
    try {
      const r = role();
      if (!last || last.details!==r.details || last.state!==r.state) set(r.details, r.state);
    } catch(e){}
  }, 2000);
})();
