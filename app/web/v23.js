/* v0.23 — clear download status: active / waiting / retrying, plus a "recent" list with ✓ complete and ✕ failed */
(() => {
  const ago = s => { const d = Date.now() / 1000 - s; return d < 90 ? t('dh_now') : d < 3600 ? Math.round(d / 60) + ' min' : d < 86400 ? Math.round(d / 3600) + ' h' : Math.round(d / 86400) + ' d' };
  function badge(j){
    if(j.status === 'bezig') return `<span class="dbadge run">${j.msg && /retry|problem|lost/i.test(j.msg) ? '⟳ ' + t('dh_retrying') : '↓ ' + t('dh_active')}</span>`;
    if(j.status === 'wachtrij') return /retry/i.test(j.msg || '') ? `<span class="dbadge warn">⟳ ${t('dh_retry_wait')}</span>` : `<span class="dbadge wait">⏸ ${t('dh_waiting')}</span>`;
    return '';
  }
  const _rq = renderQueue;
  renderQueue = function(){
    _rq();
    const jobs = window.__jobs || {}, run = Object.entries(jobs).filter(([, j]) => j.status === 'bezig' || j.status === 'wachtrij');
    // badges on the running rows
    $$('#dlQueue .upd').forEach((el, i) => { const j = run[i] && run[i][1]; if(j && !el.querySelector('.dbadge')) el.querySelector('.t b').insertAdjacentHTML('afterend', badge(j)); if(j) el.classList.add('st-' + (j.status === 'bezig' ? 'run' : 'wait')) });
    // recent: finished + failed (this session's jobs + saved history)
    const H = (window.__upd?.history || []).slice();
    for(const [id, j] of Object.entries(jobs)) if((j.status === 'klaar' || j.status === 'fout') && !H.some(h => h.id === id))
      H.unshift({id, title:j.title, status:j.status === 'klaar' ? 'done' : (j.msg === 'cancelled' ? 'cancelled' : 'failed'), size:j.total, error:j.msg, t:Date.now() / 1000});
    if(!H.length) return;
    const nOk = H.filter(h => h.status === 'done').length, nBad = H.filter(h => h.status === 'failed').length;
    $('#dlQueue').insertAdjacentHTML('beforeend', `<div class="dhist"><div class="dh-head"><span class="hud">${t('dh_recent')}</span>
      <span class="dbadge ok">✓ ${nOk} ${t('dh_done')}</span>${nBad ? `<span class="dbadge bad">✕ ${nBad} ${t('dh_failed')}</span>` : ''}<button class="btn ghost" id="dhClear">${t('dh_clear')}</button></div>
      ${H.slice(0, 8).map(h => `<div class="dh-row ${h.status}"><i>${h.status === 'done' ? '✓' : h.status === 'cancelled' ? '–' : '✕'}</i><span><b>${esc(h.title)}</b>
        <small>${h.status === 'done' ? t('dh_complete') : h.status === 'cancelled' ? t('dh_cancelled') : esc(h.error || t('dh_failed'))}${h.size ? ' · ' + fmtB(h.size) : ''} · ${ago(h.t)}</small></span>
        ${h.status !== 'done' ? `<button class="btn" data-retry="${esc(h.id)}">⟳ ${t('dh_retry')}</button>` : ''}</div>`).join('')}</div>`);
    $$('[data-retry]').forEach(b => b.onclick = async () => { b.disabled = true; const r = await post('/api/download/retry', {id:b.dataset.retry}); if(r.error) toast(r.error); pollJobs() });
    $('#dhClear').onclick = async () => { await post('/api/download/history/clear', {}); for(const [id, j] of Object.entries(jobs)) if(j.status === 'klaar' || j.status === 'fout') delete jobs[id]; window.__upd.history = []; renderQueue() };
  };
  // toast when something finishes or fails, even if you're on another page
  let prev = {};
  setInterval(async () => {
    const u = await api('/api/updates').catch(() => null); if(!u) return;
    for(const [id, j] of Object.entries(u.jobs || {})){
      const was = prev[id];
      if(was && was !== j.status){ if(j.status === 'klaar') toast('✓ ' + j.title + ' — ' + t('dh_complete')); if(j.status === 'fout' && j.msg !== 'cancelled') toast('✕ ' + j.title + ' — ' + t('dh_failed')) }
      prev[id] = j.status;
    }
    if(VIEW === 'dl'){ window.__jobs = u.jobs || {}; window.__upd = u; renderQueue() }
  }, 5000);
})();
