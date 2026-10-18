// Texto da metodologia, usado na aba Metodologia (completo) e no relatório impresso (resumido).

function textoMetodologia(meta, completo = true) {
  const t = meta.totais, p = meta.parametros, w = p.pesos_prioridade;
  const pct = (a, b) => Math.round(100 * a / b);
  const fonte = Object.values(meta.fontes).map(f => `<li>${esc(f)}</li>`).join('');

  const resumo = `
    <h3>Focos de calor</h3>
    <p>Os satélites detectam pontos quentes na superfície (focos de calor). O mesmo fogo é detectado várias vezes ao dia:
      o GOES-19 passa a cada 10 minutos, e os sensores VIIRS estão em três satélites. Somar todas as detecções
      (${fmt(t.deteccoes_brutas)} no ano) superestima o número de incêndios. Por isso o painel usa, por padrão,
      <b>focos únicos</b>: um foco por célula de ~${Math.round(p.celula_graus * 111)} km por dia, juntando todos os satélites
      (${fmt(t.focos_unicos)} no ano, ${pct(t.focos_unicos, t.deteccoes_brutas)}% das detecções). Também removemos
      ${fmt(t.deteccoes_brutas - t.deteccoes_sem_duplicatas)} detecções repetidas entre os arquivos mensal e diário do INPE.
      Para comparar com as séries oficiais, use o <b>satélite de referência</b> (${esc(p.satelite_referencia)}).</p>
    <h3>Situação fundiária</h3>
    <p>Cada foco é classificado na ordem: Terra Indígena &gt; Unidade de Conservação &gt; Imóvel do CAR &gt; Sem cadastro.
      Quando um foco cai em mais de um imóvel do CAR (os polígonos se sobrepõem), é atribuído ao menor.
      Imóveis com cadastro cancelado (${fmt(t.imoveis_car_cancelados_excluidos)}) foram excluídos.
      O CAR é autodeclaratório e <b>não comprova propriedade nem autoria do fogo</b>.</p>
    <h3>Prioridade de mobilização</h3>
    <p>Índice de 0 a 100 por evento do SIPAM: índice oficial de acionamento do SIPAM (${w.indice_sipam}),
      focos únicos nas últimas 48 h até ${p.buffer_evento_m / 1000} km do evento (${w.focos_48h}), área (${w.area}),
      persistência em dias (${w.persistencia}), atinge terra indígena, UC, quilombo ou assentamento (${w.area_sensivel})
      e status ativo (${w.ativo}). Os quatro primeiros são convertidos em percentil entre os eventos do estado.
      Classes: Crítica ≥ ${p.classes_prioridade['Crítica']}, Alta ≥ ${p.classes_prioridade['Alta']},
      Moderada ≥ ${p.classes_prioridade['Moderada']}.</p>
    <h3>Deslocamento estimado</h3>
    <p>Distâncias em linha reta, corrigidas por fator de tortuosidade (estrada ×1,4; rio ×1,8). Acesso terrestre é
      considerado provável quando há rodovia do OpenStreetMap a até 5 km do evento. Helicóptero sai de Manaus.
      São estimativas de planejamento, não rotas reais.</p>`;

  if (!completo) return resumo;

  return `
    <h2>Metodologia</h2>
    <p class="destaque">Este painel é um produto <b>${esc(PRODUTO)}</b>. Ele cruza dados públicos oficiais para mostrar
      onde o fogo está acontecendo no Amazonas, em que tipo de terra e onde a resposta é mais urgente.
      Os dados são atualizados automaticamente todo dia às 07:00 (horário de Brasília).</p>

    <h3>Fontes de dados</h3>
    <ul>${fonte}</ul>

    <h3>1. Focos de calor e como contamos</h3>
    <p>Um <b>foco de calor</b> é um pixel de imagem de satélite com temperatura muito acima do entorno, quase sempre
      fogo em vegetação. Um foco não é um incêndio: um incêndio grande gera muitos focos, e um fogo pequeno ou sob
      nuvens pode não ser detectado.</p>
    <p>O mesmo fogo é detectado várias vezes por dia. O GOES-19, geoestacionário, faz uma imagem a cada 10 minutos;
      os sensores VIIRS estão a bordo de três satélites (NOAA-20, NOAA-21 e Suomi-NPP), e há ainda MODIS e METOP.
      Na auditoria dos dados de ${meta.ano}, encontramos ${fmt(t.deteccoes_brutas)} detecções brutas no Amazonas,
      que correspondem a ${fmt(t.focos_unicos)} focos únicos: <b>somar todas as detecções superestima o fogo em
      ${fmt1(t.deteccoes_brutas / t.focos_unicos)} vezes</b>.</p>
    <p>O painel oferece três formas de contar:</p>
    <ul>
      <li><b>Focos únicos (padrão):</b> agrupa as detecções de todos os satélites numa grade de
        ${p.celula_graus}° (~${Math.round(p.celula_graus * 111)} km) e conta uma por célula por dia. É a melhor
        estimativa de quantos lugares queimaram em cada dia.</li>
      <li><b>Satélite de referência:</b> só as detecções do ${esc(p.satelite_referencia)}, que o INPE usa desde 2002
        para comparar anos. Passa uma vez por tarde, então subestima, mas é comparável com as séries oficiais
        (${fmt(t.deteccoes_satelite_referencia)} no ano).</li>
      <li><b>Todas as detecções:</b> o número bruto, útil para análises técnicas. Não use como número de incêndios.</li>
    </ul>
    <p>Também removemos ${fmt(t.deteccoes_brutas - t.deteccoes_sem_duplicatas)} detecções que aparecem duas vezes
      (no arquivo mensal e no diário do INPE, com identificadores diferentes).</p>

    <h3>2. Situação fundiária: onde caiu o fogo</h3>
    <p>Cada foco é cruzado com os limites oficiais e classificado em uma única categoria, nesta ordem de precedência:
      <b>Terra Indígena &gt; Unidade de Conservação &gt; Imóvel do CAR &gt; Sem cadastro</b>. Um foco dentro de um
      imóvel do CAR que também está dentro de uma UC conta como UC no gráfico de categorias, mas também aparece no
      ranking de imóveis.</p>
    <ul>
      <li>Os polígonos do CAR se sobrepõem com frequência. Quando um foco cai em mais de um imóvel, é atribuído ao
        menor, que é o mais provável de ser o imóvel de origem.</li>
      <li>Imóveis com cadastro <b>cancelado</b> foram excluídos (${fmt(t.imoveis_car_cancelados_excluidos)} imóveis).
        Imóveis suspensos e pendentes continuam, com o status indicado.</li>
      <li>O CAR é <b>autodeclaratório</b>: não comprova propriedade, posse nem autoria do fogo.</li>
      <li>Por lei (LGPD), o CAR público não informa nome nem CPF/CNPJ do declarante. O painel mostra o código do
        imóvel, que pode ser consultado na consulta pública do CAR.</li>
      <li>"Sem cadastro" significa fora de TI, UC e imóvel do CAR ativo: pode ser terra pública não destinada,
        área de imóvel não cadastrado ou rio e várzea.</li>
    </ul>

    <h3>3. Eventos de fogo do SIPAM</h3>
    <p>O Censipam agrupa focos próximos no espaço e no tempo em <b>eventos de fogo</b>, que representam um incêndio
      em andamento ("Ativo") ou recém-apagado ("Em observação"). O polígono do evento é a área de influência das
      detecções, com uma margem em torno de cada pixel. <b>Não é a área queimada medida</b>, e tende a ser maior que
      ela em eventos pequenos (o menor evento tem ~100 ha).</p>
    <p>A "área do evento em imóveis do CAR" é a interseção do evento com a <b>união</b> dos imóveis que ele toca,
      para não contar duas vezes áreas de imóveis sobrepostos (somar imóvel por imóvel superestimava essa área em
      ~40%).</p>

    <h3>4. Índice de prioridade de mobilização</h3>
    <p>Para sugerir onde mobilizar equipes, cada evento recebe um índice de 0 a 100:</p>
    <table class="ranking">
      <tr><th>Componente</th><th class="n">Peso</th><th>Como entra</th></tr>
      <tr><td>Índice de prioridade de acionamento do SIPAM</td><td class="n">${w.indice_sipam}</td><td>percentil entre os eventos do estado</td></tr>
      <tr><td>Focos únicos nas últimas 48 h até ${p.buffer_evento_m / 1000} km do evento</td><td class="n">${w.focos_48h}</td><td>percentil</td></tr>
      <tr><td>Área de influência do evento</td><td class="n">${w.area}</td><td>percentil</td></tr>
      <tr><td>Persistência (dias desde a primeira detecção)</td><td class="n">${w.persistencia}</td><td>percentil</td></tr>
      <tr><td>Atinge terra indígena, UC, território quilombola ou assentamento</td><td class="n">${w.area_sensivel}</td><td>sim/não</td></tr>
      <tr><td>Status "Ativo" no SIPAM</td><td class="n">${w.ativo}</td><td>sim/não</td></tr>
    </table>
    <p>Classes: <b>Crítica</b> ≥ ${p.classes_prioridade['Crítica']}, <b>Alta</b> ≥ ${p.classes_prioridade['Alta']},
      <b>Moderada</b> ≥ ${p.classes_prioridade['Moderada']}, <b>Baixa</b> abaixo disso. O índice do SIPAM é obtido
      pela API do Painel do Fogo (${fmt(t.eventos_com_indice_sipam)} de ${fmt(t.eventos_sipam)} eventos com índice
      hoje; sem índice, o componente vale zero). O índice é relativo ao estado e ao dia: serve para ordenar, não como
      medida absoluta de risco. Não considera vento, umidade, população exposta nem capacidade das equipes locais,
      que devem ser avaliados por quem decide.</p>
    <p>O ranking de municípios para mobilização ordena pelo número de eventos de prioridade crítica ou alta e, em
      seguida, pelos focos únicos dos últimos 7 dias.</p>

    <h3>5. Deslocamento estimado até o fogo</h3>
    <p>Para cada evento calculamos, em linha reta, a distância até a <b>sede municipal mais próxima</b>, até
      <b>Manaus</b> e até a <b>rodovia mais próxima</b> mapeada no OpenStreetMap (vias principais). A partir disso, com
      as premissas editáveis da aba Mobilização:</p>
    <ul>
      <li><b>Terrestre (viatura 4x4):</b> distância × fator de tortuosidade (padrão 1,4) ÷ velocidade média
        (40 km/h). Só é considerado viável quando há rodovia a até 5 km do evento. Custo = km de ida e volta × R$/km.</li>
      <li><b>Fluvial (lancha/voadeira):</b> distância × 1,8 (rios são sinuosos) ÷ 25 km/h. Custo = horas de ida e
        volta × R$/hora (combustível e operação). Supõe rio navegável entre a sede e o evento.</li>
      <li><b>Aéreo (helicóptero):</b> sai de Manaus, distância em linha reta ÷ 180 km/h + 30 min de acionamento.
        Custo = horas de voo de ida e volta × R$/hora.</li>
    </ul>
    <p>O modal sugerido é o terrestre quando viável, senão o fluvial, e o aéreo quando a viagem fluvial passa de
      12 horas. <b>São estimativas para planejamento</b>: não usam rotas reais, não consideram cheia ou seca dos
      rios, condição das estradas, pistas de pouso, nem a localização real das bases de brigada.</p>

    <h3>6. Atualização e limitações</h3>
    <ul>
      <li>Os dados são baixados e processados todo dia às 07:00 (Brasília) por um GitHub Action. A data da última
        atualização aparece no topo da página.</li>
      <li>Nuvens, fumaça e o horário das passagens dos satélites fazem com que nem todo fogo seja detectado.</li>
      <li>A posição de um foco tem incerteza de algumas centenas de metros (VIIRS) a alguns quilômetros (GOES);
        focos perto de limites podem cair do lado errado.</li>
      <li>Parcelas certificadas do SIGEF/INCRA ainda não estão incluídas.</li>
      <li>Este painel não atribui responsabilidade por queimadas. Use como apoio à fiscalização e ao planejamento.</li>
    </ul>
    <p class="nota">${esc(PRODUTO)} · Código aberto em
      <a href="https://github.com/dsalcodaa/WEBMAP-FOGO" target="_blank" rel="noopener">github.com/dsalcodaa/WEBMAP-FOGO</a>.</p>`;
}
