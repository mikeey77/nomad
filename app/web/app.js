/* PROJECT NOMAD — frontend */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = (u, o) => fetch(u, o).then(r => r.json());
const post = (u, body) => api(u, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body || {})});
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d }catch(e){ return d } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)) }catch(e){} }
};
const fmtB = n => { if(!n) return '0 B'; const u=['B','KB','MB','GB','TB']; let i=0; while(n>=1024&&i<4){n/=1024;i++} return n.toFixed(n>=100||i<3?0:1)+' '+u[i] };
const fmtN = n => (n||0).toLocaleString(LANG === 'nl' ? 'nl-NL' : 'en-GB');
const debounce = (f, ms) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => f(...a), ms) } };
function toast(msg){ const e = $('#toast'); e.textContent = msg; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 2200) }

let STATUS = {}, BOOKS = [], VIEW = 'home', SET = {}, USER = {favorites:[], notes:{}, pins:[], checklist:[]};
const VIEWS = ['home','lib','map','ai','sos','dl','set'];
const ICON = {
  lib:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5a1 1 0 011-1h4v16H5a1 1 0 01-1-1zM9 4h5v16H9zM14 5l4-1 3 15-4 1z"/></svg>',
  map:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>',
  ai:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/></svg>',
  geo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
};

/* ───────── instellingen & weergave ───────── */
function applyLook(){
  LANG = SET.lang || 'en';
  document.documentElement.dataset.accent = SET.accent || 'green';
  document.documentElement.dataset.theme = SET.theme || 'dark';
  applyI18n();
  $('#viewName').textContent = t('v_' + VIEW);
  try{ frame.contentWindow.postMessage({type:'look', scale:SET.font_scale || 1, theme:SET.theme}, '*') }catch(e){}
}
async function saveSet(patch){
  SET = await post('/api/settings', patch); delete $('#phone').dataset.url;
  applyLook(); renderSettings(); renderAll();
}
async function saveUser(patch){
  Object.assign(USER, patch);
  await post('/api/user', patch).catch(() => {});
}

/* ───────── routing ───────── */
function setView(v){
  VIEW = v;
  $$('.view').forEach(e => e.classList.toggle('on', e.id === 'v-' + v));
  $$('.tab').forEach(x => x.classList.toggle('on', x.dataset.go === v));
  $('#viewName').textContent = t('v_' + v);
  if(v === 'map') initMap();
  if(v === 'dl') loadDownloads();
  if(v === 'set'){ renderSettings(); loadCleanup() }
  if(v === 'sos') renderSos();
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
  } else setView(VIEWS.includes(v) ? v : 'home');
}
window.addEventListener('hashchange', route);
$$('[data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go });

/* ───────── status / dashboard ───────── */
async function loadStatus(){
  STATUS = await api('/api/status').catch(() => ({}));
  BOOKS = await api('/api/library').catch(() => []);
  renderAll();
}
function renderAll(){
  $('#ver').textContent = $('#ver2').textContent = STATUS.version || '';
  const on = STATUS.online;
  $('#netDot').className = 'dot ' + (on ? 'ok' : 'warn');
  $('#netTxt').textContent = (on ? t('online') : t('offline')).toUpperCase();
  $('#fLib').innerHTML = t('articles').toUpperCase() + ' <b>' + fmtN(STATUS.library?.articles) + '</b>';
  const b = $('#updBadge'); b.textContent = STATUS.updates || ''; b.classList.toggle('on', !!STATUS.updates);
  $('#aiModel').textContent = t('model').toUpperCase() + ': ' + (STATUS.ai?.model || '—');
  renderDash(); renderBooks(); renderFavs(); renderHist();
  if(VIEW === 'lib' && $('#shelf').style.display !== 'none' && !location.hash.startsWith('#search')) showShelf();
}
function stateDot(s){ return s === 'aan' ? 'ok' : (s === 'opstarten' ? 'warn' : 'bad') }
function stTxt(s){ return t('st_' + s) !== 'st_' + s ? t('st_' + s) : String(s || '').toUpperCase() }
function renderDash(){
  const S = STATUS, L = S.library || {}, M = S.maps || {}, A = S.ai || {};
  const parts = [M.world?.present && t('streets'), M.terrain?.present && t('elevation'), M.satellite?.present && t('satellite')].filter(Boolean);
  const mapSize = Object.values(M).reduce((a, x) => a + (x.size||0), 0);
  $('#mods').innerHTML = `
    <div class="card" data-h="lib"><div class="k">${t('mod')} 01</div><h3>${ICON.lib}${t('library')}</h3>
      <div class="big">${fmtN(L.articles)}</div><div class="sub">${t('articles_in', {n:L.books||0})} · ${fmtB(L.size)}</div>
      <div class="status"><span class="dot ${L.books?'ok':'bad'}"></span>${L.zim===false?t('nozim'):L.books?t('ready'):t('empty_lib')}</div></div>
    <div class="card" data-h="map"><div class="k">${t('mod')} 02</div><h3>${ICON.map}${t('worldmap')}</h3>
      <div class="big">${parts.length ? parts.length + '/3' : '—'}</div><div class="sub">${parts.join(' · ') || t('no_mapdata')} · ${fmtB(mapSize)}</div>
      <div class="status"><span class="dot ${M.world?.present?'ok':'bad'}"></span>${M.world?.present?t('ready'):t('world_missing')}</div></div>
    <div class="card" data-h="map"><div class="k">${t('mod')} 03</div><h3>${ICON.geo}${t('geo')}</h3>
      <div class="big">${S.geo==='aan'?t('st_aan'):'—'}</div><div class="sub">${t('photon')}</div>
      <div class="status"><span class="dot ${stateDot(S.geo)}"></span>${esc(stTxt(S.geo))}</div></div>
    <div class="card" data-h="ai"><div class="k">${t('mod')} 04</div><h3>${ICON.ai}${t('assistant')}</h3>
      <div class="big">${A.state==='aan'?(A.models?.length||0)+' '+t('model'):'—'}</div><div class="sub">${esc(A.model||'')} · ${t('local_ollama')}</div>
      <div class="status"><span class="dot ${stateDot(A.state)}"></span>${esc(stTxt(A.state))}</div></div>`;
  $$('#mods .card').forEach(c => c.onclick = () => location.hash = c.dataset.h);
  $('#favHome').innerHTML = USER.favorites.length ? `<div class="sec-t">${t('favorites')}</div><div class="chips">` +
    USER.favorites.slice(0, 12).map(f => `<span class="chip" data-b="${esc(f.book)}" data-p="${esc(f.path)}">★ ${esc(f.title)}</span>`).join('') + '</div>' : '';
  $$('#favHome .chip').forEach(c => c.onclick = () => location.hash = 'lib/' + c.dataset.b + '/' + c.dataset.p);
  const lan = S.lan_url, mobile = /iphone|ipad|android/i.test(navigator.userAgent);
  $('#phoneT').style.display = $('#phone').style.display = (lan && !mobile) ? '' : 'none';
  if(lan && !mobile && window.qrcode && !$('#phone').dataset.url){
    const qr = qrcode(0, 'M'); qr.addData(lan); qr.make();
    const n = qr.getModuleCount(); let rects = '';
    for(let r = 0; r < n; r++) for(let c = 0; c < n; c++) if(qr.isDark(r, c)) rects += `<rect x="${c}" y="${r}" width="1.02" height="1.02" rx=".18"/>`;
    $('#phone').dataset.url = lan;
    setTimeout(() => { const b = $('.qrbox'); if(b) b.onclick = () => b.classList.toggle('classic') });
    $('#phone').innerHTML = `<div class="qrbox"><svg viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="geometricPrecision">${rects}</svg><i class="qrscan"></i></div>
      <div class="qrinfo"><div class="k">${t('scan')}</div><div class="qrurl">${esc(lan)}</div><div class="sub">${t('phone_help')}</div>
      <div class="qrsteps"><span>📱 1. Wi-Fi</span><span>📷 2. Scan</span><span>➕ 3. Home Screen</span></div></div>`;
  }
  const d = S.disk || {}, pct = d.total ? d.used / d.total * 100 : 0;
  $('#disk').innerHTML = `<div class="k">SSD</div><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="sub">${t('used_of', {u:fmtB(d.used), t:fmtB(d.total)})} · <b style="color:var(--acc)">${fmtB(d.free)} ${t('free')}</b></div>`;
}

/* ───────── bibliotheek ───────── */
const frame = $('#frame');
let CUR = null;
function renderBooks(){
  $('#books').innerHTML = BOOKS.length ? BOOKS.map(b => `<a class="lnk" data-b="${esc(b.id)}" title="${esc(b.description)}">${esc(b.title)}<small>${esc(b.date)}</small></a>`).join('')
    : `<div class="empty">${t('no_coll')}</div>`;
  $$('#books .lnk').forEach(a => a.onclick = () => location.hash = 'lib/' + a.dataset.b);
}
function showShelf(){
  CUR = null; $('#artBlock').style.display = 'none';
  frame.style.display = 'none'; $('#shelf').style.display = 'block'; $('#progress').style.width = 0; setToc(null); $('#fDoc').textContent = '';
  $('#shelf').innerHTML = BOOKS.length ? `<div class="sec-t" style="margin-top:0">${t('collections')}</div><div class="grid">` + BOOKS.map(b => `
    <div class="card book" data-b="${esc(b.id)}"><div class="ico">${esc(b.title[0]||'?')}</div><div class="k">${esc(b.kind)}</div>
      <h3>${esc(b.title)}</h3><div class="sub">${fmtN(b.articles)} ${t('articles')} · ${fmtB(b.size)} · ${esc(b.date)}</div></div>`).join('') + '</div>'
    : `<div class="note"><b class="nt">${t('lib_empty_t')}</b><br><br>${t('lib_empty')}</div>`;
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
  frame.contentWindow.postMessage({type:'look', scale:SET.font_scale || 1, theme:SET.theme}, '*');
});
window.addEventListener('message', e => {
  const m = e.data || {};
  if(m.type === 'doc'){
    CUR = {book:m.book, path:m.path, title:m.title};
    document.title = m.title + ' · NOMAD';
    $('#fDoc').innerHTML = '▸ <b>' + esc(m.title) + '</b>';
    setToc(m.headings); addHist(m.book, m.path, m.title); renderArtBlock();
  } else if(m.type === 'scroll'){
    $('#progress').style.width = (m.p*100).toFixed(1) + '%';
    $$('#toc .lnk').forEach(a => a.classList.toggle('active', a.dataset.id === m.active));
  } else if(m.type === 'key') handleKey(m);
});
function setToc(hs){
  $('#toc').innerHTML = hs && hs.length ? hs.map(h => `<a class="lnk h${h.l}" data-id="${esc(h.id)}">${esc(h.t)}</a>`).join('') : `<div class="empty">${hs ? t('no_sec') : t('no_art')}</div>`;
  $$('#toc .lnk').forEach(a => a.onclick = () => frame.contentWindow.postMessage({type:'goto', id:a.dataset.id}, '*'));
}
const keyOf = c => c.book + '/' + c.path;
function isFav(c){ return USER.favorites.some(f => f.book === c.book && f.path === c.path) }
function renderArtBlock(){
  if(!CUR){ $('#artBlock').style.display = 'none'; return }
  $('#artBlock').style.display = '';
  const fav = isFav(CUR);
  $('#favBtn').textContent = fav ? t('fav_rm') : t('fav_add');
  $('#favBtn').classList.toggle('pri', fav);
  $('#noteBox').value = USER.notes[keyOf(CUR)] || '';
}
$('#favBtn').onclick = () => {
  if(!CUR) return;
  const favs = isFav(CUR) ? USER.favorites.filter(f => !(f.book === CUR.book && f.path === CUR.path))
                          : [{...CUR, added:Date.now()}, ...USER.favorites];
  saveUser({favorites:favs}); renderArtBlock(); renderFavs(); renderDash();
};
$('#noteBox').addEventListener('input', debounce(() => {
  if(!CUR) return;
  const notes = {...USER.notes}, v = $('#noteBox').value.trim();
  if(v) notes[keyOf(CUR)] = v; else delete notes[keyOf(CUR)];
  saveUser({notes}); toast(t('saved')); renderFavs();
}, 600));
function renderFavs(){
  $('#favs').innerHTML = USER.favorites.length ? USER.favorites.map(f => `<a class="lnk" data-b="${esc(f.book)}" data-p="${esc(f.path)}">★ ${esc(f.title)}${USER.notes[keyOf(f)] ? ' <small>✎</small>' : ''}</a>`).join('')
    : `<div class="empty">${t('no_fav')}</div>`;
  $$('#favs .lnk').forEach(a => a.onclick = () => location.hash = 'lib/' + a.dataset.b + '/' + a.dataset.p);
}
function addHist(book, path, title){
  let h = store.get('nomad.hist', []).filter(x => !(x.book === book && x.path === path));
  h.unshift({book, path, title}); store.set('nomad.hist', h.slice(0, 30)); renderHist();
}
function renderHist(){
  const h = store.get('nomad.hist', []);
  $('#hist').innerHTML = h.length ? h.map(x => `<a class="lnk" data-b="${esc(x.book)}" data-p="${esc(x.path)}">${esc(x.title)}</a>`).join('') : `<div class="empty">${t('no_hist')}</div>`;
  $$('#hist .lnk').forEach(a => a.onclick = () => location.hash = 'lib/' + a.dataset.b + '/' + a.dataset.p);
}
async function fulltextView(q){
  CUR = null; renderArtBlock();
  frame.style.display = 'none'; const box = $('#shelf'); box.style.display = 'block';
  box.innerHTML = `<div class="sec-t" style="margin-top:0">${t('searching', {q:esc(q)})}</div>`;
  const r = await api('/api/search?q=' + encodeURIComponent(q)).catch(() => ({total:0, results:[]}));
  box.innerHTML = `<div class="sec-t" style="margin-top:0">${t('results_for', {n:fmtN(r.total), q:esc(q)})}</div>` +
    (r.results.map(x => `<a class="res" data-b="${esc(x.book)}" data-p="${esc(x.path)}">${esc(x.title)}<span>${esc(x.bookTitle)} · /${esc(x.path)}</span></a>`).join('') || `<div class="empty">${t('nothing')}</div>`);
  $$('#shelf .res').forEach(a => a.onclick = () => location.hash = 'lib/' + a.dataset.b + '/' + a.dataset.p);
}
async function random(){
  const r = await api('/api/random');
  if(r.book) location.hash = 'lib/' + r.book + '/' + r.path;
}

/* ───────── kaart ───────── */
let MAP = null, mapWaiters = [], PINMARKERS = [];
const LAYERSTATE = store.get('nomad.layers', {streets:true, satellite:false, hillshade:false, terrain3d:false});
function whenMap(fn){ if(MAP && MAP.loaded()) fn(MAP); else mapWaiters.push(fn) }
const ACC = {green:['#2ecf85','#1f8a58','#9dffcf','#2f8f62'], blue:['#3aa8ff','#1f5f9a','#a8dcff','#2f6f9f'], amber:['#ffb63a','#9a6a1f','#ffe0a8','#9f7a2f'], red:['#ff5a5a','#9a2f2f','#ffb0b0','#9f3f3f']};
function mapFlavor(){
  const f = Object.assign({}, basemaps.namedFlavor('dark'));
  const [hi, maj, lab, bnd] = ACC[SET.accent] || ACC.green;
  Object.assign(f, {
    background:'#040b08', earth:'#08130e', water:'#04201c', park_a:'#0b2117', park_b:'#0d2a1c', wood_a:'#0b1d14', wood_b:'#0d2318',
    scrub_a:'#0b1a13', scrub_b:'#0b1a13', glacier:'#10201a', sand:'#13190f', beach:'#151c12', hospital:'#14140f', school:'#11180f',
    industrial:'#0e1511', aerodrome:'#0f1813', pedestrian:'#0d1611', zoo:'#0c1812', military:'#121510', runway:'#1d2b23',
    buildings:'#0f241a', boundaries:bnd,
    highway:hi, highway_casing_early:'#062014', highway_casing_late:'#062014',
    major:maj, major_casing_early:'#05170f', major_casing_late:'#05170f',
    link:maj, minor_a:'#1a4a33', minor_b:'#163d2b', minor_service:'#13321f', other:'#13321f', railway:'#2a5a43',
    bridges_highway:hi, bridges_major:maj, bridges_minor:'#1a4a33', bridges_link:maj, bridges_other:'#13321f',
    tunnel_highway:'#1a5c3d', tunnel_major:'#154530', tunnel_minor:'#11301f', tunnel_link:'#154530', tunnel_other:'#0f2a1b',
    roads_label_major:lab, roads_label_major_halo:'#04100a', roads_label_minor:'#5f9a7d', roads_label_minor_halo:'#04100a',
    ocean_label:'#2f9a8a', subplace_label:'#7fb79a', subplace_label_halo:'#04100a', city_label:'#e4fff0', city_label_halo:'#04100a',
    state_label:'#4f8a6d', state_label_halo:'#04100a', country_label:lab, address_label:'#4f7a64', address_label_halo:'#04100a',
  });
  return f;
}
function buildStyle(){
  const o = location.origin, M = STATUS.maps || {};
  const style = {
    version:8, glyphs:o + '/web/assets/fonts/{fontstack}/{range}.pbf', sprite:o + '/web/assets/sprites/v4/dark',
    sources:{ protomaps:{ type:'vector', url:'pmtiles://' + o + '/kaart/world.pmtiles', attribution:'© <a href="https://openstreetmap.org">OpenStreetMap</a> · Protomaps' } },
    layers:basemaps.layers('protomaps', mapFlavor(), {lang:LANG}),
  };
  if(M.satellite?.present) style.sources.sat = {type:'raster', url:'pmtiles://' + o + '/kaart/satellite.pmtiles', tileSize:256};
  if(M.terrain?.present){
    style.sources.dem = {type:'raster-dem', url:'pmtiles://' + o + '/kaart/terrain.pmtiles', encoding:'terrarium', attribution:'JAXA AW3D30'};
    style.sources.dem3d = {type:'raster-dem', url:'pmtiles://' + o + '/kaart/terrain.pmtiles', encoding:'terrarium'};
  }
  return style;
}
function firstId(pred){ const l = MAP.getStyle().layers.find(pred); return l && l.id }
function applyLayers(){
  const M = STATUS.maps || {};
  store.set('nomad.layers', LAYERSTATE);
  $$('#maplayers .tog').forEach(x => {
    const l = x.dataset.l, avail = l === 'streets' ? true : l === 'satellite' ? M.satellite?.present : M.terrain?.present;
    x.classList.toggle('dis', !avail); x.classList.toggle('on', !!(avail && LAYERSTATE[l]));
  });
  if(!MAP || !MAP.isStyleLoaded()) return;
  const roadsAt = firstId(l => /roads|transit|buildings/.test(l.id)), labelsAt = firstId(l => l.type === 'symbol');
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
$$('#maplayers .tog').forEach(x => x.onclick = () => { LAYERSTATE[x.dataset.l] = !LAYERSTATE[x.dataset.l]; applyLayers() });
function initMap(){
  if(MAP){ setTimeout(() => MAP.resize(), 50); return }
  if(!STATUS.maps?.world?.present){ $('#mapempty').style.display = 'grid'; applyLayers(); renderPins(); return }
  $('#mapempty').style.display = 'none';
  if(!window.__pmProto){ window.__pmProto = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', window.__pmProto.tile) }
  const last = store.get('nomad.view', {center:[4.9, 52.37], zoom:6});
  MAP = new maplibregl.Map({container:'map', style:buildStyle(), center:last.center, zoom:last.zoom, attributionControl:{compact:true}, maxPitch:80});
  MAP.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'bottom-right');
  MAP.addControl(new maplibregl.ScaleControl({unit:'metric'}), 'bottom-right');
  MAP.on('load', () => { applyLayers(); renderPins(); mapWaiters.splice(0).forEach(f => f(MAP)) });
  MAP.on('mousemove', e => { $('#mapcoord').textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)} · z${MAP.getZoom().toFixed(1)}` });
  MAP.on('moveend', () => {
    const c = MAP.getCenter(); store.set('nomad.view', {center:[c.lng, c.lat], zoom:MAP.getZoom()});
    if(VIEW === 'map') history.replaceState(null, '', `#map/@${c.lat.toFixed(5)},${c.lng.toFixed(5)},${MAP.getZoom().toFixed(2)}`);
  });
  MAP.on('contextmenu', e => pinPopup(e.lngLat));
  let pressT;
  MAP.on('touchstart', e => { pressT = setTimeout(() => pinPopup(e.lngLat), 600) });
  ['touchend','touchmove','dragstart'].forEach(ev => MAP.on(ev, () => clearTimeout(pressT)));
}
async function pinPopup(ll){
  const r = await api(`/api/geocode?lat=${ll.lat}&lon=${ll.lng}`).catch(() => ({}));
  const name = placeName((r.features || [])[0]) || t('location');
  const div = document.createElement('div');
  div.innerHTML = `<b>${esc(name)}</b><br><span class="mono dim">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</span>
    <div style="display:flex;gap:6px;margin-top:8px"><input class="inp" style="flex:1;height:30px" value="${esc(name)}"><button class="btn pri" style="height:30px">${t('save_pin')}</button></div>`;
  const pop = new maplibregl.Popup().setLngLat(ll).setDOMContent(div).addTo(MAP);
  div.querySelector('button').onclick = () => {
    const pins = [...USER.pins, {lat:+ll.lat.toFixed(6), lon:+ll.lng.toFixed(6), name:div.querySelector('input').value.trim() || name, added:Date.now()}];
    saveUser({pins}); pop.remove(); renderPins();
  };
}
function renderPins(){
  $('#pinlist').innerHTML = USER.pins.length ? USER.pins.map((p, i) => `<a class="lnk" data-i="${i}">📍 ${esc(p.name)}</a>`).join('') : `<div class="empty" style="white-space:normal">${t('no_pins')}</div>`;
  $$('#pinlist .lnk').forEach(a => a.onclick = () => { const p = USER.pins[+a.dataset.i]; MAP && MAP.flyTo({center:[p.lon, p.lat], zoom:Math.max(MAP.getZoom(), 13)}) });
  if(!MAP) return;
  PINMARKERS.forEach(m => m.remove()); PINMARKERS = [];
  USER.pins.forEach((p, i) => {
    const el = document.createElement('div'); el.className = 'pin';
    const div = document.createElement('div');
    div.innerHTML = `<b>📍 ${esc(p.name)}</b><br><span class="mono dim">${p.lat}, ${p.lon}</span><br><button class="btn" style="height:28px;margin-top:8px">${t('delete')}</button>`;
    div.querySelector('button').onclick = () => { saveUser({pins:USER.pins.filter((_, j) => j !== i)}); renderPins() };
    PINMARKERS.push(new maplibregl.Marker({element:el}).setLngLat([p.lon, p.lat]).setPopup(new maplibregl.Popup().setDOMContent(div)).addTo(MAP));
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
    if(ext) map.fitBounds([[ext[0], ext[3]], [ext[2], ext[1]]], {padding:60, maxZoom:16}); else map.flyTo({center:[lon, lat], zoom:15});
    if(marker) marker.remove();
    const el = document.createElement('div'); el.className = 'pin hit';
    marker = new maplibregl.Marker({element:el}).setLngLat([lon, lat]).setPopup(new maplibregl.Popup().setHTML('<b>' + esc(placeName(f)) + '</b>')).addTo(map);
  });
}
$('#mapq').addEventListener('input', debounce(async e => {
  const q = e.target.value.trim();
  if(!q){ $('#maphits').innerHTML = ''; return }
  const c = MAP ? MAP.getCenter() : null;
  const r = await api('/api/geocode?q=' + encodeURIComponent(q) + (c ? `&lat=${c.lat}&lon=${c.lng}` : '')).catch(() => ({features:[]}));
  window.__hits = r.features || [];
  $('#maphits').innerHTML = r.error ? `<div class="empty" style="padding:10px 14px">${t('geo_off')}</div>` :
    __hits.map((f, i) => `<a class="lnk" data-i="${i}">${esc(placeName(f))}<small>${esc(f.properties?.osm_value || '')}</small></a>`).join('') || `<div class="empty" style="padding:10px 14px">${t('nothing')}</div>`;
  $$('#maphits .lnk').forEach(a => a.onclick = () => { flyToFeature(__hits[+a.dataset.i]); $('#maphits').innerHTML = '' });
}, 180));
$('#mapq').addEventListener('keydown', e => { if(e.key === 'Enter' && window.__hits?.length){ flyToFeature(__hits[0]); $('#maphits').innerHTML = '' } });

/* ───────── AI ───────── */
let CHAT = store.get('nomad.chat', []), busy = false;
function renderChat(){
  $('#chat').innerHTML = CHAT.length ? CHAT.map(m => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">
      <div class="av">${m.role === 'user' ? t('you') : 'AI'}</div>
      <div class="bub${m.err ? ' err' : ''}${m.live ? ' cursor' : ''}">${esc(m.content)}${m.sources?.length ? '<div class="src">' +
        m.sources.map(s => `<span class="chip" data-b="${esc(s.book)}" data-p="${esc(s.path)}">↗ ${esc(s.title)}</span>`).join('') + '</div>' : ''}</div></div>`).join('')
    : `<div class="msg"><div class="av">AI</div><div class="bub" style="color:var(--dim)">${t('ai_hello')}</div></div>`;
  $$('#chat .chip').forEach(c => c.onclick = () => location.hash = 'lib/' + c.dataset.b + '/' + c.dataset.p);
  $('#chat').scrollTop = 1e9;
}
async function send(){
  const q = $('#prompt').value.trim(); if(!q || busy) return;
  busy = true; $('#send').disabled = true; $('#prompt').value = ''; autoGrow();
  CHAT.push({role:'user', content:q});
  const msg = {role:'assistant', content:'', live:true}; CHAT.push(msg); renderChat();
  try{
    const res = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({wiki:$('#useWiki').classList.contains('on'), messages:CHAT.filter(m => m !== msg && !m.err).map(m => ({role:m.role, content:m.content}))})});
    if(!res.ok){ throw new Error((await res.json().catch(() => ({}))).error || res.status) }
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
  }catch(e){ msg.content = t('error') + ': ' + e.message; msg.err = true }
  msg.live = false; busy = false; $('#send').disabled = false;
  store.set('nomad.chat', CHAT.slice(-40)); renderChat();
}
function autoGrow(){ const p = $('#prompt'); p.style.height = 'auto'; p.style.height = Math.min(200, p.scrollHeight) + 'px' }
$('#prompt').addEventListener('input', autoGrow);
$('#prompt').addEventListener('keydown', e => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send() } });
$('#send').onclick = send;
$('#useWiki').onclick = () => $('#useWiki').classList.toggle('on');
$('#newChat').onclick = () => { CHAT = []; store.set('nomad.chat', []); renderChat() };

/* ───────── noodpakket ───────── */
const GUIDES = [
  ['❤','CPR','Cardiopulmonary resuscitation','Reanimatie'], ['🩸','Bleeding','Bleeding','Bloeding stoppen'], ['🔥','Burns','Burn','Brandwonden'],
  ['😮','Choking','Choking','Verslikken'], ['🦴','Fracture','Bone fracture','Botbreuk'], ['🥶','Hypothermia','Hypothermia','Onderkoeling'],
  ['🥵','Heat stroke','Heat stroke','Zonnesteek'], ['⚡','Shock','Shock (circulatory)','Shock'], ['🐍','Snakebite','Snakebite','Slangenbeet'],
  ['🤧','Anaphylaxis','Anaphylaxis','Allergische reactie'], ['💧','Water purification','Water purification','Water zuiveren'], ['🔥','Fire making','Fire making','Vuur maken'],
  ['⛺','Shelter','Survival skills','Onderdak'], ['🧭','Navigation','Navigation','Navigeren'], ['🪢','Knots','List of knots','Knopen'], ['📻','Radio','Emergency communication system','Noodcommunicatie'],
];
async function openGuide(term){
  const med = BOOKS.find(b => b.id.startsWith('mdwiki'));
  for(const b of [med, BOOKS.find(b => b.id.startsWith('wikipedia_'))].filter(Boolean)){
    const r = await api(`/api/suggest?book=${encodeURIComponent(b.id)}&q=${encodeURIComponent(term)}`).catch(() => []);
    if(r.length){ location.hash = 'lib/' + r[0].book + '/' + r[0].path; return }
  }
  location.hash = 'search/' + encodeURIComponent(term);
}
function renderSos(){
  $('#guides').innerHTML = GUIDES.map(g => `<div class="card guide" data-q="${esc(g[2])}"><div class="gi">${g[0]}</div><b>${LANG === 'nl' ? g[3] : g[1]}</b></div>`).join('');
  $$('#guides .guide').forEach(c => c.onclick = () => openGuide(c.dataset.q));
  renderSun(); renderCheck();
  const hasSensor = 'DeviceOrientationEvent' in window && /iphone|ipad|android/i.test(navigator.userAgent);
  $('#compassNote').textContent = hasSensor ? '' : t('compass_na');
  $('#compassBtn').style.display = hasSensor ? '' : 'none';
}
let POS = null;
function renderSun(){
  const v = store.get('nomad.view', {center:[4.9, 52.37]});
  const lat = POS ? POS.lat : v.center[1], lon = POS ? POS.lon : v.center[0];
  const s = sunTimes(new Date(), lat, lon), f = d => d ? d.toLocaleTimeString(LANG === 'nl' ? 'nl-NL' : 'en-GB', {hour:'2-digit', minute:'2-digit'}) : '—';
  const len = s.rise && s.set ? (s.set - s.rise) / 36e5 : 0;
  $('#sunbox').innerHTML = `<div class="big" style="font-size:22px">☀ ${f(s.rise)} → ${f(s.set)}</div>
    ${t('daylight')}: ${Math.floor(len)}h ${Math.round((len % 1) * 60)}m<br><span class="mono dim">${lat.toFixed(3)}, ${lon.toFixed(3)} · ${t('sun_loc')}</span>`;
}
$('#posBtn').onclick = () => navigator.geolocation?.getCurrentPosition(p => { POS = {lat:p.coords.latitude, lon:p.coords.longitude}; renderSun();
  whenMap(m => m.flyTo({center:[POS.lon, POS.lat], zoom:14})) }, e => toast(e.message), {enableHighAccuracy:true, timeout:15000});
$('#compassBtn').onclick = async () => {
  try{ if(DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission() }catch(e){}
  addEventListener('deviceorientationabsolute', onOri, true); addEventListener('deviceorientation', onOri, true);
};
function onOri(e){
  const h = e.webkitCompassHeading ?? (e.absolute || e.type === 'deviceorientationabsolute' ? (360 - e.alpha) % 360 : null);
  if(h == null) return;
  $('#needle').style.transform = `rotate(${-h}deg)`;
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  $('#heading').textContent = Math.round(h) + '° ' + dirs[Math.round(h / 45) % 8];
}
function renderCheck(){
  $('#check').innerHTML = USER.checklist.map((c, i) => `<div class="chk${c.done ? ' done' : ''}" data-i="${i}"><i></i><span>${esc(c.t)}</span><b data-x="${i}">×</b></div>`).join('');
  $$('#check .chk').forEach(el => el.onclick = e => {
    const i = +el.dataset.i, list = USER.checklist.map(x => ({...x}));
    if(e.target.dataset.x !== undefined) list.splice(i, 1); else list[i].done = !list[i].done;
    saveUser({checklist:list}); renderCheck();
  });
}
$('#checkAdd').onclick = () => { const v = $('#checkIn').value.trim(); if(!v) return; $('#checkIn').value = ''; saveUser({checklist:[...USER.checklist, {t:v, done:false}]}); renderCheck() };
$('#checkIn').addEventListener('keydown', e => { if(e.key === 'Enter') $('#checkAdd').click() });
let flashing = null, audio = null;
function stopFlash(){ clearTimeout(flashing); flashing = null; $('#flash').className = ''; try{ audio && audio.close() }catch(e){} audio = null }
$('#flash').onclick = stopFlash;
$('#torchBtn').onclick = () => { $('#flash').className = 'on white'; flashing = 1 };
$('#sosBtn').onclick = () => {
  const u = 220, seq = [1,1,1,1,1,3, 3,1,3,1,3,3, 1,1,1,1,1,7];
  try{ audio = new (window.AudioContext || window.webkitAudioContext)() }catch(e){}
  let i = 0; $('#flash').className = 'on';
  const step = () => {
    const on = i % 2 === 0; $('#flash').classList.toggle('white', on);
    if(audio && on){ const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + seq[i] * u / 1000) }
    flashing = setTimeout(step, seq[i] * u); i = (i + 1) % seq.length;
  };
  step();
};

/* ───────── downloads & updates ───────── */
let dlTimer = null, CAT = null, DLTAB = 'zim', SHOW = 60, FCAT = '';
const stLabel = s => t('status_' + s);
const CATNAMES = {wikipedia:'Wikipedia', gutenberg:'Books (Gutenberg)', stack_exchange:'Stack Exchange', ted:'TED talks', ifixit:'iFixit', wiktionary:'Wiktionary',
  wikibooks:'Wikibooks', wikivoyage:'Wikivoyage', wikiversity:'Wikiversity', wikiquote:'Wikiquote', wikisource:'Wikisource', wikinews:'Wikinews',
  phet:'PhET science', libretexts:'LibreTexts', vikidia:'Vikidia (kids)', freecodecamp:'freeCodeCamp', devdocs:'DevDocs', videos:'Videos', other:'Other', mooc:'Courses', zimit:'Websites'};
const POP = ['wikipedia','gutenberg','ifixit','wikibooks','wikivoyage','stack_exchange','wiktionary','libretexts','ted','phet','devdocs','other'];
async function loadDownloads(force){
  if(!CAT || force){
    $('#zimgrid').innerHTML = `<div class="empty">${t('loading')}</div>`;
    CAT = await api('/api/catalog' + (force ? '?force=1' : '')).catch(() => ({zim:[], extras:[]}));
  }
  await pollJobs(); renderCats(); renderZim(); renderExtras();
}
async function pollJobs(){
  const u = await api('/api/updates').catch(() => ({updates:[], jobs:{}}));
  window.__jobs = u.jobs || {}; window.__upd = u;
  renderQueue(); renderUpdates(u);
  clearTimeout(dlTimer);
  const busy = Object.values(window.__jobs).some(j => j.status === 'bezig' || j.status === 'wachtrij');
  if(VIEW === 'dl' && busy) dlTimer = setTimeout(async () => {
    const before = JSON.stringify(Object.values(window.__jobs).map(j => j.status));
    await pollJobs();
    if(before !== JSON.stringify(Object.values(window.__jobs).map(j => j.status))){ CAT = null; await loadStatus(); loadDownloads() }
    else { renderZim(true); renderExtras() }
  }, 1500);
}
function jobOf(id){ return (window.__jobs || {})[id] }
function eta(j){ if(!j.speed || !j.total) return ''; const s = (j.total - j.done) / j.speed; return ` · ${fmtB(j.speed)}/s · ${s > 3600 ? (s/3600).toFixed(1) + 'h' : Math.ceil(s/60) + 'm'} ${t('eta')}` }
function jobBar(j){
  if(!j) return '';
  const pct = j.total ? (j.done / j.total * 100) : 0;
  return `<div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div><span class="mono dim">${stLabel(j.status)} ${j.total ? fmtB(j.done) + ' / ' + fmtB(j.total) + ' · ' + pct.toFixed(1) + '%' : ''}${eta(j)} ${esc(j.msg || '')}</span>`;
}
function renderQueue(){
  const run = Object.entries(window.__jobs || {}).filter(([, j]) => j.status === 'bezig' || j.status === 'wachtrij');
  $('#dlQueue').innerHTML = run.length ? `<div class="hud" style="margin:4px 2px 8px">${t('queue')}</div>` + run.map(([id, j]) =>
    `<div class="upd"><div class="t"><b>${esc(j.title)}</b>${jobBar(j)}</div><button class="btn" data-c="${esc(id)}">${t('cancel')}</button></div>`).join('') : '';
  $$('#dlQueue [data-c]').forEach(b => b.onclick = () => cancelDl(b.dataset.c));
  const d = STATUS.disk || {};
  $('#dlFree').innerHTML = `SSD <b style="color:var(--acc)">${fmtB(d.free)}</b> ${t('free')} / ${fmtB(d.total)}`;
}
function renderCats(){
  const langs = $('#flang').value.split(',').filter(Boolean);
  const counts = {};
  (CAT.zim || []).forEach(i => { if(!langs.length || langs.some(l => i.lang.split(',').includes(l))) counts[i.cat] = (counts[i.cat] || 0) + 1 });
  const cats = Object.keys(counts).sort((a, b) => (POP.indexOf(a) + 1 || 99) - (POP.indexOf(b) + 1 || 99) || counts[b] - counts[a]);
  $('#fcats').innerHTML = `<span class="chip${FCAT ? '' : ' on'}" data-c="">${t('cat_all')}</span>` +
    cats.map(c => `<span class="chip${FCAT === c ? ' on' : ''}" data-c="${esc(c)}">${esc(CATNAMES[c] || c)} <small>${counts[c]}</small></span>`).join('');
  $$('#fcats .chip').forEach(c => c.onclick = () => { FCAT = c.dataset.c; SHOW = 60; renderCats(); renderZim() });
}
function filtered(){
  const q = $('#fq').value.trim().toLowerCase(), langs = $('#flang').value.split(',').filter(Boolean), fl = $('#fflav').value, inst = $('#finst').classList.contains('on');
  let list = (CAT.zim || []).filter(i =>
    (!langs.length || langs.some(l => i.lang.split(',').includes(l))) && (!FCAT || i.cat === FCAT) && (!fl || i.flavour === fl) && (!inst || i.installed) &&
    (!q || (i.title + ' ' + i.summary + ' ' + i.name).toLowerCase().includes(q)));
  const s = $('#fsort').value;
  const pop = i => (POP.indexOf(i.cat) + 1 || 50) * 1e12 - i.articles;
  list.sort(s === 'size' ? (a, b) => b.size - a.size : s === 'small' ? (a, b) => a.size - b.size : s === 'name' ? (a, b) => a.title.localeCompare(b.title)
    : s === 'date' ? (a, b) => b.date.localeCompare(a.date) : (a, b) => (b.installed ? 1 : 0) - (a.installed ? 1 : 0) || pop(a) - pop(b));
  return list;
}
function itemBtns(id, i, kind){
  const j = jobOf(id);
  if(j && (j.status === 'bezig' || j.status === 'wachtrij')) return `<button class="btn" data-c="${esc(id)}">${t('cancel')}</button>`;
  if(kind === 'torrent') return i.installed ? `<span class="done">✓ ${t('downloaded')}</span>` : `<a class="btn" href="${esc(i.url)}" target="_blank">${t('torrent')}</a>`;
  const newer = i.installed && typeof i.installed === 'string' && i.installed < i.date;
  if(i.installed && !newer){
    let b = `<span class="done">✓ ${t('downloaded')}</span>`;
    if(kind === 'zim') b += `<button class="btn" data-o="${esc(i.prefix)}">${t('open')}</button>`;
    if(kind === 'ai') b += i.active ? `<span class="okb">${t('active')}</span>` : `<button class="btn" data-use="${esc(i.file)}">${t('use')}</button>`;
    if(kind === 'zim' || kind === 'ai') b += `<button class="btn ghost" data-rm="${esc(id)}" title="${t('remove')}">✕</button>`;
    return b;
  }
  return `<button class="btn pri" data-d="${esc(id)}">${newer ? t('update') : (j && j.status === 'fout' ? t('resume') : t('download'))}</button>`;
}
function card(id, i, kind, iconHtml){
  const j = jobOf(id), meta = kind === 'zim'
    ? `${esc(i.lang)} · ${esc(i.flavour || '—')} · ${fmtN(i.articles)} ${t('articles')} · ${esc(i.date)}` : esc(i.date || '');
  return `<div class="ccard${i.installed ? ' inst' : ''}"><div class="ctop">${iconHtml}<div class="cmain"><b>${esc(i.title)}</b><span class="mono dim">${meta}</span></div><em class="csize">${fmtB(i.size)}</em></div>
    <div class="csum">${esc(i.summary || '')}</div>${j && j.status !== 'klaar' ? jobBar(j) : ''}<div class="cbtns">${itemBtns(id, i, kind)}</div></div>`;
}
function renderZim(keepScroll){
  if(!CAT) return;
  const list = filtered();
  $('#fcount').textContent = (CAT.online ? '' : t('offline_cat') + ' · ') + t('shown', {n:fmtN(Math.min(SHOW, list.length)), t:fmtN(list.length)});
  $('#zimgrid').innerHTML = list.slice(0, SHOW).map(i => card('zim:' + i.id, i, 'zim', `<img class="cico" loading="lazy" src="/api/icon/${i.id}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cico ph',textContent:'${esc(i.title[0] || '?')}'}))">`)).join('')
    || `<div class="empty">${t('nothing')}</div>`;
  $('#more').style.display = list.length > SHOW ? '' : 'none';
  bindBtns('#zimgrid');
}
function renderExtras(){
  if(!CAT) return;
  const ex = CAT.extras || [], ic = {map:'🗺️', torrent:'⛰️', geo:'📍', ai:'🤖'};
  $('#mapgrid').innerHTML = ex.filter(i => i.kind !== 'ai').map(i => card(i.id, i, i.kind, `<div class="cico ph">${ic[i.kind]}</div>`)).join('');
  $('#aigrid').innerHTML = ex.filter(i => i.kind === 'ai').map(i => card(i.id, i, 'ai', `<div class="cico ph">🤖</div>`)).join('');
  bindBtns('#mapgrid'); bindBtns('#aigrid');
}
function bindBtns(root){
  $$(root + ' [data-d]').forEach(b => b.onclick = async () => { const r = await post('/api/download', {id:b.dataset.d}); if(r.error) toast(r.error); pollJobs().then(() => { renderZim(); renderExtras() }) });
  $$(root + ' [data-c]').forEach(b => b.onclick = () => cancelDl(b.dataset.c));
  $$(root + ' [data-o]').forEach(b => b.onclick = () => { const bk = BOOKS.find(x => x.id === b.dataset.o); location.hash = 'lib/' + (bk ? bk.id : b.dataset.o) });
  $$(root + ' [data-use]').forEach(b => b.onclick = async () => { await post('/api/ai/use', {model:b.dataset.use}); CAT = null; await loadStatus(); loadDownloads() });
  $$(root + ' [data-rm]').forEach(b => b.onclick = async () => {
    const id = b.dataset.rm, it = id.startsWith('zim:') ? CAT.zim.find(x => 'zim:' + x.id === id) : CAT.extras.find(x => x.id === id);
    if(!confirm(t('rm_confirm', {n:it.title, s:fmtB(it.size)}))) return;
    const r = await post('/api/remove', {id}); if(r.error) toast(r.error);
    CAT = null; await loadStatus(); loadDownloads();
  });
}
async function cancelDl(id){ await post('/api/download/cancel', {id}); setTimeout(() => pollJobs().then(() => { renderZim(); renderExtras() }), 600) }
function renderUpdates(u){
  $('#updCount').textContent = u.updates.length ? '(' + u.updates.length + ')' : '';
  $('#updInfo').innerHTML = `<span class="dot ${u.online ? 'ok' : 'warn'}"></span>${u.online ? t('online') : t('offline')} · ${t('last_check')}: ${u.last_check || '—'} · ${t('never_auto')}`;
  const jobs = u.jobs || {};
  $('#updList').innerHTML = u.updates.map(x => { const j = jobs[x.id]; return `<div class="upd"><div class="t"><b>${esc(x.title)}</b><span>${esc(x.type.toUpperCase())} · ${esc(x.current)} → ${esc(x.latest)}</span>${jobBar(j)}</div>
      <button class="btn pri" data-u="${esc(x.id)}" ${j && j.status === 'bezig' ? 'disabled' : ''}>${t('update')}</button></div>` }).join('') || `<div class="note">${t('up_to_date')}${u.online ? '' : t('offline_note')}</div>`;
  $$('#updList [data-u]').forEach(b => b.onclick = async () => { await post('/api/updates/run', {id:b.dataset.u}); pollJobs() });
}
$$('#dlTabs button').forEach(b => b.onclick = () => { DLTAB = b.dataset.v; $$('#dlTabs button').forEach(x => x.classList.toggle('on', x === b)); $$('.pane').forEach(p => p.style.display = p.id === 'pane-' + DLTAB ? '' : 'none') });
['#fq'].forEach(s => $(s).addEventListener('input', debounce(() => { SHOW = 60; renderZim() }, 150)));
['#flang','#fflav','#fsort'].forEach(s => $(s).addEventListener('change', () => { SHOW = 60; renderCats(); renderZim() }));
$('#finst').onclick = () => { $('#finst').classList.toggle('on'); renderZim() };
$('#more').onclick = () => { SHOW += 60; renderZim() };
$('#updCheck').onclick = async () => { await post('/api/updates/check'); $('#updInfo').textContent = t('loading'); setTimeout(pollJobs, 4000); loadDownloads(true) };
$('#rescan').onclick = async () => { await post('/api/rescan'); await loadStatus(); toast(t('saved')) };

/* ───────── instellingen ───────── */
function renderSettings(){
  const seg = (id, v) => $$('#' + id + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  seg('sLang', SET.lang); seg('sAccent', SET.accent); seg('sTheme', SET.theme);
  $('#sFont').value = SET.font_scale; $('#sFontV').textContent = Math.round(SET.font_scale * 100) + '%';
  $('#sCheck').classList.toggle('on', !!SET.update_check);
  $('#sInterval').value = SET.update_check_minutes;
  $('#sAuto').classList.toggle('on', !!SET.autostart); $('#sAuto').classList.toggle('dis', !SET.autostart_supported);
  $('#sAutoNote').textContent = SET.autostart_supported ? '' : t('s_autostart_na');
}
$$('#sLang button').forEach(b => b.onclick = () => saveSet({lang:b.dataset.v}));
$$('#sAccent button').forEach(b => b.onclick = () => saveSet({accent:b.dataset.v}));
$$('#sTheme button').forEach(b => b.onclick = () => saveSet({theme:b.dataset.v}));
$('#sFont').addEventListener('input', e => { $('#sFontV').textContent = Math.round(e.target.value * 100) + '%' });
$('#sFont').addEventListener('change', e => saveSet({font_scale:+e.target.value}));
$('#sCheck').onclick = () => saveSet({update_check:!SET.update_check});
$('#sInterval').addEventListener('change', e => saveSet({update_check_minutes:+e.target.value}));
$('#sAuto').onclick = () => SET.autostart_supported && saveSet({autostart:!SET.autostart});
let CLEAN = [];
async function loadCleanup(){
  CLEAN = await api('/api/cleanup').catch(() => []);
  $('#cleanList').innerHTML = CLEAN.length ? CLEAN.map((c, i) => `<label class="cl"><input type="checkbox" data-i="${i}" ${c.kind !== 'partial' ? 'checked' : ''}>
    <span>${esc(c.path)}<small>${t('k_' + c.kind)}</small></span><b>${fmtB(c.size)}</b></label>`).join('') : `<div class="empty">${t('s_nothing_clean')}</div>`;
  $('#cleanBtn').style.display = CLEAN.length ? '' : 'none';
}
$('#cleanBtn').onclick = async () => {
  const sel = $$('#cleanList input:checked').map(x => CLEAN[+x.dataset.i]);
  if(!sel.length) return;
  const size = sel.reduce((a, c) => a + c.size, 0);
  if(!confirm(t('s_confirm', {n:sel.length, s:fmtB(size)}))) return;
  const r = await post('/api/cleanup', {paths:sel.map(c => c.path)});
  toast(t('s_freed', {s:fmtB(r.freed)})); loadCleanup(); loadStatus();
};

/* ───────── command palette ───────── */
let items = [], sel = 0, lastQ = '';
function openPal(){ $('#palette').classList.add('on'); const q = $('#q'); q.value = ''; renderSugg([]); q.focus() }
function closePal(){ $('#palette').classList.remove('on') }
$('#palette').addEventListener('mousedown', e => { if(e.target.id === 'palette') closePal() });
$('#omni').onclick = openPal; $('#omni2').onclick = openPal;
$('#q').addEventListener('input', debounce(async e => {
  const q = e.target.value; lastQ = q;
  if(!q.trim()){ renderSugg([]); return }
  const [lib, geo] = await Promise.all([
    api('/api/suggest?q=' + encodeURIComponent(q)).catch(() => []),
    STATUS.geo === 'aan' ? api('/api/geocode?q=' + encodeURIComponent(q)).catch(() => ({})) : Promise.resolve({}),
  ]);
  if(q !== lastQ) return;
  const out = lib.map(x => ({kind:'lib', label:x.title, tag:x.bookTitle, x}));
  (geo.features || []).slice(0, 4).forEach(f => out.push({kind:'geo', label:placeName(f), tag:'📍', x:f}));
  USER.pins.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 3).forEach(p => out.push({kind:'pin', label:p.name, tag:'PIN', x:p}));
  renderSugg(out);
}, 90));
function renderSugg(list){
  items = list; sel = 0;
  const q = $('#q').value.trim();
  if(q) items.push({kind:'ft', label:'“' + q + '” — full text', tag:'ALL'});
  if(q) items.push({kind:'ai', label:'“' + q + '”', tag:'AI'});
  $('#sugg').innerHTML = items.map((it, i) => `<div class="s${i ? '' : ' sel'}" data-i="${i}"><i>${esc(it.tag || '')}</i>${esc(it.label)}</div>`).join('');
  $$('#sugg .s').forEach(s => { s.onclick = () => pick(+s.dataset.i); s.onmousemove = () => { sel = +s.dataset.i; mark() } });
}
function mark(){ $$('#sugg .s').forEach((s, i) => s.classList.toggle('sel', i === sel)); const c = $$('#sugg .s')[sel]; c && c.scrollIntoView({block:'nearest'}) }
function pick(i, ft){
  const it = items[i], q = $('#q').value.trim(); closePal();
  if(ft || !it || it.kind === 'ft'){ if(q) location.hash = 'search/' + encodeURIComponent(q); return }
  if(it.kind === 'lib') location.hash = 'lib/' + it.x.book + '/' + it.x.path;
  else if(it.kind === 'geo') flyToFeature(it.x);
  else if(it.kind === 'pin'){ location.hash = 'map'; whenMap(m => m.flyTo({center:[it.x.lon, it.x.lat], zoom:14})) }
  else if(it.kind === 'ai'){ location.hash = 'ai'; $('#prompt').value = q; send() }
}
$('#q').addEventListener('keydown', e => {
  if(e.key === 'ArrowDown'){ sel = Math.min(sel+1, items.length-1); mark(); e.preventDefault() }
  else if(e.key === 'ArrowUp'){ sel = Math.max(sel-1, 0); mark(); e.preventDefault() }
  else if(e.key === 'Enter') pick(sel, e.shiftKey);
  else if(e.key === 'Escape') closePal();
});

/* ───────── sneltoetsen ───────── */
function handleKey(e){
  const k = (e.key || '').toLowerCase();
  if((e.ctrlKey || e.metaKey) && k === 'k'){ openPal(); return true }
  if(e.inInput) return false;
  if(k === 'escape' && flashing){ stopFlash(); return true }
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
setInterval(() => { $('#clock').textContent = new Date().toLocaleString(LANG === 'nl' ? 'nl-NL' : 'en-GB', {weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', second:'2-digit'}).toUpperCase() }, 1000);
setInterval(loadStatus, 30000);
(async () => {
  [SET, USER] = await Promise.all([api('/api/settings').catch(() => ({lang:'en'})), api('/api/user').catch(() => USER)]);
  applyLook(); renderChat();
  await loadStatus(); route();
})();
