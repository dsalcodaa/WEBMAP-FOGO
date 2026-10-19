// Texto da metodologia, usado na aba Metodologia (completo) e no relatório impresso (resumido).
// Escrito para o público em geral: frases curtas, termos técnicos explicados na primeira vez.

function textoMetodologia(meta, completo = true) {
  const t = meta.totais, p = meta.parametros, w = p.pesos_prioridade;
  const fonte = Object.values(meta.fontes).map(f => `<li>${esc(f)}</li>`).join('');
  const km = Math.round(p.celula_graus * 111);

  const resumo = `
    <h3>Focos de calor</h3>
    <p>Um foco de calor é um ponto que o satélite vê muito mais quente que o entorno, quase sempre fogo na vegetação.
      O número padrão do painel é o <b>oficial do INPE</b>: conta só o satélite de referência
      (${esc(p.satelite_referencia)}), o mesmo dos boletins e das notícias (${fmt(t.deteccoes_satelite_referencia)}
      focos no ano). Também é possível ver os <b>lugares com fogo por dia</b>, juntando todos os satélites em
      quadrados de ~${km} km (${fmt(t.focos_unicos)} no ano), mas esse número não é comparável com o oficial. Somar
      todas as detecções (${fmt(t.deteccoes_brutas)}) conta o mesmo fogo várias vezes.</p>
    <h3>Eventos de fogo</h3>
    <p>Os eventos vêm prontos do Painel do Fogo do Censipam/SIPAM, que junta focos próximos em um mesmo incêndio.
      A área do evento é uma área de influência, não a área queimada medida.</p>
    <h3>Onde caiu o fogo</h3>
    <p>Cada foco entra em uma só categoria, nesta ordem: Terra Indígena, Unidade de Conservação, imóvel do CAR,
      sem cadastro. O CAR é declarado pelo próprio dono e <b>não prova propriedade nem quem pôs o fogo</b>.</p>
    <h3>Prioridade de mobilização</h3>
    <p>Nota de 0 a 100 por evento: avaliação do SIPAM (${w.indice_sipam}), fogo nas últimas 48 h
      (${w.focos_48h}), tamanho (${w.area}), dias de duração (${w.persistencia}), atinge área protegida ou de povos
      tradicionais (${w.area_sensivel}) e evento ativo (${w.ativo}). Crítica a partir de
      ${p.classes_prioridade['Crítica']}, alta a partir de ${p.classes_prioridade['Alta']}. Tempos e custos de
      viagem são estimativas em linha reta, não rotas reais.</p>
    <h3>Qualidade do ar</h3>
    <p>Média das últimas 24 horas da fumaça fina (PM2,5) e da poeira (PM10) na sede de cada município, estimada pelo
      modelo europeu Copernicus/CAMS e classificada pelo índice do Ministério do Meio Ambiente (Boa, Moderada, Ruim,
      Muito ruim, Péssima). É uma estimativa, não uma medição de estação.</p>`;

  if (!completo) return resumo;

  return `
    <h2>Como este painel funciona</h2>
    <p class="destaque">Este painel é um produto <b>${esc(PRODUTO)}</b>. Ele junta dados públicos oficiais para
      mostrar, de forma simples, <b>onde o fogo está</b> no Amazonas, <b>em que tipo de terra</b>, <b>como está o ar</b>
      que as pessoas respiram e <b>onde a resposta é mais urgente</b>. Tudo é atualizado sozinho todo dia às 07:00
      (horário de Brasília).</p>

    <h3>De onde vêm os dados</h3>
    <ul>${fonte}</ul>

    <h3>1. O que é um foco de calor</h3>
    <p>Satélites passam sobre a Amazônia e medem a temperatura do chão. Quando um ponto está muito mais quente que o
      entorno, ele vira um <b>foco de calor</b>. Quase sempre é fogo na vegetação.</p>
    <ul>
      <li><b>Um foco não é um incêndio.</b> Um incêndio grande aparece como vários focos. Um fogo pequeno, rápido ou
        coberto por nuvens pode não aparecer.</li>
      <li>Cada foco é um quadrado da imagem: cerca de 1 km no satélite oficial (sensor MODIS) e 375 m nos sensores
        VIIRS. A posição pode errar de algumas centenas de metros a alguns quilômetros.</li>
      <li>O mesmo fogo é visto muitas vezes no mesmo dia. O GOES-19 tira uma foto a cada 10 minutos, e os sensores
        VIIRS estão em três satélites. Em ${meta.ano}, os satélites registraram ${fmt(t.deteccoes_brutas)} detecções
        no Amazonas, mas elas correspondem a ${fmt(t.focos_unicos)} lugares com fogo por dia:
        <b>somar tudo conta o mesmo fogo cerca de ${fmt1(t.deteccoes_brutas / t.focos_unicos)} vezes</b>.</li>
    </ul>

    <h3>2. Como contamos os focos</h3>
    <p>O seletor <b>"Como contar os focos"</b> oferece três formas. Elas respondem perguntas diferentes:</p>
    <table class="ranking">
      <tr><th>Forma</th><th>Para que serve</th><th class="n">No ano</th></tr>
      <tr><td><b>Número oficial do INPE</b> (padrão)</td>
        <td>Conta só o <b>satélite de referência</b> (${esc(p.satelite_referencia)}, que passa à tarde). É assim que o
          INPE, o Ibama, os governos e a imprensa contam. Serve para comparar com anos anteriores e com as notícias.
          Como o satélite passa uma vez por dia, alguns fogos ficam de fora.</td>
        <td class="n">${fmt(t.deteccoes_satelite_referencia)}</td></tr>
      <tr><td><b>Lugares com fogo por dia</b></td>
        <td>Junta <b>todos os satélites</b> e divide o mapa em quadrados de ~${km} km. Cada quadrado conta uma vez por
          dia, não importa quantos satélites o viram. Mostra melhor <b>onde</b> houve fogo, mas o número é maior que o
          oficial e <b>não deve ser comparado</b> com ele. É um método deste painel, não do INPE.</td>
        <td class="n">${fmt(t.focos_unicos)}</td></tr>
      <tr><td><b>Todas as detecções</b></td>
        <td>Soma toda vez que algum satélite viu calor. Uso técnico. <b>Não use como número de focos nem de
          incêndios.</b></td>
        <td class="n">${fmt(t.deteccoes_brutas)}</td></tr>
    </table>
    <p>Sobre o satélite de referência: o INPE usa sempre o mesmo satélite para que a série seja comparável ano a ano.
      A série oficial atual usa o AQUA (passagem da tarde) desde 2003. Conferimos: para 2005, o arquivo oficial do INPE
      para o Amazonas tem exatamente o mesmo número de focos que o AQUA tem no arquivo de todos os satélites. Também
      removemos ${fmt(t.deteccoes_brutas - t.deteccoes_sem_duplicatas)} detecções repetidas entre os arquivos mensal
      e diário do INPE.</p>

    <h3>Anos anteriores</h3>
    <p>O seletor <b>Ano</b> mostra os focos desde ${(meta.anos || [])[0]?.ano ?? meta.ano}, início da série oficial pelo
      satélite de referência. Os dados vêm dos arquivos anuais do INPE e passam pelos mesmos cálculos do ano atual.
      Atenção a três pontos:</p>
    <ul>
      <li>Imóveis do CAR, unidades de conservação e terras indígenas são os <b>limites de hoje</b>. Um foco de 2005
        pode cair num imóvel cadastrado anos depois, ou numa unidade criada depois.</li>
      <li>Eventos de fogo, mobilização e qualidade do ar mostram sempre a <b>situação de hoje</b>: o SIPAM não
        disponibiliza o histórico de eventos.</li>
      <li>Para comparar anos, use o <b>número oficial do INPE</b>. O número de satélites em órbita mudou muito desde
        2003, então "lugares com fogo" e "todas as detecções" crescem só porque há mais satélites.</li>
    </ul>

    <h3>3. Eventos de fogo (SIPAM)</h3>
    <p>O <b>Censipam</b>, órgão do Ministério da Defesa, mantém o Painel do Fogo. Ele junta focos próximos no espaço e
      no tempo em um <b>evento de fogo</b>, que representa um incêndio. Cada evento tem um status: <b>Ativo</b> (ainda
      queimando) ou <b>Em observação</b> (sem focos novos há pouco tempo). Hoje são ${fmt(t.eventos_sipam)} eventos
      no Amazonas.</p>
    <ul>
      <li><b>Este painel não cria os eventos.</b> Eles chegam prontos da API do SIPAM, junto com o índice de prioridade
        do próprio SIPAM. O painel só acrescenta informações: imóveis do CAR atingidos, município, áreas protegidas,
        focos recentes, distâncias e a nota de prioridade.</li>
      <li>A área do evento é uma <b>área de influência</b> em volta das detecções. <b>Não é a área queimada medida</b>
        e costuma ser maior que ela em incêndios pequenos.</li>
      <li>A área do evento dentro de imóveis do CAR é calculada sem contar duas vezes os pedaços em que os imóveis se
        sobrepõem.</li>
      <li>Os eventos servem para <b>agir agora</b>. Para estatística do ano, use o número oficial de focos do INPE.
        Para saber quanto queimou em hectares, use os produtos de <b>área queimada</b> (INPE ou MapBiomas Fogo), que
        medem a cicatriz do fogo nas imagens.</li>
    </ul>

    <h3>4. Onde caiu o fogo</h3>
    <p>Cada foco é cruzado com os mapas oficiais e entra em <b>uma só categoria</b>, nesta ordem:
      <b>Terra Indígena, Unidade de Conservação, imóvel do CAR, sem cadastro</b>. Por exemplo: um foco num imóvel do
      CAR que fica dentro de uma unidade de conservação conta como unidade de conservação no gráfico, mas também
      aparece na lista de imóveis.</p>
    <ul>
      <li>O <b>CAR</b> (Cadastro Ambiental Rural) é preenchido pelo próprio dono ou posseiro. Ele <b>não prova
        propriedade nem posse</b> e <b>não diz quem pôs o fogo</b>.</li>
      <li>Muitos imóveis do CAR se sobrepõem. Quando um foco cai em mais de um, vai para o menor, que é o mais
        provável.</li>
      <li>Imóveis com cadastro <b>cancelado</b> ficam de fora (${fmt(t.imoveis_car_cancelados_excluidos)}). Suspensos e
        pendentes continuam, com o status indicado.</li>
      <li>Pela LGPD, o CAR público não mostra nome nem CPF/CNPJ. O painel mostra o código do imóvel, que pode ser
        pesquisado na consulta pública do CAR.</li>
      <li><b>"Sem cadastro"</b> é tudo o que fica fora de TI, UC e CAR ativo: terra pública sem destinação, imóvel
        não cadastrado, rio ou várzea.</li>
    </ul>

    <h3>5. Nota de prioridade de mobilização</h3>
    <p>Para sugerir onde mandar equipes primeiro, cada evento recebe uma nota de 0 a 100. Quanto maior, mais urgente.</p>
    <table class="ranking">
      <tr><th>O que entra na nota</th><th class="n">Peso</th><th>Como entra</th></tr>
      <tr><td>Avaliação de prioridade do próprio SIPAM</td><td class="n">${w.indice_sipam}</td><td>comparada com os outros eventos do estado</td></tr>
      <tr><td>Fogo continua aparecendo: lugares com fogo nas últimas 48 h a até ${p.buffer_evento_m / 1000} km do evento (todos os satélites, para não perder fogo recente)</td><td class="n">${w.focos_48h}</td><td>comparado</td></tr>
      <tr><td>Tamanho do evento</td><td class="n">${w.area}</td><td>comparado</td></tr>
      <tr><td>Há quantos dias o fogo dura</td><td class="n">${w.persistencia}</td><td>comparado</td></tr>
      <tr><td>Atinge terra indígena, unidade de conservação, território quilombola ou assentamento</td><td class="n">${w.area_sensivel}</td><td>sim ou não</td></tr>
      <tr><td>Evento ainda ativo</td><td class="n">${w.ativo}</td><td>sim ou não</td></tr>
    </table>
    <p>"Comparado" quer dizer que o evento ganha mais pontos quanto mais ele se destaca entre os eventos do estado
      (percentil). Faixas: <b>Crítica</b> a partir de ${p.classes_prioridade['Crítica']}, <b>Alta</b> a partir de
      ${p.classes_prioridade['Alta']}, <b>Moderada</b> a partir de ${p.classes_prioridade['Moderada']} e
      <b>Baixa</b> abaixo disso. ${fmt(t.eventos_com_indice_sipam)} de ${fmt(t.eventos_sipam)} eventos têm avaliação
      do SIPAM hoje; sem ela, esse item vale zero.</p>
    <p>A nota serve para <b>ordenar</b>, não mede o risco real. Ela não considera vento, chuva, pessoas morando perto
      nem as equipes disponíveis. Isso cabe a quem decide. O ranking de municípios ordena pelos eventos críticos ou
      altos e, depois, pelos focos dos últimos 7 dias.</p>

    <h3>6. Tempo e custo de viagem até o fogo</h3>
    <p>Para cada evento medimos a distância em linha reta até a <b>cidade (sede municipal) mais próxima</b>, até
      <b>Manaus</b> e até a <b>estrada mais próxima</b> (mapa aberto OpenStreetMap). Os valores podem ser ajustados na
      aba Mobilização:</p>
    <ul>
      <li><b>Por terra (caminhonete 4x4):</b> a distância é aumentada em 40% porque a estrada faz curvas, a 40 km/h.
        Só vale se houver estrada a até 5 km do evento.</li>
      <li><b>Por rio (lancha ou voadeira):</b> a distância é aumentada em 80% porque os rios fazem muitas curvas, a
        25 km/h. Supõe que dá para chegar pelo rio.</li>
      <li><b>Por ar (helicóptero):</b> sai de Manaus em linha reta a 180 km/h, mais 30 minutos para decolar.</li>
    </ul>
    <p>O painel sugere ir por terra quando dá, senão pelo rio, e de helicóptero quando a viagem de barco passa de 12
      horas. Os custos são de ida e volta e só do deslocamento. <b>São estimativas para planejar</b>: não usam rotas
      reais nem consideram cheia ou seca dos rios, condição das estradas, pistas de pouso ou onde as brigadas estão.</p>

    <h3>7. Qualidade do ar</h3>
    <p>A fumaça das queimadas solta partículas muito finas no ar. As mais perigosas são as <b>PM2,5</b>, menores que
      a espessura de um fio de cabelo, que entram fundo no pulmão e chegam ao sangue. Também mostramos as <b>PM10</b>,
      um pouco maiores.</p>
    <ul>
      <li><b>De onde vem:</b> do <b>Copernicus/CAMS</b>, serviço europeu que estima a poluição no mundo todo, incluindo
        a fumaça das queimadas vista por satélite. Os dados são obtidos pela API gratuita do Open-Meteo, uma vez por
        dia, para a sede de cada município.</li>
      <li><b>Como classificamos:</b> pela média das últimas 24 horas, com o Índice de Qualidade do Ar do Ministério do
        Meio Ambiente (Resolução CONAMA 491/2018). Vale a pior classe entre PM2,5 e PM10.
        <table class="ranking">
          <tr><th>Qualidade</th><th class="n">PM2,5 (µg/m³)</th><th class="n">PM10 (µg/m³)</th><th>O que pode acontecer</th></tr>
          ${[['até 25', 'até 50'], ['26 a 50', '51 a 100'], ['51 a 75', '101 a 150'], ['76 a 125', '151 a 250'],
            ['acima de 125', 'acima de 250']].map(([pm25, pm10], i) =>
            `<tr><td>${badgeAr(i)}</td><td class="n">${pm25}</td><td class="n">${pm10}</td><td>${CLASSES_AR[i].saude}</td></tr>`).join('')}
        </table></li>
      <li><b>É uma estimativa, não uma medição.</b> O modelo trabalha com quadrados de dezenas de quilômetros, então
        cidades vizinhas podem ter o mesmo valor, e a fumaça muito perto do fogo pode ser maior que a estimada.</li>
      <li>Quando disponíveis, o mapa também mostra <b>estações de medição</b> da rede <b>AQICN</b> (World Air Quality
        Index). Elas usam a escala americana (AQI), diferente da brasileira. No Amazonas há poucas estações.</li>
      <li>A qualidade do ar mostra a situação <b>de hoje</b>, não do período escolhido no filtro.</li>
    </ul>

    <h3>8. Atualização e limites</h3>
    <ul>
      <li>Os dados são baixados e processados todo dia às 07:00 (Brasília). A data da última atualização aparece no
        topo da página.</li>
      <li>Nuvens, fumaça e o horário das passagens dos satélites fazem com que nem todo fogo seja visto.</li>
      <li>Focos perto de limites (de município, TI, UC ou imóvel) podem cair do lado errado por causa da incerteza da
        posição.</li>
      <li>Parcelas certificadas do SIGEF/INCRA ainda não estão incluídas.</li>
      <li><b>Este painel não aponta culpados.</b> Use como apoio à fiscalização, ao planejamento e à informação da
        população.</li>
    </ul>
    <p class="nota">${esc(PRODUTO)} · Código aberto em
      <a href="https://github.com/dsalcodaa/WEBMAP-FOGO" target="_blank" rel="noopener">github.com/dsalcodaa/WEBMAP-FOGO</a>.</p>`;
}
