/* NOMAD v0.15 — Inventory: your real supplies, game-style. Stashes, slots, rarity, days of food & water,
   expiry warnings, recommended kits and "where to find" on the map. */

const RAR = {c:['Common', 'Gewoon', '#9aa7b0'], u:['Uncommon', 'Ongewoon', '#3ddc84'], r:['Rare', 'Zeldzaam', '#3a9bff'], e:['Epic', 'Episch', '#b26bff'], l:['Legendary', 'Legendarisch', '#ffb020']};
const NEED = {a:[2000, 3], c:[1400, 2], p:[500, 1]};  // kcal & litres per day: adult, child, pet
const BOX_ICONS = ['🏠', '🎒', '🚗', '🏕️', '🏚️', '🚐', '⛵', '🗄️', '📦', '🧰', '🏢', '🛖'];
const ITEM = {}; INV_ITEMS.forEach(r => ITEM[r[0]] = {id:r[0], e:r[1], en:r[2], nl:r[3], cat:r[4], rar:r[5], kg:r[6], kcal:r[7], l:r[8], shelf:r[9], find:r[10]});
const L = (en, nl) => LANG === 'nl' ? nl : en;

let INV = null, INV_BOX = store.get('nomad.invbox', 'home'), INV_CAT = '', INV_Q = '';
function invDefault(){
  return {people:{a:1, c:0, p:0}, custom:[],
    boxes:[{id:'home', type:'home', icon:'🏠', name:'', limit:0}, {id:'bag', type:'backpack', icon:'🎒', name:'', limit:15}, {id:'car', type:'car', icon:'🚗', name:'', limit:0}],
    stacks:[]};
}
function invLoad(){
  INV = USER.inventory && USER.inventory.boxes ? USER.inventory : invDefault();
  INV.custom = INV.custom || []; INV.people = INV.people || {a:1, c:0, p:0};
  INV.custom.forEach(c => ITEM[c.id] = c);
  if(!INV.boxes.some(b => b.id === INV_BOX)) INV_BOX = INV.boxes[0]?.id;
}
const invSave = debounce(() => saveUser({inventory:INV}), 400);
const it = id => ITEM[id] || {id, e:'📦', en:id, nl:id, cat:'tools', rar:'c', kg:0, kcal:0, l:0, shelf:0};
const iname = i => L(i.en, i.nl);
const boxName = b => b.name || ({home:L('Home supply', 'Thuisvoorraad'), backpack:L('Backpack', 'Rugzak'), car:L('Car', 'Auto')}[b.type] || L('Storage', 'Opslag'));
const daysLeft = s => s.exp ? Math.ceil((new Date(s.exp) - Date.now()) / 864e5) : null;
const uid = () => Math.random().toString(36).slice(2, 10);

/* ───────── numbers ───────── */
function needPerDay(){ const p = INV.people; return [p.a * NEED.a[0] + p.c * NEED.c[0] + p.p * NEED.p[0], p.a * NEED.a[1] + p.c * NEED.c[1] + p.p * NEED.p[1]] }
function totals(stacks){
  let kcal = 0, l = 0, kg = 0, soon = 0, bad = 0, filter = false;
  for(const s of stacks){
    const i = it(s.item), d = daysLeft(s), ok = d === null || d >= 0;
    kg += i.kg * s.qty;
    if(ok){ kcal += i.kcal * s.qty; l += i.l * s.qty }
    if(d !== null && d < 0) bad++; else if(d !== null && d <= 30) soon++;
    if(s.item === 'water_filter' || s.item === 'water_tabs') filter = true;
  }
  const [nk, nl] = needPerDay();
  return {kcal, l, kg, soon, bad, filter, food:nk ? kcal / nk : 0, water:nl ? l / nl : 0};
}
const fmtDays = d => d >= 99 ? '99+' : d >= 10 ? Math.floor(d) : d.toFixed(1).replace('.0', '');

/* ───────── rendering ───────── */
function renderInv(){
  if(!INV) invLoad();
  const all = totals(INV.stacks), box = INV.boxes.find(b => b.id === INV_BOX) || INV.boxes[0];
  const inBox = INV.stacks.filter(s => s.box === box.id), bt = totals(inBox);
  const bar = (v, max, col) => `<div class="ibar"><i style="width:${Math.min(100, v / max * 100)}%;background:${col}"></i></div>`;
  const dcol = d => d >= 14 ? 'var(--acc)' : d >= 3 ? '#ffb63a' : '#ff5470';
  $('#invHud').innerHTML = `
    <div class="ihud"><span class="ih-e">🍽️</span><div><small>${L('FOOD', 'ETEN')}</small><b style="color:${dcol(all.food)}">${fmtDays(all.food)} <em>${L('days', 'dagen')}</em></b>${bar(all.food, 14, dcol(all.food))}<small class="mono">${Math.round(all.kcal).toLocaleString()} kcal</small></div></div>
    <div class="ihud"><span class="ih-e">💧</span><div><small>${L('WATER', 'WATER')}</small><b style="color:${dcol(all.water)}">${fmtDays(all.water)} <em>${L('days', 'dagen')}</em></b>${bar(all.water, 14, dcol(all.water))}<small class="mono">${all.l.toFixed(1)} L${all.filter ? ' · 🧪 ' + L('+ filter', '+ filter') : ''}</small></div></div>
    <div class="ihud"><span class="ih-e">⏳</span><div><small>${L('EXPIRY', 'HOUDBAARHEID')}</small><b style="color:${all.bad ? '#ff5470' : all.soon ? '#ffb63a' : 'var(--acc)'}">${all.bad ? all.bad + ' ' + L('expired', 'verlopen') : all.soon ? all.soon + ' ' + L('within 30 d', 'binnen 30 d') : L('All good', 'Alles goed')}</b>
      <small class="mono">${INV.stacks.length} ${L('stacks', 'stapels')} · ${INV.stacks.reduce((a, s) => a + s.qty, 0)} ${L('items', 'items')}</small></div></div>
    <div class="ihud ppl"><span class="ih-e">👥</span><div><small>${L('PEOPLE', 'PERSONEN')}</small>
      <div class="pplrow">${[['a', '🧑', L('Adults', 'Volwassenen')], ['c', '🧒', L('Children', 'Kinderen')], ['p', '🐕', L('Pets', 'Huisdieren')]].map(([k, e, n]) =>
        `<span title="${n}">${e}<button data-pp="${k}" data-d="-1">−</button><b>${INV.people[k]}</b><button data-pp="${k}" data-d="1">+</button></span>`).join('')}</div></div></div>`;
  $$('#invHud [data-pp]').forEach(b => b.onclick = () => { const k = b.dataset.pp; INV.people[k] = Math.max(k === 'a' ? 1 : 0, INV.people[k] + +b.dataset.d); invSave(); renderInv() });

  $('#invBoxes').innerHTML = INV.boxes.map(b => {
    const st = INV.stacks.filter(s => s.box === b.id), tt = totals(st);
    return `<button class="ibox${b.id === box.id ? ' on' : ''}" data-b="${b.id}"><span class="ib-e">${b.icon}</span><span class="ib-t"><b>${esc(boxName(b))}</b>
      <small>${st.reduce((a, s) => a + s.qty, 0)} ${L('items', 'items')} · ${tt.kg.toFixed(1)}${b.limit ? ' / ' + b.limit : ''} kg</small>
      ${b.limit ? `<span class="ibar sm"><i style="width:${Math.min(100, tt.kg / b.limit * 100)}%;background:${tt.kg > b.limit ? '#ff5470' : 'var(--acc)'}"></i></span>` : ''}</span></button>`;
  }).join('') + `<button class="ibox add" id="boxAdd"><span class="ib-e">＋</span><span class="ib-t"><b>${L('New storage', 'Nieuwe opslag')}</b><small>${L('shed, boat, office…', 'schuur, boot, werk…')}</small></span></button>`;
  $$('#invBoxes [data-b]').forEach(b => {
    b.onclick = () => { INV_BOX = b.dataset.b; store.set('nomad.invbox', INV_BOX); renderInv() };
    b.ondblclick = () => editBox(INV.boxes.find(x => x.id === b.dataset.b));
    b.ondragover = e => { e.preventDefault(); b.classList.add('drop') };
    b.ondragleave = () => b.classList.remove('drop');
    b.ondrop = e => { e.preventDefault(); b.classList.remove('drop'); const s = INV.stacks.find(x => x.uid === e.dataTransfer.getData('text/nomad-stack')); if(s){ moveStack(s, b.dataset.b) } };
  });
  $('#boxAdd').onclick = () => editBox(null);

  $('#invTitle').innerHTML = `${box.icon} ${esc(boxName(box))} <button class="btn ghost" id="boxEdit" style="height:26px;padding:0 10px;font-size:10px">${L('EDIT', 'BEWERKEN')}</button>`;
  $('#boxEdit').onclick = () => editBox(box);
  $('#invSub').textContent = `${bt.kg.toFixed(1)} kg${box.limit ? ' / ' + box.limit + ' kg' : ''} · 🍽️ ${fmtDays(bt.food)} ${L('d', 'd')} · 💧 ${fmtDays(bt.water)} ${L('d', 'd')}`;

  $('#invCats').innerHTML = `<button class="icat${!INV_CAT ? ' on' : ''}" data-c="">✦ ${L('All', 'Alles')}</button>` +
    INV_CATS.map(([c, e, en, nl]) => { const n = inBox.filter(s => it(s.item).cat === c).length; return n ? `<button class="icat${INV_CAT === c ? ' on' : ''}" data-c="${c}">${e} ${L(en, nl)} <em>${n}</em></button>` : '' }).join('');
  $$('#invCats .icat').forEach(b => b.onclick = () => { INV_CAT = b.dataset.c; renderInv() });

  const q = INV_Q.toLowerCase();
  const shown = inBox.filter(s => (!INV_CAT || it(s.item).cat === INV_CAT) && (!q || iname(it(s.item)).toLowerCase().includes(q)))
    .sort((a, b) => INV_CATS.findIndex(c => c[0] === it(a.item).cat) - INV_CATS.findIndex(c => c[0] === it(b.item).cat) || iname(it(a.item)).localeCompare(iname(it(b.item))));
  const pad = Math.max(0, Math.ceil((shown.length + 1) / 8) * 8 - shown.length - 1, 15 - shown.length);
  $('#invGrid').innerHTML = shown.map(s => {
    const i = it(s.item), d = daysLeft(s), pct = d === null ? null : Math.max(0, Math.min(100, d / Math.max(30, i.shelf || 365) * 100));
    return `<div class="slot r-${i.rar}${d !== null && d < 0 ? ' bad' : d !== null && d <= 30 ? ' soon' : ''}" draggable="true" data-u="${s.uid}" title="${esc(iname(i))}">
      <span class="se">${i.e}</span>${s.qty > 1 ? `<b class="sq">${s.qty}</b>` : ''}
      ${d !== null ? `<span class="sd" title="${d} ${L('days', 'dagen')}">${d < 0 ? '☠' : d > 999 ? Math.round(d / 365) + 'y' : d + 'd'}</span><span class="sx"><i style="width:${pct}%"></i></span>` : ''}
      <span class="sn">${esc(iname(i))}</span></div>`;
  }).join('') + `<div class="slot addslot" id="slotAdd" title="${L('Add / loot items', 'Items toevoegen')}"><span class="se">＋</span><span class="sn">${L('Add item', 'Item toevoegen')}</span></div>` +
    '<div class="slot empty"></div>'.repeat(pad);
  $$('#invGrid .slot[data-u]').forEach(el => {
    el.onclick = () => openStack(INV.stacks.find(s => s.uid === el.dataset.u));
    el.ondragstart = e => { e.dataTransfer.setData('text/nomad-stack', el.dataset.u); el.classList.add('drag') };
    el.ondragend = () => el.classList.remove('drag');
  });
  $('#slotAdd').onclick = () => openPicker();
  renderKits(box);
}

function renderKits(box){
  const kits = INV_KITS.filter(k => k.type === box.type), others = INV_KITS.filter(k => k.type !== box.type);
  const ppl = INV.people.a + INV.people.c, inBox = INV.stacks.filter(s => s.box === box.id);
  const have = id => inBox.filter(s => s.item === id && (daysLeft(s) === null || daysLeft(s) >= 0)).reduce((a, s) => a + s.qty, 0);
  const html = (kits.length ? kits : others).map(k => {
    const need = k.items.map(([id, n, pp]) => ({id, n:n * (pp ? ppl : 1), h:have(id)}));
    const done = need.filter(x => x.h >= x.n).length, pct = Math.round(done / need.length * 100);
    const miss = need.filter(x => x.h < x.n);
    return `<div class="kit"><div class="kit-h"><span>${k.icon}</span><b>${L(k.en, k.nl)}</b><em>${pct}%</em></div>
      <div class="ibar"><i style="width:${pct}%;background:${pct === 100 ? 'var(--acc)' : 'linear-gradient(90deg,#3a9bff,var(--acc))'}"></i></div>
      <small class="dim">${done} / ${need.length} ${L('complete', 'compleet')}${kits.length ? '' : ' · ' + L('for another storage type', 'voor een ander soort opslag')}</small>
      <div class="kit-l">${miss.length ? miss.map(x => { const i = it(x.id); return `<div class="kit-i r-${i.rar}"><span>${i.e}</span><span class="kn">${esc(iname(i))}<small>${x.h} / ${x.n}</small></span>
        <button data-find="${x.id}" title="${L('Where to find', 'Waar te vinden')}">⌖</button><button data-add="${x.id}" data-n="${x.n - x.h}" title="${L('Add', 'Toevoegen')}">＋</button></div>` }).join('')
        : `<div class="kit-ok">✓ ${L('Kit complete — nice!', 'Pakket compleet — top!')}</div>`}</div></div>`;
  }).join('');
  $('#invKits').innerHTML = html;
  $$('#invKits [data-add]').forEach(b => b.onclick = () => addItem(b.dataset.add, +b.dataset.n, b));
  $$('#invKits [data-find]').forEach(b => b.onclick = () => findItem(b.dataset.find));
}

/* ───────── actions ───────── */
function addItem(id, qty = 1, fromEl){
  const i = it(id), box = INV_BOX;
  const exp = i.shelf ? new Date(Date.now() + i.shelf * 864e5).toISOString().slice(0, 10) : '';
  const same = INV.stacks.find(s => s.item === id && s.box === box && (s.exp || '') === exp);
  if(same) same.qty += qty; else INV.stacks.push({uid:uid(), item:id, qty, box, exp, note:'', added:Date.now()});
  invSave(); renderInv(); lootFx(i, qty, fromEl);
}
function moveStack(s, box){
  if(s.box === box) return;
  const dup = INV.stacks.find(x => x !== s && x.item === s.item && x.box === box && (x.exp || '') === (s.exp || ''));
  if(dup){ dup.qty += s.qty; INV.stacks = INV.stacks.filter(x => x !== s) } else s.box = box;
  invSave(); renderInv(); toast(`${it(s.item).e} → ${boxName(INV.boxes.find(b => b.id === box))}`);
}
function lootFx(i, qty, el){
  const r = (el || $('#slotAdd'))?.getBoundingClientRect?.() || {left:innerWidth / 2, top:innerHeight / 2, width:0, height:0};
  const fx = document.createElement('div'); fx.className = 'lootfx r-' + i.rar;
  fx.innerHTML = `<span>${i.e}</span><b>+${qty} ${esc(iname(i))}</b><small>${RAR[i.rar][LANG === 'nl' ? 1 : 0]}</small>`;
  fx.style.left = (r.left + r.width / 2) + 'px'; fx.style.top = (r.top + r.height / 2) + 'px';
  document.body.appendChild(fx); setTimeout(() => fx.remove(), 1500);
}

/* item picker: search all items ("loot table") */
function openPicker(){
  const ov = invOverlay(`<div class="pk-h"><b>${L('ADD ITEMS', 'ITEMS TOEVOEGEN')}</b><span class="dim">${L('to', 'naar')} ${INV.boxes.find(b => b.id === INV_BOX).icon} ${esc(boxName(INV.boxes.find(b => b.id === INV_BOX)))}</span><button class="nbx" data-x>✕</button></div>
    <input class="inp" id="pkQ" placeholder="${L('Search 200+ items… (water, knife, radio)', 'Zoek in 200+ items… (water, mes, radio)')}" autocomplete="off">
    <div class="pk-cats" id="pkCats"></div><div class="pk-grid" id="pkGrid"></div>`, 'picker');
  let cat = '';
  const draw = () => {
    const q = $('#pkQ').value.trim().toLowerCase();
    $('#pkCats').innerHTML = `<button class="icat${!cat ? ' on' : ''}" data-c="">✦ ${L('All', 'Alles')}</button>` + INV_CATS.map(([c, e, en, nl]) => `<button class="icat${cat === c ? ' on' : ''}" data-c="${c}">${e} ${L(en, nl)}</button>`).join('');
    $$('#pkCats .icat').forEach(b => b.onclick = () => { cat = b.dataset.c; draw() });
    const list = Object.values(ITEM).filter(i => (!cat || i.cat === cat) && (!q || i.en.toLowerCase().includes(q) || i.nl.toLowerCase().includes(q) || i.id.includes(q)));
    $('#pkGrid').innerHTML = list.map(i => `<button class="pk r-${i.rar}" data-id="${i.id}"><span class="se">${i.e}</span><span class="pn">${esc(iname(i))}</span>
        <small>${[i.kcal ? i.kcal + ' kcal' : '', i.l ? i.l + ' L' : '', i.kg ? (i.kg < 1 ? Math.round(i.kg * 1000) + ' g' : i.kg + ' kg') : ''].filter(Boolean).join(' · ')}</small></button>`).join('') +
      (q ? `<button class="pk custom" id="pkCustom"><span class="se">📦</span><span class="pn">${L('Add', 'Voeg')} “${esc($('#pkQ').value.trim())}” ${L('as your own item', 'toe als eigen item')}</span></button>` : '');
    $$('#pkGrid .pk[data-id]').forEach(b => b.onclick = () => { addItem(b.dataset.id, 1, b); b.classList.add('got'); setTimeout(() => b.classList.remove('got'), 400) });
    $('#pkCustom') && ($('#pkCustom').onclick = () => { ov.remove(); customItem($('#pkQ')?.value || '') });
  };
  $('#pkQ').oninput = draw; draw(); setTimeout(() => $('#pkQ').focus(), 50);
}
function customItem(name){
  const ov = invOverlay(`<div class="pk-h"><b>${L('OWN ITEM', 'EIGEN ITEM')}</b><button class="nbx" data-x>✕</button></div>
    <div class="cform"><label>${L('Name', 'Naam')}<input class="inp" id="cuN" value="${esc(name)}"></label>
    <label>Emoji<input class="inp" id="cuE" value="📦" maxlength="4" style="width:80px;font-size:22px;text-align:center"></label>
    <label>${L('Category', 'Categorie')}<select class="inp" id="cuC">${INV_CATS.map(([c, e, en, nl]) => `<option value="${c}">${e} ${L(en, nl)}</option>`).join('')}</select></label>
    <label>${L('Weight per item (kg)', 'Gewicht per stuk (kg)')}<input class="inp" id="cuKg" type="number" step="0.01" value="0.1"></label>
    <label>kcal<input class="inp" id="cuK" type="number" value="0"></label><label>${L('Litres water', 'Liter water')}<input class="inp" id="cuL" type="number" step="0.1" value="0"></label>
    <label>${L('Shelf life (days, 0 = none)', 'Houdbaar (dagen, 0 = n.v.t.)')}<input class="inp" id="cuS" type="number" value="0"></label></div>
    <button class="btn pri" id="cuOk" style="width:100%;margin-top:12px">${L('ADD', 'TOEVOEGEN')}</button>`, 'small');
  $('#cuOk').onclick = () => {
    const c = {id:'x_' + uid(), e:$('#cuE').value.trim() || '📦', en:$('#cuN').value.trim() || 'Item', nl:$('#cuN').value.trim() || 'Item', cat:$('#cuC').value, rar:'c',
      kg:+$('#cuKg').value || 0, kcal:+$('#cuK').value || 0, l:+$('#cuL').value || 0, shelf:+$('#cuS').value || 0, find:'super', custom:1};
    INV.custom.push(c); ITEM[c.id] = c; ov.remove(); addItem(c.id, 1);
  };
}

/* item detail */
function openStack(s){
  const i = it(s.item), d = daysLeft(s), rar = RAR[i.rar];
  const ov = invOverlay(`<div class="det r-${i.rar}"><button class="nbx" data-x style="position:absolute;right:12px;top:10px">✕</button>
      <div class="det-top"><span class="det-e">${i.e}</span><div><b class="det-n">${esc(iname(i))}</b><div><span class="rtag" style="--rc:${rar[2]}">${rar[LANG === 'nl' ? 1 : 0]}</span>
        <span class="dim">${INV_CATS.find(c => c[0] === i.cat)?.[1] || ''} ${L(...(INV_CATS.find(c => c[0] === i.cat) || [0, 0, '', '']).slice(2))}</span></div></div></div>
      <div class="det-stats">${i.kcal ? `<span>🍽️ <b>${i.kcal}</b> kcal</span>` : ''}${i.l ? `<span>💧 <b>${i.l}</b> L</span>` : ''}<span>⚖️ <b>${i.kg < 1 ? Math.round(i.kg * 1000) + ' g' : i.kg + ' kg'}</b></span>${i.shelf ? `<span>⏳ <b>${i.shelf >= 365 ? Math.round(i.shelf / 365) + ' ' + L('yr', 'jr') : i.shelf + ' d'}</b></span>` : ''}</div>
      <div class="det-row"><span>${L('Amount', 'Aantal')}</span><div class="qty"><button data-q="-1">−</button><input id="dQ" type="number" min="0" value="${s.qty}"><button data-q="1">+</button></div></div>
      <div class="det-row"><span>${L('Best before', 'Houdbaar tot')}</span><input class="inp" id="dExp" type="date" value="${s.exp || ''}">${d !== null ? `<em class="${d < 0 ? 'bad' : d <= 30 ? 'soon' : ''}">${d < 0 ? L('expired', 'verlopen') : d + ' ' + L('days left', 'dagen over')}</em>` : ''}</div>
      <div class="det-row"><span>${L('Stored in', 'Opgeslagen in')}</span><select class="inp" id="dBox">${INV.boxes.map(b => `<option value="${b.id}"${b.id === s.box ? ' selected' : ''}>${b.icon} ${esc(boxName(b))}</option>`).join('')}</select></div>
      <div class="det-row"><span>${L('Note', 'Notitie')}</span><input class="inp" id="dNote" value="${esc(s.note || '')}" placeholder="${L('e.g. top shelf in basement', 'bijv. bovenste plank kelder')}"></div>
      <div class="det-act"><button class="btn" id="dUse">✋ ${L('Use 1', 'Gebruik 1')}</button><button class="btn" id="dFind">⌖ ${L('Where to find', 'Waar te vinden')}</button>
        <button class="btn" id="dRead">📖 ${L('Read about it', 'Lees erover')}</button><button class="btn ghost" id="dDel" style="color:#ff5470">${L('Delete', 'Verwijder')}</button></div></div>`, 'small');
  const commit = () => {
    s.qty = Math.max(0, parseInt($('#dQ').value) || 0); s.exp = $('#dExp').value; s.note = $('#dNote').value.trim();
    if(s.qty === 0) INV.stacks = INV.stacks.filter(x => x !== s);
    const nb = $('#dBox').value; invSave(); if(nb !== s.box && s.qty) moveStack(s, nb); else renderInv();
  };
  $$('.det [data-q]').forEach(b => b.onclick = () => { $('#dQ').value = Math.max(0, (parseInt($('#dQ').value) || 0) + +b.dataset.q); commit() });
  ['#dQ', '#dExp', '#dBox', '#dNote'].forEach(k => $(k).onchange = commit);
  $('#dUse').onclick = () => { $('#dQ').value = Math.max(0, s.qty - 1); commit(); if(!s.qty) ov.remove() };
  $('#dDel').onclick = () => { INV.stacks = INV.stacks.filter(x => x !== s); invSave(); renderInv(); ov.remove() };
  $('#dFind').onclick = () => { ov.remove(); findItem(s.item) };
  $('#dRead').onclick = () => { ov.remove(); location.hash = 'search/' + encodeURIComponent(i.en.replace(/\(.*?\)|\d.*$/g, '').trim()) };
}

/* where to find: hint + nearest places on the map */
function findItem(id){
  const i = it(id), f = INV_FIND[i.find] || INV_FIND.super;
  const ov = invOverlay(`<div class="pk-h"><b>⌖ ${L('WHERE TO FIND', 'WAAR TE VINDEN')}</b><button class="nbx" data-x>✕</button></div>
    <div class="fnd"><span class="det-e" style="font-size:44px">${i.e}</span><div><b>${esc(iname(i))}</b>
      <p>🏪 <b>${L('Shops', 'Winkels')}:</b> ${L(f[1], f[2])}</p><p>🔎 <b>${L('When searching', 'Bij het zoeken')}:</b> ${L(f[3], f[4])}</p></div></div>
    <button class="btn pri" id="fMap" style="width:100%;margin-top:10px">🗺️ ${L('SHOW NEAREST ON THE MAP', 'TOON DICHTSTBIJZIJNDE OP DE KAART')}</button>
    <button class="btn" id="fBox" style="width:100%;margin-top:8px">＋ ${L('I found it — add to', 'Gevonden — toevoegen aan')} ${INV.boxes.find(b => b.id === INV_BOX).icon}</button>`, 'small');
  $('#fMap').onclick = () => { ov.remove(); if(typeof findOnMap === 'function') findOnMap(f[0], i.e + ' ' + L(f[1], f[2]).split(',')[0]) };
  $('#fBox').onclick = () => { ov.remove(); addItem(id, 1) };
}

function editBox(b){
  const isNew = !b; b = b || {id:'b_' + uid(), type:'custom', icon:'📦', name:'', limit:0};
  const ov = invOverlay(`<div class="pk-h"><b>${isNew ? L('NEW STORAGE', 'NIEUWE OPSLAG') : L('EDIT STORAGE', 'OPSLAG BEWERKEN')}</b><button class="nbx" data-x>✕</button></div>
    <div class="cform"><label>${L('Name', 'Naam')}<input class="inp" id="bxN" value="${esc(b.name || (isNew ? '' : boxName(b)))}" placeholder="${L('e.g. Shed, Boat, Office', 'bijv. Schuur, Boot, Werk')}"></label>
    <label>Icon<div class="icons" id="bxI">${BOX_ICONS.map(e => `<button class="${e === b.icon ? 'on' : ''}">${e}</button>`).join('')}</div></label>
    <label>${L('Type (decides the recommended kit)', 'Soort (bepaalt het aanbevolen pakket)')}<select class="inp" id="bxT">${[['home', L('Home supply', 'Thuisvoorraad')], ['backpack', L('Backpack', 'Rugzak')], ['car', L('Car', 'Auto')], ['custom', L('Other', 'Anders')]].map(([v, n]) => `<option value="${v}"${b.type === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>${L('Max weight (kg, 0 = no limit)', 'Max. gewicht (kg, 0 = geen limiet)')}<input class="inp" id="bxL" type="number" value="${b.limit || 0}"></label></div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn pri" id="bxOk" style="flex:1">${L('SAVE', 'OPSLAAN')}</button>${!isNew && INV.boxes.length > 1 ? `<button class="btn ghost" id="bxDel" style="color:#ff5470">${L('Delete', 'Verwijder')}</button>` : ''}</div>`, 'small');
  let icon = b.icon;
  $$('#bxI button').forEach(x => x.onclick = e => { e.preventDefault(); icon = x.textContent; $$('#bxI button').forEach(y => y.classList.toggle('on', y === x)) });
  $('#bxOk').onclick = () => {
    Object.assign(b, {name:$('#bxN').value.trim(), icon, type:$('#bxT').value, limit:+$('#bxL').value || 0});
    if(isNew) INV.boxes.push(b);
    INV_BOX = b.id; store.set('nomad.invbox', INV_BOX); invSave(); renderInv(); ov.remove();
  };
  $('#bxDel') && ($('#bxDel').onclick = () => {
    const n = INV.stacks.filter(s => s.box === b.id).length;
    if(n && !confirm(L(`Delete this storage and its ${n} stack(s)?`, `Deze opslag en ${n} stapel(s) verwijderen?`))) return;
    INV.boxes = INV.boxes.filter(x => x !== b); INV.stacks = INV.stacks.filter(s => s.box !== b.id); INV_BOX = INV.boxes[0].id; invSave(); renderInv(); ov.remove();
  });
}

function invOverlay(html, cls){
  const ov = document.createElement('div'); ov.className = 'invov';
  ov.innerHTML = `<div class="invpan ${cls || ''}">${html}</div>`;
  ov.onclick = e => { if(e.target === ov || e.target.closest('[data-x]')) ov.remove() };
  document.addEventListener('keydown', function esc_(e){ if(e.key === 'Escape'){ ov.remove(); document.removeEventListener('keydown', esc_) } });
  document.body.appendChild(ov); return ov;
}

/* ───────── wiring ───────── */
$('#invQ').oninput = debounce(e => { INV_Q = e.target.value; renderInv() }, 120);
$('#invAddBtn').onclick = () => openPicker();
VIEWS.push('inv');
setView = (function(orig){ return function(v){ orig(v); if(v === 'inv'){ invLoad(); renderInv() } } })(setView);
if(location.hash.startsWith('#inv')) setTimeout(() => setView('inv'), 300);
