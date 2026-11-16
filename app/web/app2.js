/* NOMAD v0.8 — bestanden, chatgeschiedenis, route plannen, extra leven */

/* ───────── modal ───────── */
function modal({title, body = '', buttons = [], input = null}){
  return new Promise(res => {
    $('#mTitle').textContent = title;
    $('#mBody').innerHTML = body + (input !== null ? `<input class="inp" id="mIn" style="width:100%;margin-top:12px" value="${esc(input)}">` : '');
    $('#mBtns').innerHTML = buttons.map((b, i) => `<button class="btn ${b.pri ? 'pri' : ''} ${b.danger ? 'danger' : ''}" data-i="${i}">${b.label}</button>`).join('');
    $('#modal').classList.add('on');
    const inp = $('#mIn'); if(inp){ inp.focus(); inp.select() }
    const done = v => { $('#modal').classList.remove('on'); res(v) };
    $$('#mBtns button').forEach(b => b.onclick = () => done({btn:buttons[+b.dataset.i].v, value:inp ? inp.value.trim() : null}));
    $('#modal').onmousedown = e => { if(e.target.id === 'modal') done({btn:'cancel'}) };
    if(inp) inp.onkeydown = e => { if(e.key === 'Enter') done({btn:buttons.find(b => b.pri)?.v, value:inp.value.trim()}); if(e.key === 'Escape') done({btn:'cancel'}) };
  });
}

/* ───────── routing van views ───────── */
VIEWS.push('files');
const _setView = setView;
setView = function(v){ _setView(v); if(v === 'files') loadFiles(FPATH); if(v === 'map') updateRouteBox(); if(v === 'home') loadFact() };

/* ───────── AI: tijdelijke chat, opslaan, bewaarde antwoorden ───────── */
renderChat = function(){
  $('#chat').innerHTML = CHAT.length ? CHAT.map((m, i) => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}" style="--i:${Math.min(i, 8)}">
      <div class="av">${m.role === 'user' ? t('you') : 'AI'}</div>
      <div class="bub${m.err ? ' err' : ''}${m.live ? ' cursor' : ''}">${esc(m.content)}${m.sources?.length ? '<div class="src">' +
        m.sources.map(s => `<span class="chip" data-b="${esc(s.book)}" data-p="${esc(s.path)}">↗ ${esc(s.title)}${s.bookTitle ? ' · ' + esc(s.bookTitle) : ''}</span>`).join('') + '</div>' : ''}
        ${m.role !== 'user' && !m.live && !m.err ? `<div class="macts"><button data-copy="${i}" title="${t('copy')}">⧉</button><button data-save="${i}" title="${t('save_ans')}">☆</button></div>` : ''}</div></div>`).join('')
    : `<div class="msg"><div class="av">AI</div><div class="bub" style="color:var(--dim)">${t('ai_hello')}</div></div>`;
  $$('#chat .chip').forEach(c => c.onclick = () => location.hash = 'lib/' + c.dataset.b + '/' + c.dataset.p);
  $$('#chat [data-copy]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(CHAT[+b.dataset.copy].content); toast(t('copied')) });
  $$('#chat [data-save]').forEach(b => b.onclick = () => {
    const i = +b.dataset.save, a = CHAT[i], q = [...CHAT.slice(0, i)].reverse().find(m => m.role === 'user');
    saveUser({saved:[{q:q ? q.content : '', a:a.content, sources:a.sources || [], date:Date.now()}, ...(USER.saved || [])]});
    b.textContent = '★'; b.classList.add('on'); toast(t('saved_ans'));
  });
  $('#chat').scrollTop = 1e9;
};
$('#newChat').onclick = async () => {
  if(!CHAT.length) return;
  const r = await modal({title:t('new_chat_q'), body:`<p class="sub">${t('new_chat_body')}</p>`,
    buttons:[{label:t('cancel_b'), v:'cancel'}, {label:t('discard'), v:'discard', danger:1}, {label:t('save_new'), v:'save', pri:1}]});
  if(r.btn === 'cancel' || !r.btn) return;
  if(r.btn === 'save'){
    const first = CHAT.find(m => m.role === 'user');
    const n = await modal({title:t('chat_title_q'), input:(first ? first.content : 'Chat').slice(0, 60),
      buttons:[{label:t('cancel_b'), v:'cancel'}, {label:t('f_save'), v:'ok', pri:1}]});
    if(n.btn !== 'ok') return;
    saveUser({chats:[{id:Date.now(), title:n.value || 'Chat', date:Date.now(), messages:CHAT.filter(m => !m.live)}, ...(USER.chats || [])]});
    toast(t('saved'));
  }
  CHAT = []; store.set('nomad.chat', []); renderChat();
};
function drawer(kind){
  const d = $('#aiDrawer');
  if(d.classList.contains('on') && d.dataset.k === kind){ d.classList.remove('on'); return }
  d.dataset.k = kind; d.classList.add('on');
  const fmtD = ts => new Date(ts).toLocaleString(LANG === 'nl' ? 'nl-NL' : 'en-GB', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
  if(kind === 'hist'){
    const list = USER.chats || [];
    d.innerHTML = `<div class="hud">${t('history_btn')}</div>` + (list.length ? list.map((c, i) => `<div class="ditem"><div class="dt" data-o="${i}"><b>${esc(c.title)}</b><span class="mono dim">${fmtD(c.date)} · ${c.messages.length}</span></div><button class="btn ghost" data-d="${i}">✕</button></div>`).join('') : `<div class="empty">${t('no_chats')}</div>`);
    $$('#aiDrawer [data-o]').forEach(e => e.onclick = () => { CHAT = JSON.parse(JSON.stringify(list[+e.dataset.o].messages)); store.set('nomad.chat', CHAT); renderChat(); d.classList.remove('on') });
    $$('#aiDrawer [data-d]').forEach(e => e.onclick = async () => { const r = await modal({title:t('f_del_q', {n:list[+e.dataset.d].title}), buttons:[{label:t('cancel_b'), v:'c'}, {label:t('del_b'), v:'y', danger:1}]}); if(r.btn === 'y'){ saveUser({chats:list.filter((_, j) => j !== +e.dataset.d)}); d.classList.remove('on'); drawer('hist') } });
  } else {
    const list = USER.saved || [];
    d.innerHTML = `<div class="hud">${t('saved_btn')}</div>` + (list.length ? list.map((s, i) => `<div class="ditem col"><b class="sq">${esc(s.q)}</b><div class="sa">${esc(s.a)}</div><div style="display:flex;gap:6px"><span class="mono dim" style="flex:1">${fmtD(s.date)}</span><button class="btn ghost" data-c="${i}">⧉</button><button class="btn ghost" data-d="${i}">✕</button></div></div>`).join('') : `<div class="empty">${t('no_saved')}</div>`);
    $$('#aiDrawer [data-c]').forEach(e => e.onclick = () => { navigator.clipboard?.writeText(list[+e.dataset.c].a); toast(t('copied')) });
    $$('#aiDrawer [data-d]').forEach(e => e.onclick = () => { saveUser({saved:list.filter((_, j) => j !== +e.dataset.d)}); d.classList.remove('on'); drawer('saved') });
  }
}
$('#histBtn').onclick = () => drawer('hist');
$('#savedBtn').onclick = () => drawer('saved');

/* ───────── bestandsbeheer ───────── */
let FPATH = '', FSEL = null;
const FIC = {dir:'folder', zim:'book', pmtiles:'map', pbf:'compass', png:'image', jpg:'image', jpeg:'image', gif:'image', webp:'image', svg:'image', mp4:'video', webm:'video', mp3:'play', zip:'archive', bz2:'archive', gz:'archive', exe:'cpu', json:'code', py:'code', js:'code'};
const isText = e => ['.txt','.md','.json','.csv','.log','.ini','.cfg','.yml','.yaml','.xml','.html','.css','.js','.py','.bat','.ps1','.gpx','.geojson'].includes(e);
const isImg = e => ['.png','.jpg','.jpeg','.gif','.webp','.svg'].includes(e);
async function loadFiles(p){
  FPATH = p || ''; FSEL = null;
  const r = await api('/api/fs/list?path=' + encodeURIComponent(FPATH)).catch(() => ({items:[]}));
  const parts = FPATH ? FPATH.split('/') : [];
  $('#crumbs').innerHTML = `<a data-p="">NOMAD</a>` + parts.map((x, i) => `<span>/</span><a data-p="${esc(parts.slice(0, i + 1).join('/'))}">${esc(x)}</a>`).join('') + (r.protected && FPATH ? ` <em class="okb">${t('f_protected')}</em>` : '');
  $$('#crumbs a').forEach(a => a.onclick = () => loadFiles(a.dataset.p));
  const fmtD = ts => new Date(ts * 1000).toLocaleDateString(LANG === 'nl' ? 'nl-NL' : 'en-GB', {day:'2-digit', month:'short', year:'numeric'});
  $('#flist').innerHTML = (FPATH ? `<div class="frow up" data-up="1"><span class="fi">${icon('chev','flip')}</span><span class="fn">..</span></div>` : '') + r.items.map((f, i) =>
    `<div class="frow" data-i="${i}" style="--i:${Math.min(i, 12)}"><span class="fi${f.dir ? ' d' : ''}">${icon(f.dir ? 'folder' : (FIC[f.ext.slice(1)] || 'file'))}</span><span class="fn">${esc(f.name)}</span>
     <span class="fs mono dim">${f.dir ? '' : fmtB(f.size)}</span><span class="fd mono dim">${fmtD(f.mtime)}</span></div>`).join('') || `<div class="empty">—</div>`;
  $$('#flist .frow').forEach(row => row.onclick = () => {
    if(row.dataset.up) return loadFiles(FPATH.split('/').slice(0, -1).join('/'));
    const f = r.items[+row.dataset.i], path = (FPATH ? FPATH + '/' : '') + f.name;
    if(f.dir) return loadFiles(path);
    $$('#flist .frow').forEach(x => x.classList.toggle('sel', x === row)); preview(f, path);
  });
  $('#fprev').innerHTML = `<div class="empty">${t('f_pick')}</div>`;
}
async function preview(f, path){
  FSEL = path;
  const raw = '/api/fs/raw?path=' + encodeURIComponent(path);
  let body = '';
  if(isImg(f.ext)) body = `<img src="${raw}" class="pimg">`;
  else if(f.ext === '.pdf') body = `<iframe src="${raw}" class="ppdf"></iframe>`;
  else if(['.mp4','.webm'].includes(f.ext)) body = `<video src="${raw}" controls class="pimg"></video>`;
  else if(['.mp3','.ogg','.wav'].includes(f.ext)) body = `<audio src="${raw}" controls style="width:100%"></audio>`;
  else if(isText(f.ext) && f.size < 2 << 20){
    const r = await api('/api/fs/read?path=' + encodeURIComponent(path));
    body = r.error ? `<div class="empty">${esc(r.error)}</div>` : `<textarea id="fedit" class="feditor" spellcheck="false">${esc(r.content)}</textarea>`;
  } else body = `<div class="empty">${t('f_noprev')}</div>`;
  const locked = /^(app|tools)\//.test(path);
  $('#fprev').innerHTML = `<div class="phead"><b>${esc(f.name)}</b><span class="mono dim">${fmtB(f.size)}</span></div>${body}
    <div class="pacts">${$('#fedit') || body.includes('fedit') ? `<button class="btn pri" id="fSave" ${path.startsWith('tools/') ? 'disabled' : ''}>${t('f_save')}</button>` : ''}
      <a class="btn" href="${raw}" download="${esc(f.name)}">${t('f_dl')}</a>
      ${locked ? '' : `<button class="btn" id="fRen">${t('f_rename')}</button><button class="btn danger" id="fDel">${t('del_b')}</button>`}</div>`;
  const s = $('#fSave'); if(s) s.onclick = async () => { const r = await post('/api/fs/write', {path, content:$('#fedit').value}); toast(r.error || t('saved')) };
  const rn = $('#fRen'); if(rn) rn.onclick = async () => { const r = await modal({title:t('f_rename'), input:f.name, buttons:[{label:t('cancel_b'), v:'c'}, {label:t('confirm_b'), v:'ok', pri:1}]});
    if(r.btn === 'ok' && r.value){ const x = await post('/api/fs/rename', {path, name:r.value}); if(x.error) toast(x.error); loadFiles(FPATH) } };
  const dl = $('#fDel'); if(dl) dl.onclick = async () => { const r = await modal({title:t('f_del_q', {n:f.name}), buttons:[{label:t('cancel_b'), v:'c'}, {label:t('del_b'), v:'y', danger:1}]});
    if(r.btn === 'y'){ const x = await post('/api/fs/delete', {path}); if(x.error) toast(x.error); loadFiles(FPATH); loadStatus() } };
}
$('#fNew').onclick = async () => { const r = await modal({title:t('f_folder_q'), input:'', buttons:[{label:t('cancel_b'), v:'c'}, {label:t('confirm_b'), v:'ok', pri:1}]});
  if(r.btn === 'ok' && r.value){ await post('/api/fs/mkdir', {path:(FPATH ? FPATH + '/' : '') + r.value}); loadFiles(FPATH) } };
$('#fNewFile').onclick = async () => { const r = await modal({title:t('f_file_q'), input:'', buttons:[{label:t('cancel_b'), v:'c'}, {label:t('confirm_b'), v:'ok', pri:1}]});
  if(r.btn === 'ok' && r.value){ await post('/api/fs/write', {path:(FPATH ? FPATH + '/' : '') + r.value, content:''}); loadFiles(FPATH) } };
$('#fUp').onchange = async e => {
  for(const file of e.target.files){
    toast('↑ ' + file.name);
    await fetch(`/api/fs/upload?path=${encodeURIComponent(FPATH)}&name=${encodeURIComponent(file.name)}`, {method:'POST', body:file});
  }
  e.target.value = ''; loadFiles(FPATH);
};

/* ───────── route plannen ───────── */
let RFROM = null, RTO = null, RMODE = 'car';
function updateRouteBox(){
  const r = STATUS.route || {};
  $('#routebox').classList.toggle('on', r.state === 'aan' || !!RFROM || !!RTO);
  $('#previewBadge').style.display = STATUS.maps?.world?.preview ? '' : 'none';
}
const _pinPopup = pinPopup;
pinPopup = async function(ll){
  await _pinPopup(ll);
  const box = document.querySelector('.maplibregl-popup-content > div');
  if(!box) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:6px';
  row.innerHTML = `<button class="btn" style="height:28px;flex:1">${t('r_from')}</button><button class="btn" style="height:28px;flex:1">${t('r_to')}</button>`;
  box.appendChild(row);
  const [a, b] = row.querySelectorAll('button');
  a.onclick = () => { RFROM = ll; document.querySelector('.maplibregl-popup')?.remove(); routeNow() };
  b.onclick = () => { RTO = ll; document.querySelector('.maplibregl-popup')?.remove(); routeNow() };
};
$$('#rmode button').forEach(b => b.onclick = () => { RMODE = b.dataset.m; $$('#rmode button').forEach(x => x.classList.toggle('on', x === b)); routeNow() });
let RMARK = [];
async function routeNow(){
  $('#routebox').classList.add('on');
  const f = ll => ll ? `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}` : '';
  $('#rFrom').textContent = RFROM ? f(RFROM) : t('r_pick_from'); $('#rTo').textContent = RTO ? f(RTO) : t('r_pick_to');
  RMARK.forEach(m => m.remove()); RMARK = [];
  [[RFROM, 'A'], [RTO, 'B']].forEach(([ll, l]) => { if(ll){ const el = document.createElement('div'); el.className = 'rmark'; el.textContent = l; RMARK.push(new maplibregl.Marker({element:el}).setLngLat(ll).addTo(MAP)) } });
  if(!RFROM || !RTO) return;
  const st = STATUS.route?.state;
  if(st !== 'aan'){ $('#rRes').innerHTML = `<div class="empty" style="white-space:normal">${st === 'bouwen' || st === 'opstarten' ? t('r_building') : t('r_off')}</div>`; return }
  $('#rRes').innerHTML = `<div class="empty">${t('loading')}</div>`;
  const r = await api(`/api/route?from=${RFROM.lat},${RFROM.lng}&to=${RTO.lat},${RTO.lng}&mode=${RMODE}`).catch(e => ({error:e.message}));
  if(r.error || !r.paths){ $('#rRes').innerHTML = `<div class="empty" style="white-space:normal">${esc(r.error || r.message || 'no route')}</div>`; return }
  const p = r.paths[0], km = (p.distance / 1000).toFixed(1), min = Math.round(p.time / 60000);
  const geo = {type:'Feature', geometry:p.points};
  if(MAP.getSource('route')) MAP.getSource('route').setData(geo);
  else {
    MAP.addSource('route', {type:'geojson', data:geo});
    MAP.addLayer({id:'route-glow', type:'line', source:'route', paint:{'line-color':getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#3dffa0', 'line-width':12, 'line-opacity':.25, 'line-blur':6}});
    MAP.addLayer({id:'route', type:'line', source:'route', layout:{'line-cap':'round','line-join':'round'}, paint:{'line-color':'#eafff3', 'line-width':4}});
  }
  const bb = p.bbox; if(bb) MAP.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], {padding:80});
  $('#rRes').innerHTML = `<div class="rsum"><b>${km} km</b><b>${min >= 60 ? Math.floor(min / 60) + 'h ' + (min % 60) + 'm' : min + ' min'}</b></div>
    <div class="rins">${(p.instructions || []).map(x => `<div><span>${esc(x.text)}</span><em>${x.distance > 0 ? (x.distance >= 1000 ? (x.distance / 1000).toFixed(1) + ' km' : Math.round(x.distance) + ' m') : ''}</em></div>`).join('')}</div>`;
}

/* ───────── home: groet + wist-je-dat ───────── */
async function loadFact(){
  const h = new Date().getHours();
  const g = h < 6 ? t('gn') : h < 12 ? t('gm') : h < 18 ? t('ga') : h < 23 ? t('ge') : t('gn');
  let el = $('#greet');
  if(!el){ el = document.createElement('div'); el.id = 'greet'; el.className = 'greet'; $('.hero-l').prepend(el) }
  el.textContent = g + ' · ' + new Date().toLocaleDateString(LANG === 'nl' ? 'nl-NL' : 'en-GB', {weekday:'long', day:'numeric', month:'long'});
  if(!BOOKS.length) return;
  const f = await api('/api/fact').catch(() => ({}));
  let box = $('#fact');
  if(!f.title){ if(box) box.remove(); return }
  if(!box){ box = document.createElement('div'); box.id = 'fact'; box.className = 'card fact'; $('#mods').after(box) }
  box.innerHTML = `<div class="k">${icon('bolt')} ${t('did_you_know')}</div><b>${esc(f.title)}</b><p>${esc(f.text)}</p>`;
  box.onclick = () => location.hash = 'lib/' + f.book + '/' + f.path;
}

/* ───────── kleine details: pi, kampvuur, vallende sterren, konami ───────── */
const _openPal = openPal;
openPal = function(){ _openPal(); $('#q').placeholder = Math.random() < 0.08 ? '3.14159265358979323846264338327950288…' : (Math.random() < 0.05 ? 'Ask me anything. I know about 7 million things.' : t('search_all')) };
$('#omni').onclick = openPal; $('#omni2').onclick = openPal;
(function(){
  // kampvuurtje in het noodpakket en 's avonds in de footer
  const fire = '<span class="campfire" title="🔥"><i></i><i></i><i></i><b></b></span>';
  const hero = $('.sos-hero'); if(hero) hero.insertAdjacentHTML('beforeend', fire.replace('campfire', 'campfire big'));
  const h = new Date().getHours();
  if(h >= 20 || h < 6) $('footer .r').insertAdjacentHTML('beforebegin', fire);
  // vallende sterren op de achtergrond
  const c = $('#fx2'), ctx = c.getContext('2d'); let stars = [];
  const loop = () => {
    c.width = innerWidth; c.height = innerHeight;
    if(Math.random() < 0.0025 && !document.hidden) stars.push({x:Math.random() * innerWidth, y:Math.random() * innerHeight * .4, vx:7 + Math.random() * 5, vy:2.5 + Math.random() * 2, l:1});
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--a').trim();
    for(const s of stars){ ctx.strokeStyle = `rgba(${acc},${s.l})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 9, s.y - s.vy * 9); ctx.stroke(); s.x += s.vx; s.y += s.vy; s.l -= 0.02 }
    stars = stars.filter(s => s.l > 0);
    setTimeout(() => requestAnimationFrame(loop), stars.length ? 16 : 250);
  };
  loop();
  // konami → matrix-regen
  const K = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']; let k = 0;
  addEventListener('keydown', e => { k = e.key === K[k] ? k + 1 : (e.key === K[0] ? 1 : 0); if(k === K.length){ k = 0; matrix() } });
  function matrix(){
    const m = document.createElement('canvas'); m.className = 'matrix'; document.body.appendChild(m);
    const x = m.getContext('2d'); m.width = innerWidth; m.height = innerHeight; const cols = Array(Math.ceil(innerWidth / 16)).fill(0); let n = 0;
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--a').trim();
    const iv = setInterval(() => { x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, 0, m.width, m.height); x.fillStyle = `rgb(${acc})`; x.font = '15px monospace';
      cols.forEach((y, i) => { x.fillText('NOMAD01アイウ'[Math.random() * 11 | 0], i * 16, y); cols[i] = y > m.height && Math.random() > .97 ? 0 : y + 16 });
      if(++n > 260){ clearInterval(iv); m.remove() } }, 33);
  }
  // klok: knipperende dubbele punt
  let blink = false; setInterval(() => { blink = !blink; $('#clock').classList.toggle('blink', blink) }, 1000);
})();

/* ───────── kaart-iconen in de catalogus (geen emoji) ───────── */
renderExtras = function(){
  if(!CAT) return;
  const ex = CAT.extras || [], ic = {map:'map', torrent:'globe', geo:'pin', ai:'cpu', route:'compass'};
  $('#mapgrid').innerHTML = ex.filter(i => i.kind !== 'ai').map(i => card(i.id, i, i.kind, `<div class="cico ph">${icon(ic[i.kind])}</div>`)).join('');
  $('#aigrid').innerHTML = ex.filter(i => i.kind === 'ai').map(i => card(i.id, i, 'ai', `<div class="cico ph">${icon('cpu')}</div>`)).join('');
  bindBtns('#mapgrid'); bindBtns('#aigrid');
};
setInterval(() => { if(VIEW === 'map') updateRouteBox() }, 5000);

/* weergave per collectie: Auto / NOMAD / Origineel / Donker */
$$('#aMode button').forEach(b => b.onclick = () => {
  if(!CUR) return;
  const m = store.get('nomad.amode', {}); m[CUR.book] = b.dataset.v; store.set('nomad.amode', m);
  $$('#aMode button').forEach(x => x.classList.toggle('on', x === b));
  frame.contentWindow.postMessage(lookMsg(), '*');
});

/* ───────── microfoon (Whisper) & voorlezen ───────── */
let REC = null;
async function micToggle(btn){
  const target = $('#' + btn.dataset.mic);
  if(REC){ REC.stop(); return }
  if(!STATUS.stt){ toast(t('mic_off')); return }
  let stream;
  try{ stream = await navigator.mediaDevices.getUserMedia({audio:true}) }catch(e){ toast(t('mic_perm')); return }
  const chunks = [], mr = new MediaRecorder(stream);
  REC = mr; btn.classList.add('rec'); toast(t('listening'));
  const stopT = setTimeout(() => mr.state === 'recording' && mr.stop(), 60000);
  mr.ondataavailable = e => chunks.push(e.data);
  mr.onstop = async () => {
    clearTimeout(stopT); stream.getTracks().forEach(x => x.stop()); REC = null; btn.classList.remove('rec'); btn.classList.add('busy'); toast(t('transcribing'));
    const r = await fetch('/api/stt', {method:'POST', body:new Blob(chunks, {type:'audio/webm'})}).then(r => r.json()).catch(e => ({error:e.message}));
    btn.classList.remove('busy');
    if(r.error){ toast(r.error); return }
    target.value = (target.value ? target.value.trim() + ' ' : '') + r.text; target.dispatchEvent(new Event('input'));
    if(r.lang && target.id === 'trIn' && $('#trFrom').value === 'auto') toast('🎙 ' + r.lang.toUpperCase());
  };
  mr.start();
}
$$('[data-mic]').forEach(b => b.onclick = () => micToggle(b));
function speak(text, lang){
  if(!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if(lang && lang !== 'auto'){ u.lang = lang; const v = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang)); if(v) u.voice = v }
  speechSynthesis.speak(u);
}
const _renderChat2 = renderChat;
renderChat = function(){
  _renderChat2();
  $$('#chat .macts').forEach((m, k) => { if(m.querySelector('[data-say]')) return; const b = document.createElement('button'); b.textContent = '🔊'; b.dataset.say = 1; b.title = 'Speak';
    const i = +m.querySelector('[data-copy]').dataset.copy; b.onclick = () => speak(CHAT[i].content, LANG); m.appendChild(b) });
};

/* ───────── vertaler ───────── */
const TRL = [['auto','tr_auto'],['en','English'],['nl','Nederlands'],['de','Deutsch'],['fr','Français'],['es','Español'],['it','Italiano'],['pt','Português'],['pl','Polski'],['tr','Türkçe'],['ar','العربية'],['uk','Українська'],['ru','Русский'],['zh','中文'],['ja','日本語']];
function trInit(){
  $('#trFrom').innerHTML = TRL.map(([c, n]) => `<option value="${c}">${c === 'auto' ? t(n) : n}</option>`).join('');
  $('#trTo').innerHTML = TRL.slice(1).map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  const s = store.get('nomad.tr', {from:'auto', to:LANG === 'nl' ? 'en' : 'nl'});
  $('#trFrom').value = s.from; $('#trTo').value = s.to;
  $('#trModel').textContent = 'AI: ' + (STATUS.ai?.model || '—');
  const P = ['I need help', 'Where is the hospital?', 'I need a doctor', 'Water, please', 'I am lost', 'Call the police', 'Is this safe to drink?', 'Thank you'];
  $('#trPhrases').innerHTML = P.map(p => `<span class="chip">${p}</span>`).join('');
  $$('#trPhrases .chip').forEach(c => c.onclick = () => { $('#trIn').value = c.textContent; $('#trFrom').value = 'en'; trGo() });
}
const trSave = () => store.set('nomad.tr', {from:$('#trFrom').value, to:$('#trTo').value});
$('#trFrom').onchange = $('#trTo').onchange = trSave;
$('#trSwap').onclick = () => { const f = $('#trFrom').value, to = $('#trTo').value; if(f !== 'auto'){ $('#trFrom').value = to; $('#trTo').value = f }
  const o = $('#trOut').textContent; if(o){ $('#trIn').value = o; $('#trOut').textContent = '' } trSave() };
$('#trIn').addEventListener('input', () => { $('#trCount').textContent = $('#trIn').value.length + ' / 5000' });
$('#trIn').addEventListener('keydown', e => { if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)) trGo() });
let trBusy = false;
async function trGo(){
  const text = $('#trIn').value.trim().slice(0, 5000); if(!text || trBusy) return;
  trBusy = true; $('#trOut').textContent = ''; $('#trOut').classList.add('cursor');
  try{
    const res = await fetch('/api/translate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text, from:$('#trFrom').value, to:$('#trTo').value})});
    if(!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for(;;){ const {value, done} = await rd.read(); if(done) break; buf += dec.decode(value, {stream:true}); let i;
      while((i = buf.indexOf('\n')) >= 0){ const l = buf.slice(0, i); buf = buf.slice(i + 1); if(!l.trim()) continue; const m = JSON.parse(l);
        if(m.t) $('#trOut').textContent += m.t; if(m.error) throw new Error(m.error) } }
  }catch(e){ $('#trOut').textContent = t('error') + ': ' + e.message }
  $('#trOut').classList.remove('cursor'); trBusy = false;
}
$('#trGo').onclick = trGo;
$('#trSpeak').onclick = () => speak($('#trOut').textContent, $('#trTo').value);
$('#trSpeakIn').onclick = () => speak($('#trIn').value, $('#trFrom').value);
$('#trCopy').onclick = () => { navigator.clipboard?.writeText($('#trOut').textContent); toast(t('copied')) };
$('#trSave').onclick = () => { const a = $('#trOut').textContent; if(!a) return; saveUser({saved:[{q:$('#trIn').value, a, sources:[], date:Date.now()}, ...(USER.saved || [])]}); toast(t('saved_ans')) };
VIEWS.push('tr');
const _setView2 = setView;
setView = function(v){ _setView2(v); if(v === 'tr') trInit() };
renderExtras = (function(orig){ return function(){ orig(); const ex = (CAT?.extras || []).filter(i => i.kind === 'ai' || i.kind === 'stt');
  $('#aigrid').innerHTML = ex.map(i => card(i.id, i, i.kind === 'stt' ? 'stt' : 'ai', `<div class="cico ph">${icon(i.kind === 'stt' ? 'mic' : 'cpu')}</div>`)).join(''); bindBtns('#aigrid') } })(renderExtras);
