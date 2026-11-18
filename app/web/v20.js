/* v0.20 — live internet speed in Downloads (+ sparkline, peak, speed test) */
(() => {
  const H = [], el = () => $('#netspeed');
  let peak = 0, test = null, testing = false;
  const mbit = b => (b * 8 / 1e6);
  const fmtS = b => { const m = mbit(b); return m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2) };
  function spark(){
    if(H.length < 2) return '';
    const max = Math.max(...H, 1), w = 90, h = 22, step = w / (H.length - 1);
    const pts = H.map((v, i) => `${(i * step).toFixed(1)},${(h - v / max * (h - 2) - 1).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="0,${h} ${pts} ${w},${h}" class="ns-fill"/><polyline points="${pts}" class="ns-line"/></svg>`;
  }
  function render(){
    const e = el(); if(!e) return;
    const jobs = Object.values(window.__jobs || {}).filter(j => j.status === 'bezig');
    const now = jobs.reduce((a, j) => a + (j.speed || 0), 0);
    const left = jobs.reduce((a, j) => a + Math.max(0, (j.total || 0) - (j.done || 0)), 0);
    if(jobs.length){
      H.push(now); if(H.length > 40) H.shift(); peak = Math.max(peak, now);
      const s = now ? left / now : 0, eta = !now ? '' : s > 3600 ? (s / 3600).toFixed(1) + ' h' : Math.ceil(s / 60) + ' min';
      e.innerHTML = `<span class="ns-dot on"></span><div class="ns-main"><b>${fmtS(now)}</b><small>Mbit/s</small></div>${spark()}
        <div class="ns-sub mono">${fmtB(now)}/s · ${jobs.length} ${t('ns_active')}${eta ? ' · ' + eta + ' ' + t('eta') : ''}<br>${t('ns_peak')} ${fmtS(peak)} Mbit/s</div>`;
    } else {
      H.length = 0;
      const r = test && test.ok ? `<b>${fmtS(test.bps)}</b><small>Mbit/s</small>` : `<b class="dim">—</b>`;
      e.innerHTML = `<span class="ns-dot ${STATUS.online ? '' : 'off'}"></span><div class="ns-main">${r}</div>
        <div class="ns-sub mono">${testing ? t('ns_testing') : test && test.ok ? t('ns_last') + (test.ping ? ' · ping ' + test.ping + ' ms' : '') : test ? esc(test.error || '') : t('ns_idle')}</div>
        <button class="btn ghost" id="nsTest" style="padding:6px 12px;font-size:11px" ${testing || !STATUS.online ? 'disabled' : ''}>${testing ? '…' : t('ns_test')}</button>`;
      $('#nsTest') && ($('#nsTest').onclick = async () => {
        testing = true; render();
        test = await api('/api/speedtest').catch(() => ({ok:false, error:'error'}));
        testing = false; render();
      });
    }
  }
  const orig = window.renderQueue;
  window.renderQueue = function(){ orig && orig.apply(this, arguments); render() };
  addEventListener('hashchange', () => setTimeout(render, 400));
})();
