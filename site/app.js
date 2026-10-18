let D, estado, map, mapaPronto = false;
const graficos = {};

let P = { ...PARAMS_PADRAO };
try { Object.assign(P, JSON.parse(localStorage.getItem('params') || '{}')); } catch { /* sem storage */ }

// ---------------------------------------------------------------- filtros

function montarFiltros() {
  const F = D.F, de = $('#f-de'), ate = $('#f-ate');
  de.min = ate.min = diaParaData(D, 0);
  de.max = ate.max = diaParaData(D, F.ultimo_dia);
  sincronizarDatas();

  F.municipios.forEach((m, i) => $('#f-mun').add(new Option(m, i)));
  Object.entries(METODOS).forEach(([k, m]) => $('#f-metodo').add(new Option(m.nome, k)));
  $('#f-cat').innerHTML = F.categorias.map((c, i) =>
    `<label class="chip"><input type="checkbox" value="${i}" checked><span class="bolinha" style="background:${CORES_CAT[i]}"></span>${c}</label>`).join('');

  de.onchange = ate.onchange = () => {
    estado.de = Math.max(0, dataParaDia(D, de.value));
    estado.ate = Math.min(F.ultimo_dia, Math.max(estado.de, dataParaDia(D, ate.value)));
    sincronizarDatas();
    atualizar();
  };
  document.querySelectorAll('.atalhos button').forEach(b => b.onclick = () => {
    const dias = +b.dataset.dias;
    estado.ate = F.ultimo_dia;
    estado.de = dias ? Math.max(0, F.ultimo_dia - dias + 1) : 0;
    sincronizarDatas();
    atualizar();
  });
  $('#f-mun').onchange = e => selecionarMunicipio(+e.target.value);
  $('#f-metodo').onchange = e => { estado.metodo = e.target.value; atualizar(); };
  $('#f-cat').onchange = () => {
    estado.cats = new Set([...document.querySelectorAll('#f-cat input:checked')].map(i => +i.value));
    atualizar();
  };
  document.querySelectorAll('[data-ajuda]').forEach(b => b.onclick = () => ajuda(b.dataset.ajuda));
}

function sincronizarDatas() {
  $('#f-de').value = diaParaData(D, estado.de);
  $('#f-ate').value = diaParaData(D, estado.ate);
  document.querySelectorAll('.atalhos button').forEach(b => {
    const dias = +b.dataset.dias;
    const ok = estado.ate === D.F.ultimo_dia && (dias ? estado.de === Math.max(0, D.F.ultimo_dia - dias + 1) : estado.de === 0);
    b.classList.toggle('ativo', ok);
  });
}

function selecionarMunicipio(m) {
  estado.mun = m;
  $('#f-mun').value = m;
  atualizar();
  if (mapaPronto) zoomMunicipio(m);
}

function ajuda(tema) {
  if (tema === 'metodo') {
    $('#dlg-texto').innerHTML = '<h3>Como contar os focos</h3>' + Object.values(METODOS)
      .map(m => `<p><b>${m.nome}</b><br>${m.desc}</p>`).join('') +
      '<p>Veja a aba <b>Metodologia</b> para os detalhes.</p>';
  }
  $('#dlg-ajuda').showModal();
}

// ---------------------------------------------------------------- abas

function mostrarAba(nome) {
  if (!document.getElementById(`aba-${nome}`)) nome = 'painel';
  document.querySelectorAll('.aba').forEach(s => { s.hidden = s.id !== `aba-${nome}`; });
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === nome));
  document.body.dataset.aba = nome;
  if (nome === 'mapa') {
    if (!map) iniciarMapa();
    else map.resize();
  }
  if (location.hash !== `#${nome}`) history.replaceState(null, '', `#${nome}`);
}

function irParaMapa(f) {
  mostrarAba('mapa');
  const zoom = () => map.fitBounds(bboxGeom(f.geometry), { padding: 60, maxZoom: 13 });
  mapaPronto ? zoom() : map.once('load', () => setTimeout(zoom, 100));
}

// ---------------------------------------------------------------- relatórios

function abrirRelatorio(mun) {
  const q = new URLSearchParams({
    mun, de: diaParaData(D, estado.de), ate: diaParaData(D, estado.ate),
    metodo: estado.metodo, cats: [...estado.cats].join(''),
  });
  window.open(`relatorio.html?${q}`, '_blank', 'noopener');
}

// ---------------------------------------------------------------- visão geral

function kpis(a, t) {
  const pct = n => a.total ? `${Math.round(100 * n / a.total)}%` : '–';
  const evs = eventosDoFiltro(D, estado);
  const ativos = evs.filter(p => p.status_evento === 'Ativo').length;
  const criticos = evs.filter(p => p.classe === 'Crítica').length;
  const itens = [
    [fmt(a.total), METODOS[estado.metodo].curto, `${fmtVar(variacao(t.atual, t.anterior))} 7 dias`],
    [pct(a.porCat[2]), 'em imóveis do CAR', `${fmt(a.porCar.size)} imóveis atingidos`],
    [pct(a.porCat[3]), 'em áreas sem cadastro', ''],
    [pct(a.porCat[1] + a.porCat[0]), 'em áreas protegidas', `${a.porUc.size} UCs · ${a.porTi.size} TIs`],
    [fmt(ativos), 'eventos de fogo ativos', 'agora, segundo o SIPAM'],
    [fmt(criticos), 'eventos de prioridade crítica', '<a href="#mobilizacao" data-aba-link="mobilizacao">ver mobilização</a>'],
  ];
  return itens.map(([v, r, s]) => `<div class="kpi"><b>${v}</b><span>${r}</span><small>${s}</small></div>`).join('');
}

Chart.defaults.color = '#9aa3ae';
Chart.defaults.borderColor = '#2b323c';
Chart.defaults.font.family = 'system-ui, sans-serif';

function graficosAtualizar(a) {
  const rotulos = Array.from({ length: a.nDias }, (_, k) => dataBR(D, estado.de + k).slice(0, 5));
  const dsDia = D.F.categorias.map((c, i) => ({ label: c, data: a.porDia[i], backgroundColor: CORES_CAT[i], stack: 's' }));
  const munTop = maiores(a.porMun, 12);

  if (!graficos.dia) {
    graficos.dia = new Chart($('#g-dia'), {
      type: 'bar', data: { labels: rotulos, datasets: dsDia },
      options: {
        maintainAspectRatio: false, animation: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
        scales: { x: { stacked: true, ticks: { maxTicksLimit: 12 } }, y: { stacked: true } },
      },
    });
    graficos.cat = new Chart($('#g-cat'), {
      type: 'doughnut',
      data: { labels: D.F.categorias, datasets: [{ data: a.porCat, backgroundColor: CORES_CAT, borderWidth: 0 }] },
      options: { maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } },
    });
    graficos.mun = new Chart($('#g-mun'), {
      type: 'bar', data: { labels: [], datasets: [{ data: [], backgroundColor: '#ff6b2c' }] },
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
  graficos.mun.data.labels = munTop.map(([m]) => D.F.municipios[m]);
  graficos.mun.data.datasets[0].data = munTop.map(([, n]) => n);
  graficos.mun.update();
}

function tabelaMunicipios(a, t) {
  const linhas = rankingMunicipios(D, estado, a, t).filter(r => r.focos || r.ativos).sort((x, y) => y.focos - x.focos);
  $('#t-mun').innerHTML = '<tr><th>#</th><th>Município</th><th class="n">Focos no período</th><th class="n">Últimos 7 dias</th>' +
    '<th>Tendência</th><th class="n">Eventos ativos</th><th>Maior prioridade</th><th></th></tr>' +
    linhas.map((r, k) => {
      const ev = D.eventos.features.find(f => f.properties.mun === r.m && f.properties.prioridade === r.maxPrio);
      return `<tr data-mun="${r.m}" class="${r.m === estado.mun ? 'sel' : ''}"><td>${k + 1}</td><td><b>${esc(r.nome)}</b></td>` +
        `<td class="n">${fmt(r.focos)}</td><td class="n">${fmt(r.s7)}</td><td>${fmtVar(r.var)}</td><td class="n">${r.ativos}</td>` +
        `<td>${ev ? badgeClasse(ev.properties.classe) : '–'}</td>` +
        `<td><button class="link" data-relatorio="${r.m}">relatório</button></td></tr>`;
    }).join('');
}

function tabelasFundiarias(a) {
  $('#t-car').innerHTML = '<tr><th>Imóvel</th><th>Município</th><th class="n">Focos</th></tr>' +
    maiores(a.porCar, 15).map(([i, n]) => {
      const p = D.idx.car.get(i)?.properties || {};
      return `<tr data-zoom="car:${i}"><td><span class="cod">${esc(p.cod)}</span><br><small>${esc(TIPO_CAR[p.tipo_imovel] || p.tipo_imovel)} · ${esc(STATUS_CAR[p.status] || p.status)} · ${fmtHa(p.area_ha)}</small></td><td>${esc(p.municipio)}</td><td class="n">${fmt(n)}</td></tr>`;
    }).join('');
  $('#t-uc').innerHTML = '<tr><th>Unidade de conservação</th><th class="n">Focos</th></tr>' +
    maiores(a.porUc, 10).map(([i, n]) => {
      const p = D.idx.uc.get(i)?.properties || {};
      return `<tr data-zoom="uc:${i}"><td>${esc(p.nome)}<br><small>${esc(p.esfera)} · ${esc(p.grupo)}</small></td><td class="n">${fmt(n)}</td></tr>`;
    }).join('');
  $('#t-ti').innerHTML = '<tr><th>Terra indígena</th><th class="n">Focos</th></tr>' +
    maiores(a.porTi, 10).map(([i, n]) => {
      const p = D.idx.ti.get(i)?.properties || {};
      return `<tr data-zoom="ti:${i}"><td>${esc(p.nome)}<br><small>${esc(p.etnia)} · ${esc(p.fase)}</small></td><td class="n">${fmt(n)}</td></tr>`;
    }).join('');
}

// ---------------------------------------------------------------- mobilização

function tabelaMobilizacao(a, t) {
  const evs = eventosDoFiltro(D, estado);
  const conta = c => evs.filter(p => p.classe === c).length;
  $('#kpis-mob').innerHTML = ['Crítica', 'Alta', 'Moderada', 'Baixa'].map(c =>
    `<div class="kpi" style="border-left:4px solid ${CORES_CLASSE[c]}"><b>${conta(c)}</b><span>prioridade ${c.toLowerCase()}</span></div>`).join('') +
    `<div class="kpi"><b>${evs.filter(p => p.status_evento === 'Ativo').length}</b><span>eventos ativos</span></div>`;

  $('#t-mob').innerHTML = '<tr><th>#</th><th>Prioridade</th><th>Local</th><th class="n">Área</th><th class="n">Focos 48 h</th>' +
    '<th>Atinge</th><th>Deslocamento sugerido</th><th class="n">Tempo</th><th class="n">Custo est.</th></tr>' +
    evs.slice(0, 60).map((p, k) => {
      const L = logistica(p, P), r = L[L.recomendado];
      const sens = [p.terra_indigena && 'TI', p.unidade_conservacao && 'UC', p.quilombola && 'Quilombo',
        p.projeto_assentamento && 'Assentamento'].filter(Boolean);
      const det = Object.entries(MODAIS).map(([k2, nome]) => {
        const m = L[k2];
        return `<li class="${k2 === L.recomendado ? 'rec' : ''}"><b>${nome}</b>: ${m.viavel ? `${fmt(m.km)} km · ${fmtH(m.h)} · ${fmtR$(m.custo)}` : `sem rodovia a até ${P.terr_lim_via} km (mais próxima a ${fmt1(p.d_via_km)} km)`}</li>`;
      }).join('');
      return `<tr class="ev" data-ev="${p.id_evento}"><td>${k + 1}</td><td>${badgeClasse(p.classe)} <b>${fmt(p.prioridade)}</b></td>` +
        `<td><b>${esc(p.municipio)}</b><br><small>${esc(p.status_evento)} · ${p.persistencia_dias} dias · evento #${p.id_evento}</small></td>` +
        `<td class="n">${fmtHa(p.area_ha)}</td><td class="n">${p.focos_48h}</td><td>${sens.join(', ') || '–'}</td>` +
        `<td>${MODAIS[L.recomendado]}<br><small>${L.recomendado === 'aer' ? 'de Manaus' : `de ${esc(L.origem)}`}</small></td>` +
        `<td class="n">${fmtH(r.h)}</td><td class="n">${fmtR$(r.custo)}</td></tr>` +
        `<tr class="det" data-det="${p.id_evento}" hidden><td></td><td colspan="8"><ul class="modais">${det}</ul>` +
        `<p class="nota">Índice SIPAM: ${p.indice_sipam ?? 'sem índice'} · Sede mais próxima: ${esc(p.sede)} (${fmt1(p.d_sede_km)} km em linha reta) · ` +
        `Manaus: ${fmt(p.d_manaus_km)} km · Área em imóveis CAR: ${fmtHa(p.area_car_ha)} (${p.n_car} imóveis) · Domínio: ${esc(p.dominio)}</p>` +
        `<button class="btn" data-ver-ev="${p.id_evento}">Ver no mapa</button></td></tr>`;
    }).join('');

  const linhas = rankingMunicipios(D, estado, a, t).filter(r => r.criticos || r.ativos)
    .sort((x, y) => y.criticos - x.criticos || y.s7 - x.s7);
  $('#t-mob-mun').innerHTML = '<tr><th>Município</th><th class="n">Críticos + altos</th><th class="n">Ativos</th>' +
    '<th class="n">Focos 7 dias</th><th>Tendência</th><th></th></tr>' +
    linhas.map(r => `<tr data-mun="${r.m}"><td><b>${esc(r.nome)}</b></td><td class="n">${r.criticos}</td><td class="n">${r.ativos}</td>` +
      `<td class="n">${fmt(r.s7)}</td><td>${fmtVar(r.var)}</td><td><button class="link" data-relatorio="${r.m}">relatório</button></td></tr>`).join('');
}

function montarParams() {
  const campos = [
    ['Terrestre', [['terr_fator', 'Fator de tortuosidade', '×'], ['terr_vel', 'Velocidade média', 'km/h'],
      ['terr_custo_km', 'Custo da viatura', 'R$/km'], ['terr_lim_via', 'Rodovia a até', 'km']]],
    ['Fluvial', [['flu_fator', 'Fator de tortuosidade', '×'], ['flu_vel', 'Velocidade média', 'km/h'],
      ['flu_custo_h', 'Custo da embarcação', 'R$/h']]],
    ['Aéreo (de Manaus)', [['aer_vel', 'Velocidade de cruzeiro', 'km/h'], ['aer_acion_h', 'Tempo de acionamento', 'h'],
      ['aer_custo_h', 'Custo da hora de voo', 'R$/h']]],
  ];
  $('#params').innerHTML = campos.map(([g, cs]) => `<fieldset><legend>${g}</legend>` +
    cs.map(([k, r, u]) => `<label>${r}<span><input type="number" step="any" min="0" name="${k}" value="${P[k]}"> ${u}</span></label>`).join('') +
    '</fieldset>').join('') + '<button type="button" class="btn" id="params-reset">Restaurar padrão</button>';
  $('#params').oninput = e => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v < 0) return;
    P[e.target.name] = v;
    try { localStorage.setItem('params', JSON.stringify(P)); } catch { /* sem storage */ }
    atualizar();
  };
  $('#params-reset').onclick = () => {
    P = { ...PARAMS_PADRAO };
    try { localStorage.removeItem('params'); } catch { /* sem storage */ }
    montarParams();
    atualizar();
  };
}

// ---------------------------------------------------------------- lateral do mapa

function lateralMapa(a, t) {
  const pct = n => a.total ? `${Math.round(100 * n / a.total)}%` : '–';
  const evs = eventosDoFiltro(D, estado);
  $('#kpis-mapa').innerHTML = [
    [fmt(a.total), METODOS[estado.metodo].curto],
    [pct(a.porCat[2]), 'em imóveis CAR'],
    [evs.filter(p => p.status_evento === 'Ativo').length, 'eventos ativos'],
    [evs.filter(p => p.classe === 'Crítica').length, 'prioridade crítica'],
  ].map(([v, r]) => `<div class="kpi"><b>${v}</b><span>${r}</span></div>`).join('');
  $('#lista-eventos').innerHTML = evs.slice(0, 8).map(p =>
    `<li data-ver-ev="${p.id_evento}">${badgeClasse(p.classe)} <b>${esc(p.municipio)}</b><br><small>${fmtHa(p.area_ha)} · ${p.focos_48h} focos em 48 h · ${esc(p.status_evento)}</small></li>`).join('');
  $('#lista-mun').innerHTML = maiores(a.porMun, 10).map(([m, n]) => {
    const [s7, ant] = t.porMun.get(m) || [0, 0];
    return `<li data-mun="${m}" class="${m === estado.mun ? 'sel' : ''}"><b>${esc(D.F.municipios[m])}</b> <span class="n">${fmt(n)}</span><br><small>7 dias: ${fmt(s7)} ${fmtVar(variacao(s7, ant))}</small></li>`;
  }).join('');
}

// ---------------------------------------------------------------- mapa

function zoomMunicipio(m) {
  if (m < 0) return map.fitBounds(bboxGeom({ coordinates: D.mun.features.map(f => f.geometry.coordinates) }), { padding: 20 });
  const f = D.idx.mun.get(m);
  if (f) map.fitBounds(bboxGeom(f.geometry), { padding: 40 });
}

function iniciarMapa() {
  map = new maplibregl.Map({
    container: 'mapa', style: estiloBase('escuro'), center: [-63.5, -4.5], zoom: 5,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

  map.on('load', () => {
    map.addSource('mun', { type: 'geojson', data: D.mun, promoteId: 'i' });
    map.addSource('uc', { type: 'geojson', data: D.uc, promoteId: 'i' });
    map.addSource('ti', { type: 'geojson', data: D.ti, promoteId: 'i' });
    map.addSource('car', { type: 'geojson', data: D.car, promoteId: 'i' });
    map.addSource('eventos', { type: 'geojson', data: D.eventos, promoteId: 'id_evento' });
    map.addSource('sedes', { type: 'geojson', data: D.sedes });
    map.addSource('focos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.on('sourcedata', e => { if (e.sourceId === 'focos' && map.isSourceLoaded('focos')) $('#carregando').hidden = true; });

    const n = ['coalesce', ['feature-state', 'n'], 0];
    map.addLayer({
      id: 'mun-fill', type: 'fill', source: 'mun', layout: { visibility: 'none' },
      paint: { 'fill-color': ['interpolate', ['linear'], n, 0, '#1d232b', 20, '#5a2a1a', 200, '#b3401a', 1000, '#ff6b2c'], 'fill-opacity': 0.75 },
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
    map.addLayer({ id: 'eventos-fill', type: 'fill', source: 'eventos', paint: { 'fill-color': corClasse, 'fill-opacity': 0.35 } });
    map.addLayer({ id: 'eventos-line', type: 'line', source: 'eventos', paint: { 'line-color': corClasse, 'line-width': 1.4 } });
    map.addLayer({
      id: 'focos-heat', type: 'heatmap', source: 'focos', maxzoom: 9,
      paint: {
        'heatmap-weight': 0.4,
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 5, 5, 9, 12],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 1, 5, 0.6, 9, 1.2],
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
    map.addLayer({
      id: 'sedes', type: 'circle', source: 'sedes',
      paint: { 'circle-radius': 3.5, 'circle-color': '#fff', 'circle-stroke-color': '#000', 'circle-stroke-width': 1 },
    });

    popups();
    mapaPronto = true;
    atualizar();
    zoomMunicipio(estado.mun);
  });

  const grupos = {
    focos: ['focos-heat', 'focos-pt'], eventos: ['eventos-fill', 'eventos-line'], car: ['car-fill', 'car-line'],
    uc: ['uc-fill', 'uc-line'], ti: ['ti-fill', 'ti-line'], mun: ['mun-fill'], sedes: ['sedes'],
  };
  document.querySelectorAll('[data-camada]').forEach(cb => cb.onchange = () =>
    grupos[cb.dataset.camada].forEach(id => map.setLayoutProperty(id, 'visibility', cb.checked ? 'visible' : 'none')));
  document.querySelectorAll('input[name=base]').forEach(r => r.onchange = () => {
    map.removeLayer('base');
    map.removeSource('base');
    map.addSource('base', { type: 'raster', tileSize: 256, ...BASES[r.value] });
    map.addLayer({ id: 'base', type: 'raster', source: 'base' }, 'mun-fill');
  });

  $('#legenda').innerHTML = '<b>Focos de calor</b>' + D.F.categorias.map((c, i) =>
    `<span><span class="bolinha" style="background:${CORES_CAT[i]}"></span> ${c}</span>`).join('') +
    '<b>Eventos SIPAM por prioridade</b>' + Object.entries(CORES_CLASSE).map(([c, cor]) =>
    `<span><span class="bolinha quadrada" style="background:${cor}"></span> ${c}</span>`).join('') +
    '<span><span class="bolinha" style="background:#fff;border:1px solid #000"></span> Sede municipal</span>';
}

function popups() {
  const popup = (e, html) => new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  const dl = pares => `<dl>${pares.filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const nFocos = (src, id) => map.getFeatureState({ source: src, id })?.n || 0;

  // a ordem importa: o clique mostra só a camada mais específica sob o cursor
  const ordem = ['focos-pt', 'sedes', 'eventos-fill', 'car-fill', 'ti-fill', 'uc-fill', 'mun-fill'];
  map.on('click', e => {
    const visiveis = ordem.filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    const [f] = map.queryRenderedFeatures(e.point, { layers: visiveis });
    if (!f) return;
    const p = f.properties, F = D.F;
    switch (f.layer.id) {
      case 'focos-pt': {
        const i = p.k;
        popup(e, '<h3>Foco de calor</h3>' + dl([
          ['Data', dataBR(D, F.dia[i])], ['Município', F.municipios[F.mun[i]]], ['Situação', F.categorias[F.cat[i]]],
          ['Detecções no dia', `${F.n[i]} (${F.nref[i]} do satélite de referência)`], ['FRP máximo', `${F.frp[i]} MW`],
          ['Imóvel CAR', F.car[i] >= 0 ? D.idx.car.get(F.car[i])?.properties.cod : null],
          ['UC', F.uc[i] >= 0 ? D.idx.uc.get(F.uc[i])?.properties.nome : null],
          ['TI', F.ti[i] >= 0 ? D.idx.ti.get(F.ti[i])?.properties.nome : null],
        ]));
        break;
      }
      case 'sedes':
        popup(e, `<h3>${esc(p.nome)}</h3><p>Sede municipal</p>`);
        break;
      case 'eventos-fill': {
        const L = logistica(p, P), r = L[L.recomendado];
        popup(e, `<h3>Evento de fogo #${p.id_evento}</h3>${badgeClasse(p.classe)} prioridade <b>${fmt(p.prioridade)}</b>/100` + dl([
          ['Status', p.status_evento], ['Início', p.dt_minima?.slice(0, 10).split('-').reverse().join('/')],
          ['Última detecção', p.dt_maxima?.slice(0, 10).split('-').reverse().join('/')],
          ['Persistência', `${p.persistencia_dias} dias`], ['Área de influência', fmtHa(p.area_ha)],
          ['Focos em 48 h', p.focos_48h], ['Índice SIPAM', p.indice_sipam], ['Município', p.municipio], ['Domínio', p.dominio],
          ['Imóveis CAR atingidos', p.n_car], ['Área em imóveis CAR', fmtHa(p.area_car_ha)],
          ['TI', p.terra_indigena], ['UC', p.unidade_conservacao], ['Assentamento', p.projeto_assentamento],
          ['Deslocamento sugerido', `${MODAIS[L.recomendado]}: ${fmtH(r.h)}, ~${fmtR$(r.custo)}`],
          ['Sede mais próxima', `${p.sede} (${fmt1(p.d_sede_km)} km)`],
        ]));
        break;
      }
      case 'car-fill':
        popup(e, `<h3>Imóvel do CAR</h3><div class="cod">${esc(p.cod)}</div>` + dl([
          ['Tipo', TIPO_CAR[p.tipo_imovel] || p.tipo_imovel], ['Status', STATUS_CAR[p.status] || p.status],
          ['Condição', p.condicao], ['Município', p.municipio], ['Área', fmtHa(p.area_ha)],
          ['Focos no filtro', nFocos('car', p.i)], ['Eventos SIPAM', p.n_eventos], ['Área em evento SIPAM', fmtHa(p.area_evento_ha)],
        ]) + '<p><a href="https://consultapublica.car.gov.br/publico/imoveis/index" target="_blank" rel="noopener">Consulta pública do CAR</a></p>');
        break;
      case 'ti-fill':
        popup(e, `<h3>TI ${esc(p.nome)}</h3>` + dl([
          ['Etnia', p.etnia], ['Fase', p.fase], ['Área', fmtHa(p.area_ha)], ['Focos no filtro', nFocos('ti', p.i)]]));
        break;
      case 'uc-fill':
        popup(e, `<h3>${esc(p.nome)}</h3>` + dl([
          ['Categoria', p.categoria], ['Esfera', p.esfera], ['Gestor', p.org_gestor], ['Área', fmtHa(p.area_ha)],
          ['Focos no filtro', nFocos('uc', p.i)]]));
        break;
      case 'mun-fill':
        popup(e, `<h3>${esc(p.nome)}</h3>` + dl([['Focos no filtro', nFocos('mun', p.i)]]));
        break;
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
  $('#carregando').hidden = false;
  map.getSource('focos').setData(focosGeoJSON(D, estado));
}

// ---------------------------------------------------------------- ciclo

function atualizar() {
  const a = agregar(D, estado), t = tendencia(D, estado);
  $('#resumo').innerHTML = resumoTexto(D, estado, a, t);
  $('#kpis').innerHTML = kpis(a, t);
  graficosAtualizar(a);
  tabelaMunicipios(a, t);
  tabelasFundiarias(a);
  tabelaMobilizacao(a, t);
  lateralMapa(a, t);
  $('#rel-mun').title = estado.mun >= 0 ? `Relatório de ${D.F.municipios[estado.mun]}` : 'Escolha um município no filtro';
  if (mapaPronto) estadoMapa(a);
}

document.addEventListener('click', e => {
  const alvo = e.target.closest('[data-relatorio],[data-ver-ev],[data-zoom],[data-mun],tr.ev,[data-aba-link]');
  if (!alvo) return;
  if (alvo.dataset.relatorio !== undefined) { e.stopPropagation(); return abrirRelatorio(+alvo.dataset.relatorio); }
  if (alvo.dataset.abaLink) { e.preventDefault(); return mostrarAba(alvo.dataset.abaLink); }
  if (alvo.dataset.verEv) {
    const f = D.eventos.features.find(f => String(f.properties.id_evento) === alvo.dataset.verEv);
    return f && irParaMapa(f);
  }
  if (alvo.dataset.zoom) {
    const [camada, id] = alvo.dataset.zoom.split(':');
    const f = D.idx[camada].get(+id);
    return f && irParaMapa(f);
  }
  if (alvo.matches('tr.ev')) {
    const det = document.querySelector(`tr[data-det="${alvo.dataset.ev}"]`);
    det.hidden = !det.hidden;
    alvo.classList.toggle('aberto', !det.hidden);
    return;
  }
  if (alvo.dataset.mun !== undefined) selecionarMunicipio(+alvo.dataset.mun);
});

carregarDados().then(dados => {
  D = dados;
  estado = estadoInicial(D, 30);
  const m = D.meta;
  $('#atualizado').innerHTML = `Atualizado em <b>${new Date(m.atualizado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</b>`;
  $('#rodape').innerHTML = `Um produto <b>${esc(PRODUTO)}</b> · Dados públicos: INPE, Censipam/SIPAM, SICAR, MMA, FUNAI, IBGE, OpenStreetMap · ` +
    'Atualização diária automática · <a href="#metodologia" data-aba-link="metodologia">Metodologia</a> · ' +
    '<a href="https://github.com/dsalcodaa/WEBMAP-FOGO" target="_blank" rel="noopener">Código aberto</a>';
  $('#aba-metodologia').innerHTML = textoMetodologia(m, true);
  montarFiltros();
  montarParams();
  document.querySelectorAll('#abas button').forEach(b => b.onclick = () => mostrarAba(b.dataset.aba));
  $('#rel-estado').onclick = () => abrirRelatorio(-1);
  $('#rel-mun').onclick = () => {
    if (estado.mun >= 0) return abrirRelatorio(estado.mun);
    $('#dlg-texto').innerHTML = '<h3>Relatório do município</h3><p>Escolha um município no filtro <b>Município</b> ou clique em "relatório" no ranking de municípios.</p>';
    $('#dlg-ajuda').showModal();
  };
  atualizar();
  mostrarAba(location.hash.slice(1) || 'painel');
}).catch(err => {
  $('#atualizado').textContent = `Erro ao carregar dados: ${err.message}`;
  console.error(err);
});
