# Fogo no Amazonas — webmap e dashboard

Cruza focos de calor e eventos de fogo com a situação fundiária do Amazonas: em que imóvel do CAR, unidade de
conservação, terra indígena ou área sem cadastro o fogo está acontecendo, em que município e quando.

Site estático (GitHub Pages) atualizado todo dia por um GitHub Action. Não precisa de servidor nem banco.

## Fontes

| Dado | Fonte | Acesso |
|---|---|---|
| Focos de calor (todos os satélites, ano corrente) | INPE – Programa Queimadas | CSV mensal/diário em `dataserver-coids.inpe.br` |
| Eventos de fogo (polígonos, persistência, domínio) | Censipam/SIPAM – Painel do Fogo | API REST `panorama.sipam.gov.br/painel-do-fogo/api` |
| Imóveis rurais | SICAR – Cadastro Ambiental Rural | WFS `geoserver.car.gov.br`, camada `sicar:sicar_imoveis_am` |
| Unidades de conservação | MMA – CNUC | Shapefile em `dados.mma.gov.br` |
| Terras indígenas | FUNAI | WFS `geoserver.funai.gov.br` |
| Municípios e limite estadual | IBGE | API de malhas |

### Limites dos dados

- **Dono do imóvel:** o CAR público não traz nome nem CPF/CNPJ do declarante (LGPD). O site mostra o código do imóvel,
  que pode ser consultado na [consulta pública do CAR](https://consultapublica.car.gov.br/publico/imoveis/index).
  SNCR e "Meu Imóvel Rural" não têm consulta em massa; o primeiro aceita apenas consultas unitárias e o segundo
  exige login gov.br do próprio titular.
- **CAR é autodeclaratório** e tem polígonos sobrepostos. Quando um foco cai em mais de um imóvel, é atribuído ao menor.
- **Classificação do foco:** Terra Indígena > Unidade de Conservação > Imóvel CAR > Sem cadastro.
- **Focos ≠ área queimada.** Satélites diferentes detectam o mesmo fogo; use o filtro de satélite para comparações
  (o INPE usa um satélite de referência para séries históricas).
- **SIGEF/INCRA** (parcelas certificadas) não está incluído: o Acervo Fundiário não respondeu de forma estável.

## Rodar localmente

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Linux/macOS: .venv/bin/pip
.venv/Scripts/python pipeline/build.py             # gera site/data/
cd site && python -m http.server 8000              # abra http://localhost:8000
```

O CAR (~99 mil polígonos) é baixado uma vez e fica em `cache/` por 7 dias.

## Publicar no GitHub Pages

1. Crie o repositório no GitHub e faça push para `main`.
2. Em **Settings → Pages**, em *Build and deployment*, escolha **Source: GitHub Actions**.
3. O workflow `.github/workflows/publicar.yml` roda a cada push, todo dia às 07:00 (Brasília) e manualmente em
   **Actions → Atualizar dados e publicar → Run workflow**.

## Estrutura

```
pipeline/fontes.py   coleta de cada fonte
pipeline/build.py    cruzamentos espaciais e geração de site/data/
site/                página estática (MapLibre + Chart.js)
```

Para outro estado, mude `UF` e `UF_IBGE` em `pipeline/fontes.py` (a camada do CAR segue o padrão `sicar_imoveis_<uf>`).
