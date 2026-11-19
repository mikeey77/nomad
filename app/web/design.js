/* NOMAD v0.24 — design system behaviour: icons, view transitions, skeletons, library covers, dashboard Home */

/* ───────── icons ───────── */
function lic(name, cls = ''){
  const p = ICONS[name]; if(!p) return '';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
const EMOJI_ICON = {
  '📄':'file-text', '🤖':'bot', '📱':'smartphone', '📍':'map-pin', '⬆':'upload', '⟳':'rotate-cw', '✓':'check', '✕':'x', '🗑':'trash-2', '🗑️':'trash-2',
  '⬇':'download', '↓':'download', '🔍':'search', '🔎':'search', '⚙':'settings', '⚙️':'settings', '⭐':'star', '★':'star', '☆':'star', '🔖':'bookmark',
  '🎒':'backpack', '🧭':'compass', '🛰':'satellite', '🛰️':'satellite', '🎬':'clapperboard', '📚':'library', '🗺':'map', '🗺️':'map', '☀':'sun', '☀️':'sun',
  '💧':'droplet', '🔥':'flame', '⚡':'zap', '📷':'camera', '🎤':'mic', '✨':'sparkles', '🚗':'car', '🥾':'footprints', '🚲':'bike', '📋':'clipboard-list',
  '🔄':'refresh-cw', '➕':'plus', '+':'plus', '✏':'pencil', '✏️':'pencil', '✎':'pencil', '📁':'folder', '🌍':'globe', '🌐':'globe', '🔔':'bell', '⏸':'pause',
  '▶':'play', '🍳':'cooking-pot', '⏳':'hourglass', '⚠':'triangle-alert', '⚠️':'triangle-alert', '🔁':'repeat', '🏠':'house', '💾':'hard-drive',
  '🔊':'volume-2', '📦':'package', '🛒':'shopping-cart', '❤':'heart', '❤️':'heart', '🔒':'lock', '👁':'eye', '⇅':'arrow-up-down', '🎯':'target',
  '📖':'book-open', '🖼':'image', '🖼️':'image', '🕘':'history', '◎':'target', '🌊':'waves', '⛺':'tent', '📻':'radio', '💊':'pill', '⛽':'fuel', 'ℹ':'info',
};
const EMOJI_RE = new RegExp('^\\s*(' + Object.keys(EMOJI_ICON).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\uFE0F?\\s*');
const ICON_SEL = '.btn,.seg button,.hud,.sec-t,.tray button,.qact button,.dbadge,.rtools button';
function firstText(el, d){
  for(const x of el.childNodes){
    if(x.nodeType === 3){ if(x.textContent.trim()) return x; continue }
    if(x.nodeType !== 1) continue;
    if(/^(svg|img)$/i.test(x.tagName) || d > 0) return null;
    if(x.tagName === 'SPAN' || x.tagName === 'B') return firstText(x, d + 1);
    return null;
  }
  return null;
}
function iconize(root){
  const els = root.matches?.(ICON_SEL) ? [root] : [];
  root.querySelectorAll && els.push(...root.querySelectorAll(ICON_SEL));
  for(const el of els){
    if(el.dataset.ic) continue;
    const tn = firstText(el, 0);
    if(!tn) continue;
    const m = tn.textContent.match(EMOJI_RE);
    if(!m || (m[1] === '+' && !/^\s*\+\s+\S/.test(tn.textContent))) continue;
    const name = EMOJI_ICON[m[1]] || EMOJI_ICON[m[1].replace('️', '')];
    if(!name) continue;
    tn.textContent = tn.textContent.slice(m[0].length);
    tn.parentNode.insertBefore(document.createRange().createContextualFragment(lic(name)), tn);
    el.dataset.ic = 1;
  }
}
let icQ = new Set(), icT = 0;
new MutationObserver(ms => {
  for(const m of ms) for(const n of m.addedNodes) if(n.nodeType === 1) icQ.add(n); else if(n.nodeType === 3 && n.parentElement) icQ.add(n.parentElement);
  if(!icT) icT = requestAnimationFrame(() => { icT = 0; const q = [...icQ]; icQ.clear(); q.forEach(n => { if(n.isConnected){ iconize(n); skeletonize(n) } }) });
}).observe(document.body, {childList:true, subtree:true, characterData:false});
iconize(document.body);

/* ───────── skeletons instead of "Loading…" ───────── */
function skeletonize(n){
  const els = n.classList?.contains('empty') ? [n] : n.querySelectorAll ? [...n.querySelectorAll('.empty')] : [];
  for(const e of els){
    if(e.textContent.trim() !== t('loading')) continue;
    const big = e.parentElement && /grid|bgrid|zimgrid|shelf/i.test(e.parentElement.id + ' ' + e.parentElement.className);
    e.outerHTML = big ? `<div class="skel-wrap">${'<div class="skel skel-card"></div>'.repeat(6)}</div>`
      : `<div style="padding:4px 0">${'<div class="skel skel-line"></div>'.repeat(3)}</div>`;
  }
}

/* ───────── view transitions (map opens as a circle from the tab you clicked) ───────── */
document.body.dataset.view = (location.hash.slice(1) || 'home').split(/[/?]/)[0];
document.addEventListener('click', e => {
  const tab = e.target.closest('.tab'); if(!tab) return;
  const r = tab.getBoundingClientRect(), m = $('#main') || document.body, mr = m.getBoundingClientRect();
  $('#v-map')?.style.setProperty('--cx', (r.left + r.width / 2 - mr.left) + 'px');
  $('#v-map')?.style.setProperty('--cy', (r.top + r.height / 2 - mr.top) + 'px');
}, true);
setView = (function(orig){ return function(v){ document.body.dataset.view = v; orig(v); if(v === 'home') setTimeout(tileify, 60); if(v === 'lib') setTimeout(coverize, 30) } })(setView);

/* ───────── library covers ───────── */
const COVER = {};
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
const KIND_HUE = {wikipedia:150, encyclopedie:150, gezondheid:350, health:350, boeken:30, books:30, reizen:200, travel:200, onderwijs:265, education:265, techniek:45, tech:45};
function coverize(){
  const cards = $$('#shelf .book:not(.cov)'); if(!cards.length) return;
  $('#shelf .grid')?.classList.add('stagger');
  for(const c of cards){
    const b = BOOKS.find(x => x.id === c.dataset.b); if(!b) continue;
    const h = KIND_HUE[(b.kind || '').toLowerCase()] ?? hue(b.title);
    c.classList.add('cov');
    c.style.setProperty('--cv', `radial-gradient(120% 90% at 85% 0%, hsl(${h} 55% 26%), hsl(${(h + 40) % 360} 45% 9%) 70%)`);
    c.innerHTML = `<div class="cv-art"><span class="mono-l">${esc((b.title || '?')[0])}</span><img class="ph" alt=""></div>
      <div class="cv-ico">${esc((b.title || '?')[0])}</div>
      <div class="cv-body"><span class="cv-kind">${esc(b.kind || '')}</span><h3>${esc(b.title)}</h3>
      <div class="cv-meta"><span>${fmtN(b.articles)} ${t('articles')}</span><span>${fmtB(b.size)}</span><span>${esc(b.date || '')}</span></div></div>
      <span class="cv-open">${lic('book-open')}</span>`;
    const fill = cv => {
      if(cv.icon){ const im = new Image(); im.onload = () => { const ic = c.querySelector('.cv-ico'); ic.textContent = ''; ic.appendChild(im) }; im.src = cv.icon }
      if(cv.img){ const ph = c.querySelector('img.ph'); ph.onload = () => ph.classList.add('on'); ph.src = cv.img }
    };
    if(COVER[b.id]) fill(COVER[b.id]);
    else api('/api/cover/' + encodeURIComponent(b.id)).then(cv => { COVER[b.id] = cv; fill(cv) }).catch(() => {});
  }
}
const _showShelf = showShelf;
showShelf = function(){ _showShelf.apply(this, arguments); coverize() };

/* ───────── Home as a dashboard: tiles you can drag, resize and hide ───────── */
const TILES = {   // id → [selector, default size, label key]
  mods:['#mods', 'l', ''], fact:['#fact', 'm', ''], quick:['#tQuick', 's', 'tile_quick'], inv:['#invHome', 'm', ''], sun:['#sunHome', 's', ''],
  dl:['#tDl', 's', 'tile_dl'], fav:['#favHome', 'm', ''], phone:['#phone', 'm', 'phone'], disk:['#disk', 'm', 'storage'],
};
const DEF_ORDER = ['mods', 'quick', 'fact', 'sun', 'inv', 'dl', 'fav', 'disk', 'phone'];
function homeCfg(){ const h = (USER?.ui || {}).home || {}; return {order:h.order || DEF_ORDER, size:h.size || {}, hidden:h.hidden || []} }
function saveHome(cfg){ saveUser({ui:{...(USER.ui || {}), home:cfg}}) }
let EDIT = false;
function ensureExtraTiles(){
  const dash = $('#v-home .dash');
  if(!$('#tQuick')){
    const q = document.createElement('div'); q.id = 'tQuick'; q.className = 'card';
    q.innerHTML = `<div class="qact">
      <button data-go="map">${lic('map')}${t('map')}</button><button data-go="ai">${lic('bot')}${t('ai')}</button>
      <button data-go="sos">${lic('shield')}${t('sos')}</button><button data-go="inv">${lic('backpack')}${t('inv')}</button></div>`;
    q.querySelectorAll('[data-go]').forEach(b => b.onclick = () => location.hash = b.dataset.go);
    dash.appendChild(q);
  }
  if(!$('#tDl')){ const d = document.createElement('div'); d.id = 'tDl'; d.className = 'card dlmini'; d.onclick = e => { if(!EDIT) location.hash = 'dl' }; dash.appendChild(d) }
  if(!$('#homebar')){
    const hb = document.createElement('div'); hb.id = 'homebar'; hb.className = 'homebar';
    hb.innerHTML = `<button class="btn ghost" id="homeEdit">${lic('layout-grid')}<span>${t('tile_edit')}</span></button>`;
    $('#omni2').after(hb);
    $('#homeEdit').onclick = () => { EDIT = !EDIT; dash.classList.toggle('editing', EDIT); $('#homeEdit span').textContent = EDIT ? t('tile_done') : t('tile_edit'); $('#homeEdit').classList.toggle('pri', EDIT); tileify() };
  }
  if(!$('#tTray')){ const tr = document.createElement('div'); tr.id = 'tTray'; tr.className = 'tray'; $('#homebar').after(tr) }
}
async function renderDlTile(){
  const el = $('#tDl'); if(!el) return;
  const u = window.__upd && window.__upd.jobs ? window.__upd : await api('/api/updates').catch(() => ({jobs:{}}));
  const run = Object.values(u.jobs || {}).filter(j => j.status === 'bezig' || j.status === 'wachtrij');
  const H = u.history || [];
  el.innerHTML = run.length ? run.slice(0, 3).map(j => { const p = j.total ? j.done / j.total * 100 : 0; return `<div class="dm-row"><b>${esc(j.title)}</b><div class="dm-bar"><i style="width:${p.toFixed(1)}%"></i></div><small>${j.status === 'bezig' ? p.toFixed(0) + '%' + (j.speed ? ' · ' + fmtB(j.speed) + '/s' : '') : t('dh_waiting').toLowerCase()}</small></div>` }).join('')
    : `<div class="dm-empty">${lic('circle-check')} ${t('tile_dl_idle')}</div>${H[0] ? `<small>${H[0].status === 'done' ? '✓' : '✕'} ${esc(H[0].title)}</small>` : ''}`;
}
function tileify(){
  const dash = $('#v-home .dash'); if(!dash || !$('#mods')) return;
  ensureExtraTiles();
  dash.classList.add('tiles');
  const cfg = homeCfg(), order = [...cfg.order, ...DEF_ORDER.filter(x => !cfg.order.includes(x))];
  order.forEach((id, i) => {
    const d = TILES[id]; if(!d) return; const el = $(d[0]); if(!el) return;
    el.classList.add('tile'); el.dataset.tile = id; el.style.order = 10 + i;
    const sz = cfg.size[id] || d[1];
    el.classList.remove('t-s', 't-m', 't-l'); el.classList.add('t-' + sz);
    el.classList.toggle('t-hide', cfg.hidden.includes(id));
    if(d[2]) el.dataset.label = t(d[2]);
    el.draggable = EDIT;
    if(!el.querySelector(':scope>.tctl')){
      const c = document.createElement('div'); c.className = 'tctl';
      c.innerHTML = `<span class="lbl">${lic('grip-vertical')}</span><button data-a="size" title="${t('tile_size')}">${lic('maximize-2')}</button><button data-a="hide" title="${t('tile_hide')}">${lic('eye-off')}</button>`;
      c.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if(!a) return; e.stopPropagation(); const cf = homeCfg();
        if(a === 'size'){ const cur = cf.size[id] || d[1]; cf.size = {...cf.size, [id]:{s:'m', m:'l', l:'s'}[cur]} }
        if(a === 'hide') cf.hidden = [...cf.hidden, id];
        cf.order = order; saveHome(cf); setTimeout(tileify, 30) };
      el.appendChild(c);
    }
  });
  // header bits sit at the top
  ['.hero', '#omni2', '#homebar', '#tTray'].forEach((s, i) => { const e = $(s); if(e) e.style.order = i });
  // tray with hidden tiles
  const tr = $('#tTray');
  tr.innerHTML = `<span class="lbl">${t('tile_hidden')}</span>` + (cfg.hidden.length ? cfg.hidden.map(id => `<button class="btn" data-show="${id}">${lic('plus')}${esc(tileName(id))}</button>`).join('') : `<span class="dim" style="font-size:12px">${t('tile_none')}</span>`)
    + `<button class="btn ghost" id="tReset" style="margin-left:auto">${lic('undo-2')}${t('tile_reset')}</button>`;
  tr.querySelectorAll('[data-show]').forEach(b => b.onclick = () => { const cf = homeCfg(); cf.hidden = cf.hidden.filter(x => x !== b.dataset.show); cf.order = order; saveHome(cf); setTimeout(tileify, 30) });
  $('#tReset').onclick = () => { saveHome({order:DEF_ORDER, size:{}, hidden:[]}); setTimeout(tileify, 30) };
  renderDlTile();
}
function tileName(id){
  const el = $(TILES[id][0]);
  return TILES[id][2] ? t(TILES[id][2]) : (el?.querySelector('h3,b,.hud,.sec-t')?.textContent || id).trim().slice(0, 28);
}
/* drag & drop to reorder */
(() => {
  let src = null;
  document.addEventListener('dragstart', e => { const t_ = e.target.closest?.('.dash.editing>.tile'); if(!t_) return; src = t_; t_.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move' });
  document.addEventListener('dragend', () => { src?.classList.remove('dragging'); $$('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); src = null });
  document.addEventListener('dragover', e => {
    const t_ = e.target.closest?.('.dash.editing>.tile'); if(!src || !t_ || t_ === src) return; e.preventDefault();
    const r = t_.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
    $$('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); t_.classList.add(after ? 'drop-after' : 'drop-before');
  });
  document.addEventListener('drop', e => {
    const t_ = e.target.closest?.('.dash.editing>.tile'); if(!src || !t_ || t_ === src) return; e.preventDefault();
    const cf = homeCfg(); let order = [...cf.order, ...DEF_ORDER.filter(x => !cf.order.includes(x))].filter(x => x !== src.dataset.tile);
    const at = order.indexOf(t_.dataset.tile) + (t_.classList.contains('drop-after') ? 1 : 0);
    order.splice(at, 0, src.dataset.tile); cf.order = order; saveHome(cf); setTimeout(tileify, 30);
  });
})();
setInterval(() => { if(VIEW === 'home'){ tileify() } }, 4000);
setTimeout(tileify, 1500);
if(VIEW === 'lib') setTimeout(coverize, 800);

/* ───────── v0.24.3: markdown in AI answers (bold, lists, headings, code) ───────── */
function mdLite(src){
  let s = esc(src || '');
  const blocks = [];
  s = s.replace(/```[\w-]*\n?([\s\S]*?)(```|$)/g, (m, c) => { blocks.push(`<pre class="mdpre"><code>${c.replace(/\n$/, '')}</code></pre>`); return `\u0000${blocks.length - 1}\u0000` });
  s = s.split('\n').map(l => {
    let m;
    if((m = l.match(/^\s{0,3}(#{1,4})\s+(.*)$/))) return `<span class="mdh mdh${m[1].length}">${m[2]}</span>`;
    if((m = l.match(/^(\s*)[-*•]\s+(.*)$/))) return `${m[1]}<span class="mdli"><i>•</i><span>${m[2]}</span></span>`;
    if((m = l.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) return `${m[1]}<span class="mdli num"><i>${m[2]}</i><span>${m[3]}</span></span>`;
    if(/^\s*(---|\*\*\*)\s*$/.test(l)) return '<hr class="mdhr">';
    return l;
  }).join('\n');
  s = s.replace(/`([^`\n]+)`/g, '<code class="mdc">$1</code>')
       .replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>')
       .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
       .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
       .replace(/\n(<span class="mdli)/g, '$1').replace(/(<\/span><\/span>)\n/g, '$1')
       .replace(/(<span class="mdh[^>]*>.*?<\/span>|<hr class="mdhr">)\n+/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[+i]);
}
renderChat = (function(orig){ return function(){
  orig.apply(this, arguments);
  const A = CHAT.filter(m => m.role !== 'user');
  $$('#chat .msg.a .bub').forEach((b, i) => {
    const m = A[i]; if(!m || m.err || !m.content) return;
    const src = b.querySelector(':scope>.src'); if(src) src.remove();
    b.innerHTML = mdLite(m.content); b.classList.add('md');
    if(src) b.appendChild(src);
  });
} })(renderChat);

/* ───────── v0.24.3: show "building" instead of "downloading 0 B" for local work ───────── */
const BUILD_RE = /^(building|reading|writing|installing|unpacking|starting|finding)/i;
jobBar = (function(orig){ return function(j){
  if(!j || j.status !== 'bezig' || !BUILD_RE.test(j.msg || '')) return orig(j);
  const pct = j.total ? Math.min(100, j.done / j.total * 100) : 0;
  return `<div class="bar build"><i style="width:${pct.toFixed(1)}%"></i></div><span class="mono dim">${esc(j.msg)}</span>`;
} })(jobBar);
