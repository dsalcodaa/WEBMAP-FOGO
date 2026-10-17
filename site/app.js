const CORES_CAT = ['#f2994a', '#3fbf7f', '#e5c547', '#8c96a3'];
const STATUS_CAR = { AT: 'Ativo', PE: 'Pendente', SU: 'Suspenso', CA: 'Cancelado' };
const TIPO_CAR = { IRU: 'Imóvel rural', AST: 'Assentamento', PCT: 'Povos e comunidades tradicionais' };
const DIA_MS = 86400000;

const BASES = {
  escuro: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Base © Esri, HERE, Garmin, © OpenStreetMap',
    maxzoom: 16,
  },
  satelite: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imagens © Esri, Maxar, Earthstar Geographics',
  },
};

const $ = sel => document.querySelector(sel);
const fmt = n => n.toLocaleString('pt-BR');
const fmtHa = n => `${fmt(Math.round(n))} ha`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const estado = { de: 0, ate: 365, sat: -1, mun: -1, cats: new Set([0, 1, 2, 3]) };
let F, geo = {}, map, graficos = {};

async function carregar() {
  const nomes = ['focos.json', 'meta.json', 'car.geojson', 'uc.geojson', 'ti.geojson', 'eventos.geojson', 'municipios.geojson'];
  const [focos, meta, car, uc, ti, eventos, mun] = await Promise.all(
    nomes.map(n => fetch(`data/${n}`).then(r => { if (!r.ok) throw new Error(n); return r.json(); })));
  F = focos;
  geo = { car, uc, ti, eventos, mun, meta };
  F.n = F.lat.length;
  F.dia0 = Date.UTC(F.ano, 0, 1);
  F.ultimoDia = F.dia.reduce((a, b) => Math.max(a, b), 0);
}

const diaParaData = d => new Date(F.dia0 + d * DIA_MS).toISOString().slice(0, 10);
const dataParaDia = s => Math.round((Date.parse(s) - F.dia0) / DIA_MS);

// ---------------------------------------------------------------- filtros

function montarFiltros() {
  const de = $('#f-de'), ate = $('#f-ate');
  de.min = ate.min = diaParaData(0);
  de.max = ate.max = diaParaData(F.ultimoDia);
  aplicarAtalho(30);

  F.satelites.forEach((s, i) => $('#f-sat').add(new Option(s, i)));
  F.municipios.forEach((m, i) => $('#f-mun').add(new Option(m, i)));
  F.categorias.forEach((c, i) => {
    $('#f-cat').insertAdjacentHTML('beforeend',
      `<label><input type="checkbox" value="${i}" checked><span class="bolinha" style="background:${CORES_CAT[i]}"></span>${c}</label>`);
  });

  de.onchange = ate.onchange = () => { estado.de = dataParaDia(de.value); estado.ate = dataParaDia(ate.value); atualizar(); };
  $('#f-sat').onchange = e => { estado.sat = +e.target.value; atualizar(); };
  $('#f-mun').onchange = e => { estado.mun = +e.target.value; atualizar(); zoomMunicipio(estado.mun); };
  $('#f-cat').onchange = () => {
    estado.cats = new Set([...document.querySelectorAll('#f-cat input:checked')].map(i => +i.value));
    atualizar();
  };
  document.querySelectorAll('.atalhos button').forEach(b => b.onclick = () => { aplicarAtalho(+b.dataset.dias); atualizar(); });
}

function aplicarAtalho(dias) {
  estado.ate = F.ultimoDia;
  estado.de = dias ? Math.max(0, F.ultimoDia - dias + 1) : 0;
  $('#f-de').value = diaParaData(estado.de);
  $('#f-ate').value = diaParaData(estado.ate);
}

function passa(i) {
  const d = F.dia[i];
  return d >= estado.de && d <= estado.ate
    && (estado.sat < 0 || F.sat[i] === estado.sat)
    && (estado.mun < 0 || F.mun[i] === estado.mun)
    && estado.cats.has(F.cat[i]);
}

function filtroMapa() {
  const f = ['all', ['>=', ['get', 'd'], estado.de], ['<=', ['get', 'd'], estado.ate],
    ['in', ['get', 'c'], ['literal', [...estado.cats]]]];
  if (estado.sat >= 0) f.push(['==', ['get', 's'], estado.sat]);
  if (estado.mun >= 0) f.push(['==', ['get', 'm'], estado.mun]);
  return f;
}

// ---------------------------------------------------------------- agregação

function agregar() {
  const nDias = estado.ate - estado.de + 1;
  const porDia = F.categorias.map(() => new Array(nDias).fill(0));
  const porCat = new Array(F.categorias.length).fill(0);
  const porMun = new Map(), porCar = new Map(), porUc = new Map(), porTi = new Map();
  let total = 0;
  const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (let i = 0; i < F.n; i++) {
    if (!passa(i)) continue;
    total++;
    const c = F.cat[i];
    porDia[c][F.dia[i] - estado.de]++;
    porCat[c]++;
    if (F.mun[i] >= 0) inc(porMun, F.mun[i]);
    if (F.car[i] >= 0) inc(porCar, F.car[i]);
    if (F.uc[i] >= 0) inc(porUc, F.uc[i]);
    if (F.ti[i] >= 0) inc(porTi, F.ti[i]);
  }
  return { total, porDia, porCat, porMun, porCar, porUc, porTi, nDias };
}

const maiores = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const indexar = fc => new Map(fc.features.map(f => [f.properties.i, f]));

// ---------------------------------------------------------------- dashboard

function kpis(a) {
  const pct = n => a.total ? `${Math.round(100 * n / a.total)}%` : '–';
  const ativos = geo.eventos.features.filter(f => f.properties.status_evento === 'Ativo').length;
  const itens = [
    [fmt(a.total), 'focos no filtro'],
    [pct(a.porCat[2]), 'em imóveis CAR'],
    [pct(a.porCat[3]), 'sem cadastro'],
    [pct(a.porCat[1]), 'em UCs'],
    [pct(a.porCat[0]), 'em TIs'],
    [fmt(a.porCar.size), 'imóveis CAR atingidos'],
    [fmt(a.porUc.size), 'UCs atingidas'],
    [fmt(a.porTi.size), 'TIs atingidas'],
    [fmt(ativos), 'eventos SIPAM ativos'],
  ];
  $('#kpis').innerHTML = itens.map(([v, r]) => `<div class="kpi"><b>${v}</b><span>${r}</span></div>`).join('');
}

Chart.defaults.color = '#9aa3ae';
Chart.defaults.borderColor = '#2b323c';
Chart.defaults.font.family = 'system-ui, sans-serif';

function graficosAtualizar(a) {
  const rotulos = Array.from({ length: a.nDias }, (_, k) => diaParaData(estado.de + k).slice(5).split('-').reverse().join('/'));
  const dsDia = F.categorias.map((c, i) => ({ label: c, data: a.porDia[i], backgroundColor: CORES_CAT[i], stack: 's' }));
  const munTop = maiores(a.porMun, 12);

  if (!graficos.dia) {
    graficos.dia = new Chart($('#g-dia'), {
      type: 'bar',
      data: { labels: rotulos, datasets: dsDia },
      options: {
        maintainAspectRatio: false, animation: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
        scales: { x: { stacked: true, ticks: { maxTicksLimit: 10 } }, y: { stacked: true } },
      },
    });
    graficos.cat = new Chart($('#g-cat'), {
      type: 'doughnut',
      data: { labels: F.categorias, datasets: [{ data: a.porCat, backgroundColor: CORES_CAT, borderWidth: 0 }] },
      options: { maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10 } } } },
    });
    graficos.mun = new Chart($('#g-mun'), {
      type: 'bar',
      data: { labels: [], datasets: [{ data: [], backgroundColor: '#ff6b2c' }] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } },
        onClick: (_, el) => { if (el.length) selecionarMunicipio(graficos.mun.$ids[el[0].index]); },
      },
    });
  }
  graficos.dia.data.labels = rotulos;
  graficos.dia.data.datasets = dsDia;
  graficos.dia.update();
  graficos.cat.data.datasets[0].data = a.porCat;
  graficos.cat.update();
  graficos.mun.$ids = munTop.map(([m]) => m);
  graficos.mun.data.labels = munTop.map(([m]) => F.municipios[m]);
  graficos.mun.data.datasets[0].data = munTop.map(([, n]) => n);
  graficos.mun.update();
}

function tabelas(a) {
  const car = indexar(geo.car), uc = indexar(geo.uc), ti = indexar(geo.ti);

  $('#t-car').innerHTML = '<tr><th>Imóvel</th><th>Município</th><th class="n">Focos</th></tr>' +
    maiores(a.porCar, 15).map(([i, n]) => {
      const p = car.get(i)?.properties || {};
      return `<tr data-zoom="car:${i}"><td><span class="cod">${esc(p.cod)}</span><br>${esc(TIPO_CAR[p.tipo_imovel] || p.tipo_imovel)} · ${esc(STATUS_CAR[p.status] || p.status)} · ${fmtHa(p.area_ha || 0)}</td><td>${esc(p.municipio)}</td><td class="n">${fmt(n)}</td></tr>`;
    }).join('');

  $('#t-uc').innerHTML = '<tr><th>Unidade</th><th>Esfera</th><th class="n">Focos</th></tr>' +
    maiores(a.porUc, 10).map(([i, n]) => {
      const p = uc.get(i)?.properties || {};
      return `<tr data-zoom="uc:${i}"><td>${esc(p.nome)}</td><td>${esc(p.esfera)}</td><td class="n">${fmt(n)}</td></tr>`;
    }).join('');

  $('#t-ti').innerHTML = '<tr><th>Terra indígena</th><th>Etnia</th><th class="n">Focos</th></tr>' +
    maiores(a.porTi, 10).map(([i, n]) => {
      const p = ti.get(i)?.properties || {};
      return `<tr data-zoom="ti:${i}"><td>${esc(p.nome)}</td><td>${esc(p.etnia)}</td><td class="n">${fmt(n)}</td></tr>`;
    }).join('');
}

function tabelaEventos() {
  const evs = geo.eventos.features
    .filter(f => f.properties.n_car > 0)
    .sort((a, b) => b.properties.area_car_ha - a.properties.area_car_ha)
    .slice(0, 10);
  $('#t-ev').innerHTML = '<tr><th>Evento</th><th>Município</th><th class="n">Imóveis</th><th class="n">Área em CAR</th></tr>' +
    evs.map(f => {
      const p = f.properties;
      return `<tr data-zoom="eventos:${p.id_evento}"><td>#${p.id_evento}<br>${esc(p.status_evento)} · ${p.persistencia_dias} dias</td><td>${esc(p.municipio)}</td><td class="n">${p.n_car}</td><td class="n">${fmtHa(p.area_car_ha)}</td></tr>`;
    }).join('');
}

document.addEventListener('click', e => {
  const tr = e.target.closest('tr[data-zoom]');
  if (!tr) return;
  const [camada, id] = tr.dataset.zoom.split(':');
  const chave = camada === 'eventos' ? 'id_evento' : 'i';
  const f = geo[camada].features.find(f => String(f.properties[chave]) === id);
  if (f) zoomFeicao(f);
});

// ---------------------------------------------------------------- mapa

function bbox(geom) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = c => typeof c[0] === 'number'
    ? (b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])])
    : c.forEach(visit);
  visit(geom.coordinates);
  return [[b[0], b[1]], [b[2], b[3]]];
}

function zoomFeicao(f) {
  map.fitBounds(bbox(f.geometry), { padding: 60, maxZoom: 14 });
}

function zoomMunicipio(i) {
  if (i < 0) return map.fitBounds(bbox({ coordinates: geo.mun.features.map(f => f.geometry.coordinates) }), { padding: 20 });
  const f = geo.mun.features.find(f => f.properties.i === i);
  if (f) zoomFeicao(f);
}

function selecionarMunicipio(i) {
  estado.mun = i;
  $('#f-mun').value = i;
  atualizar();
  zoomMunicipio(i);
}

function focosGeoJSON() {
  const features = new Array(F.n);
  for (let i = 0; i < F.n; i++) {
    features[i] = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [F.lon[i], F.lat[i]] },
      properties: { k: i, d: F.dia[i], s: F.sat[i], m: F.mun[i], c: F.cat[i], f: F.frp[i] },
    };
  }
  return { type: 'FeatureCollection', features };
}

function estiloBase(nome) {
  return {
    version: 8,
    sources: { base: { type: 'raster', tileSize: 256, ...BASES[nome] } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

function iniciarMapa() {
  map = new maplibregl.Map({
    container: 'mapa',
    style: estiloBase('escuro'),
    center: [-63.5, -4.5],
    zoom: 5,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

  map.on('load', () => {
    map.addSource('mun', { type: 'geojson', data: geo.mun, promoteId: 'i' });
    map.addSource('uc', { type: 'geojson', data: geo.uc, promoteId: 'i' });
    map.addSource('ti', { type: 'geojson', data: geo.ti, promoteId: 'i' });
    map.addSource('car', { type: 'geojson', data: geo.car, promoteId: 'i' });
    map.addSource('eventos', { type: 'geojson', data: geo.eventos, promoteId: 'id_evento' });
    map.addSource('focos', { type: 'geojson', data: focosGeoJSON() });

    const n = ['coalesce', ['feature-state', 'n'], 0];
    map.addLayer({
      id: 'mun-fill', type: 'fill', source: 'mun', layout: { visibility: 'none' },
      paint: {
        'fill-color': ['interpolate', ['linear'], n, 0, '#1d232b', 50, '#5a2a1a', 500, '#b3401a', 3000, '#ff6b2c'],
        'fill-opacity': 0.75,
      },
    });
    map.addLayer({ id: 'mun-line', type: 'line', source: 'mun', paint: { 'line-color': '#4a5563', 'line-width': 0.6 } });
    map.addLayer({ id: 'uc-fill', type: 'fill', source: 'uc', paint: { 'fill-color': '#3fbf7f', 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'uc-line', type: 'line', source: 'uc', paint: { 'line-color': '#3fbf7f', 'line-width': 1.2 } });
    map.addLayer({ id: 'ti-fill', type: 'fill', source: 'ti', paint: { 'fill-color': '#f2994a', 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'ti-line', type: 'line', source: 'ti', paint: { 'line-color': '#f2994a', 'line-width': 1.2, 'line-dasharray': [3, 1] } });
    map.addLayer({
      id: 'car-fill', type: 'fill', source: 'car', minzoom: 7,
      paint: {
        'fill-color': ['interpolate', ['linear'], n, 0, '#6b5d1f', 5, '#e5c547', 30, '#ff8a2c'],
        'fill-opacity': ['case', ['>', n, 0], 0.35, 0.12],
      },
    });
    map.addLayer({ id: 'car-line', type: 'line', source: 'car', minzoom: 7, paint: { 'line-color': '#e5c547', 'line-width': 0.7 } });
    map.addLayer({ id: 'eventos-fill', type: 'fill', source: 'eventos', paint: { 'fill-color': '#ff3b3b', 'fill-opacity': 0.35 } });
    map.addLayer({ id: 'eventos-line', type: 'line', source: 'eventos', paint: { 'line-color': '#ff3b3b', 'line-width': 1.2 } });
    map.addLayer({
      id: 'focos-heat', type: 'heatmap', source: 'focos', maxzoom: 9,
      paint: {
        'heatmap-weight': 0.15,
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 10],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 9, 1],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.9, 9, 0],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)', 0.2, '#5a1a0a', 0.45, '#b3261e', 0.7, '#ff6b2c', 1, '#ffe08a'],
      },
    });
    map.addLayer({
      id: 'focos-pt', type: 'circle', source: 'focos', minzoom: 7,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2, 12, 5],
        'circle-color': ['match', ['get', 'c'], 0, CORES_CAT[0], 1, CORES_CAT[1], 2, CORES_CAT[2], CORES_CAT[3]],
        'circle-stroke-color': '#000', 'circle-stroke-width': 0.5,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 8, 1],
      },
    });

    popups();
    atualizar();
    zoomMunicipio(-1);
  });

  const grupos = {
    focos: ['focos-heat', 'focos-pt'], eventos: ['eventos-fill', 'eventos-line'], car: ['car-fill', 'car-line'],
    uc: ['uc-fill', 'uc-line'], ti: ['ti-fill', 'ti-line'], mun: ['mun-fill'],
  };
  document.querySelectorAll('[data-camada]').forEach(cb => cb.onchange = () =>
    grupos[cb.dataset.camada].forEach(id => map.setLayoutProperty(id, 'visibility', cb.checked ? 'visible' : 'none')));

  document.querySelectorAll('input[name=base]').forEach(r => r.onchange = () => {
    map.removeLayer('base');
    map.removeSource('base');
    map.addSource('base', { type: 'raster', tileSize: 256, ...BASES[r.value] });
    map.addLayer({ id: 'base', type: 'raster', source: 'base' }, 'mun-fill');
  });

  $('#legenda').innerHTML = '<span>Focos INPE:</span>' + F.categorias.map((c, i) =>
    `<span><span class="bolinha" style="background:${CORES_CAT[i]}"></span> ${c}</span>`).join('') +
    '<span><span class="bolinha" style="background:#ff3b3b;border-radius:2px"></span> Evento SIPAM (área queimando)</span>';
}

function popups() {
  const popup = (e, html) => new maplibregl.Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  const dl = pares => `<dl>${pares.filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const nFocos = (src, id) => map.getFeatureState({ source: src, id })?.n || 0;

  // a ordem importa: o clique mostra só a camada mais específica sob o cursor
  const ordem = ['focos-pt', 'eventos-fill', 'car-fill', 'ti-fill', 'uc-fill', 'mun-fill'];
  map.on('click', e => {
    const visiveis = ordem.filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    const [f] = map.queryRenderedFeatures(e.point, { layers: visiveis });
    if (!f) return;
    const p = f.properties;
    const camada = f.layer.id;
    if (camada === 'focos-pt') {
      const i = p.k;
      const car = F.car[i] >= 0 ? geo.car.features.find(x => x.properties.i === F.car[i])?.properties.cod : null;
      const uc = F.uc[i] >= 0 ? geo.uc.features.find(x => x.properties.i === F.uc[i])?.properties.nome : null;
      const ti = F.ti[i] >= 0 ? geo.ti.features.find(x => x.properties.i === F.ti[i])?.properties.nome : null;
      popup(e, `<h3>Foco de calor</h3>` + dl([
        ['Data', diaParaData(F.dia[i]).split('-').reverse().join('/')], ['Satélite', F.satelites[F.sat[i]]],
        ['Município', F.municipios[F.mun[i]]], ['FRP', `${F.frp[i]} MW`], ['Situação', F.categorias[F.cat[i]]],
        ['Imóvel CAR', car], ['UC', uc], ['TI', ti],
      ]));
    } else if (camada === 'eventos-fill') {
      popup(e, `<h3>Evento de fogo SIPAM #${p.id_evento}</h3>` + dl([
        ['Status', p.status_evento], ['Início', p.dt_minima?.slice(0, 10)], ['Última detecção', p.dt_maxima?.slice(0, 10)],
        ['Persistência', `${p.persistencia_dias} dias`], ['Área', fmtHa(p.area_ha)], ['Município', p.municipio],
        ['Domínio', p.dominio], ['Imóveis CAR atingidos', p.n_car], ['Área dentro de CAR', fmtHa(p.area_car_ha)],
        ['TI', p.terra_indigena], ['UC', p.unidade_conservacao], ['Assentamento', p.projeto_assentamento],
      ]));
    } else if (camada === 'car-fill') {
      popup(e, `<h3>Imóvel CAR</h3><div class="cod">${esc(p.cod)}</div>` + dl([
        ['Tipo', TIPO_CAR[p.tipo_imovel] || p.tipo_imovel], ['Status', STATUS_CAR[p.status] || p.status],
        ['Condição', p.condicao], ['Município', p.municipio], ['Área', fmtHa(p.area_ha)],
        ['Focos (filtro)', nFocos('car', p.i)], ['Eventos SIPAM', p.n_eventos], ['Área em evento SIPAM', fmtHa(p.area_evento_ha)],
      ]) + `<p><a href="https://consultapublica.car.gov.br/publico/imoveis/index" target="_blank" rel="noopener">Consulta pública do CAR</a></p>`);
    } else if (camada === 'ti-fill') {
      popup(e, `<h3>TI ${esc(p.nome)}</h3>` + dl([
        ['Etnia', p.etnia], ['Fase', p.fase], ['Modalidade', p.modalidade_ti], ['Área', fmtHa(p.area_ha)], ['Focos (filtro)', nFocos('ti', p.i)],
      ]));
    } else if (camada === 'uc-fill') {
      popup(e, `<h3>${esc(p.nome)}</h3>` + dl([
        ['Categoria', p.categoria], ['Grupo', p.grupo], ['Esfera', p.esfera], ['Gestor', p.org_gestor],
        ['Área', fmtHa(p.area_ha)], ['Focos (filtro)', nFocos('uc', p.i)],
      ]));
    } else if (camada === 'mun-fill') {
      popup(e, `<h3>${esc(p.nome)}</h3>` + dl([['Focos (filtro)', nFocos('mun', p.i)]]));
    }
  });
  ordem.forEach(id => {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  });
}

function estadoMapa(a) {
  const aplicar = (src, contagem) => {
    map.removeFeatureState({ source: src });
    contagem.forEach((n, id) => map.setFeatureState({ source: src, id }, { n }));
  };
  aplicar('car', a.porCar);
  aplicar('uc', a.porUc);
  aplicar('ti', a.porTi);
  aplicar('mun', a.porMun);
  const filtro = filtroMapa();
  map.setFilter('focos-heat', filtro);
  map.setFilter('focos-pt', filtro);
}

// ---------------------------------------------------------------- ciclo

function atualizar() {
  const a = agregar();
  kpis(a);
  graficosAtualizar(a);
  tabelas(a);
  if (map?.isStyleLoaded() && map.getSource('focos')) estadoMapa(a);
}

carregar().then(() => {
  const m = geo.meta;
  $('#atualizado').textContent = `Dados de ${m.ano} · atualizado em ${new Date(m.atualizado_em).toLocaleString('pt-BR')}`;
  $('#fontes').innerHTML = '<strong>Fontes</strong><br>' + Object.values(m.fontes).map(esc).join('<br>') +
    '<br><br>Classificação do foco: TI &gt; UC &gt; imóvel CAR &gt; sem cadastro. Imóveis CAR sobrepostos: o foco é atribuído ao menor polígono. ' +
    'O CAR é autodeclaratório e não comprova propriedade.';
  montarFiltros();
  tabelaEventos();
  iniciarMapa();
  atualizar();
}).catch(err => {
  $('#atualizado').textContent = `Erro ao carregar dados: ${err.message}. Rode pipeline/build.py.`;
  console.error(err);
});
