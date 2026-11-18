/* NOMAD v0.22 — sun & moon, drinking-water sources, inventory ↔ AI */

/* ───────── astronomy (offline): sunrise/sunset, twilight, daylight left, moon phase ───────── */
const ASTRO = (() => {
  const D = Math.PI / 180, J1970 = 2440587.5, J2000 = 2451545, SYN = 29.530588853;
  const toJ = d => d / 86400000 + J1970, fromJ = j => new Date((j - J1970) * 86400000);
  function sun(date, lat, lon){
    const n = Math.round(toJ(date.getTime()) - J2000 + 0.0008 - lon / 360) ;
    const Js = n - lon / 360, M = (357.5291 + 0.98560028 * Js) % 360;
    const C = 1.9148 * Math.sin(M * D) + 0.02 * Math.sin(2 * M * D) + 0.0003 * Math.sin(3 * M * D);
    const L = (M + C + 180 + 102.9372) % 360;
    const Jt = J2000 + Js + 0.0053 * Math.sin(M * D) - 0.0069 * Math.sin(2 * L * D);
    const dec = Math.asin(Math.sin(L * D) * Math.sin(23.4397 * D));
    const at = h => { const c = (Math.sin(h * D) - Math.sin(lat * D) * Math.sin(dec)) / (Math.cos(lat * D) * Math.cos(dec)); return c > 1 ? 'night' : c < -1 ? 'day' : Math.acos(c) / D };
    const pair = h => { const w = at(h); return typeof w === 'string' ? {all:w} : {rise:fromJ(Jt - w / 360), set:fromJ(Jt + w / 360)} };
    return {noon:fromJ(Jt), sun:pair(-0.833), civil:pair(-6), golden:pair(6)};
  }
  function moon(date){
    const age = (((toJ(date.getTime()) - 2451550.1) % SYN) + SYN) % SYN;
    const illum = (1 - Math.cos(2 * Math.PI * age / SYN)) / 2, idx = Math.round(age / SYN * 8) % 8;
    const full = age < SYN / 2 ? SYN / 2 - age : SYN - age + SYN / 2, nw = SYN - age;
    return {age, illum, idx, icon:['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'][idx], nextFull:new Date(date.getTime() + full * 864e5), nextNew:new Date(date.getTime() + nw * 864e5)};
  }
  return {sun, moon};
})();
const MOON_NAMES = {en:['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'],
  nl:['Nieuwe maan', 'Wassende sikkel', 'Eerste kwartier', 'Wassende maan', 'Volle maan', 'Afnemende maan', 'Laatste kwartier', 'Afnemende sikkel']};
const hm = d => d.toLocaleTimeString(LANG === 'nl' ? 'nl-NL' : 'en-GB', {hour:'2-digit', minute:'2-digit'});
const dur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' };
function astroPlace(){
  if(typeof POS !== 'undefined' && POS) return [POS.lon, POS.lat, t('r_me')];
  if(MAP && $('#v-map').classList.contains('on')) return [...MAP.getCenter().toArray(), t('sm_mapc')];
  const l = store.get('nomad.lastll', null); if(l) return [l[0], l[1], t('sm_mapc')];
  const p = (USER?.pins || [])[0]; if(p) return [p.lon, p.lat, p.name];
  return [4.9, 52.37, 'Amsterdam'];
}
function astroInfo(lon, lat){
  const now = new Date(), s = ASTRO.sun(now, lat, lon), m = ASTRO.moon(now);
  let state, left = '';
  if(s.sun.all) state = s.sun.all === 'day' ? t('sm_midnight') : t('sm_polar');
  else if(now < s.sun.rise){ state = t('sm_rises') + ' ' + hm(s.sun.rise); left = dur(s.sun.rise - now) + ' ' + t('sm_until') }
  else if(now < s.sun.set){ state = t('sm_sets') + ' ' + hm(s.sun.set); left = dur(s.sun.set - now) + ' ' + t('sm_light') }
  else { const tm = ASTRO.sun(new Date(now.getTime() + 864e5), lat, lon); state = t('sm_rises') + ' ' + (tm.sun.rise ? hm(tm.sun.rise) : '—'); left = s.civil.set && now < s.civil.set ? dur(s.civil.set - now) + ' ' + t('sm_dusk') : t('sm_dark') }
  return {now, s, m, state, left, len:s.sun.rise ? dur(s.sun.set - s.sun.rise) : s.sun.all === 'day' ? '24h' : '0h'};
}
function astroDetail(lon, lat, place){
  const A = astroInfo(lon, lat), s = A.s, m = A.m, f = d => d ? hm(d) : '—', dd = d => d.toLocaleDateString(LANG === 'nl' ? 'nl-NL' : 'en-GB', {weekday:'short', day:'numeric', month:'short'});
  return `<div class="sm-grid">
    <div><small>${t('sm_dawn')}</small><b>${f(s.civil.rise)}</b></div><div><small>☀ ${t('sm_rise')}</small><b>${f(s.sun.rise)}</b></div>
    <div><small>${t('sm_noon')}</small><b>${hm(s.noon)}</b></div><div><small>☀ ${t('sm_set')}</small><b>${f(s.sun.set)}</b></div>
    <div><small>${t('sm_duskl')}</small><b>${f(s.civil.set)}</b></div><div><small>${t('sm_len')}</small><b>${A.len}</b></div>
    <div class="w"><small>${t('sm_golden')}</small><b>${s.golden.rise ? f(s.sun.rise) + '–' + f(s.golden.rise) + ' · ' + f(s.golden.set) + '–' + f(s.sun.set) : '—'}</b></div>
    <div class="w moonrow"><span class="mi">${m.icon}</span><span><b>${MOON_NAMES[LANG === 'nl' ? 'nl' : 'en'][m.idx]} · ${Math.round(m.illum * 100)}%</b><small>${t('sm_full')} ${dd(m.nextFull)} · ${t('sm_new')} ${dd(m.nextNew)}</small></span></div>
  </div><div class="mono dim" style="font-size:10px;margin-top:8px">📍 ${esc(place)} · ${lat.toFixed(3)}, ${lon.toFixed(3)}</div>`;
}

/* map chip */
(() => {
  const chip = document.createElement('div'); chip.id = 'sunchip'; chip.className = 'glass';
  $('#v-map').appendChild(chip);
  function upd(){
    if(!MAP || !$('#v-map').classList.contains('on')) return;
    const [lon, lat, place] = astroPlace(), A = astroInfo(lon, lat);
    chip.innerHTML = `<div class="sc-top"><span>☀</span><b>${esc(A.state)}</b>${A.left ? `<em>${esc(A.left)}</em>` : ''}<span class="sc-m" title="${MOON_NAMES[LANG === 'nl' ? 'nl' : 'en'][A.m.idx]}">${A.m.icon}</span></div>
      ${chip.classList.contains('open') ? astroDetail(lon, lat, place) : ''}`;
  }
  chip.onclick = () => { chip.classList.toggle('open'); upd() };
  setInterval(upd, 30000);
  const hook = () => { if(MAP && !MAP.__sun){ MAP.__sun = 1; MAP.on('moveend', () => { store.set('nomad.lastll', MAP.getCenter().toArray().map(v => +v.toFixed(4))); upd() }) } upd() };
  setView = (function(orig){ return function(v){ orig(v); if(v === 'map') setTimeout(hook, 600) } })(setView);
  if(location.hash.startsWith('#map')) setTimeout(hook, 2500);
})();

/* home card */
function homeSun(){
  if(!$('#mods')) return;
  let d = $('#sunHome'); if(!d){ d = document.createElement('div'); d.id = 'sunHome'; d.className = 'card sunhome'; ($('#invHome') || $('#mods')).after(d) }
  const [lon, lat, place] = astroPlace(), A = astroInfo(lon, lat);
  d.innerHTML = `<div class="sh-l"><div class="hud">${t('sm_title')}</div><b>${esc(A.state)}</b><span>${esc(A.left)}</span></div>
    <div class="sh-r"><span>${A.m.icon}</span><small>${MOON_NAMES[LANG === 'nl' ? 'nl' : 'en'][A.m.idx]}<br>${Math.round(A.m.illum * 100)}%</small></div>`;
  d.onclick = () => modal({title:'☀ ' + t('sm_title'), body:astroDetail(lon, lat, place), buttons:[{label:t('close'), v:'ok', pri:1}]});
}
setView = (function(orig){ return function(v){ orig(v); if(v === 'home') setTimeout(homeSun, 80) } })(setView);
setTimeout(homeSun, 1700); setInterval(() => $('#v-home')?.classList.contains('on') && homeSun(), 60000);

/* ───────── drinking water: springs, taps, wells; toilets separate; open water in "nearby" ───────── */
(() => {
  const w = POI_CATS.find(c => c[0] === 'water');
  if(w) w[2] = ['drinking_water', 'water_point', 'water_tap', 'water_well', 'spring', 'fountain', 'watering_place'];
  if(!POI_CATS.some(c => c[0] === 'toilets')){
    POI_PATHS.wc = 'M7 3a2 2 0 100 4 2 2 0 000-4zM17 3a2 2 0 100 4 2 2 0 000-4zM5 9h4v12H5zM15 9h4l1.5 7H18v5h-2v-5h-2.5z';
    POI_CATS.splice(POI_CATS.indexOf(w) + 1, 0, ['toilets', '#8aa3b8', ['toilets'], 'wc']);
  }
  for(const k in POI_KIND) delete POI_KIND[k];
  POI_CATS.forEach(([c, , kinds]) => kinds.forEach(k => POI_KIND[k] = c));
  if(typeof renderPoiChips === 'function' && $('#poichips')) renderPoiChips();

  const _rn = renderNearby;
  renderNearby = function(){
    _rn();
    if(!MAP || FIND || !POI_ON.has('water') || MAP.getZoom() < 12 || !$('#nearbox').classList.contains('on')) return;
    const ref = refPoint(), best = {};
    let fs = []; try { fs = MAP.querySourceFeatures('protomaps', {sourceLayer:'water'}) } catch(e){}
    for(const f of fs){
      const kind = f.properties.kind_detail || f.properties.kind || 'water', name = f.properties['name:' + LANG] || f.properties.name || '';
      const key = name || kind; let dmin = 1e12, pt = null;
      const scan = c => { if(typeof c[0] === 'number'){ const d = dist(ref, c); if(d < dmin){ dmin = d; pt = c } } else c.forEach(scan) };
      scan(f.geometry.coordinates);
      if(pt && (!best[key] || best[key].d > dmin)) best[key] = {d:dmin, pt, name, kind};
    }
    const rows = Object.values(best).filter(x => !['ocean', 'sea', 'bay', 'strait'].includes(x.kind) && !/sea|zee|ocean/i.test(x.name)).sort((a, b) => a.d - b.d).slice(0, 3);
    if(!rows.length) return;
    const h = rows.map((r, i) => `<a class="nrow ow" data-w="${i}"><i style="background:#1f6fb2"></i><span><b>🌊 ${esc(r.name || r.kind.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()))}</b><small>${t('open_water')}</small></span><em>${fmtD(r.d)}</em></a>`).join('');
    $('#nearlist').insertAdjacentHTML('afterbegin', h + `<div class="owtip">${t('ow_tip')}</div>`);
    $$('#nearlist .ow').forEach(a => a.onclick = () => MAP.flyTo({center:rows[+a.dataset.w].pt, zoom:Math.max(MAP.getZoom(), 16)}));
  };
})();

/* ───────── inventory ↔ AI ───────── */
(() => {
  const tools = $('#v-inv .inv-tools'); if(!tools) return;
  const b = document.createElement('button'); b.className = 'btn'; b.id = 'invAi'; b.innerHTML = '🤖 ' + t('inv_ai'); b.style.height = '38px';
  tools.insertBefore(b, $('#invAddBtn'));
  const name = s => { const i = it(s.item); return (i.e || '') + ' ' + (LANG === 'nl' ? i.nl || i.en : i.en || i.nl) };
  function context(){
    const p = INV.people, lines = [];
    lines.push(`Household: ${p.a} adult(s), ${p.c} child(ren), ${p.p} pet(s).`);
    const tt = totals(INV.stacks);
    lines.push(`Totals: ~${fmtDays(tt.food)} days of food, ~${fmtDays(tt.water)} days of water, ${tt.kg.toFixed(1)} kg${tt.filter ? ', has water filter/tablets' : ''}.`);
    for(const box of INV.boxes){
      const st = INV.stacks.filter(s => s.box === box.id); if(!st.length) continue;
      lines.push(`\n${box.icon} ${box.name || box.type}:`);
      st.forEach(s => { const d = daysLeft(s); lines.push(`- ${name(s).trim()} ×${s.qty}${d !== null ? (d < 0 ? ' (EXPIRED)' : ` (expires in ${Math.round(d)} days)`) : ''}${s.note ? ' — ' + s.note : ''}`) });
    }
    return lines.join('\n');
  }
  const ASKS = [['cook', '🍳'], ['missing', '🎒'], ['last', '⏳'], ['first', '⚠️'], ['trade', '🔁']];
  b.onclick = async () => {
    const pm = modal({title:'🤖 ' + t('inv_ai_t'), body:`<p class="sub">${t('inv_ai_sub')}</p><div class="aiasks">${ASKS.map(([k, e]) => `<button class="btn" data-k="${k}">${e} ${t('ia_' + k)}</button>`).join('')}</div>
      <input class="inp" id="iaQ" placeholder="${esc(t('ia_own'))}" style="width:100%;margin-top:10px">`, buttons:[{label:t('close'), v:'x'}, {label:t('ia_go'), v:'go', pri:1}]});
    let pick = '';
    $$('.aiasks [data-k]').forEach(x => x.onclick = () => { pick = x.dataset.k; $('#iaQ').value = t('iq_' + pick); $$('.aiasks .btn').forEach(y => y.classList.toggle('pri', y === x)) });
    const r = await pm; const q = ($('#iaQ')?.value || '').trim() || (pick && t('iq_' + pick));
    if(r.btn !== 'go' || !q) return;
    location.hash = 'ai';
    setTimeout(() => {
      const ctx = `${q}\n\n[My inventory — use this list]\n${context()}`;
      $('#prompt').value = ctx; window.__invAskLen = q.length; send();
    }, 400);
  };
  const _rc = renderChat;
  renderChat = function(){
    if(window.__invAskLen){ const u = [...CHAT].reverse().find(m => m.role === 'user' && m.content.includes('[My inventory')); if(u && !u.short){ u.short = u.content.slice(0, window.__invAskLen) + '  🎒' } window.__invAskLen = 0 }
    _rc();
    $$('#chat .msg.u').forEach((el, i) => { const us = CHAT.filter(m => m.role === 'user')[i]; if(us && us.short) el.querySelector('.bub').textContent = us.short });
  };
})();
