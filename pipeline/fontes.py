"""Coleta de dados das fontes públicas (INPE, SIPAM, SICAR, MMA/CNUC, FUNAI, IBGE, CAMS, AQICN)."""
import io
import os
import re
import ssl
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from shapely.geometry import LineString, Point, shape

UF = "AM"
UF_IBGE = 13
UF_NOME = "AMAZONAS"  # como aparece nos arquivos anuais do INPE
CRS = "EPSG:4674"  # SIRGAS 2000

INPE_BASE = "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv"
SIPAM_BASE = "https://panorama.sipam.gov.br/painel-do-fogo/api/v1"
CAR_WFS = "https://geoserver.car.gov.br/geoserver/sicar/wfs"
FUNAI_WFS = "https://geoserver.funai.gov.br/geoserver/Funai/ows"
CNUC_DATASET = "https://dados.mma.gov.br/dataset/unidadesdeconservacao"
IBGE_MALHA = "https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}"
IBGE_MUNICIPIOS = "https://servicodados.ibge.gov.br/api/v1/localidades/estados/{uf}/municipios"
# coordenadas das sedes municipais (compilação aberta baseada no IBGE; a API do IBGE não traz coordenadas)
SEDES_CSV = "https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
DNIT_WFS = "https://servicos.dnit.gov.br/dnitgeo/geoserver/ows"  # o mesmo servidor do visualizador VGeo


class _LegacyTLS(HTTPAdapter):
    # geoserver.car.gov.br recusa o handshake com o nível de segurança padrão do OpenSSL 3
    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.set_ciphers("DEFAULT@SECLEVEL=1")
        ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)


session = requests.Session()
session.headers["User-Agent"] = "webmap-fogo/1.0 (+https://github.com)"
session.mount("https://geoserver.car.gov.br", _LegacyTLS())


def get(url, tentativas=4, **kwargs):
    kwargs.setdefault("timeout", 180)
    for i in range(tentativas):
        try:
            r = session.get(url, **kwargs)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if i == tentativas - 1:
                raise
            print(f"  retry {i + 1} {url}: {e}")
            time.sleep(5 * (i + 1))


# ---------------------------------------------------------------- INPE

def focos_inpe(ano: int) -> gpd.GeoDataFrame:
    """Focos de calor do ano (arquivos mensais) + últimos dias (diários), filtrados para a UF."""
    hoje = date.today()
    meses = range(1, (hoje.month if ano == hoje.year else 12) + 1)
    urls = [f"{INPE_BASE}/mensal/Brasil/focos_mensal_br_{ano}{m:02d}.csv" for m in meses]
    if ano == hoje.year:
        idx = get(f"{INPE_BASE}/diario/Brasil/").text
        diarios = sorted(set(re.findall(r'href="(focos_diario_br_\d{8}\.csv)"', idx)))
        urls += [f"{INPE_BASE}/diario/Brasil/{f}" for f in diarios[-3:]]

    partes = []
    for url in urls:
        print("  INPE", url.rsplit("/", 1)[-1])
        try:
            df = pd.read_csv(io.BytesIO(get(url).content), dtype=str)
        except requests.HTTPError as e:
            print("   ignorado:", e)
            continue
        partes.append(df[df["estado_id"].str.strip() == str(UF_IBGE)])

    df = pd.concat(partes, ignore_index=True).drop_duplicates("id")
    for c in ["lat", "lon", "frp", "risco_fogo", "precipitacao", "numero_dias_sem_chuva"]:
        df[c] = pd.to_numeric(df[c].str.strip(), errors="coerce")
    df["data_hora_gmt"] = pd.to_datetime(df["data_hora_gmt"])
    df = df[df["data_hora_gmt"].dt.year == ano]
    return gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df.lon, df.lat), crs=CRS)


def focos_inpe_historico(ano: int, cache: Path) -> gpd.GeoDataFrame:
    """Focos de um ano fechado (arquivo anual de todos os satélites, Brasil inteiro), filtrados para a UF.
    O arquivo do Brasil chega a 110 MB; o recorte da UF fica em cache, pois anos passados não mudam."""
    arq = cache / f"focos_{UF.lower()}_{ano}.parquet"
    if arq.exists():
        df = pd.read_parquet(arq)
    else:
        print(f"  INPE anual {ano}")
        try:
            r = get(f"{INPE_BASE}/anual/Brasil_todos_sats/focos_br_todos-sats_{ano}.zip", tentativas=2, timeout=900)
        except requests.HTTPError:
            # o arquivo anual sai meses depois da virada do ano; até lá, usa os mensais (sem cache)
            print(f"  anual {ano} indisponível, usando os arquivos mensais")
            return focos_inpe(ano)
        z = zipfile.ZipFile(io.BytesIO(r.content))
        df = pd.read_csv(z.open(z.namelist()[0]), dtype=str,
                         usecols=["latitude", "longitude", "data_pas", "satelite", "estado", "frp"])
        df = df[df.estado.str.strip().str.upper() == UF_NOME].drop(columns="estado")
        df = df.rename(columns={"latitude": "lat", "longitude": "lon", "data_pas": "data_hora_gmt"})
        for c in ["lat", "lon", "frp"]:
            df[c] = pd.to_numeric(df[c].str.strip(), errors="coerce")
        df["satelite"] = df.satelite.str.strip()
        df["data_hora_gmt"] = pd.to_datetime(df.data_hora_gmt)
        df = df.reset_index(drop=True)
        arq.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(arq)
    df["id"] = np.arange(len(df))
    return gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df.lon, df.lat), crs=CRS)


# ---------------------------------------------------------------- SIPAM

def eventos_sipam() -> gpd.GeoDataFrame:
    """Eventos de fogo ativos ou em observação (polígonos) do Painel do Fogo."""
    dados = get(f"{SIPAM_BASE}/eventos", params={"sigla_estado": UF}).json()
    linhas = []
    for ev in dados:
        if not ev.get("geom"):
            continue
        props = {k: v for k, v in ev.items() if k not in ("geom", "retangulo_envolvente")}
        props["geometry"] = shape(ev["geom"])
        linhas.append(props)
    return gpd.GeoDataFrame(linhas, geometry="geometry", crs=CRS)


def prioridades_sipam(ids) -> dict:
    """Índice de prioridade de acionamento do SIPAM por evento.
    A listagem em lote só devolve os 999 maiores do país; os demais vêm do histórico de cada evento."""
    indice = {p["id_evento"]: p["indice"]
              for p in get(f"{SIPAM_BASE}/eventos/prioridades", params={"limite": 999}).json()}
    faltam = [i for i in ids if i not in indice]

    def ultimo(i):
        try:
            hist = get(f"{SIPAM_BASE}/eventos/{i}/prioridades", tentativas=2, timeout=60).json()
        except requests.RequestException:
            return i, None
        return i, max(hist, key=lambda h: h["dt_maxima"])["indice"] if hist else None

    with ThreadPoolExecutor(6) as ex:
        indice.update(dict(ex.map(ultimo, faltam)))
    return {i: indice.get(i) for i in ids}


# ---------------------------------------------------------------- SICAR

def imoveis_car(cache: Path, max_idade_dias=7, pagina=5000) -> gpd.GeoDataFrame:
    """Polígonos de imóveis do CAR da UF via WFS paginado. Cache local em GeoParquet."""
    if cache.exists() and (time.time() - cache.stat().st_mtime) < max_idade_dias * 86400:
        print("  CAR do cache", cache)
        return gpd.read_parquet(cache)

    camada = f"sicar:sicar_imoveis_{UF.lower()}"
    partes, inicio = [], 0
    while True:
        print(f"  CAR startIndex={inicio}")
        r = get(CAR_WFS, params={
            "service": "WFS", "version": "2.0.0", "request": "GetFeature",
            "typeNames": camada, "outputFormat": "application/json",
            "count": pagina, "startIndex": inicio, "sortBy": "cod_imovel",
        }, timeout=600)
        fc = r.json()
        feats = fc.get("features", [])
        if not feats:
            break
        partes.append(gpd.GeoDataFrame.from_features(feats, crs=CRS))
        inicio += len(feats)
        if len(feats) < pagina:
            break

    gdf = pd.concat(partes, ignore_index=True)
    gdf = gpd.GeoDataFrame(gdf, geometry="geometry", crs=CRS).drop_duplicates("cod_imovel")
    gdf["geometry"] = gdf.geometry.make_valid()
    cache.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(cache)
    return gdf


# ---------------------------------------------------------------- IBGE

def limite_uf() -> gpd.GeoDataFrame:
    r = get(IBGE_MALHA.format(uf=UF_IBGE), params={"formato": "application/vnd.geo+json", "qualidade": "intermediaria"})
    return gpd.GeoDataFrame.from_features(r.json()["features"], crs=CRS)


def municipios() -> gpd.GeoDataFrame:
    r = get(IBGE_MALHA.format(uf=UF_IBGE), params={
        "formato": "application/vnd.geo+json", "qualidade": "intermediaria", "intrarregiao": "municipio"})
    gdf = gpd.GeoDataFrame.from_features(r.json()["features"], crs=CRS)
    nomes = {str(m["id"]): m["nome"] for m in get(IBGE_MUNICIPIOS.format(uf=UF_IBGE)).json()}
    gdf["cod_ibge"] = gdf["codarea"].astype(str)
    gdf["nome"] = gdf["cod_ibge"].map(nomes)
    return gdf[["cod_ibge", "nome", "geometry"]]


def sedes_municipais() -> gpd.GeoDataFrame:
    df = pd.read_csv(io.BytesIO(get(SEDES_CSV).content), dtype={"codigo_ibge": str})
    df = df[df.codigo_uf == UF_IBGE]
    return gpd.GeoDataFrame(
        {"cod_ibge": df.codigo_ibge, "nome": df.nome, "capital": df.capital == 1},
        geometry=gpd.points_from_xy(df.longitude, df.latitude), crs=CRS).reset_index(drop=True)


# ---------------------------------------------------------------- DNIT (VGeo)

# superfície das rodovias federais no SNV; PLA (planejada) não existe no terreno e fica de fora
SUPERFICIE_SNV = {"DUP": "Pavimentada (duplicada)", "PAV": "Pavimentada", "EOD": "Em obras de duplicação",
                  "EOP": "Em obras de pavimentação", "IMP": "Implantada (leito natural)",
                  "EOI": "Em obras de implantação", "TRV": "Travessia (balsa)"}


def _dnit_params(camada, filtro, **extra):
    return {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": f"vgeo:{camada}",
            "outputFormat": "application/json", "srsName": "EPSG:4326", "CQL_FILTER": filtro, **extra}


def _dnit(camada: str, filtro: str) -> gpd.GeoDataFrame:
    feats = get(DNIT_WFS, params=_dnit_params(camada, filtro)).json()["features"]
    return gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326").to_crs(CRS)


def dnit(uf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Rodovias federais (SNV, versão mais recente), pistas de pouso e portos do DNIT, recortados para a UF."""
    # o SNV guarda todas as versões desde 2013; busca só o campo da versão para achar a mais recente
    feats = get(DNIT_WFS, params=_dnit_params("vw_snv_rod", f"Unidade_Federacao='{UF}'",
                                             propertyName="Versao_SNV")).json()["features"]
    versao = max(f["properties"]["Versao_SNV"] for f in feats)
    rod = _dnit("vw_snv_rod", f"Unidade_Federacao='{UF}' AND Versao_SNV='{versao}'")
    rod = rod[rod.Superficie_Federal.isin(SUPERFICIE_SNV)]
    rod = gpd.GeoDataFrame({
        "tipo": "rodovia", "nome": "BR-" + rod.Codigo_BR.astype(str),
        "detalhe": rod.Superficie_Federal.map(SUPERFICIE_SNV),
        "trecho": rod.Local_Inicio.fillna("") + " → " + rod.Local_Fim.fillna(""),
        "snv": rod.Codigo_SNV, "versao": rod.Versao_SNV,
    }, geometry=rod.geometry.values, crs=CRS)

    pis = _dnit("vw_aerodromos", f"Unidade_Federacao='{UF}'")
    pis = gpd.GeoDataFrame({
        "tipo": "pista", "nome": pis.Nome.fillna(pis.Codigo_ICAO),
        "detalhe": pis.Municipio.fillna("") + " · " + pis.Extensao_m.fillna(0).astype(int).astype(str) + " m de "
                   + pis.Pavimento.fillna("pavimento não informado") + " · "
                   + pis.Uso.map({"PUB": "pública", "PRIV": "privada"}).fillna("uso não informado"),
        "codigo": pis.Codigo_ICAO,
    }, geometry=pis.geometry.representative_point().values, crs=CRS)

    por = _dnit("vw_portos", f"Unidade_Federacao='{UF}'")
    por = gpd.GeoDataFrame({
        "tipo": "porto", "nome": por.Nome,
        "detalhe": por.Classe.fillna("") + " · " + por.Acesso_Fluvial.fillna(por.Hidrovia.fillna("")),
    }, geometry=por.geometry.representative_point().values, crs=CRS)

    tudo = pd.concat([rod, pis, por], ignore_index=True)
    return gpd.GeoDataFrame(tudo[tudo.intersects(uf.union_all())], crs=CRS)


# ---------------------------------------------------------------- qualidade do ar

OPEN_METEO_AR = "https://air-quality-api.open-meteo.com/v1/air-quality"
WAQI_BOUNDS = "https://api.waqi.info/v2/map/bounds"


def ar_modelo(pontos: gpd.GeoDataFrame) -> list[dict]:
    """PM2.5 e PM10 horários (últimas 24 h) do modelo CAMS via Open-Meteo, para cada ponto. Grátis, sem chave."""
    dados = get(OPEN_METEO_AR, params={
        "latitude": ",".join(f"{y:.3f}" for y in pontos.geometry.y),
        "longitude": ",".join(f"{x:.3f}" for x in pontos.geometry.x),
        "current": "pm2_5,pm10", "hourly": "pm2_5,pm10",
        "past_days": 1, "forecast_days": 1, "timezone": "America/Manaus",
    }).json()
    return dados if isinstance(dados, list) else [dados]


def ar_estacoes(uf: gpd.GeoDataFrame) -> list[dict]:
    """Estações de medição na UF (rede AQICN/WAQI). Precisa do token grátis em WAQI_TOKEN; sem ele, lista vazia."""
    token = os.environ.get("WAQI_TOKEN")
    if not token:
        print("  WAQI_TOKEN não definido: estações AQICN ignoradas")
        return []
    x0, y0, x1, y1 = uf.total_bounds
    r = get(WAQI_BOUNDS, params={"latlng": f"{y0},{x0},{y1},{x1}", "networks": "all", "token": token}).json()
    if r.get("status") != "ok":
        print("  AQICN:", r.get("data"))
        return []
    area = uf.union_all()
    return [{"nome": s["station"]["name"], "lat": s["lat"], "lon": s["lon"], "aqi": int(s["aqi"]),
             "hora": s["station"].get("time")}
            for s in r["data"] if str(s["aqi"]).isdigit() and area.contains(Point(s["lon"], s["lat"]))]


# ---------------------------------------------------------------- OpenStreetMap

def vias_osm(cache: Path, max_idade_dias=30) -> gpd.GeoDataFrame:
    """Rodovias principais (trunk a tertiary) da UF via Overpass. Cache local de 30 dias."""
    if cache.exists() and (time.time() - cache.stat().st_mtime) < max_idade_dias * 86400:
        return gpd.read_parquet(cache)
    consulta = (f'[out:json][timeout:170];area["ISO3166-2"="BR-{UF}"]->.a;'
                'way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](area.a);out geom;')
    for url in OVERPASS:
        try:
            r = session.post(url, data={"data": consulta}, timeout=240)
            r.raise_for_status()
            elementos = r.json()["elements"]
            break
        except (requests.RequestException, ValueError) as e:
            print("  Overpass falhou:", url, e)
    else:
        if cache.exists():
            print("  usando cache antigo de vias")
            return gpd.read_parquet(cache)
        raise RuntimeError("Overpass indisponível e sem cache de vias")

    linhas = [e for e in elementos if len(e.get("geometry", [])) > 1]
    gdf = gpd.GeoDataFrame(
        {"highway": [e["tags"].get("highway") for e in linhas]},
        geometry=[LineString([(p["lon"], p["lat"]) for p in e["geometry"]]) for e in linhas],
        crs="EPSG:4326").to_crs(CRS)
    cache.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(cache)
    return gdf


# ---------------------------------------------------------------- MMA / CNUC

def unidades_conservacao(uf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Shapefile mais recente do CNUC, recortado para a UF."""
    html = get(CNUC_DATASET).text
    zips = sorted(set(re.findall(r'href="(https?://[^"]+/shp_cnuc_(\d{4})_(\d{2})[^"]*\.zip)"', html)),
                  key=lambda t: (t[1], t[2]))
    url = zips[-1][0]
    print("  CNUC", url.rsplit("/", 1)[-1])
    z = zipfile.ZipFile(io.BytesIO(get(url, timeout=600).content))
    shp = next(n for n in z.namelist() if n.lower().endswith(".shp"))
    tmp = Path("cache/cnuc")
    tmp.mkdir(parents=True, exist_ok=True)
    z.extractall(tmp)
    # o DBF é UTF-8 com campos truncados no meio de caracteres; lê como latin1 e decodifica tolerante
    gdf = gpd.read_file(tmp / shp, encoding="latin1").to_crs(CRS)
    for c in gdf.drop(columns="geometry").select_dtypes(include=["object", "string"]).columns:
        gdf[c] = gdf[c].map(lambda s: s.encode("latin1").decode("utf-8", "ignore") if isinstance(s, str) else s)
    gdf = gdf[gdf.intersects(uf.union_all())].copy()
    gdf["geometry"] = gdf.geometry.make_valid()
    return gdf


# ---------------------------------------------------------------- FUNAI

FUNAI_CA_INTERMEDIARIA = "http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt"


def _bundle_funai() -> str:
    # servidor da FUNAI não envia a CA intermediária; baixa pelo AIA e junta ao bundle do certifi
    import certifi
    destino = Path("cache/funai-ca.pem")
    if not destino.exists():
        der = get(FUNAI_CA_INTERMEDIARIA).content
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(Path(certifi.where()).read_text() + "\n" + ssl.DER_cert_to_PEM_cert(der))
    return str(destino)


def terras_indigenas(uf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    minx, miny, maxx, maxy = uf.total_bounds
    r = get(FUNAI_WFS, params={
        "service": "WFS", "version": "1.0.0", "request": "GetFeature",
        "typeName": "Funai:tis_poligonais", "outputFormat": "application/json",
        "bbox": f"{minx},{miny},{maxx},{maxy},EPSG:4674", "srsName": "EPSG:4674",
    }, timeout=600, verify=_bundle_funai())
    gdf = gpd.GeoDataFrame.from_features(r.json()["features"], crs=CRS)
    gdf = gdf[gdf.intersects(uf.union_all())].copy()
    gdf["geometry"] = gdf.geometry.make_valid()
    return gdf
