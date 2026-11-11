# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Site estático (HTML + CSS + JS puro, MapLibre GL 4.7.1), publicado no GitHub Pages; dados gerados por `pipeline/build.py` e lidos como JSON/GeoJSON em `site/data`. Sem framework nem etapa de build no front.

## Users

Gestores e técnicos públicos (órgãos ambientais, defesa civil, secretarias) do Amazonas que decidem mobilização e resposta a incêndios. Usam no computador, em escritório ou sala de situação, para ler a situação do dia, filtrar por período e município e imprimir relatórios. Cidadãos e imprensa podem consultar (o painel é público), mas não são o público de projeto.

## Product Purpose

Cruzar focos de calor (INPE) e eventos de fogo (SIPAM) com a situação fundiária do Amazonas (imóveis do CAR, unidades de conservação, terras indígenas, áreas sem cadastro) para mostrar onde o fogo está, em que terreno e município, quando, e onde a mobilização de equipes é mais urgente. Sucesso: o gestor responde "onde mandar equipe hoje?" sem precisar de analista.

## Positioning

Painel que liga o fogo ao dono e à categoria do terreno e estima a logística de deslocamento (terrestre, fluvial, aérea) com premissas editáveis; um painel de satélite genérico não mostra de quem é a terra nem o custo de chegar lá.

## Operating Context

Telas: Visão geral, Mapa interativo, Mobilização, Metodologia e Relatórios (estado ou município, para imprimir/PDF). Filtros globais: ano, período (hoje, 7, 30, 90 dias, ano), município e método de contagem de focos. Atualização automática duas vezes ao dia (07:00 e 21:00 de Brasília) por GitHub Action.

## Capabilities and Constraints

Funções, dados, abas e textos permanecem; o redesign é só visual (`site/index.html`, `site/style.css`, `site/app.js`, `site/relatorio.css`). Fontes: INPE, Censipam/SIPAM, SICAR, MMA/CNUC, FUNAI, IBGE, DNIT, OpenStreetMap, Copernicus/CAMS, AQICN. Tabelas e mapa precisam continuar legíveis em tela de notebook e na impressão.

## Brand Commitments

Assinatura "NEX – Hub de Análises Estratégicas" e título "Fogo no Amazonas" permanecem. O visual segue a linguagem institucional dos painéis públicos brasileiros de geoinformação, mas não usa brasão, logo gov.br, nem marca de nenhum órgão: o painel não é um site oficial de governo e não deve parecer um.

## Evidence on Hand

Dados reais e diários em `site/data`. Referências visuais indicadas pelo usuário (leitura em 11/11/2026): AdaptaBrasil/MCTI (padrão gov.br: Rawline, azul #1351B4, painel flutuante recolhível sobre mapa), DNIT VGeo (mapa em tela cheia, botões brancos flutuantes), Esri (Avenir Next, azul #0079C1, faixas escuras, botões retos).

## Product Principles

1. O mapa e os números do dia vêm primeiro; a moldura não compete com eles.
2. Todo número mostra sua fonte e seu período.
3. Linguagem simples para quem decide, rigor metodológico a um clique.
4. Parece instituição séria, nunca site oficial falso.

## Accessibility & Inclusion

Contraste mínimo WCAG AA, foco visível por teclado, rótulos em português, não depender só de cor para classes de prioridade e qualidade do ar. Impressão em A4 preservada.
