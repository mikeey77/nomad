/* NOMAD v0.12 — fast translator, photo recognition, clearer storage clean-up */

const LNAME = Object.fromEntries((typeof TRL !== 'undefined' ? TRL : []).filter(([c]) => c !== 'auto'));

/* ───────── translator: fast engine (Argos) with AI fallback ───────── */
trGo = async function(){
  const text = $('#trIn').value.trim().slice(0, 5000); if(!text || trBusy) return;
  trBusy = true; $('#trOut').textContent = ''; $('#trOut').classList.add('cursor'); $('#trHint').innerHTML = '';
  const t0 = performance.now();
  try{
    const res = await fetch('/api/translate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text, from:$('#trFrom').value, to:$('#trTo').value})});
    if(!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', engine = '';
    for(;;){ const {value, done} = await rd.read(); if(done) break; buf += dec.decode(value, {stream:true}); let i;
      while((i = buf.indexOf('\n')) >= 0){ const l = buf.slice(0, i); buf = buf.slice(i + 1); if(!l.trim()) continue; const m = JSON.parse(l);
        if(m.from && $('#trFrom').value === 'auto') $('#trModel').textContent = t('tr_detected', {l:LNAME[m.from] || m.from});
        if(m.engine){
          engine = m.engine;
          $('#trHint').innerHTML = `<span class="engb ${engine}">${engine === 'fast' ? t('tr_fast') : t('tr_ai')}</span>` +
            (m.missing?.length ? `<span class="trtip">${t('tr_tip', {l:m.missing.map(c => LNAME[c] || c).join(', ')})}</span>` : '');
        }
        if(m.t) $('#trOut').textContent += m.t;
        if(m.error) throw new Error(m.error) } }
    $('#trOut').textContent = $('#trOut').textContent.replace(/\n+$/, '');
    $('#trHint').insertAdjacentHTML('beforeend', `<span class="mono dim">${((performance.now() - t0) / 1000).toFixed(1)}s</span>`);
  }catch(e){ $('#trOut').textContent = t('error') + ': ' + e.message }
  $('#trOut').classList.remove('cursor'); trBusy = false;
};
$('#trGo').onclick = trGo;

/* ───────── downloads: AI tab grouped (chat · photo · translate · speech) ───────── */
renderExtras = function(){
  if(!CAT) return;
  const ex = CAT.extras || [], ic = {map:'map', torrent:'globe', geo:'pin', route:'compass'};
  $('#mapgrid').innerHTML = ex.filter(i => ic[i.kind]).map(i => card(i.id, i, i.kind, `<div class="cico ph">${icon(ic[i.kind])}</div>`)).join('');
  const vis = i => /^Vision|· also recognises photos/.test(i.summary || '');
  const groups = [
    [t('assistant'), ex.filter(i => i.kind === 'ai' && !vis(i)), 'cpu'],
    [t('c_photo'), ex.filter(i => i.kind === 'ai' && vis(i)), 'camera'],
    [t('c_translate'), ex.filter(i => i.kind === 'mt'), 'trans'],
    ['Speech', ex.filter(i => i.kind === 'stt'), 'mic'],
  ];
  $('#aigrid').innerHTML = groups.filter(g => g[1].length).map(([name, items, ico]) =>
    `<div class="grp-t">${icon(ico)} ${esc(name)}</div>` + items.map(i => card(i.id, i, i.kind, `<div class="cico ph">${icon(ico)}</div>`)).join('')).join('');
  bindBtns('#mapgrid'); bindBtns('#aigrid');
};

/* ───────── storage clean-up: explained, nothing ticked by default ───────── */
const CL_SAFE = {old:true, installer:true, archive:true, partial:false};
loadCleanup = async function(){
  CLEAN = await api('/api/cleanup').catch(() => []);
  if(!CLEAN.length){ $('#cleanList').innerHTML = `<div class="empty">${t('s_nothing_clean')}</div>`; $('#cleanBtn').style.display = 'none'; return }
  const kinds = [...new Set(CLEAN.map(c => c.kind))];
  $('#cleanList').innerHTML = `<p class="sub" style="margin:0 0 12px">${t('cl_intro')}</p>` + kinds.map(k => {
    const items = CLEAN.map((c, i) => [c, i]).filter(([c]) => c.kind === k), tot = items.reduce((a, [c]) => a + c.size, 0);
    return `<div class="clg"><div class="clh"><b>${t('k_' + k)}</b><span class="clb ${CL_SAFE[k] ? 'ok' : 'warn'}">${CL_SAFE[k] ? t('cl_safe') : t('cl_check')}</span><em>${fmtB(tot)}</em></div>
      <div class="cld">${t('cl_' + k)}</div>` +
      items.map(([c, i]) => `<label class="cl"><input type="checkbox" data-i="${i}"><span>${esc(c.path.split(/[\\/]/).pop())}<small>${esc(c.path)}</small></span><b>${fmtB(c.size)}</b></label>`).join('') + '</div>';
  }).join('') + `<button class="btn ghost" id="clAll" style="margin-top:4px">${t('cl_all')}</button>`;
  $('#clAll').onclick = () => $$('#cleanList input').forEach(x => { if(CL_SAFE[CLEAN[+x.dataset.i].kind]) x.checked = true });
  $('#cleanBtn').style.display = '';
};
