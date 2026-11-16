/* NOMAD v0.11 — faster AI: live search progress, think mode, warm model, smooth streaming */

let THINK = store.get('nomad.think', false);
$('#thinkTog').classList.toggle('on', THINK);
$('#thinkTog').onclick = () => { THINK = !THINK; store.set('nomad.think', THINK); $('#thinkTog').classList.toggle('on', THINK) };

/* extra blocks inside an AI bubble: live status + thinking */
window.aiExtras = m => {
  let h = m.img ? `<img class="uimg" src="${m.img}" alt="">` : '';
  if(m.think){
    const open = m.live && !m.content;
    h += `<details class="think"${open ? ' open' : ''}><summary>${open ? '<span class="spin"></span>' + t('s_thinking') : '🧠 ' + t('s_thought')}</summary><div>${esc(m.think)}</div></details>`;
  }
  if(m.live && !m.content && m.status) h += `<div class="aistat"><span class="spin"></span>${esc(m.status)}</div>`;
  if(m.live && m.steps?.length && !m.content) h += `<div class="aisteps">${m.steps.map(s => `<span>${esc(s)}</span>`).join('')}</div>`;
  return h;
};

/* render at most once per frame while tokens stream in */
let _rq = 0;
function renderSoon(){ if(_rq) return; _rq = requestAnimationFrame(() => { _rq = 0; renderChat() }) }

/* ───────── photo → AI (plant, furniture, object recognition) ───────── */
let PHOTO = null;  // {full: dataURL for the model, thumb: small dataURL for the chat}
function shrink(file, max){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
async function setPhoto(file){
  if(!file || !file.type.startsWith('image/')) return;
  PHOTO = {full:await shrink(file, 896), thumb:await shrink(file, 220)};
  $('#photoPrev').innerHTML = `<div class="pchip"><img src="${PHOTO.thumb}"><span>${t('photo_ready')}</span><button title="✕">✕</button></div>`;
  $('#photoPrev button').onclick = () => { PHOTO = null; $('#photoPrev').innerHTML = '' };
  if(!$('#prompt').value.trim()) $('#prompt').value = t('photo_q');
  $('#prompt').focus();
}
$('#photoIn').onchange = e => { setPhoto(e.target.files[0]); e.target.value = '' };
$('#v-ai').addEventListener('dragover', e => e.preventDefault());
$('#v-ai').addEventListener('drop', e => { const f = e.dataTransfer.files?.[0]; if(f){ e.preventDefault(); setPhoto(f) } });
$('#prompt').addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/')); if(f){ e.preventDefault(); setPhoto(f) } });

send = async function(){
  const q = $('#prompt').value.trim(); if(!q || busy) return;
  busy = true; $('#send').disabled = true; $('#prompt').value = ''; autoGrow();
  const photo = PHOTO; PHOTO = null; $('#photoPrev').innerHTML = '';
  CHAT.push({role:'user', content:q, img:photo?.thumb});
  const wiki = $('#useWiki').classList.contains('on');
  const msg = {role:'assistant', content:'', live:true, status:wiki ? t('s_search', {n:'…', kw:'…'}) : t('s_answer'), steps:[]};
  CHAT.push(msg); renderChat();
  const t0 = performance.now(); let tFirst = 0, found = '';
  try{
    const res = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({wiki, think:THINK, images:photo ? [photo.full] : [], messages:CHAT.filter(m => m !== msg && !m.err).map(m => ({role:m.role, content:m.content}))})});
    if(!res.ok){ throw new Error((await res.json().catch(() => ({}))).error || res.status) }
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for(;;){
      const {value, done} = await reader.read(); if(done) break;
      buf += dec.decode(value, {stream:true});
      let i; while((i = buf.indexOf('\n')) >= 0){
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if(!line.trim()) continue;
        let m; try{ m = JSON.parse(line) }catch{ continue }
        if(m.status === 'search') msg.status = t('s_search', {n:m.books, kw:(m.kw || []).join(' ')});
        else if(m.status === 'book' && m.n) msg.steps.push('✓ ' + m.book);
        else if(m.status === 'timeout') msg.steps.push(t('s_skip', {b:m.skipped.join(', ')}));
        else if(m.status === 'found'){ found = t('s_found', {n:m.n, s:(m.ms / 1000).toFixed(1)}); msg.status = found }
        else if(m.status === 'answer'){ msg.status = STATUS.ai?.warm === false ? t('s_cold') : t('s_answer'); msg.model = m.model }
        else if(m.status === 'vision') msg.status = t('s_vision', {m:m.model});
        else if(m.status === 'seen' && m.name){ msg.steps.push('👁 ' + m.name); msg.status = t('s_lookup', {x:m.name}) }
        if(m.source){ (msg.sources = msg.sources || []).push(m.source) }
        if(m.sources) msg.sources = m.sources;
        if(m.th){ msg.think = (msg.think || '') + m.th; if(!tFirst) tFirst = performance.now() }
        if(m.t){ msg.content += m.t; if(!tFirst) tFirst = performance.now() }
        if(m.done){
          const parts = [msg.model || STATUS.ai?.model || ''];
          if(m.tps) parts.push(m.tps + ' ' + t('tok_s'));
          if(found) parts.push(found);
          parts.push(((performance.now() - t0) / 1000).toFixed(1) + 's');
          msg.meta = parts.filter(Boolean).join(' · ');
          if(STATUS.ai) STATUS.ai.warm = true;
        }
        if(m.error){ msg.content = m.error; msg.err = true }
        renderSoon();
      }
    }
  }catch(e){ msg.content = t('error') + ': ' + e.message; msg.err = true }
  msg.live = false; delete msg.status; delete msg.steps; busy = false; $('#send').disabled = false;
  store.set('nomad.chat', CHAT.slice(-40)); renderChat();
};
$('#send').onclick = send;
