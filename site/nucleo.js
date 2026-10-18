// Dados, filtros, agregações e cálculos compartilhados entre o painel (app.js) e o relatório (relatorio.js).

const PRODUTO = 'NEX – Hub de Análises Estratégicas';
const CORES_CAT = ['#f2994a', '#3fbf7f', '#e5c547', '#8c96a3'];
const CORES_CLASSE = { 'Crítica': '#ff3b3b', 'Alta': '#ff8a2c', 'Moderada': '#e5c547', 'Baixa': '#8c96a3' };
const STATUS_CAR = { AT: 'Ativo', PE: 'Pendente', SU: 'Suspenso', CA: 'Cancelado' };
const TIPO_CAR = { IRU: 'Imóvel rural', AST: 'Assentamento', PCT: 'Povos e comunidades tradicionais' };
const DIA_MS = 86400000;

const METODOS = {
  unicos: {
    nome: 'Focos únicos (recomendado)',
    curto: 'focos únicos',
    desc: 'Um foco por área de ~1 km² por dia, juntando todos os satélites. Evita contar o mesmo fogo várias vezes.',
  },
  ref: {
    nome: 'Satélite de referência do INPE',
    curto: 'focos (satélite de referência)',
    desc: 'Só as detecções do satélite AQUA (tarde), usado pelo INPE para comparar anos. Subestima, mas é comparável.',
  },
  brutas: {
    nome: 'Todas as detecções',
    curto: 'detecções de satélite',
    desc: 'Toda detecção de todos os satélites. O mesmo fogo aparece várias vezes ao dia; não use como número de incêndios.',
  },
};

// premissas de deslocamento; editáveis na aba Mobilização
const PARAMS_PADRAO = {
  terr_fator: 1.4, terr_vel: 40, terr_custo_km: 3.5, terr_lim_via: 5,
  flu_fator: 1.8, flu_vel: 25, flu_custo_h: 180,
  aer_vel: 180, aer_acion_h: 0.5, aer_custo_h: 9000,
};

const $ = sel => document.querySelector(sel);
const fmt = n => Math.round(n).toLocaleString('pt-BR');
const fmt1 = n => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtHa = n => `${fmt(n || 0)} ha`;
const fmtR$ = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtH = h => h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function carregarDados(base = 'data/') {
  const nomes = ['focos.json', 'meta.json', 'car.geojson', 'uc.geojson', 'ti.geojson', 'eventos.geojson',
    'municipios.geojson', 'sedes.geojson'];
  const [F, meta, car, uc, ti, eventos, mun, sedes] = await Promise.all(
    nomes.map(n => fetch(base + n).then(r => { if (!r.ok) throw new Error(n); return r.json(); })));
  F.n = F.lat.length;
  F.dia0 = Date.UTC(F.ano, 0, 1);
  const indexar = fc => new Map(fc.features.map(f => [f.properties.i, f]));
  return {
    F, meta, car, uc, ti, eventos, mun, sedes,
    idx: { car: indexar(car), uc: indexar(uc), ti: indexar(ti), mun: indexar(mun) },
  };
}

function diaParaData(D, d) { return new Date(D.F.dia0 + d * DIA_MS).toISOString().slice(0, 10); }
function dataParaDia(D, s) { return Math.round((Date.parse(s) - D.F.dia0) / DIA_MS); }
function dataBR(D, d) { return diaParaData(D, d).split('-').reverse().join('/'); }

function estadoInicial(D, dias = 30) {
  const ate = D.F.ultimo_dia;
  return { de: Math.max(0, ate - dias + 1), ate, metodo: 'unicos', mun: -1, cats: new Set([0, 1, 2, 3]) };
}

function pesoFoco(D, metodo) {
  const F = D.F;
  if (metodo === 'ref') return i => F.nref[i];
  if (metodo === 'brutas') return i => F.n[i];
  return () => 1;
}

function agregar(D, e) {
  const F = D.F, w = pesoFoco(D, e.metodo);
  const nDias = e.ate - e.de + 1;
  const porDia = F.categorias.map(() => new Array(nDias).fill(0));
  const porCat = new Array(F.categorias.length).fill(0);
  const porMun = new Map(), porCar = new Map(), porUc = new Map(), porTi = new Map();
  const inc = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  let total = 0, frpMax = 0;
  for (let i = 0; i < F.n; i++) {
    const d = F.dia[i];
    if (d < e.de || d > e.ate || (e.mun >= 0 && F.mun[i] !== e.mun) || !e.cats.has(F.cat[i])) continue;
    const v = w(i);
    if (!v) continue;
    total += v;
    const c = F.cat[i];
    porDia[c][d - e.de] += v;
    porCat[c] += v;
    if (F.frp[i] > frpMax) frpMax = F.frp[i];
    if (F.mun[i] >= 0) inc(porMun, F.mun[i], v);
    if (F.car[i] >= 0) inc(porCar, F.car[i], v);
    if (F.uc[i] >= 0) inc(porUc, F.uc[i], v);
    if (F.ti[i] >= 0) inc(porTi, F.ti[i], v);
  }
  return { total, porDia, porCat, porMun, porCar, porUc, porTi, nDias, frpMax };
}

// últimos 7 dias completos até `e.ate` contra os 7 anteriores, por município (ignora o início do filtro).
// O dia mais recente dos dados está incompleto (o INPE publica ao longo do dia) e não entra na comparação.
function tendencia(D, e) {
  const F = D.F, w = pesoFoco(D, e.metodo);
  const fim = Math.min(e.ate, F.ultimo_dia - 1);
  const porMun = new Map();
  let atual = 0, anterior = 0;
  for (let i = 0; i < F.n; i++) {
    const d = F.dia[i];
    if (d > fim || d < fim - 13 || !e.cats.has(F.cat[i])) continue;
    const v = w(i);
    if (!v) continue;
    const k = d > fim - 7 ? 0 : 1;
    const par = porMun.get(F.mun[i]) || [0, 0];
    par[k] += v;
    porMun.set(F.mun[i], par);
    if (e.mun < 0 || F.mun[i] === e.mun) k === 0 ? (atual += v) : (anterior += v);
  }
  return { atual, anterior, porMun };
}

function variacao(atual, anterior) {
  if (!anterior) return atual ? null : 0;
  return (atual - anterior) / anterior;
}

function fmtVar(v) {
  if (v === null) return '<span class="var sobe">novo</span>';
  if (Math.abs(v) < 0.005) return '<span class="var">estável</span>';
  const p = Math.round(v * 100);
  return `<span class="var ${p > 0 ? 'sobe' : 'desce'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}%</span>`;
}

const maiores = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

function eventosDoFiltro(D, e) {
  return D.eventos.features
    .map(f => f.properties)
    .filter(p => e.mun < 0 || p.mun === e.mun)
    .sort((a, b) => b.prioridade - a.prioridade);
}

function logistica(ev, P) {
  const terrKm = ev.d_sede_km * P.terr_fator;
  const fluKm = ev.d_sede_km * P.flu_fator;
  const terr = {
    viavel: ev.d_via_km != null && ev.d_via_km <= P.terr_lim_via,
    km: terrKm, h: terrKm / P.terr_vel, custo: 2 * terrKm * P.terr_custo_km,
  };
  const flu = { viavel: true, km: fluKm, h: fluKm / P.flu_vel };
  flu.custo = 2 * flu.h * P.flu_custo_h;
  const aer = { viavel: true, km: ev.d_manaus_km, h: P.aer_acion_h + ev.d_manaus_km / P.aer_vel };
  aer.custo = 2 * (ev.d_manaus_km / P.aer_vel) * P.aer_custo_h;
  let recomendado = terr.viavel ? 'terr' : 'flu';
  if (!terr.viavel && flu.h > 12) recomendado = 'aer';
  return { terr, flu, aer, recomendado, origem: ev.sede };
}

const MODAIS = { terr: 'Terrestre (4x4)', flu: 'Fluvial (lancha)', aer: 'Aéreo (helicóptero de Manaus)' };

function rankingMunicipios(D, e, a, t) {
  const ev = new Map();
  D.eventos.features.forEach(f => {
    const p = f.properties;
    if (p.mun < 0) return;
    const r = ev.get(p.mun) || { ativos: 0, criticos: 0, maxPrio: 0, area: 0 };
    if (p.status_evento === 'Ativo') r.ativos++;
    if (p.classe === 'Crítica' || p.classe === 'Alta') r.criticos++;
    r.maxPrio = Math.max(r.maxPrio, p.prioridade);
    r.area += p.area_ha;
    ev.set(p.mun, r);
  });
  return D.F.municipios.map((nome, m) => {
    const [s7, s7ant] = t.porMun.get(m) || [0, 0];
    const r = ev.get(m) || { ativos: 0, criticos: 0, maxPrio: 0, area: 0 };
    return { m, nome, focos: a.porMun.get(m) || 0, s7, s7ant, var: variacao(s7, s7ant), ...r };
  });
}

function resumoTexto(D, e, a, t) {
  const lugar = e.mun >= 0 ? `em ${D.F.municipios[e.mun]}` : 'no Amazonas';
  const met = METODOS[e.metodo].curto;
  const pct = n => a.total ? Math.round(100 * n / a.total) : 0;
  const v = variacao(t.atual, t.anterior);
  const tend = v === null ? 'surgiram focos onde não havia na semana anterior'
    : Math.abs(v) < 0.05 ? 'o número ficou estável em relação à semana anterior'
      : `houve ${v > 0 ? 'aumento' : 'queda'} de ${Math.abs(Math.round(v * 100))}% em relação à semana anterior`;
  const top = maiores(a.porMun, 3).map(([m]) => D.F.municipios[m]);
  const evs = eventosDoFiltro(D, e);
  const ativos = evs.filter(p => p.status_evento === 'Ativo').length;
  const urgentes = evs.filter(p => p.classe === 'Crítica').length;
  let s = `De <b>${dataBR(D, e.de)}</b> a <b>${dataBR(D, e.ate)}</b> foram registrados <b>${fmt(a.total)} ${met}</b> ${lugar}. `;
  s += `<b>${pct(a.porCat[2])}%</b> caíram em imóveis do Cadastro Ambiental Rural, <b>${pct(a.porCat[3])}%</b> em áreas sem cadastro, `;
  s += `<b>${pct(a.porCat[1])}%</b> em unidades de conservação e <b>${pct(a.porCat[0])}%</b> em terras indígenas. `;
  s += `Nos últimos 7 dias completos, ${tend}. `;
  if (e.mun < 0 && top.length) s += `Os municípios mais afetados no período foram <b>${top.join('</b>, <b>')}</b>. `;
  s += `Hoje há <b>${ativos}</b> eventos de fogo ativos monitorados pelo SIPAM ${lugar}`;
  s += urgentes ? `, dos quais <b>${urgentes}</b> com prioridade crítica de mobilização.` : '.';
  return s;
}

function bboxGeom(geom) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = c => typeof c[0] === 'number'
    ? (b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])])
    : c.forEach(visit);
  visit(geom.coordinates);
  return [[b[0], b[1]], [b[2], b[3]]];
}

function focosGeoJSON(D, e) {
  const F = D.F, w = pesoFoco(D, e.metodo), features = [];
  for (let i = 0; i < F.n; i++) {
    const d = F.dia[i];
    if (d < e.de || d > e.ate || (e.mun >= 0 && F.mun[i] !== e.mun) || !e.cats.has(F.cat[i]) || !w(i)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [F.lon[i], F.lat[i]] },
      properties: { k: i, c: F.cat[i] },
    });
  }
  return { type: 'FeatureCollection', features };
}

const BASES = {
  escuro: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Base © Esri, HERE, Garmin, © OpenStreetMap', maxzoom: 16,
  },
  claro: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Base © Esri, HERE, Garmin, © OpenStreetMap', maxzoom: 16,
  },
  satelite: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imagens © Esri, Maxar, Earthstar Geographics',
  },
};

function estiloBase(nome) {
  return {
    version: 8,
    sources: { base: { type: 'raster', tileSize: 256, ...BASES[nome] } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

const corClasse = ['match', ['get', 'classe'],
  'Crítica', CORES_CLASSE['Crítica'], 'Alta', CORES_CLASSE['Alta'], 'Moderada', CORES_CLASSE['Moderada'], CORES_CLASSE['Baixa']];

function badgeClasse(c) {
  return `<span class="badge" style="background:${CORES_CLASSE[c]}">${esc(c)}</span>`;
}
