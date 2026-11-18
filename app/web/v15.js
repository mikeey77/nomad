/* NOMAD v0.16 — SSD plug-in popup setting, inventory status on Home */

/* Settings: what to do when the SSD is plugged in (Windows) */
function renderPlug(){
  const sup = SET.autostart_supported, m = SET.plug_mode || 'off';
  $$('#sPlug button').forEach(b => { b.classList.toggle('on', b.dataset.v === m); b.disabled = !sup });
}
$$('#sPlug button').forEach(b => b.onclick = async () => { if(!SET.autostart_supported) return toast(t('s_autostart_na')); await saveSet({plug_mode:b.dataset.v}); renderPlug() });
setView = (function(orig){ return function(v){ orig(v); if(v === 'set') renderPlug(); if(v === 'home') setTimeout(homeInv, 50) } })(setView);

/* Home: one-line inventory status under the modules */
function homeInv(){
  if(!$('#invHome') && $('#mods')){ const d = document.createElement('div'); d.id = 'invHome'; d.className = 'card invlink'; $('#mods').after(d) }
  if(typeof renderInvHome === 'function' && USER) renderInvHome();
}
renderDash = (function(orig){ return function(){ const r = orig.apply(this, arguments); homeInv(); return r } })(renderDash);
setTimeout(homeInv, 1500);
