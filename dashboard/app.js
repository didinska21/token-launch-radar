// Pre-Token Radar dashboard: renders window.RADAR (written by main.ts beside this page),
// with search, category / chain / TVL filters, five sort orders, a watchlist toggle and a
// per-protocol detail panel. Hash state (#detail=<slug>, #category=<name>, #watch=1)
// makes every view linkable — and screenshot-able — exactly as a reader would see it.

const R = window.RADAR;
const rows = R.rows;
const $ = (id) => document.getElementById(id);

const fmt$ = (x) => (x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x).toLocaleString('en-US')}`);
const fmtPct = (x) => (x === null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(1)}%`);
const fmtAge = (d) => (d === null ? '—' : d >= 365 ? `${(d / 365).toFixed(1)}y` : `${d}d`);

const state = { q: '', category: '', chain: '', mintvl: 0, sort: 'rank', watch: false, selected: null };

// Hash state first, so a shared or screenshotted link opens on the same view.
for (const part of location.hash.replace(/^#/, '').split('&')) {
  const [k, v] = part.split('=');
  if (!v) continue;
  const val = decodeURIComponent(v);
  if (k === 'detail') state.selected = val;
  if (k === 'category') state.category = val;
  if (k === 'chain') state.chain = val;
  if (k === 'q') state.q = val;
  if (k === 'watch') state.watch = val === '1';
  if (k === 'sort') state.sort = val;
}

function fillSelect(el, values) {
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    el.appendChild(o);
  }
}
fillSelect($('category'), [...new Set(rows.map((r) => r.category).filter(Boolean))].sort());
fillSelect($('chain'), [...new Set(rows.flatMap((r) => r.chains))].sort());
$('category').value = state.category; $('chain').value = state.chain;
$('q').value = state.q; $('sort').value = state.sort; $('watchonly').checked = state.watch;

$('chips').innerHTML = [
  `<span class="chip">Snapshot <b>${R.as_of}</b></span>`,
  `<span class="chip"><b>${rows.length}</b> pre-token protocols ranked</span>`,
  `<span class="chip"><b>${rows.filter((r) => r.on_watchlist).length}</b> watchlist · floor ${fmt$(R.floor_usd)}</span>`,
  `<span class="chip"><b>${R.live_size}</b> live tokens set aside</span>`,
].join('');

const presentCats = new Set(rows.map((r) => r.category));
const topCats = R.model.categories.filter((c) => presentCats.has(c.category)).slice(0, 8).map((c) => `${c.category} <b>${c.used.toFixed(2)}x</b>`).join(' · ');
$('modelstrip').innerHTML =
  `<div class="formula">Implied value = TVL × category multiple × momentum × maturity × breadth</div>` +
  `<p>${R.model.summary} Global median multiple in this snapshot: <b>${R.model.global_median.toFixed(3)}x</b>. Board floor: TVL ≥ ${fmt$(R.model.min_tvl_usd)} with no token recorded.</p>` +
  `<div class="cats">Category multiples in use: ${topCats}</div>`;

$('livegrid').innerHTML = R.live.map((l) =>
  `<div class="live"><b>${l.name}${l.symbol ? ` · ${l.symbol}` : ''}</b><span>${l.category ?? 'Uncategorised'} · mcap ${fmt$(l.mcap_usd)} · TVL ${fmt$(l.tvl_usd)}</span></div>`).join('');

function visible() {
  let out = rows.filter((r) =>
    (!state.watch || r.on_watchlist) &&
    (!state.category || r.category === state.category) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    r.tvl_usd >= state.mintvl &&
    (!state.q || r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q)));
  const by = {
    rank: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    readiness: (a, b) => b.readiness - a.readiness,
  }[state.sort];
  return out.sort(by);
}

function render() {
  const vis = visible();
  $('count').textContent = `${vis.length} of ${rows.length} protocols shown`;
  $('empty').hidden = vis.length > 0;
  $('rows').innerHTML = vis.map((r) => `
    <tr data-slug="${r.slug}" class="${r.slug === state.selected ? 'sel' : ''}">
      <td class="n">${r.rank}</td>
      <td><span class="pname">${r.name}</span>${r.on_watchlist ? ' <span class="star" title="On the house watchlist">★</span>' : ''}<br><span class="slug">${r.slug}</span></td>
      <td class="cat">${r.category ?? '—'}</td>
      <td class="n">${fmt$(r.tvl_usd)}</td>
      <td class="n ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${fmtPct(r.change_7d)}</td>
      <td class="n">${fmtAge(r.age_days)}</td>
      <td class="n impl">${fmt$(r.implied_value_usd)}</td>
      <td class="n">${(r.implied_value_usd / r.tvl_usd).toFixed(2)}x</td>
      <td><span class="bar"><i style="width:${r.readiness}%"></i></span><span class="ready">${r.readiness}</span></td>
    </tr>`).join('');
  for (const tr of $('rows').children) {
    tr.addEventListener('click', () => { state.selected = tr.dataset.slug; render(); });
  }
  renderDetail();
}

function renderDetail() {
  const r = rows.find((x) => x.slug === state.selected) ?? rows[0];
  if (!r) { $('detail').innerHTML = ''; return; }
  state.selected = r.slug;
  $('detail').innerHTML = `
    <h2>${r.name}</h2>
    <div class="badges">
      <span class="badge rank">Rank #${r.rank} of ${rows.length}</span>
      ${r.on_watchlist ? '<span class="badge watch">★ House watchlist</span>' : '<span class="badge">Early find — below the $50M floor</span>'}
      <span class="badge">${r.category ?? 'Uncategorised'}</span>
    </div>
    <div class="stats">
      <div class="stat"><small>Implied value</small><b>${fmt$(r.implied_value_usd)}</b></div>
      <div class="stat"><small>TVL</small><b>${fmt$(r.tvl_usd)}</b></div>
      <div class="stat"><small>7d TVL change</small><b>${fmtPct(r.change_7d)}</b></div>
      <div class="stat"><small>Tracked, no token</small><b>${r.listed_at ? `${fmtAge(r.age_days)} (since ${r.listed_at})` : 'date unreported'}</b></div>
    </div>
    <div class="factors">
      How the value is built: ${fmt$(r.tvl_usd)} TVL × <b>${r.multiple.toFixed(2)}x</b> category multiple
      × <b>${r.momentum.toFixed(2)}</b> momentum × <b>${r.maturity.toFixed(2)}</b> maturity
      × <b>${r.breadth.toFixed(2)}</b> breadth = <b>${fmt$(r.implied_value_usd)}</b>.
      Readiness ${r.readiness}/100 blends size, momentum and track record.
      <div class="chainchips">${r.chains.map((c) => `<span>${c}</span>`).join('')}</div>
    </div>
    <h3>Farm plan — before any token</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${s}</li>`).join('')}</ol>`;
}

for (const [id, key, parse] of [['q', 'q', (v) => v.toLowerCase()], ['category', 'category', (v) => v], ['chain', 'chain', (v) => v], ['sort', 'sort', (v) => v]]) {
  $(id).addEventListener('input', (e) => { state[key] = parse(e.target.value); render(); });
}
$('mintvl').addEventListener('input', (e) => { state.mintvl = Number(e.target.value); render(); });
$('watchonly').addEventListener('change', (e) => { state.watch = e.target.checked; render(); });

render();
