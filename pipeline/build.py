"""Baixa as fontes, cruza focos/eventos de fogo com CAR, UCs, TIs e municípios, calcula prioridade de
mobilização e distâncias de acesso, e gera os dados do site.

Uso: python pipeline/build.py [--ano 2026] [--saida site/data]
"""
import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

import fontes

CRS_METRICO = "EPSG:5880"  # SIRGAS 2000 / Brazil Polyconic: áreas em ha e distâncias em km
CATEGORIAS = ["Terra Indígena", "Unidade de Conservação", "Imóvel CAR", "Sem cadastro"]
SAT_REFERENCIA = "AQUA_M-T"  # satélite de referência do INPE para séries comparáveis
CELULA_GRAUS = 0.01          # ~1,1 km: um foco único por célula por dia
BUFFER_EVENTO_M = 1000       # focos recentes contados até 1 km da borda do evento
ANO_INICIAL = 2003           # início da série oficial do INPE pelo satélite de referência

# pesos do índice de prioridade de mobilização (somam 100)
PESOS = {"indice_sipam": 30, "focos_48h": 25, "area": 15, "persistencia": 10, "area_sensivel": 10, "ativo": 10}
CLASSES = [(70, "Crítica"), (50, "Alta"), (30, "Moderada"), (0, "Baixa")]


def escrever_geojson(gdf: gpd.GeoDataFrame, caminho: Path, tolerancia=0.0002):
    gdf = gdf.copy()
    if tolerancia:
        gdf["geometry"] = gdf.geometry.simplify(tolerancia, preserve_topology=True)
    gdf = gdf[~gdf.geometry.is_empty]
    gdf.to_file(caminho, driver="GeoJSON", COORDINATE_PRECISION=5, RFC7946="YES")
    print(f"  {caminho.name}: {len(gdf)} feições, {caminho.stat().st_size / 1e6:.1f} MB")


def poligono_mais_especifico(pontos: gpd.GeoDataFrame, poligonos: gpd.GeoDataFrame, coluna: str) -> pd.Series:
    """Para cada ponto, valor de `coluna` do menor polígono que o contém; -1 se nenhum.
    Polígonos do CAR se sobrepõem, então o menor é o mais provável de ser o imóvel de origem."""
    j = gpd.sjoin(pontos[["geometry"]], poligonos[[coluna, "_area", "geometry"]], predicate="within", how="inner")
    j = j.sort_values("_area").loc[lambda d: ~d.index.duplicated(keep="first")]
    return j[coluna].reindex(pontos.index).fillna(-1).astype(int)


def focos_unicos(focos: gpd.GeoDataFrame, dia0: pd.Timestamp) -> gpd.GeoDataFrame:
    """Agrupa detecções em focos únicos: uma célula de ~1 km por dia, somando todos os satélites.
    Um mesmo fogo é detectado várias vezes ao dia (GOES-19 a cada 10 min, VIIRS em 3 satélites)."""
    f = focos.sort_values("data_hora_gmt").copy()
    f["dia"] = (f.data_hora_gmt.dt.normalize() - dia0).dt.days
    f["cy"] = np.floor(f.lat / CELULA_GRAUS).astype(int)
    f["cx"] = np.floor(f.lon / CELULA_GRAUS).astype(int)
    f["ref"] = (f.satelite == SAT_REFERENCIA).astype(int)
    agg = dict(lat=("lat", "first"), lon=("lon", "first"), n=("id", "size"), nref=("ref", "sum"), frp=("frp", "max"))
    if "municipio_id" in f:  # só os arquivos mensais/diários trazem o código do município
        agg["municipio_id"] = ("municipio_id", "first")
    u = f.groupby(["cy", "cx", "dia"], sort=False).agg(**agg).reset_index()
    return gpd.GeoDataFrame(u, geometry=gpd.points_from_xy(u.lon, u.lat), crs=fontes.CRS)


# limites da média de 24 h (µg/m³) entre as faixas Boa | Moderada | Ruim | Muito ruim | Péssima
# do Índice de Qualidade do Ar do MMA (Guia Técnico, 2019; Resolução CONAMA 491/2018)
FAIXAS_AR = {"pm25": [25, 50, 75, 125], "pm10": [50, 100, 150, 250]}


def faixa_ar(valor, poluente):
    return int(np.searchsorted(FAIXAS_AR[poluente], valor, side="left"))


def qualidade_ar(sedes: gpd.GeoDataFrame, mun_idx: dict, uf: gpd.GeoDataFrame) -> dict:
    """Média das últimas 24 h de PM2.5 e PM10 na sede de cada município (modelo CAMS) e estações AQICN."""
    municipios, hora = [], None
    for (_, s), r in zip(sedes.iterrows(), fontes.ar_modelo(sedes)):
        hora = r["current"]["time"]
        h = pd.DataFrame(r["hourly"])
        agora = h.index[h.time == r["current"]["time"]][0]
        ult = h.iloc[agora - 23: agora + 1]
        pm25, pm10 = ult.pm2_5.mean(), ult.pm10.mean()
        if pd.isna(pm25) or pd.isna(pm10):
            continue
        municipios.append({
            "mun": mun_idx.get(s.cod_ibge, -1), "nome": s.nome, "lat": round(s.geometry.y, 4), "lon": round(s.geometry.x, 4),
            "pm25_24h": round(float(pm25), 1), "pm10_24h": round(float(pm10), 1),
            "pm25_agora": r["current"]["pm2_5"], "pm10_agora": r["current"]["pm10"],
            "classe": max(faixa_ar(pm25, "pm25"), faixa_ar(pm10, "pm10")),
        })
    return {"hora": hora, "municipios": municipios, "estacoes": fontes.ar_estacoes(uf)}


def com_coordenadas(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Ponto de referência (sempre dentro do polígono), em graus decimais SIRGAS 2000, para localizar em campo."""
    p = gdf.geometry.representative_point()
    return gdf.assign(lat=p.y.round(5), lon=p.x.round(5))


def cruzar(focos: gpd.GeoDataFrame, car, uc, ti):
    """Imóvel CAR, UC e TI de cada foco, e a categoria pela ordem de precedência TI > UC > CAR > sem cadastro."""
    focos["car_i"] = poligono_mais_especifico(focos, car, "_i")
    focos["uc_i"] = poligono_mais_especifico(focos, uc, "_i")
    focos["ti_i"] = poligono_mais_especifico(focos, ti, "_i")
    focos["cat"] = np.select([focos.ti_i >= 0, focos.uc_i >= 0, focos.car_i >= 0], [0, 1, 2], default=3)


def colunas_focos(focos, ano, ultimo_dia, municipios, fechado):
    """Focos únicos em formato colunar; os índices apontam para as listas e GeoJSONs do site."""
    return {
        "ano": ano,
        "fechado": fechado,  # ano passado: o último dia está completo
        "ultimo_dia": ultimo_dia,
        "categorias": CATEGORIAS,
        "municipios": municipios,
        "lat": focos.lat.round(4).tolist(),
        "lon": focos.lon.round(4).tolist(),
        "dia": focos.dia.tolist(),
        "n": focos.n.tolist(),
        "nref": focos.nref.tolist(),
        "mun": focos.mun_i.tolist(),
        "cat": focos.cat.tolist(),
        "car": focos.car_i.tolist(),
        "uc": focos.uc_i.tolist(),
        "ti": focos.ti_i.tolist(),
        "frp": focos.frp.fillna(0).round(1).tolist(),
    }


def percentil(s: pd.Series) -> pd.Series:
    r = s.rank(pct=True)
    return r.where(s > 0, 0).fillna(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", type=int, default=date.today().year)
    ap.add_argument("--saida", default="site/data")
    ap.add_argument("--cache", default="cache")
    ap.add_argument("--desde", type=int, default=ANO_INICIAL, help="primeiro ano do histórico")
    args = ap.parse_args()
    saida, cache = Path(args.saida), Path(args.cache)
    saida.mkdir(parents=True, exist_ok=True)
    dia0 = pd.Timestamp(f"{args.ano}-01-01")

    print("1/9 limites e sedes municipais (IBGE)")
    uf = fontes.limite_uf()
    mun = fontes.municipios().sort_values("nome").reset_index(drop=True)
    mun["i"] = np.arange(len(mun))
    sedes = fontes.sedes_municipais()
    print("2/9 unidades de conservação (CNUC/MMA)")
    uc = fontes.unidades_conservacao(uf).reset_index(drop=True)
    print("3/9 terras indígenas (FUNAI)")
    ti = fontes.terras_indigenas(uf).reset_index(drop=True)
    print("4/9 imóveis CAR (SICAR)")
    car = fontes.imoveis_car(cache / f"car_{fontes.UF.lower()}.parquet")
    n_car_cancelados = int((car.status_imovel == "CA").sum())
    car = car[car.status_imovel != "CA"].reset_index(drop=True)
    print("5/9 rodovias (OpenStreetMap)")
    vias = fontes.vias_osm(cache / f"vias_{fontes.UF.lower()}.parquet")
    # o servidor do DNIT não responde fora do Brasil (GitHub Actions); usa a cópia versionada no repositório.
    # Para atualizar a cópia, rode o pipeline de uma máquina no Brasil e faça commit de pipeline/dados/.
    copia_dnit = Path(__file__).parent / "dados" / f"dnit_{fontes.UF.lower()}.geojson"
    try:
        dnit = fontes.dnit(uf)
        copia_dnit.parent.mkdir(exist_ok=True)
        dnit.to_file(copia_dnit, driver="GeoJSON")
        print(f"  DNIT: {dnit.tipo.value_counts().to_dict()}")
    except Exception as e:  # noqa: BLE001
        print("  DNIT indisponível, usando a cópia do repositório:", e)
        dnit = gpd.read_file(copia_dnit) if copia_dnit.exists() else \
            gpd.GeoDataFrame({"tipo": [], "nome": [], "detalhe": []}, geometry=[], crs=fontes.CRS)
    print("6/9 eventos de fogo e prioridades (SIPAM)")
    eventos = fontes.eventos_sipam().reset_index(drop=True)
    eventos["indice_sipam"] = eventos.id_evento.map(fontes.prioridades_sipam(eventos.id_evento.tolist()))
    print("7/9 focos de calor (INPE)")
    deteccoes = fontes.focos_inpe(args.ano)
    n_deteccoes_brutas = len(deteccoes)
    deteccoes = deteccoes.drop_duplicates(["satelite", "data_hora_gmt", "lat", "lon"])
    focos = focos_unicos(deteccoes, dia0)
    ultimo_dia = int(focos.dia.max())

    print("8/9 cruzamentos")
    for g in (uc, ti, car, mun):
        g["_area"] = g.to_crs(CRS_METRICO).area
    for g in (uc, ti, car):
        g["_i"] = np.arange(len(g))

    cruzar(focos, car, uc, ti)
    mun_idx = {c: i for i, c in enumerate(mun.cod_ibge)}
    focos["mun_i"] = focos.municipio_id.str.strip().map(mun_idx).fillna(-1).astype(int)

    # eventos SIPAM x CAR
    ev_m = eventos.to_crs(CRS_METRICO)
    car_m = car[["_i", "geometry"]].to_crs(CRS_METRICO)
    pares = gpd.sjoin(ev_m[["id_evento", "geometry"]], car_m, predicate="intersects", how="inner")
    geo_ev = ev_m.set_index("id_evento").geometry
    geo_car = car_m.set_index("_i").geometry
    pares["ha"] = [geo_ev[e].intersection(geo_car[c]).area / 1e4 for e, c in zip(pares.id_evento, pares._i)]
    pares = pares[pares.ha > 0]
    # área do evento dentro de imóveis: união dos imóveis, para não contar sobreposições do CAR duas vezes
    area_car = {e: geo_ev[e].intersection(geo_car.loc[g._i].union_all()).area / 1e4
                for e, g in pares.groupby("id_evento")}
    queimada_por_car = pares.groupby("_i").agg(area_evento_ha=("ha", "sum"), n_eventos=("id_evento", "nunique"))
    eventos["n_car"] = eventos.id_evento.map(pares.groupby("id_evento")._i.nunique()).fillna(0).astype(int)
    eventos["area_car_ha"] = eventos.id_evento.map(area_car).fillna(0).round(1)
    eventos["area_ha"] = (ev_m.area / 1e4).round(1)

    # focos únicos recentes no evento (até 1 km da borda)
    recentes = focos[focos.dia >= ultimo_dia - 1].to_crs(CRS_METRICO)
    zona = ev_m[["id_evento", "geometry"]].copy()
    zona["geometry"] = zona.buffer(BUFFER_EVENTO_M)
    n48 = gpd.sjoin(recentes[["geometry"]], zona, predicate="within").groupby("id_evento").size()
    eventos["focos_48h"] = eventos.id_evento.map(n48).fillna(0).astype(int)

    # município do evento e área sensível
    ponto = ev_m.geometry.representative_point()
    pts = gpd.GeoDataFrame({"id_evento": eventos.id_evento}, geometry=ponto, crs=CRS_METRICO)
    em_mun = gpd.sjoin(pts, mun[["i", "geometry"]].to_crs(CRS_METRICO), predicate="within")
    eventos["mun"] = eventos.id_evento.map(em_mun.drop_duplicates("id_evento").set_index("id_evento")["i"]).fillna(-1).astype(int)
    eventos["area_sensivel"] = eventos[["terra_indigena", "unidade_conservacao", "quilombola", "projeto_assentamento"]] \
        .notna().any(axis=1)

    # logística: sede municipal mais próxima, Manaus e rodovia mais próxima (linha reta, em km)
    sedes_m = sedes.to_crs(CRS_METRICO)
    prox = gpd.sjoin_nearest(pts, sedes_m[["nome", "geometry"]], distance_col="d").drop_duplicates("id_evento")
    eventos["sede"] = eventos.id_evento.map(prox.set_index("id_evento")["nome"])
    eventos["d_sede_km"] = eventos.id_evento.map(prox.set_index("id_evento")["d"] / 1000).round(1)
    manaus = sedes_m[sedes_m.capital].geometry.iloc[0]
    eventos["d_manaus_km"] = (pts.distance(manaus) / 1000).round(1)
    via = gpd.sjoin_nearest(pts, vias[["geometry"]].to_crs(CRS_METRICO), distance_col="d").drop_duplicates("id_evento")
    eventos["d_via_km"] = eventos.id_evento.map(via.set_index("id_evento")["d"] / 1000).round(1)
    # pista de pouso e porto mais próximos (DNIT), para planejar apoio aéreo e fluvial
    for tipo in ("pista", "porto"):
        alvo = dnit[dnit.tipo == tipo]
        if alvo.empty:
            eventos[tipo], eventos[f"d_{tipo}_km"] = None, None
            continue
        p = gpd.sjoin_nearest(pts, alvo[["nome", "geometry"]].to_crs(CRS_METRICO), distance_col="d") \
            .drop_duplicates("id_evento").set_index("id_evento")
        eventos[tipo] = eventos.id_evento.map(p["nome"])
        eventos[f"d_{tipo}_km"] = eventos.id_evento.map(p["d"] / 1000).round(1)

    # índice de prioridade de mobilização (0-100)
    comp = {
        "indice_sipam": percentil(eventos.indice_sipam.fillna(0)),
        "focos_48h": percentil(eventos.focos_48h),
        "area": percentil(eventos.area_ha),
        "persistencia": percentil(eventos.persistencia_dias.fillna(0)),
        "area_sensivel": eventos.area_sensivel.astype(float),
        "ativo": (eventos.status_evento == "Ativo").astype(float),
    }
    eventos["prioridade"] = sum(PESOS[k] * v for k, v in comp.items()).round(1)
    eventos["classe"] = eventos.prioridade.map(lambda p: next(c for lim, c in CLASSES if p >= lim))

    print("9/9 saídas")
    def escrever_car(ids, caminho, tolerancia=0.0002):
        """Só os imóveis citados pelos focos (ou eventos), para o arquivo do site não ficar enorme."""
        out = car[car._i.isin(ids)].copy().join(queimada_por_car, on="_i")
        out["area_evento_ha"] = out.area_evento_ha.fillna(0).round(1)
        out["n_eventos"] = out.n_eventos.fillna(0).astype(int)
        out["area_ha"] = (out._area / 1e4).round(1)
        out = com_coordenadas(out.rename(columns={"_i": "i", "cod_imovel": "cod", "status_imovel": "status"}))
        escrever_geojson(out[["i", "cod", "status", "condicao", "tipo_imovel", "municipio", "area_ha",
                              "area_evento_ha", "n_eventos", "lat", "lon", "geometry"]], caminho, tolerancia)
        return len(out)

    n_car_com_fogo = escrever_car(set(focos.loc[focos.car_i >= 0, "car_i"]) | set(queimada_por_car.index),
                                  saida / "car.geojson")

    uc["area_ha"] = (uc._area / 1e4).round(0)
    escrever_geojson(
        com_coordenadas(uc.rename(columns={"_i": "i", "nome_uc": "nome"}))[
            ["i", "nome", "categoria", "grupo", "esfera", "org_gestor", "area_ha", "lat", "lon", "geometry"]],
        saida / "uc.geojson", tolerancia=0.001)

    ti["area_ha"] = (ti._area / 1e4).round(0)
    escrever_geojson(
        com_coordenadas(ti.rename(columns={"_i": "i", "terrai_nome": "nome", "etnia_nome": "etnia", "fase_ti": "fase"}))[
            ["i", "nome", "etnia", "fase", "modalidade_ti", "area_ha", "lat", "lon", "geometry"]],
        saida / "ti.geojson", tolerancia=0.001)
    if dnit.empty:
        (saida / "dnit.geojson").write_text('{"type":"FeatureCollection","features":[]}')
    else:
        escrever_geojson(dnit, saida / "dnit.geojson", tolerancia=0.0005)

    escrever_geojson(mun[["i", "cod_ibge", "nome", "geometry"]], saida / "municipios.geojson", tolerancia=0.002)
    escrever_geojson(sedes, saida / "sedes.geojson", tolerancia=0)

    eventos = eventos.drop(columns=["latitude", "longitude", "pais"])
    eventos["indice_sipam"] = eventos.indice_sipam.round(1)
    escrever_geojson(eventos, saida / "eventos.geojson", tolerancia=0.0001)

    colunas = colunas_focos(focos, args.ano, ultimo_dia, mun.nome.tolist(), fechado=False)
    (saida / "focos.json").write_text(json.dumps(colunas, separators=(",", ":")))
    print(f"  focos.json: {len(focos)} focos únicos, {(saida / 'focos.json').stat().st_size / 1e6:.1f} MB")
    anos = [{"ano": args.ano, "ref": int(focos.nref.sum()), "unicos": len(focos), "brutas": n_deteccoes_brutas}]

    # anos fechados: mesmos cruzamentos com os limites atuais de CAR, UC e TI. Um ano que falhar fica de fora.
    print("   histórico de focos (INPE, arquivos anuais)")
    (saida / "anos").mkdir(exist_ok=True)
    for ano in range(args.desde, args.ano):
        try:
            det = fontes.focos_inpe_historico(ano, cache / "historico")
            n_brutas = len(det)
            det = det.drop_duplicates(["satelite", "data_hora_gmt", "lat", "lon"])
            f = focos_unicos(det, pd.Timestamp(f"{ano}-01-01"))
            cruzar(f, car, uc, ti)
            f["mun_i"] = poligono_mais_especifico(f, mun, "i")
            fim = (date(ano, 12, 31) - date(ano, 1, 1)).days
            (saida / "anos" / f"focos_{ano}.json").write_text(
                json.dumps(colunas_focos(f, ano, fim, mun.nome.tolist(), fechado=True), separators=(",", ":")))
            # traço mais simples que o do ano atual: 23 anos de CAR precisam caber no limite de 1 GB do GitHub Pages
            escrever_car(set(f.loc[f.car_i >= 0, "car_i"]), saida / "anos" / f"car_{ano}.geojson", tolerancia=0.0006)
            anos.append({"ano": ano, "ref": int(f.nref.sum()), "unicos": len(f), "brutas": n_brutas})
            print(f"   {ano}: {int(f.nref.sum())} focos (referência), {len(f)} lugares com fogo")
        except Exception as e:  # noqa: BLE001
            print(f"   {ano} ignorado: {e}")
    anos.sort(key=lambda a: a["ano"])

    # qualidade do ar é complemento: se a API falhar, o site sai sem ela em vez de não atualizar
    try:
        ar = qualidade_ar(sedes, mun_idx, uf)
    except Exception as e:  # noqa: BLE001
        print("  qualidade do ar ignorada:", e)
        ar = {"hora": None, "municipios": [], "estacoes": []}
    (saida / "ar.json").write_text(json.dumps(ar, ensure_ascii=False, separators=(",", ":")))
    print(f"  ar.json: {len(ar['municipios'])} sedes, {len(ar['estacoes'])} estações")

    meta = {
        "atualizado_em": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "uf": fontes.UF,
        "ano": args.ano,
        "anos": anos,
        "totais": {
            "deteccoes_brutas": n_deteccoes_brutas,
            "deteccoes_sem_duplicatas": len(deteccoes),
            "focos_unicos": len(focos),
            "deteccoes_satelite_referencia": int(focos.nref.sum()),
            "eventos_sipam": len(eventos),
            "eventos_com_indice_sipam": int(eventos.indice_sipam.notna().sum()),
            "imoveis_car_uf": len(car),
            "imoveis_car_cancelados_excluidos": n_car_cancelados,
            "imoveis_car_com_fogo": n_car_com_fogo,
            "ucs": len(uc),
            "tis": len(ti),
            "vias_osm": len(vias),
        },
        "parametros": {
            "satelite_referencia": SAT_REFERENCIA,
            "celula_graus": CELULA_GRAUS,
            "buffer_evento_m": BUFFER_EVENTO_M,
            "pesos_prioridade": PESOS,
            "classes_prioridade": {c: lim for lim, c in CLASSES},
        },
        "fontes": {
            "focos": "INPE – Programa Queimadas (dataserver-coids.inpe.br)",
            "eventos": "Censipam/SIPAM – Painel do Fogo (panorama.sipam.gov.br)",
            "car": "SICAR – Cadastro Ambiental Rural (geoserver.car.gov.br)",
            "uc": "MMA – Cadastro Nacional de Unidades de Conservação",
            "ti": "FUNAI – Terras Indígenas (geoserver.funai.gov.br)",
            "municipios": "IBGE – Malhas territoriais; sedes: compilação aberta kelvins/municipios-brasileiros",
            "vias": "OpenStreetMap – rodovias principais (Overpass API)",
            "ar": "Copernicus CAMS via Open-Meteo (modelo de PM2.5 e PM10); estações da rede AQICN/WAQI",
            "dnit": "DNIT – DNITGeo/VGeo (rodovias federais do SNV, pistas de pouso e portos)",
        },
    }
    (saida / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print("ok")


if __name__ == "__main__":
    main()
