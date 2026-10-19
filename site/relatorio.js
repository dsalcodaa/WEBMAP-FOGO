let P = { ...PARAMS_PADRAO };
try { Object.assign(P, JSON.parse(localStorage.getItem('params') || '{}')); } catch { /* sem storage */ }

function estadoDaUrl(D) {
  const q = new URLSearchParams(location.search);
  const e = estadoInicial(D, 30);
  if (q.has('de')) e.de = Math.max(0, dataParaDia(D, q.get('de')));
  if (q.has('ate')) e.ate = Math.min(D.F.ultimo_dia, dataParaDia(D, q.get('ate')));
  if (METODOS[q.get('metodo')]) e.metodo = q.get('metodo');
  if (q.has('mun')) e.mun = +q.get('mun');
  if (q.get('cats')) e.cats = new Set([...q.get('cats')].map(Number));
  return e;
}

function arKpi(D, e) {
  const ar = arDoFiltro(D, e);
  if (!ar.length) return [];
  return e.mun >= 0 ? [[CLASSES_AR[ar[0].classe].nome, 'qualidade do ar hoje']]
    : [[fmt(ar.filter(r => r.classe >= 2).length), 'cidades com ar ruim ou pior hoje']];
}

function tabela(sel, cab, linhas) {
  $(sel).innerHTML = `<tr>${cab.map(c => `<th class="${c.startsWith('#') ? 'n' : ''}">${c.replace(/^#/, '')}</th>`).join('')}</tr>` +
    (linhas.length ? linhas.join('') : `<tr><td colspan="${cab.length}" class="vazio">Nenhum registro no período.</td></tr>`);
}

function graficos(D, e, a) {
  Chart.defaults.font.family = 'system-ui, sans-serif';
  Chart.defaults.color = '#333';
  new Chart($('#g-dia'), {
    type: 'bar',
    data: {
      labels: Array.from({ length: a.nDias }, (_, k) => dataBR(D, e.de + k).slice(0, 5)),
      datasets: D.F.categorias.map((c, i) => ({ label: c, data: a.porDia[i], backgroundColor: CORES_CAT[i], stack: 's' })),
    },
    options: {
      animation: false, maintainAspectRatio: false, devicePixelRatio: 2,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
      scales: { x: { stacked: true, ticks: { maxTicksLimit: 10, font: { size: 9 } } }, y: { stacked: true } },
    },
  });
  new Chart($('#g-cat'), {
    type: 'doughnut',
    data: { labels: D.F.categorias, datasets: [{ data: a.porCat, backgroundColor: CORES_CAT, borderWidth: 0 }] },
    options: { animation: false, maintainAspectRatio: false, devicePixelRatio: 2, plugins: { legend: { position: 'right', labels: { boxWidth: 10 } } } },
  });
}

function mapa(D, e) {
  return new Promise(resolve => {
    const area = e.mun >= 0 ? D.idx.mun.get(e.mun).geometry : { coordinates: D.mun.features.map(f => f.geometry.coordinates) };
    const map = new maplibregl.Map({
      container: 'mapa', style: estiloBase('claro'), bounds: bboxGeom(area), fitBoundsOptions: { padding: 20 },
      interactive: false, attributionControl: { compact: false }, preserveDrawingBuffer: true,
    });
    map.on('load', () => {
      map.addSource('mun', { type: 'geojson', data: D.mun });
      map.addSource('uc', { type: 'geojson', data: D.uc });
      map.addSource('ti', { type: 'geojson', data: D.ti });
      map.addSource('eventos', { type: 'geojson', data: D.eventos });
      map.addSource('focos', { type: 'geojson', data: focosGeoJSON(D, e) });
      map.addSource('sedes', { type: 'geojson', data: D.sedes });
      map.addLayer({ id: 'uc', type: 'fill', source: 'uc', paint: { 'fill-color': '#3fbf7f', 'fill-opacity': 0.15, 'fill-outline-color': '#2a8a5a' } });
      map.addLayer({ id: 'ti', type: 'fill', source: 'ti', paint: { 'fill-color': '#f2994a', 'fill-opacity': 0.15, 'fill-outline-color': '#c0712a' } });
      map.addLayer({ id: 'mun', type: 'line', source: 'mun', paint: { 'line-color': '#555', 'line-width': 0.6 } });
      if (e.mun >= 0) {
        map.addLayer({ id: 'sel', type: 'line', source: 'mun', filter: ['==', ['get', 'i'], e.mun], paint: { 'line-color': '#000', 'line-width': 2 } });
      }
      map.addLayer({
        id: 'focos', type: 'circle', source: 'focos',
        paint: { 'circle-radius': e.mun >= 0 ? 2.2 : 1.4, 'circle-color': '#d7301f', 'circle-opacity': 0.55 },
      });
      map.addLayer({ id: 'eventos', type: 'fill', source: 'eventos', paint: { 'fill-color': corClasse, 'fill-opacity': 0.7, 'fill-outline-color': '#000' } });
      map.addLayer({ id: 'sedes', type: 'circle', source: 'sedes', paint: { 'circle-radius': 3, 'circle-color': '#fff', 'circle-stroke-color': '#000', 'circle-stroke-width': 1 } });
      map.once('idle', resolve);
    });
  });
}

carregarDados().then(async D => {
  const ano = +new URLSearchParams(location.search).get('ano');
  if (ano && ano !== D.F.ano) await carregarAno(D, ano);
  const e = estadoDaUrl(D);
  const a = agregar(D, e), t = tendencia(D, e);
  const nomeLocal = e.mun >= 0 ? `Município de ${D.F.municipios[e.mun]} (AM)` : 'Estado do Amazonas';
  const periodo = `${dataBR(D, e.de)} a ${dataBR(D, e.ate)}`;

  document.title = `Relatório de fogo · ${e.mun >= 0 ? D.F.municipios[e.mun] : 'Amazonas'} · ${periodo} · NEX`;
  $('#titulo').textContent = `Fogo e qualidade do ar — ${nomeLocal}`;
  $('#subtitulo').innerHTML = `Período: <b>${periodo}</b> · Contagem: <b>${esc(METODOS[e.metodo].nome)}</b>` +
    (e.cats.size < 4 ? ` · Categorias: ${[...e.cats].map(c => D.F.categorias[c]).join(', ')}` : '') +
    (D.F.ano !== anoAtual(D) ? '<br>Eventos de fogo, mobilização e qualidade do ar mostram a situação de hoje; ' +
      'CAR, UCs e TIs usam os limites atuais.' : '');
  $('#gerado').innerHTML = `Gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}<br>` +
    `Dados atualizados em ${new Date(D.meta.atualizado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
  $('#resumo').innerHTML = resumoTexto(D, e, a, t);

  const evs = eventosDoFiltro(D, e);
  const pct = n => a.total ? `${Math.round(100 * n / a.total)}%` : '–';
  $('#kpis').innerHTML = [
    [fmt(a.total), METODOS[e.metodo].curto],
    [fmtVar(variacao(t.atual, t.anterior)), 'últimos 7 dias × 7 anteriores'],
    [pct(a.porCat[2]), 'em imóveis do CAR'],
    [pct(a.porCat[3]), 'sem cadastro'],
    [pct(a.porCat[0] + a.porCat[1]), 'em TIs e UCs'],
    [fmt(a.porCar.size), 'imóveis CAR atingidos'],
    [evs.filter(p => p.status_evento === 'Ativo').length, 'eventos ativos agora'],
    [evs.filter(p => p.classe === 'Crítica').length, 'eventos de prioridade crítica'],
  ].concat(arKpi(D, e)).map(([v, r]) => `<div class="kpi"><b>${v}</b><span>${r}</span></div>`).join('');

  $('#legenda').innerHTML = `<span class="ponto" style="background:#d7301f"></span> Focos de calor no período · ` +
    Object.entries(CORES_CLASSE).map(([c, cor]) => `<span class="ponto quad" style="background:${cor}"></span> Evento ${c.toLowerCase()}`).join(' · ') +
    ' · <span class="ponto quad" style="background:#3fbf7f"></span> UC · <span class="ponto quad" style="background:#f2994a"></span> TI · ' +
    '<span class="ponto" style="background:#fff;border:1px solid #000"></span> Sede municipal';

  graficos(D, e, a);

  const ar = arDoFiltro(D, e);
  if (ar.length) {
    const hora = D.ar.hora ? `${D.ar.hora.slice(8, 10)}/${D.ar.hora.slice(5, 7)} às ${D.ar.hora.slice(11, 16)}` : '';
    const est = D.ar.estacoes.length
      ? ` Estações de medição da rede AQICN no estado: ${D.ar.estacoes.map(s => `${esc(s.nome)} (índice ${s.aqi}, ${faixaAqi(s.aqi).toLowerCase()})`).join('; ')}.`
      : '';
    $('#nota-ar').innerHTML = `Situação no momento em que o relatório foi gerado, não no período do filtro. Média das ` +
      `24 horas até ${hora} (horário de Manaus), na sede de cada município, pelo Índice de Qualidade do Ar do MMA. ` +
      `PM2,5 é a fumaça fina, em µg/m³. Valores estimados pelo modelo Copernicus/CAMS.` +
      (e.mun < 0 ? ` Mostrando as ${Math.min(15, ar.length)} cidades com pior ar de ${ar.length}.` : '') + est;
    tabela('#t-ar', CAB_AR, linhasAr(ar.slice(0, 15)));
  } else {
    $('#sec-ar').remove();
  }

  if (e.mun < 0) {
    const linhas = rankingMunicipios(D, e, a, t).filter(r => r.focos || r.ativos).sort((x, y) => y.focos - x.focos).slice(0, 20);
    tabela('#t-mun', ['#', 'Município', '#Focos no período', '#Últimos 7 dias', 'Tendência', '#Eventos ativos', '#Críticos + altos'],
      linhas.map((r, k) => `<tr><td>${k + 1}</td><td>${esc(r.nome)}</td><td class="n">${fmt(r.focos)}</td><td class="n">${fmt(r.s7)}</td>` +
        `<td>${fmtVar(r.var)}</td><td class="n">${r.ativos}</td><td class="n">${r.criticos}</td></tr>`));
  } else {
    $('#sec-mun').remove();
  }

  const limite = e.mun >= 0 ? 25 : 20;
  $('#nota-mob').innerHTML = `Eventos de fogo ativos ou em observação no SIPAM, ordenados pelo índice de prioridade (0–100). ` +
    `Deslocamento estimado a partir da sede municipal mais próxima (terrestre/fluvial) ou de Manaus (aéreo), ida e volta. ` +
    `${evs.length > limite ? `Mostrando os ${limite} primeiros de ${evs.length}.` : ''}`;
  tabela('#t-mob', ['#', 'Prioridade', 'Município', 'Status', '#Área (ha)', '#Focos 48 h', 'Deslocamento sugerido', '#Tempo', '#Custo est.'],
    evs.slice(0, limite).map((p, k) => {
      const L = logistica(p, P), r = L[L.recomendado];
      return `<tr><td>${k + 1}</td><td>${badgeClasse(p.classe)} ${fmt(p.prioridade)}</td><td>${esc(p.municipio)}</td>` +
        `<td>${esc(p.status_evento)}, ${p.persistencia_dias} d</td><td class="n">${fmt(p.area_ha)}</td><td class="n">${p.focos_48h}</td>` +
        `<td>${MODAIS[L.recomendado]} ${L.recomendado === 'aer' ? '' : `de ${esc(L.origem)}`}</td><td class="n">${fmtH(r.h)}</td>` +
        `<td class="n">${fmtR$(r.custo)}</td></tr>`;
    }));

  tabela('#t-car', ['Código do imóvel', 'Tipo / status', 'Município', '#Área (ha)', '#Focos'],
    maiores(a.porCar, 15).map(([i, n]) => {
      const p = D.idx.car.get(i)?.properties || {};
      return `<tr><td class="cod">${esc(p.cod)}</td><td>${esc(TIPO_CAR[p.tipo_imovel] || p.tipo_imovel)} · ${esc(STATUS_CAR[p.status] || p.status)}</td>` +
        `<td>${esc(p.municipio)}</td><td class="n">${fmt(p.area_ha)}</td><td class="n">${fmt(n)}</td></tr>`;
    }));
  tabela('#t-uc', ['Unidade', '#Focos'], maiores(a.porUc, 10).map(([i, n]) =>
    `<tr><td>${esc(D.idx.uc.get(i)?.properties.nome)}</td><td class="n">${fmt(n)}</td></tr>`));
  tabela('#t-ti', ['Terra indígena', '#Focos'], maiores(a.porTi, 10).map(([i, n]) =>
    `<tr><td>${esc(D.idx.ti.get(i)?.properties.nome)}</td><td class="n">${fmt(n)}</td></tr>`));

  $('#metodologia').insertAdjacentHTML('beforeend', textoMetodologia(D.meta, false) +
    `<h3>Fontes</h3><p>${Object.values(D.meta.fontes).map(esc).join('; ')}.</p>`);
  $('#rodape').innerHTML = `Um produto <b>${esc(PRODUTO)}</b> · Painel público: ${esc(location.href.replace(/relatorio\.html.*$/, ''))}`;

  await mapa(D, e);
  const b = $('#imprimir');
  b.disabled = false;
  b.textContent = 'Imprimir / salvar em PDF';
  b.onclick = () => window.print();
}).catch(err => {
  $('#imprimir').textContent = `Erro ao carregar dados: ${err.message}`;
  console.error(err);
});
