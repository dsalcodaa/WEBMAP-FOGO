"""Baixa as fontes, cruza focos/eventos de fogo com CAR, UCs, TIs e municípios e gera os dados do site.

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

CRS_AREA = "EPSG:5880"  # SIRGAS 2000 / Brazil Polyconic, para áreas em hectares
CATEGORIAS = ["Terra Indígena", "Unidade de Conservação", "Imóvel CAR", "Sem cadastro"]


def escrever_geojson(gdf: gpd.GeoDataFrame, caminho: Path, tolerancia=0.0002):
    gdf = gdf.copy()
    gdf["geometry"] = gdf.geometry.simplify(tolerancia, preserve_topology=True)
    gdf = gdf[~gdf.geometry.is_empty]
    gdf.to_file(caminho, driver="GeoJSON", COORDINATE_PRECISION=5, RFC7946="YES")
    print(f"  {caminho.name}: {len(gdf)} feições, {caminho.stat().st_size / 1e6:.1f} MB")


def poligono_mais_especifico(pontos: gpd.GeoDataFrame, poligonos: gpd.GeoDataFrame, coluna: str) -> pd.Series:
    """Para cada ponto, índice (em `poligonos`) do menor polígono que o contém; -1 se nenhum.
    Polígonos do CAR se sobrepõem, então o menor é o mais provável de ser o imóvel de origem."""
    j = gpd.sjoin(pontos[["geometry"]], poligonos[[coluna, "_area", "geometry"]], predicate="within", how="inner")
    j = j.sort_values("_area").loc[lambda d: ~d.index.duplicated(keep="first")]
    return j[coluna].reindex(pontos.index).fillna(-1).astype(int)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", type=int, default=date.today().year)
    ap.add_argument("--saida", default="site/data")
    ap.add_argument("--cache", default="cache")
    args = ap.parse_args()
    saida, cache = Path(args.saida), Path(args.cache)
    saida.mkdir(parents=True, exist_ok=True)

    print("1/7 limites IBGE")
    uf = fontes.limite_uf()
    mun = fontes.municipios().sort_values("nome").reset_index(drop=True)

    print("2/7 unidades de conservação (CNUC/MMA)")
    uc = fontes.unidades_conservacao(uf).reset_index(drop=True)
    print("3/7 terras indígenas (FUNAI)")
    ti = fontes.terras_indigenas(uf).reset_index(drop=True)
    print("4/7 imóveis CAR (SICAR)")
    car = fontes.imoveis_car(cache / f"car_{fontes.UF.lower()}.parquet").reset_index(drop=True)
    print("5/7 eventos de fogo (SIPAM)")
    eventos = fontes.eventos_sipam().reset_index(drop=True)
    print("6/7 focos de calor (INPE)")
    focos = fontes.focos_inpe(args.ano).reset_index(drop=True)

    print("7/7 cruzamentos")
    for g in (uc, ti, car):
        g["_area"] = g.to_crs(CRS_AREA).area
        g["_i"] = np.arange(len(g))

    focos["car_i"] = poligono_mais_especifico(focos, car, "_i")
    focos["uc_i"] = poligono_mais_especifico(focos, uc, "_i")
    focos["ti_i"] = poligono_mais_especifico(focos, ti, "_i")
    focos["cat"] = np.select(
        [focos.ti_i >= 0, focos.uc_i >= 0, focos.car_i >= 0], [0, 1, 2], default=3)

    # eventos SIPAM x CAR: área do evento dentro de cada imóvel
    ev_area = eventos.to_crs(CRS_AREA)
    car_area = car[["_i", "geometry"]].to_crs(CRS_AREA)
    pares = gpd.sjoin(ev_area[["id_evento", "geometry"]], car_area, predicate="intersects", how="inner")
    if len(pares):
        geo_ev = ev_area.set_index("id_evento").geometry
        geo_car = car_area.set_index("_i").geometry
        pares["ha"] = [
            geo_ev[e].intersection(geo_car[c]).area / 1e4
            for e, c in zip(pares.id_evento, pares._i)
        ]
        pares = pares[pares.ha > 0]
    queimada_por_car = pares.groupby("_i").agg(area_evento_ha=("ha", "sum"), n_eventos=("id_evento", "nunique"))
    car_por_evento = pares.groupby("id_evento").agg(n_car=("_i", "nunique"), area_car_ha=("ha", "sum"))

    # ---------------------------------------------------------------- saídas
    # imóveis CAR com algum foco ou evento
    com_fogo = set(focos.loc[focos.car_i >= 0, "car_i"]) | set(queimada_por_car.index)
    car_out = car[car._i.isin(com_fogo)].copy()
    car_out = car_out.join(queimada_por_car, on="_i")
    car_out["area_evento_ha"] = car_out.area_evento_ha.fillna(0).round(1)
    car_out["n_eventos"] = car_out.n_eventos.fillna(0).astype(int)
    car_out["area_ha"] = (car_out._area / 1e4).round(1)
    car_out = car_out.rename(columns={"_i": "i", "cod_imovel": "cod", "status_imovel": "status"})
    escrever_geojson(
        car_out[["i", "cod", "status", "condicao", "tipo_imovel", "municipio", "area_ha", "area_evento_ha",
                 "n_eventos", "geometry"]],
        saida / "car.geojson")

    uc["area_ha"] = (uc._area / 1e4).round(0)
    escrever_geojson(
        uc.rename(columns={"_i": "i", "nome_uc": "nome"})[
            ["i", "nome", "categoria", "grupo", "esfera", "org_gestor", "area_ha", "geometry"]],
        saida / "uc.geojson", tolerancia=0.001)

    ti["area_ha"] = (ti._area / 1e4).round(0)
    escrever_geojson(
        ti.rename(columns={"_i": "i", "terrai_nome": "nome", "etnia_nome": "etnia", "fase_ti": "fase"})[
            ["i", "nome", "etnia", "fase", "modalidade_ti", "area_ha", "geometry"]],
        saida / "ti.geojson", tolerancia=0.001)

    mun["i"] = np.arange(len(mun))
    escrever_geojson(mun[["i", "cod_ibge", "nome", "geometry"]], saida / "municipios.geojson", tolerancia=0.002)

    eventos = eventos.join(car_por_evento, on="id_evento")
    eventos["n_car"] = eventos.n_car.fillna(0).astype(int)
    eventos["area_car_ha"] = eventos.area_car_ha.fillna(0).round(1)
    eventos["area_ha"] = (ev_area.area / 1e4).round(1)
    eventos = eventos.drop(columns=["latitude", "longitude", "pais"])
    escrever_geojson(eventos, saida / "eventos.geojson", tolerancia=0.0001)

    # focos em formato colunar (compacto); índices apontam para as listas e GeoJSONs acima
    satelites = sorted(focos.satelite.unique())
    mun_idx = {c: i for i, c in enumerate(mun.cod_ibge)}
    dia0 = pd.Timestamp(f"{args.ano}-01-01")
    colunas = {
        "ano": args.ano,
        "categorias": CATEGORIAS,
        "satelites": satelites,
        "municipios": mun.nome.tolist(),
        "lat": focos.lat.round(4).tolist(),
        "lon": focos.lon.round(4).tolist(),
        "dia": (focos.data_hora_gmt - dia0).dt.days.tolist(),
        "sat": focos.satelite.map({s: i for i, s in enumerate(satelites)}).tolist(),
        "mun": focos.municipio_id.str.strip().map(mun_idx).fillna(-1).astype(int).tolist(),
        "cat": focos.cat.tolist(),
        "car": focos.car_i.tolist(),
        "uc": focos.uc_i.tolist(),
        "ti": focos.ti_i.tolist(),
        "frp": focos.frp.fillna(0).round(1).tolist(),
    }
    (saida / "focos.json").write_text(json.dumps(colunas, separators=(",", ":")))
    print(f"  focos.json: {len(focos)} focos, {(saida / 'focos.json').stat().st_size / 1e6:.1f} MB")

    meta = {
        "atualizado_em": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "uf": fontes.UF,
        "ano": args.ano,
        "totais": {
            "focos": len(focos),
            "eventos_sipam": len(eventos),
            "imoveis_car_uf": len(car),
            "imoveis_car_com_fogo": len(car_out),
            "ucs": len(uc),
            "tis": len(ti),
        },
        "fontes": {
            "focos": "INPE – Programa Queimadas (dataserver-coids.inpe.br)",
            "eventos": "Censipam/SIPAM – Painel do Fogo (panorama.sipam.gov.br)",
            "car": "SICAR – Cadastro Ambiental Rural (geoserver.car.gov.br)",
            "uc": "MMA – Cadastro Nacional de Unidades de Conservação",
            "ti": "FUNAI – Terras Indígenas (geoserver.funai.gov.br)",
            "municipios": "IBGE – Malhas territoriais",
        },
    }
    (saida / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print("ok")


if __name__ == "__main__":
    main()
