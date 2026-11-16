/* PROJECT NOMAD — frontend */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = (u, o) => fetch(u, o).then(r => r.json());
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d }catch(e){ return d } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)) }catch(e){} }
};
const fmtB = n => { if(!n) return '0 B'; const u=['B','KB','MB','GB','TB']; let i=0; while(n>=1024&&i<4){n/=1024;i++} return n.toFixed(n>=100||i<3?0:1)+' '+u[i] };
const fmtN = n => (n||0).toLocaleString('nl-NL');

let STATUS = {}, BOOKS = [], VIEW = 'home';
const VIEWS = { home:'// COMMANDOCENTRUM', lib:'// BIBLIOTHEEK', map:'// WERELDKAART', ai:'// AI-ASSISTENT', upd:'// UPDATES' };
const ICON = {
  lib:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5a1 1 0 011-1h4v16H5a1 1 0 01-1-1zM9 4h5v16H9zM14 5l4-1 3 15-4 1z"/></svg>',
  map:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>',
  ai:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/></svg>',
  geo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  ter:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 19l6-9 4 6 3-4 5 7z"/></svg>',
};

/* ───────── routing ───────── */
function setView(v){
  VIEW = v;
  $$('.view').forEach(e => e.classList.toggle('on', e.id === 'v-'+v));
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.go === v));
  $('#viewName').textContent = VIEWS[v] || '';
  if(v === 'map') initMap();
  if(v === 'upd') loadUpdates();
}
function route(){
  const h = decodeURI(location.hash.slice(1) || 'home');
  const [v, ...rest] = h.split('/');
  if(v === 'lib'){
    setView('lib');
    if(rest.length >= 2) openArticle(rest[0], rest.slice(1).join('/'));
    else if(rest.length === 1) openArticle(rest[0], '');
    else showShelf();
  } else if(v === 'search'){
    setView('lib'); fulltextView(decodeURIComponent(rest.join('/')));
  } else if(v === 'map'){
    setView('map');
    const m = (rest[0]||'').match(/^@(-?[\d.]+),(-?[\d.]+),([\d.]+)/);
    if(m) whenMap(map => map.jumpTo({center:[+m[2], +m[1]], zoom:+m[3]}));
  } else setView(VIEWS[v] ? v : 'home');
}
window.addEventListener('hashchange', route);
$$('[data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go });

/* ───────── status / dashboard ───────── */
async function loadStatus(){
  STATUS = await api('/api/status').catch(() => ({}));
  BOOKS = await api('/api/library').catch(() => []);
  $('#ver').textContent = STATUS.version || '';
  const on = STATUS.online;
  $('#netDot').className = 'dot ' + (on ? 'ok' : 'warn');
  $('#netTxt').textContent = on ? 'ONLINE · UPDATES MOGELIJK' : 'OFFLINE · VOLLEDIG LOKAAL';
  $('#fLib').innerHTML = 'ARTIKELEN <b>' + fmtN(STATUS.library?.articles) + '</b>';
  const b = $('#updBadge'); b.textContent = STATUS.updates || ''; b.classList.toggle('on', !!STATUS.updates);
  $('#aiModel').textContent = 'MODEL: ' + (STATUS.ai?.model || '—');
  renderDash(); renderBooks();
}
function stateDot(s){ return s === 'aan' ? 'ok' : (s === 'opstarten' ? 'warn' : 'bad') }
function renderDash(){
  const S = STATUS, L = S.library || {}, M = S.maps || {}, A = S.ai || {};
  const mapParts = [M.world?.present && 'straten', M.terrain?.present && 'hoogte', M.satellite?.present && 'satelliet'].filter(Boolean);
  const mapSize = Object.values(M).reduce((a, x) => a + (x.size||0), 0);
  $('#mods').innerHTML = `
    <div class="card" data-h="lib"><div class="k">MODULE 01</div><h3>${ICON.lib}Bibliotheek</h3>
      <div class="big">${fmtN(L.articles)}</div><div class="sub">artikelen in ${L.books||0} collectie(s) · ${fmtB(L.size)}</div>
      <div class="status"><span class="dot ${L.books?'ok':'bad'}"></span>${L.zim===false?'LIBZIM ONTBREEKT':L.books?'GEREED':'LEEG — ZET .ZIM IN DATA\\BIBLIOTHEEK'}</div></div>
    <div class="card" data-h="map"><div class="k">MODULE 02</div><h3>${ICON.map}Wereldkaart</h3>
      <div class="big">${mapParts.length ? mapParts.length + '/3' : '—'}</div><div class="sub">${mapParts.join(' · ') || 'nog geen kaartdata'} · ${fmtB(mapSize)}</div>
      <div class="status"><span class="dot ${M.world?.present?'ok':'bad'}"></span>${M.world?.present?'GEREED':'WORLD.PMTILES ONTBREEKT'}</div></div>
    <div class="card" data-h="map"><div class="k">MODULE 03</div><h3>${ICON.geo}Adres zoeken</h3>
      <div class="big">${S.geo==='aan'?'AAN':'—'}</div><div class="sub">Photon geocoder · wereldwijd</div>
      <div class="status"><span class="dot ${stateDot(S.geo)}"></span>${esc((S.geo||'').toUpperCase())}</div></div>
    <div class="card" data-h="ai"><div class="k">MODULE 04</div><h3>${ICON.ai}AI-assistent</h3>
      <div class="big">${A.state==='aan'?(A.models?.length||0)+' model':'—'}</div><div class="sub">${esc(A.model||'')} · lokaal via Ollama</div>
      <div class="status"><span class="dot ${stateDot(A.state)}"></span>${esc((A.state||'').toUpperCase())}</div></div>`;
  $$('#mods .card').forEach(c => c.onclick = () => location.hash = c.dataset.h);
  const lan = S.lan_url, mobile = /iphone|ipad|android/i.test(navigator.userAgent);
  $('#phoneT').style.display = $('#phone').style.display = (lan && !mobile) ? '' : 'none';
  if(lan && !mobile && window.qrcode){
    const qr = qrcode(0, 'M'); qr.addData(lan); qr.make();
    $('#phone').innerHTML = `<div style="flex:none;background:#d6efe2;padding:10px;border-radius:10px;line-height:0">${qr.createSvgTag({cellSize:4, margin:0})}</div>
      <div><div class="k">SCAN MET JE CAMERA</div><div class="big" style="font-size:20px">${esc(lan)}</div>
      <div class="sub">Telefoon of iPad op dezelfde wifi. Daarna: <b>Deel → Zet op beginscherm</b> (iPhone) of <b>⋮ → App installeren</b> (Android).</div></div>`;
  }
  const d = S.disk || {}, pct = d.total ? d.used / d.total * 100 : 0;
  $('#disk').innerHTML = `<div class="k">SSD</div><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="sub">${fmtB(d.used)} gebruikt van ${fmtB(d.total)} · <b style="color:var(--acc)">${fmtB(d.free)} vrij</b></div>`;
}

/* ───────── bibliotheek ───────── */
const frame = $('#frame');
function renderBooks(){
  $('#books').innerHTML = BOOKS.length ? BOOKS.map(b => `<a class="lnk" data-b="${esc(b.id)}" title="${esc(b.description)}">${esc(b.title)}<small>${esc(b.date)}</small></a>`).join('')
    : '<div class="empty">Nog geen collecties</div>';
  $$('#books .lnk').forEach(a => a.onclick = () => location.hash = 'lib/' + a.dataset.b);
}
function showShelf(){
  frame.style.display = 'none'; $('#shelf').style.display = 'block'; $('#progress').style.width = 0; setToc([]); $('#fDoc').textContent = '';
  $('#shelf').innerHTML = BOOKS.length ? `<div class="sec-t" style="margin-top:0">COLLECTIES</div><div class="grid">` + BOOKS.map(b => `
    <div class="card book" data-b="${esc(b.id)}"><div class="ico">${esc(b.title[0]||'?')}</div><div class="k">${esc(b.kind)}</div>
      <h3>${esc(b.title)}</h3><div class="sub">${fmtN(b.articles)} artikelen · ${fmtB(b.size)} · ${esc(b.date)}</div></div>`).join('') + '</div>'
    : `<div class="note"><b style="color:var(--acc);font-family:var(--mono);letter-spacing:.2em">BIBLIOTHEEK IS LEEG</b><br><br>
       Zet .zim-bestanden (Wikipedia, Gutenberg, iFixit…) in <code>NOMAD\\data\\bibliotheek</code> en klik bij Updates op <i>Bibliotheek opnieuw scannen</i>.</div>`;
  $$('#shelf .book').forEach(c => c.onclick = () => location.hash = 'lib/' + c.dataset.b);
}
function openArticle(book, path){
  $('#shelf').style.display = 'none'; frame.style.display = 'block';
  const want = '/lib/' + encodeURIComponent(book) + '/' + path.split('/').map(encodeURIComponent).join('/');
  let cur = ''; try{ cur = frame.contentWindow.location.pathname }catch(e){}
  if(decodeURIComponent(cur) === decodeURIComponent(want)) return;
  try{ if(cur.startsWith('/lib/')){ frame.contentWindow.location.replace(want); return } }catch(e){}
  frame.src = want;
}
frame.addEventListener('load', () => {
  let p = ''; try{ p = frame.contentWindow.location.pathname }catch(e){ return }
  if(!p.startsWith('/lib/')) return;
  const want = '#lib/' + decodeURIComponent(p.slice(5));
  if(decodeURI(location.hash) !== want) history.replaceState(null, '', encodeURI(want));
});
window.addEventListener('message', e => {
  const m = e.data || {};
  if(m.type === 'doc'){
    document.title = m.title + ' · NOMAD';
    $('#fDoc').innerHTML = '▸ <b>' + esc(m.title) + '</b>';
    setToc(m.headings); addHist(m.book, m.path, m.title);
  } else if(m.type === 'scroll'){
    $('#progress').style.width = (m.p*100).toFixed(1) + '%';
    $$('#toc .lnk').forEach(a => a.classList.toggle('active', a.dataset.id === m.active));
  } else if(m.type === 'key') handleKey(m);
});
function setToc(hs){
  $('#toc').innerHTML = hs && hs.length ? hs.map(h => `<a class="lnk h${h.l}" data-id="${esc(h.id)}">${esc(h.t)}</a>`).join('') : '<div class="empty">Geen secties</div>';
  $$('#toc .lnk').forEach(a => a.onclick = () => frame.contentWindow.postMessage({type:'goto', id:a.dataset.id}, '*'));
}
function addHist(book, path, title){
  let h = store.get('nomad.hist', []).filter(x => !(x.book === book && x.path === path));
  h.unshift({book, path, title}); store.set('nomad.hist', h.slice(0, 30)); renderHist();
}
function renderHist(){
  const h = store.get('nomad.hist', []);
  $('#hist').innerHTML = h.length ? h.map(x => `<a class="lnk" data-b="${esc(x.book)}" data-p="${esc(x.path)}">${esc(x.title)}</a>`).join('') : '<div class="empty">Nog niets gelezen</div>';
  $$('#hist .lnk').forEach(a => a.onclick = () => location.hash = 'lib/' + a.dataset.b + '/' + a.dataset.p);
}
async function fulltextView(q){
  frame.style.display = 'none'; const box = $('#shelf'); box.style.display = 'block';
  box.innerHTML = `<div class="sec-t" style="margin-top:0">ZOEKEN NAAR “${esc(q)}”…</div>`;
  const r = await api('/api/search?q=' + encodeURIComponent(q)).catch(() => ({total:0, results:[]}));
  box.innerHTML = `<div class="sec-t" style="margin-top:0">${fmtN(r.total)} RESULTATEN VOOR “${esc(q)}”</div>` +
    (r.results.map(x => `<a class="res" data-b="${esc(x.book)}" data-p="${esc(x.path)}">${esc(x.title)}<span>${esc(x.bookTitle)} · /${esc(x.path)}</span></a>`).join('') || '<div class="empty">Niets gevonden</div>');
  $$('#shelf .res').forEach(a => a.onclick = () => location.hash = 'lib/' + a.dataset.b + '/' + a.dataset.p);
}
async function random(){
  const r = await api('/api/random');
  if(r.book) location.hash = 'lib/' + r.book + '/' + r.path;
}

/* ───────── kaart ───────── */
let MAP = null, mapWaiters = [];
const LAYERSTATE = store.get('nomad.layers', {streets:true, satellite:false, hillshade:false, terrain3d:false});
function whenMap(fn){ if(MAP && MAP.loaded()) fn(MAP); else mapWaiters.push(fn) }
function greenFlavor(){
  const f = Object.assign({}, basemaps.namedFlavor('dark'));
  Object.assign(f, {
    background:'#040b08', earth:'#08130e', water:'#04201c', park_a:'#0b2117', park_b:'#0d2a1c', wood_a:'#0b1d14', wood_b:'#0d2318',
    scrub_a:'#0b1a13', scrub_b:'#0b1a13', glacier:'#10201a', sand:'#13190f', beach:'#151c12', hospital:'#14140f', school:'#11180f',
    industrial:'#0e1511', aerodrome:'#0f1813', pedestrian:'#0d1611', zoo:'#0c1812', military:'#121510', runway:'#1d2b23',
    buildings:'#0f241a', boundaries:'#2f8f62',
    highway:'#2ecf85', highway_casing_early:'#062014', highway_casing_late:'#062014',
    major:'#1f8a58', major_casing_early:'#05170f', major_casing_late:'#05170f',
    link:'#1f8a58', minor_a:'#1a4a33', minor_b:'#163d2b', minor_service:'#13321f', other:'#13321f', railway:'#2a5a43',
    bridges_highway:'#2ecf85', bridges_major:'#1f8a58', bridges_minor:'#1a4a33', bridges_link:'#1f8a58', bridges_other:'#13321f',
    tunnel_highway:'#1a5c3d', tunnel_major:'#154530', tunnel_minor:'#11301f', tunnel_link:'#154530', tunnel_other:'#0f2a1b',
    roads_label_major:'#8fe8bb', roads_label_major_halo:'#04100a', roads_label_minor:'#5f9a7d', roads_label_minor_halo:'#04100a',
    ocean_label:'#2f9a8a', subplace_label:'#7fb79a', subplace_label_halo:'#04100a', city_label:'#d8ffe9', city_label_halo:'#04100a',
    state_label:'#4f8a6d', state_label_halo:'#04100a', country_label:'#9dffcf', address_label:'#4f7a64', address_label_halo:'#04100a',
  });
  return f;
}
function buildStyle(){
  const o = location.origin, M = STATUS.maps || {};
  const style = {
    version: 8,
    glyphs: o + '/web/assets/fonts/{fontstack}/{range}.pbf',
    sprite: o + '/web/assets/sprites/v4/dark',
    sources: {
      protomaps: { type:'vector', url:'pmtiles://' + o + '/kaart/world.pmtiles',
        attribution:'© <a href="https://openstreetmap.org">OpenStreetMap</a> · Protomaps' },
    },
    layers: basemaps.layers('protomaps', greenFlavor(), {lang:'en'}),
  };
  if(M.satellite?.present) style.sources.sat = { type:'raster', url:'pmtiles://' + o + '/kaart/satellite.pmtiles', tileSize:256, attribution:'Satelliet' };
  if(M.terrain?.present){
    style.sources.dem = { type:'raster-dem', url:'pmtiles://' + o + '/kaart/terrain.pmtiles', encoding:'terrarium', attribution:'JAXA AW3D30' };
    style.sources.dem3d = { type:'raster-dem', url:'pmtiles://' + o + '/kaart/terrain.pmtiles', encoding:'terrarium' };
  }
  return style;
}
function firstId(pred){ const l = MAP.getStyle().layers.find(pred); return l && l.id }
function applyLayers(){
  const M = STATUS.maps || {};
  store.set('nomad.layers', LAYERSTATE);
  $$('#maplayers .tog').forEach(t => {
    const l = t.dataset.l, avail = l === 'streets' ? true : l === 'satellite' ? M.satellite?.present : M.terrain?.present;
    t.classList.toggle('dis', !avail); t.classList.toggle('on', !!(avail && LAYERSTATE[l]));
  });
  if(!MAP || !MAP.isStyleLoaded()) return;
  const roadsAt = firstId(l => /roads|transit|buildings/.test(l.id));
  const labelsAt = firstId(l => l.type === 'symbol');
  if(M.satellite?.present){
    if(LAYERSTATE.satellite && !MAP.getLayer('sat')) MAP.addLayer({id:'sat', type:'raster', source:'sat', paint:{'raster-saturation':-0.15,'raster-contrast':0.1}}, roadsAt);
    if(!LAYERSTATE.satellite && MAP.getLayer('sat')) MAP.removeLayer('sat');
  }
  if(M.terrain?.present){
    if(LAYERSTATE.hillshade && !MAP.getLayer('hill')) MAP.addLayer({id:'hill', type:'hillshade', source:'dem',
      paint:{'hillshade-shadow-color':'#000a05','hillshade-highlight-color':'rgba(150,255,200,.35)','hillshade-accent-color':'#0b3a24','hillshade-exaggeration':0.55}}, labelsAt);
    if(!LAYERSTATE.hillshade && MAP.getLayer('hill')) MAP.removeLayer('hill');
    MAP.setTerrain(LAYERSTATE.terrain3d ? {source:'dem3d', exaggeration:1.4} : null);
    if(LAYERSTATE.terrain3d && MAP.getPitch() < 30) MAP.easeTo({pitch:60, duration:800});
  }
  MAP.getStyle().layers.forEach(l => {
    let vis = true;
    if(l.type === 'background' && LAYERSTATE.satellite) vis = false;
    if(l.source === 'protomaps' && l.type === 'fill' && LAYERSTATE.satellite && !/buildings/.test(l.id)) vis = false;
    if(l.source === 'protomaps' && l.type === 'line' && !LAYERSTATE.streets) vis = false;
    if(l.source === 'protomaps' || l.type === 'background') MAP.setLayoutProperty(l.id, 'visibility', vis ? 'visible' : 'none');
  });
}
$$('#maplayers .tog').forEach(t => t.onclick = () => { LAYERSTATE[t.dataset.l] = !LAYERSTATE[t.dataset.l]; applyLayers() });

function initMap(){
  if(MAP) { setTimeout(() => MAP.resize(), 50); return }
  if(!STATUS.maps?.world?.present){ $('#mapempty').style.display = 'grid'; applyLayers(); return }
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  const last = store.get('nomad.view', {center:[4.9, 52.37], zoom:6});
  MAP = new maplibregl.Map({ container:'map', style:buildStyle(), center:last.center, zoom:last.zoom, attributionControl:{compact:true}, maxPitch:80 });
  MAP.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'bottom-right');
  MAP.addControl(new maplibregl.ScaleControl({unit:'metric'}), 'bottom-right');
  MAP.on('load', () => { applyLayers(); mapWaiters.splice(0).forEach(f => f(MAP)) });
  MAP.on('mousemove', e => { $('#mapcoord').textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)} · z${MAP.getZoom().toFixed(1)}` });
  MAP.on('moveend', () => {
    const c = MAP.getCenter(); store.set('nomad.view', {center:[c.lng, c.lat], zoom:MAP.getZoom()});
    if(VIEW === 'map') history.replaceState(null, '', `#map/@${c.lat.toFixed(5)},${c.lng.toFixed(5)},${MAP.getZoom().toFixed(2)}`);
  });
  MAP.on('contextmenu', async e => {
    const r = await api(`/api/geocode?lat=${e.lngLat.lat}&lon=${e.lngLat.lng}`).catch(() => ({}));
    const f = (r.features || [])[0];
    new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b>${esc(placeName(f) || 'Locatie')}</b><br><span style="font-family:var(--mono);font-size:11px;color:var(--dim)">${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}</span>`).addTo(MAP);
  });
}
let marker = null;
function placeName(f){
  if(!f) return '';
  const p = f.properties || {};
  return [p.name, p.street && (p.street + (p.housenumber ? ' ' + p.housenumber : '')), p.city || p.town || p.village, p.country].filter(Boolean).filter((v,i,a) => a.indexOf(v) === i).join(', ');
}
function flyToFeature(f){
  const [lon, lat] = f.geometry.coordinates;
  location.hash = 'map';
  whenMap(map => {
    const ext = f.properties?.extent;
    if(ext) map.fitBounds([[ext[0], ext[3]], [ext[2], ext[1]]], {padding:60, maxZoom:16});
    else map.flyTo({center:[lon, lat], zoom:15});
    if(marker) marker.remove();
    const el = document.createElement('div');
    el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 6px rgba(61,255,160,.25),0 0 20px var(--acc)';
    marker = new maplibregl.Marker({element:el}).setLngLat([lon, lat]).setPopup(new maplibregl.Popup().setHTML('<b>' + esc(placeName(f)) + '</b>')).addTo(map);
  });
}
let geoT = null;
$('#mapq').addEventListener('input', e => {
  clearTimeout(geoT); const q = e.target.value.trim();
  geoT = setTimeout(async () => {
    if(!q){ $('#maphits').innerHTML = ''; return }
    const c = MAP ? MAP.getCenter() : null;
    const r = await api('/api/geocode?q=' + encodeURIComponent(q) + (c ? `&lat=${c.lat}&lon=${c.lng}` : '')).catch(() => ({features:[]}));
    window.__hits = r.features || [];
    $('#maphits').innerHTML = r.error ? `<div class="empty" style="padding:10px 14px">${esc(r.error)}</div>` :
      __hits.map((f, i) => `<a class="lnk" data-i="${i}">${esc(placeName(f))}<small>${esc(f.properties?.osm_value || '')}</small></a>`).join('') || '<div class="empty" style="padding:10px 14px">Niets gevonden</div>';
    $$('#maphits .lnk').forEach(a => a.onclick = () => { flyToFeature(__hits[+a.dataset.i]); $('#maphits').innerHTML = '' });
  }, 180);
});
$('#mapq').addEventListener('keydown', e => { if(e.key === 'Enter' && window.__hits?.length){ flyToFeature(__hits[0]); $('#maphits').innerHTML = '' } });

/* ───────── AI ───────── */
let CHAT = store.get('nomad.chat', []), busy = false;
function renderChat(){
  $('#chat').innerHTML = CHAT.length ? CHAT.map((m, i) => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">
      <div class="av">${m.role === 'user' ? 'JIJ' : 'AI'}</div>
      <div class="bub${m.err ? ' err' : ''}${m.live ? ' cursor' : ''}">${esc(m.content)}${m.sources?.length ? '<div class="src">' +
        m.sources.map(s => `<span class="chip" data-b="${esc(s.book)}" data-p="${esc(s.path)}">↗ ${esc(s.title)}</span>`).join('') + '</div>' : ''}</div></div>`).join('')
    : `<div class="msg"><div class="av">AI</div><div class="bub" style="color:var(--dim)">Hoi! Ik draai volledig lokaal op je SSD. Met “Wikipedia als bron” zoek ik eerst in je offline Wikipedia en antwoord ik op basis daarvan, met de bronnen erbij.</div></div>`;
  $$('#chat .chip').forEach(c => c.onclick = () => location.hash = 'lib/' + c.dataset.b + '/' + c.dataset.p);
  $('#chat').scrollTop = 1e9;
}
async function send(){
  const t = $('#prompt').value.trim(); if(!t || busy) return;
  busy = true; $('#send').disabled = true; $('#prompt').value = ''; autoGrow();
  CHAT.push({role:'user', content:t});
  const msg = {role:'assistant', content:'', live:true}; CHAT.push(msg); renderChat();
  try{
    const res = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({wiki: $('#useWiki').classList.contains('on'), messages: CHAT.filter(m => m !== msg && !m.err).map(m => ({role:m.role, content:m.content}))})});
    if(!res.ok && res.headers.get('content-type')?.includes('json') && !res.body){ throw new Error((await res.json()).error) }
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for(;;){
      const {value, done} = await reader.read(); if(done) break;
      buf += dec.decode(value, {stream:true});
      let i; while((i = buf.indexOf('\n')) >= 0){
        const line = buf.slice(0, i); buf = buf.slice(i+1); if(!line.trim()) continue;
        const m = JSON.parse(line);
        if(m.sources) msg.sources = m.sources;
        if(m.t) msg.content += m.t;
        if(m.error){ msg.content = m.error; msg.err = true }
        renderChat();
      }
    }
  }catch(e){ msg.content = 'Fout: ' + e.message; msg.err = true }
  msg.live = false; busy = false; $('#send').disabled = false;
  store.set('nomad.chat', CHAT.slice(-40)); renderChat();
}
function autoGrow(){ const p = $('#prompt'); p.style.height = 'auto'; p.style.height = Math.min(200, p.scrollHeight) + 'px' }
$('#prompt').addEventListener('input', autoGrow);
$('#prompt').addEventListener('keydown', e => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send() } });
$('#send').onclick = send;
$('#useWiki').onclick = () => $('#useWiki').classList.toggle('on');
$('#newChat').onclick = () => { CHAT = []; store.set('nomad.chat', []); renderChat() };

/* ───────── updates ───────── */
let updTimer = null;
async function loadUpdates(){
  const u = await api('/api/updates').catch(() => ({updates:[], jobs:{}}));
  $('#updInfo').innerHTML = (u.online ? '<span class="dot ok"></span>Online' : '<span class="dot warn"></span>Offline') +
    ' · laatste controle: ' + (u.last_check || 'nog niet') + ' · NOMAD downloadt nooit iets zonder dat jij op “Updaten” klikt.';
  const jobs = u.jobs || {};
  const rows = u.updates.map(x => {
    const j = jobs[x.id];
    return `<div class="upd"><div class="t"><b>${esc(x.title)}</b><span>${esc(x.type.toUpperCase())} · ${esc(x.current)} → ${esc(x.latest)}</span>
      ${j ? `<div class="bar"><i style="width:${j.total ? (j.done/j.total*100).toFixed(1) : 0}%"></i></div><span>${esc(j.status)} ${j.total ? fmtB(j.done) + ' / ' + fmtB(j.total) : ''} ${esc(j.msg||'')}</span>` : ''}</div>
      <button class="btn pri" data-u="${esc(x.id)}" ${j && j.status === 'bezig' ? 'disabled' : ''}>UPDATEN</button></div>`;
  });
  const done = Object.entries(jobs).filter(([id, j]) => j.status !== 'bezig' && !u.updates.find(x => x.id === id))
    .map(([id, j]) => `<div class="upd"><div class="t"><b>${esc(j.title)}</b><span>${esc(j.status.toUpperCase())} ${esc(j.msg||'')}</span></div></div>`);
  $('#updList').innerHTML = rows.concat(done).join('') || '<div class="note">Alles is up-to-date' + (u.online ? '.' : ' (voor zover bekend; je bent offline).') + '</div>';
  $$('#updList [data-u]').forEach(b => b.onclick = async () => { await api('/api/updates/run', {method:'POST', body:JSON.stringify({id:b.dataset.u})}); loadUpdates() });
  clearTimeout(updTimer);
  if(VIEW === 'upd' && Object.values(jobs).some(j => j.status === 'bezig')) updTimer = setTimeout(loadUpdates, 1500);
}
$('#updCheck').onclick = async () => { await api('/api/updates/check', {method:'POST'}); $('#updInfo').textContent = 'Controleren…'; setTimeout(loadUpdates, 4000) };
$('#rescan').onclick = async () => { const r = await api('/api/rescan', {method:'POST'}); await loadStatus(); $('#updInfo').textContent = r.books + ' collectie(s) gevonden.' };

/* ───────── command palette ───────── */
let items = [], sel = 0, sT = null, lastQ = '';
function openPal(){ $('#palette').classList.add('on'); const q = $('#q'); q.value = ''; renderSugg([]); q.focus() }
function closePal(){ $('#palette').classList.remove('on') }
$('#palette').addEventListener('mousedown', e => { if(e.target.id === 'palette') closePal() });
$('#omni').onclick = openPal; $('#omni2').onclick = openPal;
$('#q').addEventListener('input', e => {
  clearTimeout(sT); const q = e.target.value; lastQ = q;
  sT = setTimeout(async () => {
    if(!q.trim()){ renderSugg([]); return }
    const [lib, geo] = await Promise.all([
      api('/api/suggest?q=' + encodeURIComponent(q)).catch(() => []),
      STATUS.geo === 'aan' ? api('/api/geocode?q=' + encodeURIComponent(q)).catch(() => ({})) : Promise.resolve({}),
    ]);
    if(q !== lastQ) return;
    const out = lib.map(x => ({kind:'lib', label:x.title, tag:x.bookTitle, x}));
    (geo.features || []).slice(0, 4).forEach(f => out.push({kind:'geo', label:placeName(f), tag:'PLAATS', x:f}));
    renderSugg(out);
  }, 90);
});
function renderSugg(list){
  items = list; sel = 0;
  const q = $('#q').value.trim();
  if(q) items.push({kind:'ft', label:`Zoek “${q}” in alle tekst`, tag:'ALLES'});
  if(q) items.push({kind:'ai', label:`Vraag de AI: “${q}”`, tag:'AI'});
  $('#sugg').innerHTML = items.map((it, i) => `<div class="s${i ? '' : ' sel'}" data-i="${i}"><i>${esc(it.tag || '')}</i>${esc(it.label)}</div>`).join('');
  $$('#sugg .s').forEach(s => { s.onclick = () => pick(+s.dataset.i); s.onmousemove = () => { sel = +s.dataset.i; mark() } });
}
function mark(){ $$('#sugg .s').forEach((s, i) => s.classList.toggle('sel', i === sel)); const c = $$('#sugg .s')[sel]; c && c.scrollIntoView({block:'nearest'}) }
function pick(i, ft){
  const it = items[i], q = $('#q').value.trim(); closePal();
  if(ft || !it || it.kind === 'ft'){ if(q) location.hash = 'search/' + encodeURIComponent(q); return }
  if(it.kind === 'lib') location.hash = 'lib/' + it.x.book + '/' + it.x.path;
  else if(it.kind === 'geo') flyToFeature(it.x);
  else if(it.kind === 'ai'){ location.hash = 'ai'; $('#prompt').value = q; send() }
}
$('#q').addEventListener('keydown', e => {
  if(e.key === 'ArrowDown'){ sel = Math.min(sel+1, items.length-1); mark(); e.preventDefault() }
  else if(e.key === 'ArrowUp'){ sel = Math.max(sel-1, 0); mark(); e.preventDefault() }
  else if(e.key === 'Enter'){ pick(sel, e.shiftKey) }
  else if(e.key === 'Escape') closePal();
});

/* ───────── sneltoetsen ───────── */
function handleKey(e){
  const k = (e.key || '').toLowerCase();
  if((e.ctrlKey || e.metaKey) && k === 'k'){ openPal(); return true }
  if(e.inInput) return false;
  if(k === '/'){ openPal(); return true }
  if(k === 'r' && !e.ctrlKey && !e.metaKey){ random(); return true }
  if(e.altKey && k === 'arrowleft'){ history.back(); return true }
  if(e.altKey && k === 'arrowright'){ history.forward(); return true }
  return false;
}
document.addEventListener('keydown', e => {
  if($('#palette').classList.contains('on')) return;
  const inInput = /input|textarea/i.test(e.target.tagName);
  if(handleKey({key:e.key, ctrlKey:e.ctrlKey, metaKey:e.metaKey, altKey:e.altKey, inInput})) e.preventDefault();
});
$('#bRand').onclick = random;

/* ───────── start ───────── */
setInterval(() => { $('#clock').textContent = new Date().toLocaleString('nl-NL', {weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', second:'2-digit'}).toUpperCase() }, 1000);
setInterval(loadStatus, 30000);
renderHist(); renderChat();
loadStatus().then(route);
