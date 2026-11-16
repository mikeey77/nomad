/* NOMAD v0.13 — sun mode, article images, photo → translate, GPX tracks, backups, faster start */

/* ───────── home: "did you know" with the article's picture ───────── */
loadFact = async function(){
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
  box.classList.toggle('withimg', !!f.img);
  box.innerHTML = (f.img ? `<div class="fimg"><img src="${esc(f.img)}" alt="" onerror="this.closest('.fact').classList.remove('withimg');this.parentNode.remove()"></div>` : '') +
    `<div class="ftxt"><div class="k">${icon('bolt')} ${t('did_you_know')}</div><b>${esc(f.title)}</b><p>${esc(f.text)}</p></div>`;
  box.onclick = () => location.hash = 'lib/' + f.book + '/' + f.path;
};

/* ───────── startup: show that the library is still loading ───────── */
setInterval(() => {
  let el = $('#scanning');
  if(STATUS.scanning){
    if(!el){ el = document.createElement('span'); el.id = 'scanning'; el.className = 'scanning'; document.querySelector('footer')?.appendChild(el) }
    el.innerHTML = `<span class="spin"></span>${t('scanning')}`;
  } else if(el) el.remove();
}, 700);

/* ───────── translator: photo of a sign / menu → text → translation ───────── */
$('#trPhotoIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  const img = await shrink(f, 1280);
  $('#trIn').value = ''; $('#trOut').textContent = ''; $('#trHint').innerHTML = `<span class="aistat"><span class="spin"></span>${t('tr_reading')}</span>`;
  const r = await post('/api/ocr', {image:img}).catch(e => ({error:e.message}));
  $('#trHint').innerHTML = '';
  if(r.error){ toast(r.error); return }
  $('#trIn').value = r.text; $('#trIn').dispatchEvent(new Event('input'));
  if($('#trFrom').value !== 'auto'){ $('#trFrom').value = 'auto' }
  trGo();
};

/* ───────── map: GPX tracks ───────── */
let TRACKS = [], TRACK_HIDE = new Set(store.get('nomad.trackhide', []));
const TRACK_COLORS = ['#ff5ad1', '#3ad7ff', '#ffd23a', '#9b7bff', '#ff7a3a'];
async function loadTracks(){
  TRACKS = await api('/api/tracks').catch(() => []);
  renderTrackList(); drawTracks();
}
function renderTrackList(){
  const el = $('#tracklist'); if(!el) return;
  el.innerHTML = TRACKS.length ? TRACKS.map((tr, i) => `<div class="trk${TRACK_HIDE.has(tr.file) ? ' off' : ''}" data-i="${i}">
      <i style="background:${TRACK_COLORS[i % TRACK_COLORS.length]}"></i>
      <span><b>${esc(tr.name)}</b><small>${tr.error ? esc(tr.error) : t('km_climb', {km:tr.km, m:tr.climb || 0})}</small></span>
      <button data-a="eye" title="Show/hide">${TRACK_HIDE.has(tr.file) ? '○' : '●'}</button><button data-a="del" title="${t('delete')}">✕</button></div>`).join('')
    : `<div class="sub" style="padding:4px 6px;font-size:12px">${t('no_tracks')}</div>`;
  $$('#tracklist .trk').forEach(row => {
    const tr = TRACKS[+row.dataset.i];
    row.onclick = e => {
      const a = e.target.dataset.a;
      if(a === 'eye'){ TRACK_HIDE.has(tr.file) ? TRACK_HIDE.delete(tr.file) : TRACK_HIDE.add(tr.file); store.set('nomad.trackhide', [...TRACK_HIDE]); renderTrackList(); drawTracks(); return }
      if(a === 'del'){ modal({title:t('del_track_q', {n:tr.name}), buttons:[{label:t('cancel_b'), v:'c'}, {label:t('delete'), v:'d', danger:1}]})
        .then(r => r.btn === 'd' && post('/api/tracks/delete', {name:tr.file}).then(loadTracks)); return }
      if(tr.bbox && MAP) MAP.fitBounds([[tr.bbox[0], tr.bbox[1]], [tr.bbox[2], tr.bbox[3]]], {padding:80, maxZoom:15});
    };
  });
}
function drawTracks(){
  if(!MAP) return;
  if(!MAP.isStyleLoaded()){ MAP.once('idle', drawTracks); return }
  const feats = [];
  TRACKS.forEach((tr, i) => {
    if(TRACK_HIDE.has(tr.file)) return;
    const color = TRACK_COLORS[i % TRACK_COLORS.length];
    tr.lines.forEach(l => feats.push({type:'Feature', properties:{color}, geometry:{type:'LineString', coordinates:l}}));
    tr.points.forEach(p => feats.push({type:'Feature', properties:{color, name:p.name}, geometry:{type:'Point', coordinates:[p.lon, p.lat]}}));
  });
  const data = {type:'FeatureCollection', features:feats};
  if(MAP.getSource('tracks')){ MAP.getSource('tracks').setData(data); return }
  MAP.addSource('tracks', {type:'geojson', data});
  MAP.addLayer({id:'tracks-casing', type:'line', source:'tracks', filter:['==', '$type', 'LineString'], layout:{'line-cap':'round', 'line-join':'round'}, paint:{'line-color':'#000', 'line-width':7, 'line-opacity':.45}});
  MAP.addLayer({id:'tracks-line', type:'line', source:'tracks', filter:['==', '$type', 'LineString'], layout:{'line-cap':'round', 'line-join':'round'}, paint:{'line-color':['get', 'color'], 'line-width':4}});
  MAP.addLayer({id:'tracks-pt', type:'circle', source:'tracks', filter:['==', '$type', 'Point'], paint:{'circle-radius':5, 'circle-color':['get', 'color'], 'circle-stroke-color':'#fff', 'circle-stroke-width':2}});
  MAP.addLayer({id:'tracks-lbl', type:'symbol', source:'tracks', filter:['==', '$type', 'Point'], layout:{'text-field':['get', 'name'], 'text-font':['Noto Sans Medium'], 'text-size':12, 'text-offset':[0, 1.2], 'text-anchor':'top'},
    paint:{'text-color':'#fff', 'text-halo-color':'#000', 'text-halo-width':1.5}});
}
async function importGpx(files){
  let n = 0;
  for(const f of files){
    if(!/\.gpx$/i.test(f.name)) continue;
    const r = await post('/api/tracks/save', {name:f.name, gpx:await f.text()}).catch(e => ({error:e.message}));
    if(r.error) toast(f.name + ': ' + r.error); else n++;
  }
  if(n){ toast(t('gpx_saved')); TRACK_HIDE.clear(); await loadTracks(); const last = TRACKS[0]; if(last?.bbox && MAP) MAP.fitBounds([[last.bbox[0], last.bbox[1]], [last.bbox[2], last.bbox[3]]], {padding:80, maxZoom:15}) }
}
$('#gpxIn').onchange = e => { importGpx([...e.target.files]); e.target.value = '' };
$('#v-map').addEventListener('dragover', e => e.preventDefault());
$('#v-map').addEventListener('drop', e => { const fs = [...(e.dataTransfer.files || [])].filter(f => /\.gpx$/i.test(f.name)); if(fs.length){ e.preventDefault(); importGpx(fs) } });
let _trHooked = null;
function hookTracks(){
  if(!MAP || _trHooked === MAP) return;
  _trHooked = MAP;
  MAP.on('style.load', drawTracks);
  if(MAP.isStyleLoaded()) loadTracks(); else MAP.once('load', loadTracks);
}
setView = (function(orig){ return function(v){ orig(v); if(v === 'map') setTimeout(hookTracks, 300) } })(setView);
setInterval(hookTracks, 2000);

/* route → GPX file */
window.routeExtras = () => {
  const R = window.LAST_ROUTE; if(!R) return;
  const b = document.createElement('button'); b.className = 'btn'; b.style.cssText = 'width:100%;margin-top:8px;height:30px'; b.textContent = t('export_gpx');
  b.onclick = async () => {
    const coords = R.p.points.coordinates, name = `Route ${R.mode} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="PROJECT NOMAD" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name><trkseg>` +
      coords.map(c => `<trkpt lat="${c[1]}" lon="${c[0]}">${c[2] != null ? `<ele>${c[2]}</ele>` : ''}</trkpt>`).join('') + '</trkseg></trk></gpx>';
    const r = await post('/api/tracks/save', {name, gpx});
    if(r.error) return toast(r.error);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([gpx], {type:'application/gpx+xml'})); a.download = r.file; a.click();
    toast(t('gpx_saved')); loadTracks();
  };
  $('#rRes').appendChild(b);
};

/* ───────── settings: backup & restore ───────── */
async function loadBackups(){
  const l = await api('/api/backups').catch(() => []);
  $('#bkList').innerHTML = l.length ? `${t('b_auto')}: ` + l.slice(0, 5).map(b => `<code>${esc(b.file.replace('nomad-backup-', '').replace('.json', ''))}</code>`).join(' · ') : '';
}
$('#bkNow').onclick = async () => { await post('/api/backup/now', {}); toast(t('b_made')); loadBackups() };
$('#bkIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  let data; try{ data = JSON.parse(await f.text()) }catch{ return toast('Not a NOMAD backup') }
  const r = await modal({title:t('b_restore_q'), body:`<p class="sub">${esc(f.name)}</p>`,
    buttons:[{label:t('cancel_b'), v:'c'}, {label:t('b_replace'), v:'replace', danger:1}, {label:t('b_merge'), v:'merge', pri:1}]});
  if(r.btn !== 'merge' && r.btn !== 'replace') return;
  const res = await post('/api/backup/restore', {data, mode:r.btn});
  if(res.error) return toast(res.error);
  toast(t('b_done')); setTimeout(() => location.reload(), 900);
};
setView = (function(orig){ return function(v){ orig(v); if(v === 'set') loadBackups() } })(setView);

/* map follows the theme (sun → light map), also when settings arrive after the map was built */
let _mapLook = null;
applyLook = (function(orig){ return function(){
  orig();
  const k = (SET.theme === 'sun' ? 'sun' : '') + '|' + (SET.map_style || 'color') + '|' + (SET.accent || '');
  if(MAP && _mapLook !== null && _mapLook !== k){ MAP.setStyle(buildStyle()); MAP.once('styledata', () => { applyLayers(); renderPins(); drawTracks() }) }
  _mapLook = k;
} })(applyLook);
