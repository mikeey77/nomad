/* NOMAD v0.21 — navigation upgrades, "send to phone", My documents for the AI, language packs */

/* ───────── route: pick A/B from search, my location, swap, straight-line fallback, send to phone ───────── */
(() => {
  const NAMES = {A:'', B:''};
  const hav = (a, b) => { const R = Math.PI / 180, x = Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lng - a.lng) * R / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)) };
  const brg = (a, b) => { const R = Math.PI / 180, y = Math.sin((b.lng - a.lng) * R) * Math.cos(b.lat * R), x = Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lng - a.lng) * R); return (Math.atan2(y, x) / R + 360) % 360 };
  const fmtD = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m) + ' m';
  const fmtMin = min => min >= 60 ? Math.floor(min / 60) + 'h ' + Math.round(min % 60) + 'm' : Math.round(min) + ' min';
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  // tools row in the route box
  const box = $('#routebox');
  const tools = document.createElement('div'); tools.className = 'rtools';
  tools.innerHTML = `<button class="btn" data-r="me" title="${t('r_me')}">📍 ${t('r_me')}</button><button class="btn" data-r="swap" title="${t('r_swap')}">⇅</button><button class="btn" data-r="clear" title="${t('r_clear')}">✕</button>`;
  box.querySelector('.rpts').after(tools);
  tools.querySelector('[data-r=me]').onclick = () => {
    if(!navigator.geolocation) return toast(t('r_noloc'));
    toast(t('r_locating'));
    navigator.geolocation.getCurrentPosition(p => { RFROM = {lat:p.coords.latitude, lng:p.coords.longitude}; NAMES.A = t('r_me'); routeNow() },
      () => toast(t('r_noloc')), {enableHighAccuracy:true, timeout:12000});
  };
  tools.querySelector('[data-r=swap]').onclick = () => { [RFROM, RTO] = [RTO, RFROM]; [NAMES.A, NAMES.B] = [NAMES.B, NAMES.A]; routeNow() };
  tools.querySelector('[data-r=clear]').onclick = () => {
    RFROM = RTO = null; NAMES.A = NAMES.B = ''; RMARK.forEach(m => m.remove()); RMARK = [];
    if(MAP.getSource('route')) MAP.getSource('route').setData({type:'FeatureCollection', features:[]});
    $('#rRes').innerHTML = ''; window.LAST_ROUTE = null; box.classList.remove('on');
  };

  // A / B buttons on every search hit
  new MutationObserver(() => {
    $$('#maphits .lnk').forEach(a => {
      if(a.querySelector('.rab')) return;
      const s = document.createElement('span'); s.className = 'rab';
      s.innerHTML = `<b data-ab="A" title="${t('r_from')}">A</b><b data-ab="B" title="${t('r_to')}">B</b>`;
      s.onclick = e => {
        e.stopPropagation(); const ab = e.target.dataset.ab; if(!ab) return;
        const f = __hits[+a.dataset.i], [lng, lat] = f.geometry.coordinates;
        if(ab === 'A'){ RFROM = {lat, lng}; NAMES.A = placeName(f) } else { RTO = {lat, lng}; NAMES.B = placeName(f) }
        $('#maphits').innerHTML = ''; $('#mapq').value = ''; routeNow();
      };
      a.appendChild(s);
    });
  }).observe($('#maphits'), {childList:true});

  const _routeNow = routeNow;
  routeNow = async function(){
    if(RFROM && !RFROM.lng && RFROM.lon) RFROM = {lat:RFROM.lat, lng:RFROM.lon};
    await _routeNow();
    if(NAMES.A && RFROM) $('#rFrom').textContent = NAMES.A;
    if(NAMES.B && RTO) $('#rTo').textContent = NAMES.B;
    if(!RFROM || !RTO) return;
    const st = STATUS.route?.state;
    if(st !== 'aan'){
      // no route engine: straight line with distance, direction and time estimates
      const d = hav(RFROM, RTO), b = brg(RFROM, RTO);
      const geo = {type:'Feature', geometry:{type:'LineString', coordinates:[[RFROM.lng, RFROM.lat], [RTO.lng, RTO.lat]]}};
      if(MAP.getSource('route')) MAP.getSource('route').setData(geo);
      else { MAP.addSource('route', {type:'geojson', data:geo}); MAP.addLayer({id:'route', type:'line', source:'route', paint:{'line-color':'#eafff3', 'line-width':3, 'line-dasharray':[2, 2]}}) }
      MAP.fitBounds([[Math.min(RFROM.lng, RTO.lng), Math.min(RFROM.lat, RTO.lat)], [Math.max(RFROM.lng, RTO.lng), Math.max(RFROM.lat, RTO.lat)]], {padding:90, maxZoom:15});
      window.LAST_ROUTE = {straight:true, p:{distance:d, time:d / 1.25 * 1000 * 1.3, points:geo.geometry, instructions:[{text:`${t('r_head')} ${DIRS[Math.round(b / 45) % 8]} (${Math.round(b)}°)`, interval:[0, 1]}]}, mode:'foot', from:RFROM, to:RTO};
      $('#rRes').innerHTML = `<div class="rsum"><b>${fmtD(d)}</b><b>${Math.round(b)}° ${DIRS[Math.round(b / 45) % 8]}</b></div>
        <div class="rins"><div><span>🥾 ${t('r_walk')}</span><em>${fmtMin(d * 1.3 / 1.25 / 60)}</em></div><div><span>🚲 ${t('r_bike2')}</span><em>${fmtMin(d * 1.3 / 4.5 / 60)}</em></div><div><span>🚗 ${t('r_car2')}</span><em>${fmtMin(d * 1.35 / 15 / 60)}</em></div></div>
        <div class="geo-off" style="padding:8px 0 0;border:0">${st === 'bouwen' || st === 'opstarten' ? t('r_building') : t('r_straight')} ${st === 'bouwen' || st === 'opstarten' ? '' : `<a onclick="gotoDownload('route:netherlands')">${t('r_get')}</a>`}</div>`;
    }
    addSendBtn();
  };

  function addSendBtn(){
    const R = window.LAST_ROUTE; if(!R || $('#rSend')) return;
    const b = document.createElement('button'); b.className = 'btn pri'; b.id = 'rSend'; b.style.cssText = 'width:100%;margin-top:8px;height:32px';
    b.innerHTML = '📱 ' + t('r_send');
    b.onclick = () => {
      const p = R.p, coords = p.points.coordinates.map(c => [+c[0].toFixed(6), +c[1].toFixed(6)]);
      const name = `${NAMES.A || t('r_start')} → ${NAMES.B || t('r_dest')}`.slice(0, 80);
      const ins = (p.instructions || []).map(x => [x.text, (x.interval || [0])[0]]);
      const r = {id:Date.now(), name, mode:R.mode, dist:Math.round(p.distance), time:Math.round(p.time / 1000), coords, ins, added:Date.now()};
      saveUser({routes:[r, ...(USER.routes || [])].slice(0, 12)});
      toast(t('r_sent'));
    };
    $('#rRes').appendChild(b);
  }
})();

/* ───────── My documents (the AI reads your own files) ───────── */
(() => {
  const btn = document.createElement('button'); btn.className = 'btn'; btn.id = 'docsBtn'; btn.style.cssText = 'height:28px;white-space:nowrap';
  btn.innerHTML = '📄 ' + t('docs_btn') + ' <b id="docsN"></b>';
  $('#histBtn').before(btn);
  async function count(){ const r = await api('/api/docs').catch(() => null); if(r) $('#docsN').textContent = r.state.files || '' ; return r }
  setTimeout(count, 2500);
  const fsz = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' kB';
  async function render(){
    const r = await count() || {files:[], state:{}};
    $('#mBody').innerHTML = `<p class="sub">${t('docs_sub')}</p>
      <label class="btn pri" style="display:inline-flex;gap:8px;align-items:center;cursor:pointer;margin:6px 0 12px">⬆ ${t('docs_add')}<input type="file" id="docIn" multiple hidden accept=".pdf,.txt,.md,.docx,.odt,.epub,.html,.htm,.csv,.rtf,.json,.srt"></label>
      ${r.state.state === 'indexing' ? `<div class="mono dim" style="font-size:11px">⟳ ${t('docs_idx')} ${esc(r.state.msg || '')}</div>` : ''}
      <div class="doclist">${r.files.length ? r.files.map(f => `<div class="docrow${f.error ? ' bad' : ''}"><span>${/\.pdf$/i.test(f.name) ? '📕' : /\.docx?$|\.odt$/i.test(f.name) ? '📘' : /\.epub$/i.test(f.name) ? '📗' : '📄'}</span>
          <a href="/api/fs/raw?path=${encodeURIComponent(f.path)}" target="_blank">${esc(f.name)}</a><em>${f.error ? esc(f.error) : (f.pages ? f.pages + ' p · ' : '') + f.chunks + ' ' + t('docs_parts') + ' · ' + fsz(f.size)}</em></div>`).join('')
        : `<div class="empty" style="white-space:normal">${t('docs_none')}</div>`}</div>
      <p class="mono dim" style="font-size:10.5px;margin-top:10px">${esc(r.dir || 'NOMAD/data/documents')}</p>`;
    $('#docIn').onchange = async e => {
      const files = [...e.target.files]; if(!files.length) return;
      for(const f of files){ toast('⬆ ' + f.name); await fetch(`/api/fs/upload?path=${encodeURIComponent(r.dir)}&name=${encodeURIComponent(f.name)}`, {method:'POST', body:f}) }
      await post('/api/docs/scan', {}); toast(t('docs_added')); setTimeout(render, 1500); setTimeout(render, 6000);
    };
  }
  btn.onclick = async () => {
    const p = modal({title:'📄 ' + t('docs_title'), body:'', buttons:[{label:t('close'), v:'ok', pri:1}]});
    await render(); await p;
  };
  // sources from own documents open the file itself
  const _rc = renderChat;
  renderChat = function(){
    _rc();
    $$('#chat .chip[data-b="__doc"]').forEach(c => { c.classList.add('doc'); c.onclick = () => window.open('/api/fs/raw?path=' + encodeURIComponent(c.dataset.p), '_blank') });
  };
  renderChat();
})();

/* ───────── language packs: one card with a language picker + full / light ───────── */
(() => {
  const _rb = renderBundles;
  renderBundles = function(){
    if(!BUN || !BUN.bundles) return _rb();
    const all = BUN.bundles, langs = all.filter(b => b.group === 'lang');
    if(!langs.length) return _rb();
    let sel = store.get('nomad.langpack', '');
    const planned = langs.find(b => PLAN[b.id]);
    if(planned) sel = planned.id;
    if(!langs.some(b => b.id === sel)) sel = (langs.find(b => b.id === 'lang:de') || langs[0]).id;
    const cur = langs.find(b => b.id === sel), lg = cur.lang;
    const shown = all.filter(b => b.group !== 'lang' || b.id === sel);
    BUN.bundles = shown; try { _rb() } finally { BUN.bundles = all }
    const card = $$('#bgrid .bcard')[shown.findIndex(b => b.id === sel)];
    if(!card) return;
    card.classList.add('langcard');
    const full = langs.filter(b => !b.light).sort((a, b) => a.langName.localeCompare(b.langName));
    const w = document.createElement('div'); w.className = 'langrow';
    w.innerHTML = `<select class="inp langsel">${full.map(b => `<option value="${b.lang}" ${b.lang === lg ? 'selected' : ''}>${esc(b.langName)}</option>`).join('')}</select>
      <div class="seg lseg"><button data-l="0" class="${cur.light ? '' : 'on'}">📷 ${t('lp_full')} · ${fmtB((langs.find(b => b.id === 'lang:' + lg) || {}).total || 0)}</button><button data-l="1" class="${cur.light ? 'on' : ''}">⚡ ${t('lp_light')} · ${fmtB((langs.find(b => b.id === 'lang:' + lg + ':light') || {}).total || 0)}</button></div>`;
    const go = id => { if(PLAN[sel]){ delete PLAN[sel]; PLAN[id] = []; savePlan() } store.set('nomad.langpack', id); renderBundles() };
    w.querySelector('select').onchange = e => go('lang:' + e.target.value + (cur.light ? ':light' : ''));
    w.querySelectorAll('[data-l]').forEach(b => b.onclick = () => go('lang:' + lg + (b.dataset.l === '1' ? ':light' : '')));
    card.querySelector('.bdesc').before(w);
  };
})();
