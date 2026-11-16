/* NOMAD — effecten: opstartsequentie, 3D-globe, ticker, kaart-spotlight */
(function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const boot = document.getElementById('boot'), log = document.getElementById('bootLog'), bar = document.getElementById('bootBar');
  let seen = false; try{ seen = sessionStorage.getItem('nomad.boot') === '1' }catch(e){}

  async function waitStatus(){ for(let i = 0; i < 60 && !STATUS.version; i++) await sleep(50) }
  async function runBoot(){
    if(seen){ boot.classList.add('done'); return }
    await waitStatus();
    const S = STATUS, M = S.maps || {}, ok = v => v ? '<b>OK</b>' : '<em>--</em>';
    const lines = [
      `NOMAD OS v${S.version || '?'} :: node for offline media, archives and data`,
      `> mounting ssd ............ <b>${fmtB(S.disk?.total)}</b>`,
      `> library index ........... ${ok(S.library?.books)} ${fmtN(S.library?.articles)} articles`,
      `> vector world map ........ ${ok(M.world?.present)}`,
      `> elevation model ......... ${ok(M.terrain?.present)}`,
      `> geocoder ................ ${ok(S.geo === 'aan')}`,
      `> neural assistant ........ ${ok(S.ai?.state === 'aan')}`,
      `> uplink .................. ${S.online ? '<b>ONLINE</b>' : '<em>OFFLINE — LOCAL MODE</em>'}`,
      `READY.`,
    ];
    for(let i = 0; i < lines.length; i++){
      log.innerHTML += lines[i] + '\n'; bar.style.width = ((i + 1) / lines.length * 100) + '%';
      await sleep(i === lines.length - 1 ? 350 : 110);
    }
    boot.classList.add('done');
    try{ sessionStorage.setItem('nomad.boot', '1') }catch(e){}
  }
  boot.onclick = () => boot.classList.add('done');
  runBoot();

  /* ── globe ── */
  let globe = null;
  async function initGlobe(){
    await waitStatus();
    const el = document.getElementById('globe');
    if(STATUS.maps?.world?.present && window.maplibregl){
      if(!window.__pmProto){ window.__pmProto = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', window.__pmProto.tile) }
      const o = location.origin, f = mapFlavor();
      const layers = basemaps.layers('protomaps', f, {lang:LANG}).filter(l => l.type !== 'symbol');
      globe = new maplibregl.Map({container:el, interactive:false, attributionControl:false, center:[5, 30], zoom:0.6, renderWorldCopies:false,
        style:{version:8, projection:{type:'globe'}, sources:{protomaps:{type:'vector', url:'pmtiles://' + o + '/kaart/world.pmtiles', maxzoom:5}}, layers,
          sky:{'atmosphere-blend':0.6}}});
      let lon = 5;
      const spin = () => { if(VIEW === 'home' && !document.hidden){ lon = (lon + 0.06) % 360; globe.setCenter([lon - 180, 25]) } requestAnimationFrame(spin) };
      globe.on('load', () => requestAnimationFrame(spin));
    } else {
      dotGlobe(el);
    }
    fxOverlay();
  }
  /* reserve: draaiende stippenbol (zonder kaartdata) */
  function dotGlobe(el){
    const c = document.createElement('canvas'); c.style.cssText = 'width:100%;height:100%'; el.appendChild(c);
    const ctx = c.getContext('2d'); let rot = 0;
    const pts = []; for(let i = 0; i < 900; i++){ const y = 1 - (i / 899) * 2, r = Math.sqrt(1 - y*y), th = i * 2.399963; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]) }
    const draw = () => {
      const w = c.width = c.clientWidth * devicePixelRatio, h = c.height = c.clientHeight * devicePixelRatio, R = w * 0.42;
      const acc = getComputedStyle(document.documentElement).getPropertyValue('--a').trim();
      ctx.clearRect(0, 0, w, h);
      if(VIEW === 'home') rot += 0.004;
      for(const [x, y, z] of pts){
        const X = x * Math.cos(rot) - z * Math.sin(rot), Z = x * Math.sin(rot) + z * Math.cos(rot);
        const a = (Z + 1) / 2;
        ctx.fillStyle = `rgba(${acc},${0.08 + a * 0.75})`;
        ctx.beginPath(); ctx.arc(w/2 + X * R, h/2 - y * R, (0.6 + a * 1.4) * devicePixelRatio, 0, 7); ctx.fill();
      }
      requestAnimationFrame(draw);
    };
    draw();
  }
  /* overlay: pings en scanboog */
  function fxOverlay(){
    const c = document.getElementById('globeFx'), ctx = c.getContext('2d'); let a = 0; const pings = [];
    const draw = () => {
      const w = c.width = c.clientWidth * devicePixelRatio, h = c.height = c.clientHeight * devicePixelRatio, R = w * 0.43;
      const acc = getComputedStyle(document.documentElement).getPropertyValue('--a').trim();
      ctx.clearRect(0, 0, w, h);
      a += 0.012;
      const g = ctx.createConicGradient ? ctx.createConicGradient(a, w/2, h/2) : null;
      if(g){ g.addColorStop(0, `rgba(${acc},.28)`); g.addColorStop(0.12, `rgba(${acc},0)`); g.addColorStop(1, `rgba(${acc},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w/2, h/2, R, 0, 7); ctx.fill() }
      ctx.strokeStyle = `rgba(${acc},.5)`; ctx.lineWidth = devicePixelRatio; ctx.beginPath(); ctx.arc(w/2, h/2, R, 0, 7); ctx.stroke();
      if(Math.random() < 0.03){ const t = Math.random() * 6.28, r = Math.sqrt(Math.random()) * R * 0.85; pings.push({x:w/2 + Math.cos(t)*r, y:h/2 + Math.sin(t)*r, life:1}) }
      for(const p of pings){ p.life -= 0.012; ctx.strokeStyle = `rgba(${acc},${p.life})`; ctx.beginPath(); ctx.arc(p.x, p.y, (1 - p.life) * 18 * devicePixelRatio, 0, 7); ctx.stroke();
        ctx.fillStyle = `rgba(${acc},${p.life})`; ctx.beginPath(); ctx.arc(p.x, p.y, 2 * devicePixelRatio, 0, 7); ctx.fill() }
      while(pings.length && pings[0].life <= 0) pings.shift();
      requestAnimationFrame(draw);
    };
    draw();
  }
  initGlobe();

  /* ── ticker ── */
  const tick = document.getElementById('ticker'); let ti = 0;
  setInterval(() => {
    if(!STATUS.version) return;
    const S = STATUS, d = S.disk || {}, msgs = [
      `<b>${fmtN(S.library?.articles)}</b> ${t('articles').toUpperCase()} · ${S.library?.books || 0} ${t('collections')}`,
      `SSD <b>${fmtB(d.free)}</b> ${t('free').toUpperCase()} / ${fmtB(d.total)}`,
      `${S.online ? '<b>UPLINK ONLINE</b>' : 'UPLINK OFFLINE · <b>LOCAL MODE</b>'}`,
      `PINS <b>${USER.pins.length}</b> · ${t('favorites')} <b>${USER.favorites.length}</b>`,
    ];
    tick.innerHTML = '▸ ' + msgs[ti++ % msgs.length];
  }, 3200);

  /* ── spotlight op kaarten ── */
  document.addEventListener('pointermove', e => {
    const c = e.target.closest && e.target.closest('.card'); if(!c) return;
    const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });

  /* ── tellers laten oplopen ── */
  const obs = new MutationObserver(() => {
    document.querySelectorAll('#mods .big').forEach(el => {
      if(el.dataset.done) return; el.dataset.done = 1;
      const txt = el.textContent, n = parseInt(txt.replace(/\D/g, ''), 10);
      if(!n || n < 10 || !/^[\d.,\s]+$/.test(txt)) return;
      const t0 = performance.now();
      const step = now => { const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3); el.textContent = fmtN(Math.round(n * e)); if(k < 1) requestAnimationFrame(step) };
      requestAnimationFrame(step);
    });
  });
  obs.observe(document.getElementById('mods'), {childList:true});
})();
