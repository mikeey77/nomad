/* NOMAD v0.18 — AI model picker (Auto + every installed model), AI welcome screen,
   clearer "with images" choices in the catalog, best-for badges on AI models, finishing touches */
const L3 = (en, nl) => LANG === 'nl' ? nl : en;

/* what each model is good at (matched on the name) */
const MODEL_INFO = [
  [/qwen2\.5vl|llava|moondream|minicpm-v|llama3\.2-vision|granite3\.2-vision/, '📷', ['Photos', 'Foto’s']],
  [/gemma3:(4b|12b)/, '📷', ['Photos + languages', 'Foto’s + talen']],
  [/deepseek-r1|qwq|phi4-reasoning|magistral/, '🧠', ['Deep thinking', 'Diep nadenken']],
  [/qwen3:8b|mistral:7b/, '⭐', ['Best quality (slower)', 'Beste kwaliteit (trager)']],
  [/qwen3/, '🇳🇱', ['Smart + Dutch', 'Slim + Nederlands']],
  [/coder/, '💻', ['Programming', 'Programmeren']],
  [/phi4/, '🧮', ['Math & logic', 'Rekenen & logica']],
  [/:1b|:1\.7b|gemma3:1b/, '⚡', ['Fastest', 'Snelst']],
  [/llama3\.2:3b/, '⚖️', ['Balanced (default)', 'Gebalanceerd (standaard)']],
];
const modelInfo = m => { const r = MODEL_INFO.find(([re]) => re.test(m)); return r ? {e:r[1], d:L3(...r[2])} : {e:'🤖', d:L3('General', 'Algemeen')} };
const isVisionModel = m => MODEL_INFO.slice(0, 2).some(([re]) => re.test(m));

/* ───────── model picker in the AI composer ───────── */
function renderModelPick(){
  const el = $('#aiModel'); if(!el) return;
  const models = STATUS.ai?.models || [], cur = store.get('nomad.aimodel', 'auto');
  const valid = cur === 'auto' || models.includes(cur) ? cur : 'auto';
  const label = valid === 'auto' ? '✨ Auto' : modelInfo(valid).e + ' ' + valid.replace(':latest', '');
  el.innerHTML = `<button class="mpick" id="mpick" title="${L3('Choose which AI answers', 'Kies welke AI antwoordt')}">${esc(label)} <span>▾</span></button>`;
  $('#mpick').onclick = e => { e.stopPropagation(); openModelMenu(models, valid) };
}
function openModelMenu(models, cur){
  $('#mmenu')?.remove();
  const m = document.createElement('div'); m.id = 'mmenu'; m.className = 'mmenu';
  const row = (id, e, name, d) => `<button class="mm${id === cur ? ' on' : ''}" data-m="${esc(id)}"><span class="mm-e">${e}</span><span class="mm-t"><b>${esc(name)}</b><small>${esc(d)}</small></span>${id === cur ? '<i>✓</i>' : ''}</button>`;
  m.innerHTML = `<div class="mm-h">${L3('WHICH AI ANSWERS', 'WELKE AI ANTWOORDT')}</div>` +
    row('auto', '✨', 'Auto', L3('Picks for you: photo model for photos, thinking model with Think, otherwise ', 'Kiest zelf: fotomodel bij foto’s, denkmodel bij Nadenken, anders ') + (STATUS.ai?.model || '')) +
    (models.length ? models.map(x => { const i = modelInfo(x); return row(x, i.e, x.replace(':latest', ''), i.d) }).join('') : `<div class="mm-empty">${L3('No models installed yet', 'Nog geen modellen geïnstalleerd')}</div>`) +
    `<button class="mm more" data-more="1">＋ ${L3('Get more models', 'Meer modellen downloaden')}</button>`;
  document.body.appendChild(m);
  const r = $('#mpick').getBoundingClientRect();
  m.style.left = Math.min(r.left, innerWidth - 340) + 'px'; m.style.bottom = (innerHeight - r.top + 8) + 'px';
  m.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { store.set('nomad.aimodel', b.dataset.m); m.remove(); renderModelPick(); toast((b.dataset.m === 'auto' ? '✨ Auto' : b.dataset.m) + ' ✓') });
  m.querySelector('[data-more]').onclick = () => { m.remove(); location.hash = 'dl'; setTimeout(() => $('#dlTabs button[data-v="ai"]')?.click(), 300) };
  setTimeout(() => document.addEventListener('click', function off(e){ if(!m.contains(e.target)){ m.remove(); document.removeEventListener('click', off) } }), 0);
}

/* ───────── AI welcome screen with suggestions ───────── */
const AI_SUGG = [
  ['💧', ['How do I purify water without a filter?', 'Hoe maak ik water drinkbaar zonder filter?']],
  ['🩹', ['How do I treat a deep cut?', 'Hoe behandel ik een diepe snijwond?']],
  ['🔥', ['Ways to start a fire when it is wet', 'Manieren om vuur te maken als het nat is']],
  ['🌱', ['Which vegetables grow fastest?', 'Welke groenten groeien het snelst?']],
  ['📷', ['What plant is this? (add a photo)', 'Wat voor plant is dit? (voeg een foto toe)']],
  ['⚡', ['How do I wire a solar panel to a battery?', 'Hoe sluit ik een zonnepaneel aan op een accu?']],
];
renderChat = (function(orig){ return function(){
  orig.apply(this, arguments);
  if(CHAT.length) return;
  const models = STATUS.ai?.models || [];
  $('#chat').innerHTML = `<div class="aiw">
    <div class="aiw-orb"><span></span><span></span><span></span><b>AI</b></div>
    <h2>${L3('What do you want to know?', 'Wat wil je weten?')}</h2>
    <p>${t('ai_hello')}</p>
    <div class="aiw-stat"><span>${STATUS.ai?.state === 'aan' ? '<i class="ok"></i>' + L3('Running offline', 'Draait offline') : '<i></i>' + L3('AI is off', 'AI staat uit')}</span>
      <span>🤖 ${models.length} ${L3('models', 'modellen')}</span><span>📚 ${BOOKS.length} ${L3('collections', 'collecties')}</span></div>
    <div class="aiw-grid">${AI_SUGG.map(([e, q]) => `<button class="aiw-s" data-q="${esc(L3(...q))}"><span>${e}</span>${esc(L3(...q))}</button>`).join('')}</div></div>`;
  $$('#chat .aiw-s').forEach(b => b.onclick = () => {
    const q = b.dataset.q;
    if(q.includes('📷') || /photo|foto/i.test(q) && /\(/.test(q)){ $('#prompt').value = q.replace(/\s*\(.*\)$/, ''); $('#photoIn').click(); return }
    $('#prompt').value = q; send();
  });
} })(renderChat);

/* ───────── catalog: make "with images" obvious ───────── */
const FLAVX = {
  maxi:   ['🖼', ['Full + images', 'Volledig + afbeeldingen'], ['Best · recommended', 'Beste · aanbevolen']],
  '':     ['🖼', ['Standard', 'Standaard'], ['', '']],
  nopic:  ['📝', ['Text only', 'Alleen tekst'], ['No images · much smaller', 'Geen afbeeldingen · veel kleiner']],
  mini:   ['✂️', ['Intro only', 'Alleen intro'], ['First paragraph · tiny', 'Eerste alinea · heel klein']],
};
renderZim = (function(orig){ return function(){
  orig.apply(this, arguments);
  $$('#zimgrid .flavs').forEach(box => {
    const btns = [...box.querySelectorAll('button')];
    btns.forEach(b => {
      const card = b.closest('.ccard'), G = b.dataset.g, fid = b.dataset.f;
      const v = (CAT.zim || []).find(x => x.id === fid); if(!v) return;
      const f = FLAVX[v.flavour] || ['📦', [v.flavour, v.flavour], ['', '']];
      b.innerHTML = `<span class="fv-e">${f[0]}</span><span class="fv-t"><b>${esc(L3(...f[1]))}</b><small>${fmtB(v.size)}${L3(...f[2]) ? ' · ' + esc(L3(...f[2])) : ''}</small></span>`;
      if(v.flavour === 'maxi') b.classList.add('best');
    });
    box.classList.add('flavs2');
  });
} })(renderZim);

/* AI models in Downloads: "best for" badges */
const BEST = {'qwen2.5vl:3b':['★ Best for photos', '★ Beste voor foto’s'], 'moondream':['⚡ Fastest photo model', '⚡ Snelste fotomodel'],
  'llama3.2:3b':['✓ Recommended start', '✓ Aanbevolen start'], 'qwen3:4b':['★ Best for Dutch', '★ Beste voor Nederlands'],
  'qwen3:8b':['★ Best quality', '★ Beste kwaliteit'], 'gemma3:1b':['⚡ Fastest', '⚡ Snelst']};
renderExtras = (function(orig){ return function(){
  orig.apply(this, arguments);
  for(const [id, lab] of Object.entries(BEST)){
    const c = document.querySelector(`.ccard[data-id="ai:${CSS.escape(id)}"] .cmain`);
    if(c && !c.querySelector('.bestb')) c.insertAdjacentHTML('beforeend', `<span class="bestb">${esc(L3(...lab))}</span>`);
  }
  const ph = [...$$('#aigrid .grp-t')].find(g => /photo|foto/i.test(g.textContent));
  if(ph && !ph.nextElementSibling?.classList.contains('grp-n')) ph.insertAdjacentHTML('afterend', `<div class="grp-n">${L3('For recognising plants, objects and reading text in photos, <b>Qwen 2.5 VL 3B</b> is best. On a slow laptop pick <b>Moondream 2</b>. With <b>Auto</b> NOMAD uses it by itself when you add a photo.', 'Voor planten, voorwerpen en tekst op foto’s is <b>Qwen 2.5 VL 3B</b> het beste. Op een trage laptop kies je <b>Moondream 2</b>. Met <b>Auto</b> gebruikt NOMAD hem vanzelf zodra je een foto toevoegt.')}</div>`);
} })(renderExtras);

/* ───────── finishing touches ───────── */
// toasts with an icon, stacked and dismissable
toast = (function(){
  let host = null;
  return function(msg){
    if(!host){ host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host) }
    const t = document.createElement('div'); t.className = 'toast2';
    const ic = /✓|saved|opgeslagen|added|toegevoegd|copied|gekopieerd|done|klaar/i.test(msg) ? '✓' : /error|fout|failed|mislukt|not |niet /i.test(msg) ? '!' : 'i';
    t.innerHTML = `<i class="${ic === '✓' ? 'ok' : ic === '!' ? 'bad' : ''}">${ic}</i><span>${esc(msg)}</span>`;
    t.onclick = () => t.remove();
    host.appendChild(t); while(host.children.length > 3) host.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300) }, 3200);
  };
})();
// ripple on buttons
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn,.tab,.icat,.chip,.mm,.aiw-s'); if(!b || b.disabled) return;
  const r = b.getBoundingClientRect(), s = document.createElement('span'); s.className = 'rip';
  const d = Math.max(r.width, r.height) * 2; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  if(getComputedStyle(b).position === 'static') b.style.position = 'relative';
  b.style.overflow = 'hidden'; b.appendChild(s); setTimeout(() => s.remove(), 600);
});
// keep picker & stats fresh
setInterval(() => { if(VIEW === 'ai'){ const k = JSON.stringify(STATUS.ai?.models || []) + store.get('nomad.aimodel', 'auto'); if(k !== renderModelPick.k){ renderModelPick.k = k; renderModelPick(); if(!CHAT.length) renderChat() } } }, 1000);
setView = (function(orig){ return function(v){ orig(v); if(v === 'ai'){ renderModelPick(); renderChat() } } })(setView);
