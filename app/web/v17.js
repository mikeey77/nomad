/* NOMAD v0.17 — video library + player, satellite download from the map, one profile per SSD */
const L2 = (en, nl) => LANG === 'nl' ? nl : en;

/* ───────── one player per SSD: app preferences live on the SSD, not in this browser ───────── */
(function(){
  const _set = store.set.bind(store), skip = /^nomad\.(chat|hist)$/;
  let pending = {}, timer = 0;
  store.set = (k, v) => {
    _set(k, v);
    if(!k.startsWith('nomad.') || skip.test(k)) return;
    pending[k] = v; clearTimeout(timer);
    timer = setTimeout(() => { const ui = {...(USER.ui || {}), ...pending}; pending = {}; USER.ui = ui; post('/api/user', {ui}).catch(() => {}) }, 800);
  };
  // when the profile arrives from the SSD, it wins over whatever this browser remembered
  let applied = false;
  const apply = () => {
    if(applied || !USER || !USER.ui) return; applied = true;
    let changed = false;
    for(const [k, v] of Object.entries(USER.ui)) try{ const j = JSON.stringify(v); if(localStorage.getItem(k) !== j){ localStorage.setItem(k, j); changed = true } }catch(e){}
    // first visit from this device/browser: reload once so everything starts from the SSD profile
    if(changed && !sessionStorage.getItem('nomad.uiapplied')){ sessionStorage.setItem('nomad.uiapplied', '1'); location.reload() }
  };
  const iv = setInterval(() => { if(USER && USER.ui !== undefined){ apply(); clearInterval(iv) } }, 300);
})();

/* ───────── map: download missing layers straight from the layer panel ───────── */
const LAYER_DL = {satellite:'sat:world', hillshade:'torrent:terrain', terrain3d:'torrent:terrain'};
applyLayers = (function(orig){ return function(){
  orig.apply(this, arguments);
  $$('#maplayers .tog').forEach(x => {
    const id = LAYER_DL[x.dataset.l]; let a = x.querySelector('.ldl');
    if(x.classList.contains('dis') && id){
      if(!a){ a = document.createElement('button'); a.className = 'ldl'; x.appendChild(a) }
      a.textContent = '↓ ' + t('get');
      a.onclick = e => { e.stopPropagation(); gotoDownload(id) };
    } else if(a) a.remove();
  });
} })(applyLayers);
window.gotoDownload = id => {
  window.__hl = {id};
  setTimeout(() => window.__hl = null, 8000);
  location.hash = 'dl';
  const pane = id.startsWith('zim:') ? 'zim' : /^(ai|stt|mt):/.test(id) ? 'ai' : 'maps';
  setTimeout(() => { $(`#dlTabs button[data-v="${pane}"]`)?.click(); renderExtras() }, 350);
};

/* ───────── video library ───────── */
let VIDS = [], VTOPICS = [];
async function loadVideos(){ const r = await api('/api/videos').catch(() => ({videos:[]})); VIDS = r.videos || []; VTOPICS = r.topics || []; return VIDS }
const vstate = rel => (USER.videos || {})[rel] || {};
const fmtT = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0') };
function videoCards(list){
  return list.map(v => {
    const st = vstate(v.rel), pct = st.dur ? Math.min(100, st.pos / st.dur * 100) : 0;
    return `<div class="vcard" data-rel="${esc(v.rel)}"><div class="vthumb"${v.thumb ? ` style="background-image:url('${v.thumb.replace(/'/g, '%27')}')"` : ''}>${v.thumb ? '' : '<span>🎬</span>'}
      <i class="vplay">▶</i>${st.dur ? `<em>${fmtT(st.dur)}</em>` : ''}${st.done ? '<b class="vdone">✓</b>' : ''}<u style="width:${st.done ? 100 : pct}%"></u></div>
      <div class="vmeta"><b>${esc(v.title)}</b><small>${v.folder ? esc(v.folder) + ' · ' : ''}${fmtB(v.size)}</small></div></div>`;
  }).join('');
}
showShelf = (function(orig){ return async function(){
  orig.apply(this, arguments);
  await loadVideos();
  if(CUR) return;  // an article was opened meanwhile
  $('#vidShelf')?.remove();
  const sec = document.createElement('div'); sec.id = 'vidShelf';
  const folders = [...new Set(VIDS.map(v => v.folder).filter(Boolean))];
  sec.innerHTML = `<div class="sec-t vhead"><span>🎬 ${t('videos')} <em class="mono dim">${VIDS.length}</em></span><button class="btn pri" id="vGet">＋ ${t('v_get')}</button></div>` +
    (VIDS.length ? (folders.length ? `<div class="inv-cats" id="vFold"><button class="icat on" data-f="">✦ ${L2('All', 'Alles')}</button>${folders.map(f => `<button class="icat" data-f="${esc(f)}">${esc(f)}</button>`).join('')}</div>` : '') +
      `<div class="vgrid" id="vGrid">${videoCards(VIDS)}</div>`
      : `<div class="note">${t('v_empty')}</div>`);
  $('#shelf').appendChild(sec);
  const bind = () => $$('#vGrid .vcard').forEach(c => c.onclick = () => openPlayer(VIDS.find(v => v.rel === c.dataset.rel)));
  bind();
  $$('#vFold .icat').forEach(b => b.onclick = () => { $$('#vFold .icat').forEach(x => x.classList.toggle('on', x === b)); $('#vGrid').innerHTML = videoCards(VIDS.filter(v => !b.dataset.f || v.folder === b.dataset.f)); bind() });
  $('#vGet').onclick = openFinder;
} })(showShelf);

/* finder: Internet Archive (public domain / Creative Commons films) + direct links */
function openFinder(){
  const ov = invOverlay(`<div class="pk-h"><b>🎬 ${t('v_get').toUpperCase()}</b><span class="dim">${t('v_src')}</span><button class="nbx" data-x>✕</button></div>
    <div style="display:flex;gap:8px"><input class="inp" id="vfQ" placeholder="${t('v_search')}" style="flex:1;height:42px"><button class="btn pri" id="vfGo">${L2('SEARCH', 'ZOEKEN')}</button></div>
    <div class="pk-cats" id="vfTopics" style="margin-top:10px">${VTOPICS.map(x => `<button class="icat" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div id="vfRes" class="vfres"></div>
    <details class="vfurl"><summary>🔗 ${t('v_link')}</summary><div style="display:flex;gap:8px;margin-top:8px"><input class="inp" id="vfUrl" placeholder="https://…/video.mp4" style="flex:1;height:38px"><input class="inp" id="vfTitle" placeholder="${L2('Title (optional)', 'Titel (optioneel)')}" style="width:200px;height:38px"><button class="btn" id="vfUrlGo">↓</button></div>
      <div class="sub" style="margin-top:6px">${t('v_link_help')}</div></details>`);
  let topic = '';
  const go = async q => {
    $('#vfRes').innerHTML = `<div class="aistat" style="padding:20px"><span class="spin"></span>${L2('Searching the Internet Archive…', 'Zoeken in het Internet Archive…')}</div>`;
    const r = await api('/api/videos/search?q=' + encodeURIComponent(q)).catch(e => ({error:e.message, results:[]}));
    if(r.error && !r.results.length){ $('#vfRes').innerHTML = `<div class="note">${esc(r.error)}<br>${t('v_offline')}</div>`; return }
    $('#vfRes').innerHTML = r.results.length ? r.results.map(x => `<div class="vres"><img src="${esc(x.thumb)}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div><b>${esc(x.title)}</b><small>${[x.year, x.runtime, x.downloads ? fmtN(x.downloads) + ' ' + L2('views', 'keer bekeken') : ''].filter(Boolean).map(esc).join(' · ')}</small>
        <p>${esc(x.desc)}</p><small class="lic">${/publicdomain/.test(x.license) ? '🅿 Public domain' : /creativecommons/.test(x.license) ? '🅲 Creative Commons' : '🅿 ' + esc(x.license)}</small></div>
        <button class="btn${x.have ? '' : ' pri'}" data-id="${esc(x.id)}"${x.have ? ' disabled' : ''}>${x.have ? '✓' : '↓ ' + L2('Download', 'Download')}</button></div>`).join('')
      : `<div class="note">${t('nothing')}</div>`;
    $$('#vfRes [data-id]').forEach(b => b.onclick = async () => {
      b.disabled = true; b.textContent = '…';
      const res = await post('/api/videos/get', {ident:b.dataset.id, topic}).catch(e => ({error:e.message}));
      if(res.error){ toast(res.error); b.disabled = false; b.textContent = '↓'; return }
      b.textContent = '✓ ' + L2('Queued', 'In de wachtrij'); toast(L2('Downloading — see Downloads', 'Wordt gedownload — zie Downloads'));
    });
  };
  $('#vfGo').onclick = () => { topic = ''; go($('#vfQ').value || 'survival') };
  $('#vfQ').onkeydown = e => { if(e.key === 'Enter') $('#vfGo').click() };
  $$('#vfTopics .icat').forEach(b => b.onclick = () => { $$('#vfTopics .icat').forEach(x => x.classList.toggle('on', x === b)); topic = b.dataset.q; $('#vfQ').value = b.dataset.q; go(b.dataset.q) });
  $('#vfUrlGo').onclick = async () => {
    const r = await post('/api/videos/get', {url:$('#vfUrl').value.trim(), title:$('#vfTitle').value.trim()}).catch(e => ({error:e.message}));
    toast(r.error || L2('Downloading — see Downloads', 'Wordt gedownload — zie Downloads'));
  };
  go('survival training');
}

/* ───────── the player ───────── */
function openPlayer(v, opts = {}){
  if(!v) return;
  const src = opts.src || '/video/' + v.rel.split('/').map(encodeURIComponent).join('/');
  const queue = opts.queue || VIDS.filter(x => x.folder === v.folder && x.rel !== v.rel).concat(VIDS.filter(x => x.folder !== v.folder)).slice(0, 12);
  const st = vstate(v.rel), speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const ov = document.createElement('div'); ov.className = 'vplayer';
  ov.innerHTML = `<div class="vp-stage"><video playsinline preload="metadata" src="${src}"${v.thumb ? ` poster="${v.thumb}"` : ''}></video>
      <div class="vp-burst"></div><div class="vp-spin"><span class="spin"></span></div>
      <div class="vp-top"><b>${esc(v.title)}</b><button class="vp-x" title="Esc">✕</button></div>
      <div class="vp-bar">
        <div class="vp-seek"><i class="vp-buf"></i><i class="vp-pos"></i><span class="vp-tip"></span></div>
        <div class="vp-ctl">
          <button data-a="play" title="Space">▶</button><button data-a="back" title="J">⟲ 10</button><button data-a="fwd" title="L">10 ⟳</button>
          <span class="vp-time">0:00 / 0:00</span><span class="vp-sp"></span>
          <button data-a="mute" title="M">🔊</button><input type="range" class="vp-vol" min="0" max="1" step="0.05" value="${store.get('nomad.vvol', 1)}">
          <button data-a="speed" title="&lt; &gt;">1×</button>${v.subs?.length ? '<button data-a="cc" title="C">CC</button>' : ''}
          <button data-a="pip" title="P">⧉</button><button data-a="full" title="F">⛶</button>
        </div></div></div>
    <aside class="vp-side"><h3>${esc(v.title)}</h3><div class="vp-sub">${[v.folder, fmtB(v.size)].filter(Boolean).map(esc).join(' · ')}</div>
      ${v.desc ? `<p class="vp-desc">${esc(v.desc)}</p>` : ''}${v.source ? `<div class="vp-lic">${esc(v.license || '')}<br><span class="mono">${esc(v.source)}</span></div>` : ''}
      ${queue.length ? `<div class="sec-t">${t('v_next')}</div><div class="vp-q">${queue.map(q => `<div class="vp-qi" data-rel="${esc(q.rel)}"><span${q.thumb ? ` style="background-image:url('${q.thumb.replace(/'/g, '%27')}')"` : ''}></span><b>${esc(q.title)}</b></div>`).join('')}</div>` : ''}
      ${opts.src ? '' : `<button class="btn ghost" data-a="del" style="color:#ff5470;margin-top:14px">${t('delete')}</button>`}</aside>`;
  document.body.appendChild(ov);
  const vid = ov.querySelector('video'), q = s => ov.querySelector(s), btn = a => ov.querySelector(`[data-a="${a}"]`);
  vid.volume = store.get('nomad.vvol', 1); vid.playbackRate = store.get('nomad.vrate', 1); btn('speed').textContent = vid.playbackRate + '×';
  (v.subs || []).forEach(async (s, i) => {
    let url = s;
    if(s.endsWith('.srt')){ const txt = await fetch(s).then(r => r.text()); url = URL.createObjectURL(new Blob(['WEBVTT\n\n' + txt.replace(/(\d+:\d+:\d+),(\d+)/g, '$1.$2')], {type:'text/vtt'})) }
    const tr = document.createElement('track'); tr.kind = 'subtitles'; tr.src = url; tr.default = i === 0 && store.get('nomad.vcc', false); vid.appendChild(tr);
  });
  let saveT = 0;
  const save = (force) => {
    if(opts.src || !vid.duration) return;
    const all = {...(USER.videos || {})}, done = vid.currentTime / vid.duration > 0.95;
    all[v.rel] = {pos:done ? 0 : Math.floor(vid.currentTime), dur:Math.round(vid.duration), done:done || !!all[v.rel]?.done, at:Date.now()};
    USER.videos = all;
    if(force || Date.now() - saveT > 5000){ saveT = Date.now(); saveUser({videos:all}) }
  };
  vid.addEventListener('loadedmetadata', () => {
    if(st.pos && st.pos < vid.duration - 5 && !st.done) vid.currentTime = st.pos;
    vid.play().catch(() => {});
    if(!v.thumb && !opts.src) setTimeout(() => thumbOf(vid, v), 1500);
  });
  const burst = s => { const b = q('.vp-burst'); b.textContent = s; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on') };
  const toggle = () => { vid.paused ? vid.play() : vid.pause() };
  vid.onplay = () => { btn('play').textContent = '❚❚'; ov.classList.remove('paused') };
  vid.onpause = () => { btn('play').textContent = '▶'; ov.classList.add('paused'); save(true) };
  vid.onwaiting = () => ov.classList.add('wait'); vid.onplaying = () => ov.classList.remove('wait');
  vid.ontimeupdate = () => {
    q('.vp-pos').style.width = (vid.currentTime / vid.duration * 100 || 0) + '%';
    q('.vp-time').textContent = fmtT(vid.currentTime) + ' / ' + fmtT(vid.duration); save();
  };
  vid.onprogress = () => { try{ q('.vp-buf').style.width = (vid.buffered.end(vid.buffered.length - 1) / vid.duration * 100) + '%' }catch(e){} };
  vid.onended = () => { save(true); const n = queue[0]; if(n && store.get('nomad.vauto', true)){ close(); openPlayer(n) } };
  vid.onclick = toggle; vid.ondblclick = () => btn('full').click();
  const seek = q('.vp-seek');
  const at = e => { const r = seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) };
  seek.onpointermove = e => { const p = at(e); q('.vp-tip').textContent = fmtT(p * vid.duration); q('.vp-tip').style.left = (p * 100) + '%' };
  seek.onpointerdown = e => { vid.currentTime = at(e) * vid.duration; const mv = ev => vid.currentTime = at(ev) * vid.duration; seek.onpointermove = ev => mv(ev); document.addEventListener('pointerup', () => { seek.onpointermove = ev => { const p = at(ev); q('.vp-tip').textContent = fmtT(p * vid.duration); q('.vp-tip').style.left = (p * 100) + '%' } }, {once:true}) };
  btn('play').onclick = toggle;
  btn('back').onclick = () => { vid.currentTime -= 10; burst('⟲ 10') };
  btn('fwd').onclick = () => { vid.currentTime += 10; burst('10 ⟳') };
  btn('mute').onclick = () => { vid.muted = !vid.muted; btn('mute').textContent = vid.muted ? '🔇' : '🔊' };
  q('.vp-vol').oninput = e => { vid.volume = +e.target.value; vid.muted = false; store.set('nomad.vvol', vid.volume) };
  btn('speed').onclick = () => { const i = (speeds.indexOf(vid.playbackRate) + 1) % speeds.length; vid.playbackRate = speeds[i]; btn('speed').textContent = speeds[i] + '×'; store.set('nomad.vrate', speeds[i]); burst(speeds[i] + '×') };
  btn('cc') && (btn('cc').onclick = () => { const tr = vid.textTracks[0]; if(!tr) return; tr.mode = tr.mode === 'showing' ? 'hidden' : 'showing'; store.set('nomad.vcc', tr.mode === 'showing'); btn('cc').classList.toggle('on', tr.mode === 'showing') });
  btn('pip').onclick = () => { document.pictureInPictureElement ? document.exitPictureInPicture() : vid.requestPictureInPicture?.().catch(() => {}) };
  btn('full').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : q('.vp-stage').requestFullscreen?.() };
  btn('del') && (btn('del').onclick = async () => { const r = await modal({title:t('delete') + ': ' + v.title + '?', buttons:[{label:t('cancel_b'), v:'c'}, {label:t('delete'), v:'d', danger:1}]}); if(r.btn === 'd'){ await post('/api/videos/delete', {rel:v.rel}); close(); showShelf() } });
  ov.querySelectorAll('.vp-qi').forEach(x => x.onclick = () => { close(); openPlayer(VIDS.find(y => y.rel === x.dataset.rel)) });
  let hideT; const wake = () => { ov.classList.add('awake'); clearTimeout(hideT); hideT = setTimeout(() => !vid.paused && ov.classList.remove('awake'), 2600) };
  q('.vp-stage').onmousemove = wake; wake();
  const key = e => {
    if(/INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
    const k = e.key.toLowerCase(); wake();
    if(k === ' ' || k === 'k'){ e.preventDefault(); toggle(); burst(vid.paused ? '❚❚' : '▶') }
    else if(k === 'j' || k === 'arrowleft'){ vid.currentTime -= k === 'j' ? 10 : 5; burst('⟲') }
    else if(k === 'l' || k === 'arrowright'){ vid.currentTime += k === 'l' ? 10 : 5; burst('⟳') }
    else if(k === 'arrowup'){ e.preventDefault(); vid.volume = Math.min(1, vid.volume + .1); q('.vp-vol').value = vid.volume; burst('🔊 ' + Math.round(vid.volume * 100) + '%') }
    else if(k === 'arrowdown'){ e.preventDefault(); vid.volume = Math.max(0, vid.volume - .1); q('.vp-vol').value = vid.volume; burst('🔉 ' + Math.round(vid.volume * 100) + '%') }
    else if(k === 'f') btn('full').click(); else if(k === 'm') btn('mute').click(); else if(k === 'p') btn('pip').click(); else if(k === 'c') btn('cc')?.click();
    else if(k === '>' || k === '.') btn('speed').click();
    else if(/^[0-9]$/.test(k)) vid.currentTime = vid.duration * +k / 10;
    else if(k === 'escape' && !document.fullscreenElement) close();
  };
  document.addEventListener('keydown', key);
  const close = () => { save(true); vid.pause(); document.removeEventListener('keydown', key); ov.remove(); if(VIEW === 'lib' && !CUR) refreshVidGrid() };
  q('.vp-x').onclick = close;
}
function refreshVidGrid(){ const g = $('#vGrid'); if(g){ g.innerHTML = videoCards(VIDS); $$('#vGrid .vcard').forEach(c => c.onclick = () => openPlayer(VIDS.find(v => v.rel === c.dataset.rel))) } }
function thumbOf(vid, v){
  try{
    const c = document.createElement('canvas'), w = 480; c.width = w; c.height = Math.round(w * vid.videoHeight / vid.videoWidth) || 270;
    c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
    post('/api/videos/thumb', {rel:v.rel, image:c.toDataURL('image/jpeg', 0.8)});
  }catch(e){}
}

/* files: open videos in the player */
loadFiles = (function(orig){ return async function(p){
  await orig.apply(this, arguments);
  $$('#flist .frow').forEach(row => {
    const name = row.querySelector('.fn')?.textContent || '';
    if(/\.(mp4|m4v|webm|mkv|mov|ogv)$/i.test(name)){
      row.addEventListener('click', e => { e.stopImmediatePropagation(); const path = (FPATH ? FPATH + '/' : '') + name;
        openPlayer({rel:path, title:name.replace(/\.[^.]+$/, ''), size:0}, {src:'/api/fs/raw?path=' + encodeURIComponent(path), queue:[]}) }, true);
    }
  });
} })(loadFiles);
