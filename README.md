# Fogo no Amazonas — painel público

**Um produto NEX – Hub de Análises Estratégicas.**

Painel público que cruza focos de calor (INPE) e eventos de fogo (SIPAM) com a situação fundiária do Amazonas:
em que imóvel do CAR, unidade de conservação, terra indígena ou área sem cadastro o fogo está acontecendo, em que
município, quando, e onde a mobilização de equipes é mais urgente.

Acesse: **https://dsalcodaa.github.io/WEBMAP-FOGO/**

Site estático (GitHub Pages) atualizado todo dia às 07:00 (Brasília) por um GitHub Action. Não precisa de servidor.

## Telas

| Tela | O que tem |
|---|---|
| **Visão geral** | Resumo em texto simples, indicadores, focos por dia, distribuição fundiária e rankings de municípios (com tendência de 7 dias), imóveis do CAR, UCs e TIs |
| **Mapa interativo** | Mapa com focos, eventos SIPAM coloridos por prioridade, CAR, UCs, TIs e sedes municipais, com painel lateral de eventos prioritários e municípios |
| **Mobilização** | Eventos ordenados pelo índice de prioridade (0–100), municípios que precisam de mobilização e deslocamento estimado (terrestre, fluvial e aéreo), com premissas editáveis |
| **Metodologia** | Explicação completa dos cálculos, fontes e limitações |
| **Relatórios** | Relatório para imprimir ou salvar em PDF, do estado ou de um município, respeitando os filtros |

## Fontes

| Dado | Fonte | Acesso |
|---|---|---|
| Focos de calor (todos os satélites, ano corrente) | INPE – Programa Queimadas | CSV mensal/diário em `dataserver-coids.inpe.br` |
| Eventos de fogo e índice de prioridade | Censipam/SIPAM – Painel do Fogo | API REST `panorama.sipam.gov.br/painel-do-fogo/api` |
| Imóveis rurais | SICAR – Cadastro Ambiental Rural | WFS `geoserver.car.gov.br`, camada `sicar:sicar_imoveis_am` |
| Unidades de conservação | MMA – CNUC | Shapefile em `dados.mma.gov.br` |
| Terras indígenas | FUNAI | WFS `geoserver.funai.gov.br` |
| Municípios | IBGE | API de malhas |
| Sedes municipais | Compilação aberta `kelvins/municipios-brasileiros` | CSV |
| Rodovias | OpenStreetMap | Overpass API |
| Qualidade do ar (modelo) | Copernicus CAMS | API `air-quality-api.open-meteo.com` |
| Qualidade do ar (estações, opcional) | AQICN / WAQI | API `api.waqi.info`, token no secret `WAQI_TOKEN` |

## Metodologia (resumo)

A explicação completa está na aba **Metodologia** do site.

- **Anos anteriores.** Seletor de ano desde 2003 (início da série oficial pelo satélite de referência), a partir
  dos arquivos anuais do INPE (`anual/Brasil_todos_sats`). O recorte do AM de cada ano fica em `cache/historico/`
  (cache próprio no Actions). CAR, UCs e TIs usam os limites atuais; eventos e qualidade do ar são sempre de hoje.
- **Contagem de focos.** O padrão é o **número oficial do INPE**: só o satélite de referência (AQUA_M-T, usado em
  toda a série oficial desde 2003), o mesmo usado pelo INPE, Ibama, governos e imprensa, comparável entre anos. Opções:
  *lugares com fogo por dia* (todos os satélites, uma célula de ~1 km por dia; método deste painel, não comparável
  com o oficial) e *todas as detecções* (uso técnico; conta o mesmo fogo ~3,6 vezes). Duplicatas entre os arquivos
  mensal e diário do INPE são removidas.
- **Eventos SIPAM.** Vêm prontos da API do Painel do Fogo (Censipam), que agrupa focos próximos no espaço e no tempo.
  O painel não cria eventos; só acrescenta CAR, áreas protegidas, focos recentes, distâncias e a nota de prioridade.
- **Qualidade do ar.** Média de 24 h de PM2,5 e PM10 na sede de cada município, do modelo Copernicus/CAMS via
  Open-Meteo (grátis, sem chave), classificada pelo Índice de Qualidade do Ar do MMA (CONAMA 491/2018). Estações
  medidas da rede AQICN aparecem se o secret `WAQI_TOKEN` estiver configurado (token grátis em
  https://aqicn.org/data-platform/token/). IQAir e Google Air Quality não foram usados: o Google exige conta com
  cobrança, e o plano grátis do IQAir é limitado a 5 chamadas por minuto e a poucas cidades do AM.
- **Situação fundiária.** Ordem de precedência: TI > UC > Imóvel CAR > Sem cadastro. Polígonos do CAR sobrepostos:
  o foco vai para o menor. Imóveis com CAR cancelado são excluídos. O CAR é autodeclaratório e não comprova
  propriedade nem autoria do fogo, e o CAR público não traz nome/CPF do declarante (LGPD).
- **Área dos eventos.** O polígono é a área de influência das detecções, não a área queimada medida. A área do
  evento em imóveis do CAR usa a união dos imóveis, para não contar sobreposições duas vezes.
- **Prioridade de mobilização (0–100).** Pesos: índice de acionamento do SIPAM 30, focos únicos nas últimas 48 h
  25, área 15, persistência 10, área sensível (TI/UC/quilombo/assentamento) 10, status ativo 10. Classes:
  Crítica ≥ 70, Alta ≥ 50, Moderada ≥ 30.
- **Deslocamento estimado.** Distância em linha reta até a sede municipal mais próxima, corrigida por tortuosidade:
  terrestre ×1,4 a 40 km/h, só se houver rodovia a até 5 km; fluvial ×1,8 a 25 km/h. O aéreo é helicóptero
  saindo de Manaus a 180 km/h. Os custos são de ida e volta, e as premissas são editáveis no site. São estimativas
  de planejamento, não rotas reais.
- **Tendência.** Compara os últimos 7 dias completos com os 7 anteriores. O dia corrente, ainda incompleto, fica
  de fora.

## Rodar localmente

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Linux/macOS: .venv/bin/pip
.venv/Scripts/python pipeline/build.py             # gera site/data/
cd site && python -m http.server 8000              # abra http://localhost:8000
```

O CAR (~99 mil polígonos) fica em `cache/` por 7 dias, e as rodovias do OSM por 30 dias.

## Publicação

O workflow `.github/workflows/publicar.yml` roda a cada push, todo dia às 07:00 (Brasília) e manualmente em
**Actions → Atualizar dados e publicar → Run workflow**. O GitHub pausa workflows agendados em repositórios sem
commits por 60 dias; para reativar, clique em **Enable workflow** na aba Actions.

## Estrutura

```
pipeline/fontes.py    coleta de cada fonte
pipeline/build.py     focos únicos, cruzamentos, prioridade, logística e geração de site/data/
site/index.html       painel (abas: visão geral, mapa, mobilização, metodologia)
site/nucleo.js        filtros, agregações e cálculos compartilhados
site/app.js           interface do painel
site/metodologia.js   texto da metodologia
site/relatorio.*      relatório para impressão (estado ou município)
```

Para outro estado, mude `UF` e `UF_IBGE` em `pipeline/fontes.py`.
