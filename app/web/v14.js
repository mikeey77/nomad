/* NOMAD v0.14 — places on the map (fuel, hospital, supermarket…) with a "nearby" list, phone sync messages */

const POI_CATS = [
  ['fuel',     '#ff8a3a', ['fuel'], 'pump'],
  ['charge',   '#29c5f6', ['charging_station'], 'bolt'],
  ['hospital', '#ff4d6a', ['hospital', 'clinic', 'doctors', 'dentist'], 'cross'],
  ['pharmacy', '#2fcf7a', ['pharmacy', 'chemist'], 'pill'],
  ['shop',     '#4d8bff', ['supermarket', 'convenience', 'greengrocer', 'grocery', 'bakery', 'butcher'], 'cart'],
  ['food',     '#ffb63a', ['restaurant', 'fast_food', 'cafe', 'bar', 'pub'], 'fork'],
  ['parking',  '#7f8cff', ['parking'], 'P'],
  ['water',    '#3fb8f0', ['drinking_water', 'toilets', 'water_point'], 'drop'],
  ['police',   '#5b6bff', ['police', 'fire_station'], 'shield'],
  ['camp',     '#8bc34a', ['camp_site', 'caravan_site', 'alpine_hut', 'shelter', 'wilderness_hut'], 'tent'],
  ['money',    '#c9a24a', ['atm', 'bank', 'bureau_de_change'], '€'],
];
const POI_PATHS = {
  pump:'M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16M4 21h12M8 8h4M15 9l3 2v7a1.5 1.5 0 003 0v-9l-3-3',
  bolt:'M13 2L4 14h7l-1 8 9-12h-7z', cross:'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  pill:'M9 3h6v4h4v6h-4v8H9v-8H5V7h4z', cart:'M3 4h2l2.5 11h10L20 7H6.5M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z',
  fork:'M7 3v8a2 2 0 002 2v8M11 3v8M9 3v6M16 21V3c2.5 1.5 3 5 3 8h-3',
  drop:'M12 2.7l5.7 5.7a8 8 0 11-11.4 0z', shield:'M12 2l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z',
  tent:'M12 3L2 21h20zM12 3v18M9 21l3-6 3 6',
};
const POI_KIND = {}; POI_CATS.forEach(([c, , kinds]) => kinds.forEach(k => POI_KIND[k] = c));
let POI_ON = new Set(store.get('nomad.poi', ['fuel', 'hospital', 'pharmacy', 'shop']));

function poiIcon(color, sym){
  const s = 2, n = 30 * s, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(n / 2, n / 2, n / 2 - 2 * s, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  g.lineWidth = 2 * s; g.strokeStyle = '#ffffff'; g.stroke();
  g.save(); g.translate(n / 2 - 8.5 * s, n / 2 - 8.5 * s); g.scale(17 * s / 24, 17 * s / 24);
  if(POI_PATHS[sym]){ g.lineWidth = 2.4; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#fff'; g.stroke(new Path2D(POI_PATHS[sym])); if(sym === 'cross' || sym === 'drop'){ g.fillStyle = '#fff'; g.fill(new Path2D(POI_PATHS[sym])) } }
  else { g.fillStyle = '#fff'; g.font = 'bold 17px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sym, 12, 13) }
  g.restore();
  return {width:n, height:n, data:g.getImageData(0, 0, n, n).data};
}
let FIND = null;  // {kinds, label} from the inventory's "where to find"
function poiKinds(){ if(FIND) return FIND.kinds; return POI_CATS.filter(([c]) => POI_ON.has(c)).flatMap(([, , k]) => k) }
function drawPois(){
  if(!MAP) return;
  if(!MAP.isStyleLoaded()){ MAP.once('idle', drawPois); return }
  if(!MAP.getSource('protomaps')) return;
  POI_CATS.forEach(([c, col, , sym]) => { if(!MAP.hasImage('poi-' + c)) MAP.addImage('poi-' + c, poiIcon(col, sym), {pixelRatio:2}) });
  if(!MAP.hasImage('poi-find')) MAP.addImage('poi-find', poiIcon('#b26bff', 'M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z'), {pixelRatio:2});
  const kinds = poiKinds(), filter = ['in', ['get', 'kind'], ['literal', kinds.length ? kinds : ['__none__']]];
  const cat = ['match', ['get', 'kind']]; POI_CATS.forEach(([c, , ks]) => cat.push(ks, 'poi-' + c)); cat.push(FIND ? 'poi-find' : 'poi-shop');
  if(MAP.getLayer('nomad-pois')) MAP.setLayoutProperty('nomad-pois', 'icon-image', cat);
  if(!MAP.getLayer('nomad-pois')){
    MAP.addLayer({id:'nomad-pois', type:'symbol', source:'protomaps', 'source-layer':'pois', minzoom:12, filter,
      layout:{'icon-image':cat, 'icon-size':['interpolate', ['linear'], ['zoom'], 12, .75, 16, 1], 'icon-allow-overlap':['step', ['zoom'], false, 15, true],
        'text-field':['step', ['zoom'], '', 15, ['coalesce', ['get', 'name:' + LANG], ['get', 'name'], '']], 'text-font':['Noto Sans Medium'], 'text-size':11,
        'text-offset':[0, 1.3], 'text-anchor':'top', 'text-optional':true},
      paint:{'text-color':SET.theme === 'sun' || SET.theme === 'light' ? '#111' : '#fff', 'text-halo-color':SET.theme === 'sun' || SET.theme === 'light' ? '#fff' : '#000', 'text-halo-width':1.4}});
    MAP.on('click', 'nomad-pois', e => poiPopup(e.features[0]));
    MAP.on('mouseenter', 'nomad-pois', () => MAP.getCanvas().style.cursor = 'pointer');
    MAP.on('mouseleave', 'nomad-pois', () => MAP.getCanvas().style.cursor = '');
  } else MAP.setFilter('nomad-pois', filter);
}
const kindLabel = k => POI_KIND[k] ? t('c_' + POI_KIND[k]) : String(k || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
function poiName(f){ return f.properties['name:' + LANG] || f.properties.name || kindLabel(f.properties.kind) }
function refPoint(){ return POS ? [POS.lon, POS.lat] : (MAP ? MAP.getCenter().toArray() : [0, 0]) }
function dist(a, b){
  const R = 6371000, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtD = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m) + ' m';
function poiPopup(f){
  const ll = f.geometry.coordinates, c = POI_KIND[f.properties.kind] || 'shop', col = POI_KIND[f.properties.kind] ? POI_CATS.find(x => x[0] === c)[1] : '#b26bff';
  const div = document.createElement('div');
  div.innerHTML = `<b>${esc(poiName(f))}</b><br><span class="mono dim" style="color:${col}">● ${esc(kindLabel(f.properties.kind))}</span> <span class="mono dim">· ${fmtD(dist(refPoint(), ll))}</span>
    <div style="display:flex;gap:6px;margin-top:8px"><button class="btn" style="height:28px;flex:1">${t('route_here')}</button></div>`;
  div.querySelector('button').onclick = () => {
    RTO = {lng:ll[0], lat:ll[1]};
    if(!RFROM && POS) RFROM = {lng:POS.lon, lat:POS.lat};
    document.querySelector('.maplibregl-popup')?.remove(); routeNow();
  };
  new maplibregl.Popup({offset:14}).setLngLat(ll).setDOMContent(div).addTo(MAP);
}
function renderPoiChips(){
  $('#poichips').innerHTML = POI_CATS.map(([c, col, , sym]) => `<button class="pchip2${POI_ON.has(c) ? ' on' : ''}" data-c="${c}" title="${esc(t('c_' + c))}" style="--pc:${col}">
      <i>${POI_PATHS[sym] ? `<svg viewBox="0 0 24 24"><path d="${POI_PATHS[sym]}"/></svg>` : `<b>${sym}</b>`}</i><span>${esc(t('c_' + c))}</span></button>`).join('') +
    `<button class="btn" id="nearBtn" style="width:100%;height:30px;margin-top:8px">◎ ${t('nearby')}</button>`;
  $$('#poichips .pchip2').forEach(b => b.onclick = () => {
    FIND = null; setNearTitle();
    POI_ON.has(b.dataset.c) ? POI_ON.delete(b.dataset.c) : POI_ON.add(b.dataset.c);
    store.set('nomad.poi', [...POI_ON]); renderPoiChips(); drawPois(); if($('#nearbox').classList.contains('on')) setTimeout(renderNearby, 300);
  });
  $('#nearBtn').onclick = () => { $('#nearbox').classList.toggle('on'); renderNearby() };
}
function renderNearby(){
  if(!$('#nearbox').classList.contains('on') || !MAP) return;
  if(MAP.getZoom() < 12){ $('#nearlist').innerHTML = `<div class="empty" style="white-space:normal">${t('near_zoom')}</div>`; return }
  const kinds = poiKinds(), ref = refPoint(), seen = new Set();
  const feats = MAP.querySourceFeatures('protomaps', {sourceLayer:'pois'}).filter(f => kinds.includes(f.properties.kind)).filter(f => {
    const k = poiName(f) + f.geometry.coordinates.map(v => v.toFixed(4)).join(); if(seen.has(k)) return false; seen.add(k); return true;
  }).map(f => ({f, d:dist(ref, f.geometry.coordinates)})).sort((a, b) => a.d - b.d).slice(0, 40);
  $('#nearlist').innerHTML = feats.length ? feats.map(({f, d}, i) => {
    const c = POI_KIND[f.properties.kind], col = c ? POI_CATS.find(x => x[0] === c)[1] : '#b26bff';
    return `<a class="nrow" data-i="${i}"><i style="background:${col}"></i><span><b>${esc(poiName(f))}</b><small>${esc(kindLabel(f.properties.kind))}</small></span><em>${fmtD(d)}</em></a>`;
  }).join('') : `<div class="empty" style="white-space:normal">${t('near_none')}</div>`;
  $$('#nearlist .nrow').forEach(a => a.onclick = () => { const f = feats[+a.dataset.i].f; MAP.flyTo({center:f.geometry.coordinates, zoom:Math.max(MAP.getZoom(), 16)}); poiPopup(f) });
}
function setNearTitle(){ const sp = $('#nearbox .hud span'); if(sp) sp.textContent = FIND ? t('finding') + ': ' + FIND.label : t('nearby') }
$('#nearClose').onclick = () => { $('#nearbox').classList.remove('on'); if(FIND){ FIND = null; setNearTitle(); drawPois() } };
window.findOnMap = (kinds, label) => {
  FIND = {kinds, label}; location.hash = 'map';
  setTimeout(() => {
    hookPois(); drawPois(); setNearTitle();
    if(MAP){ const c = POS ? [POS.lon, POS.lat] : MAP.getCenter().toArray(); if(MAP.getZoom() < 13) MAP.jumpTo({center:c, zoom:14}) }
    $('#nearbox').classList.add('on'); renderNearby(); MAP && MAP.once('idle', renderNearby);
  }, 500);
};
renderPoiChips();

let _poiHooked = null;
function hookPois(){
  if(!MAP || _poiHooked === MAP) return;
  _poiHooked = MAP;
  MAP.on('style.load', () => setTimeout(drawPois, 50));
  MAP.on('moveend', () => { renderNearby(); MAP.once('idle', renderNearby) });
  drawPois();
}
setInterval(hookPois, 1500);
setView = (function(orig){ return function(v){ orig(v); if(v === 'map') setTimeout(hookPois, 300) } })(setView);

/* phone sync result (file dropped in data\inbox) */
let _syncSeen = null;
setInterval(() => {
  const m = STATUS.sync_msg; if(!m || !m.length) return;
  const k = JSON.stringify(m); if(k === _syncSeen) return;
  if(_syncSeen !== null){
    const a = m.reduce((s, x) => s + (x.added || 0), 0), r = m.reduce((s, x) => s + (x.removed || 0), 0);
    toast(t('sync_done', {a, r}));
    api('/api/user').then(u => { USER = u; renderFavs(); renderHist(); renderDash(); renderPins() }).catch(() => {});
    if(typeof loadTracks === 'function') loadTracks();
  }
  _syncSeen = k;
}, 1500);
