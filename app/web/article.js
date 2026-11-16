(function(){
  const P = window.parent !== window ? window.parent : null;
  if(!P){
    // direct geopend (niet in NEXUS) → stuur door naar de shell
    location.replace('/#lib/' + decodeURIComponent(location.pathname.slice(5)));
    return;
  }
  document.documentElement.classList.add('nexus');

  function ready(){
    // secties altijd uitklappen (mwoffliner gebruikt <details>)
    document.querySelectorAll('details').forEach(d => d.open = true);
    document.querySelectorAll('.collapsible-block, .mf-section-1, [class*="mf-section"]').forEach(el => {
      el.style.display = ''; el.classList.add('open-block');
    });

    // externe links in nieuw tabblad
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.getAttribute('href');
      if(/^(https?:)?\/\//i.test(h)){ a.target = '_blank'; a.rel = 'noopener'; a.classList.add('ext') }
    });

    const title = (document.querySelector('h1') || {}).textContent || document.title;
    const heads = [...document.querySelectorAll('h2, h3')].map((h, i) => {
      if(!h.id){
        const inner = h.querySelector('[id]');
        h.id = inner ? inner.id : ('nx-h' + i);
      }
      return { id: h.id, t: h.textContent.replace(/\[bewerken.*?\]|\[edit\]/gi,'').trim(), l: h.tagName === 'H2' ? 2 : 3 };
    }).filter(h => h.t);
    window.__heads = heads;
    P.postMessage({ type: 'doc', title: title.trim(), headings: heads,
      book: decodeURIComponent(location.pathname.split('/')[2]), path: decodeURIComponent(location.pathname.split('/').slice(3).join('/')) }, '*');
    onScroll();
  }

  function onScroll(){
    const el = document.scrollingElement || document.documentElement;
    const max = el.scrollHeight - el.clientHeight;
    const p = max > 0 ? el.scrollTop / max : 0;
    let active = null;
    for(const h of (window.__heads || [])){
      const n = document.getElementById(h.id);
      if(n && n.getBoundingClientRect().top < 140) active = h.id;
    }
    P.postMessage({ type: 'scroll', p, active }, '*');
  }
  let t = null;
  addEventListener('scroll', () => { if(t) return; t = requestAnimationFrame(() => { t = null; onScroll() }) }, { passive: true });

  addEventListener('message', e => {
    const m = e.data || {};
    if(m.type === 'look'){
      document.documentElement.style.setProperty('--fs', m.scale || 1);
      document.documentElement.classList.toggle('light', m.theme === 'light');
    }
    if(m.type === 'goto'){
      const n = document.getElementById(m.id);
      if(n){ n.closest('details') && (n.closest('details').open = true); n.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
    }
  });

  // sneltoetsen doorgeven aan de shell
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    const inInput = /input|textarea/i.test(e.target.tagName);
    const want = ((e.ctrlKey || e.metaKey) && (k === 'k')) ||
                 (!inInput && !e.ctrlKey && !e.metaKey && !e.altKey && (k === '/' || k === 'r')) ||
                 (e.altKey && (k === 'arrowleft' || k === 'arrowright'));
    if(want){
      e.preventDefault();
      P.postMessage({ type: 'key', key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, inInput }, '*');
    }
  });

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
