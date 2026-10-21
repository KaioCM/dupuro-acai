// Gráficos do admin e do painel do revendedor (Chart.js) — tema e utilidades
// comuns, seguindo a skill dataviz:
//   * paleta categórica VALIDADA (scripts/validate_palette.js: daltonismo e
//     separação PASS; laranja/verde abaixo de 3:1 no fundo → obrigatório ter
//     a visão em tabela, ver tabela());
//   * barras <= 24px com ponta arredondada só no lado do valor; grade 1px discreta;
//   * legenda com marcador de cor (texto nunca na cor da série);
//   * valores curtos no eixo (R$ 10k).
var DupuroGraficos = (function () {
  // Ordem fixa: a cor segue a ENTIDADE (o revendedor/produto), nunca a posição.
  var SERIES = ['#7B3F72', '#1F9E8E', '#D98C00', '#C0392B', '#2E6FA3', '#7BA428'];
  var OUTROS = '#A89AA4';          // "Outros" é neutro, não ganha cor de série
  var DESTAQUE = '#7B3F72';        // série única = roxo da marca
  var DESTAQUE_CLARO = '#C9A3C1';  // mesmo tom, mais claro: período ainda incompleto
  var TINTA = '#33122B', TINTA_2 = '#7A5A72', GRADE = 'rgba(56,12,47,0.08)';

  function tema() {
    if (!window.Chart || tema.ok) return;
    tema.ok = true;
    var d = Chart.defaults;
    d.font.family = "'Inter', sans-serif";
    d.font.size = 12;
    d.color = TINTA_2;
    d.scale.grid.color = GRADE;
    d.scale.grid.lineWidth = 1;
    d.scale.grid.drawTicks = false;
    if (d.scale.border) d.scale.border.display = false;
    d.scale.ticks.padding = 8;
    var leg = d.plugins.legend.labels;
    leg.usePointStyle = true; leg.pointStyle = 'circle'; leg.boxWidth = 8; leg.boxHeight = 8;
    leg.padding = 16; leg.color = TINTA; leg.font = { size: 12, weight: '600' };
    d.elements.bar.borderRadius = 4;          // só o lado do valor (borderSkipped 'start')
    d.elements.bar.borderSkipped = 'start';
    d.datasets.bar.maxBarThickness = 24;
    d.datasets.bar.categoryPercentage = 0.72;
    d.datasets.bar.barPercentage = 0.88;
  }

  function brlCurto(v) {
    v = Number(v) || 0;
    if (Math.abs(v) >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    if (Math.abs(v) >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
    return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
  function brl(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  // Visão em tabela de um gráfico (linhas = rótulos do eixo X, colunas = séries).
  function tabela(chart, formato) {
    var fmt = formato === 'brl' ? brl : function (v) { return String(v); };
    var ds = chart.data.datasets;
    var head = '<tr><th scope="col"></th>' + ds.map(function (d) {
      return '<th scope="col"><span class="tg-cor" style="background:' + d.backgroundColor + '"></span>' + escTxt(d.label) + '</th>';
    }).join('') + '</tr>';
    var linhas = chart.data.labels.map(function (rot, i) {
      return '<tr><th scope="row">' + escTxt(rot) + '</th>' + ds.map(function (d) {
        var v = d.data[i];
        return '<td>' + (v === null || v === undefined || v === 0 ? '—' : fmt(v)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<table class="tabela-grafico-t"><thead>' + head + '</thead><tbody>' + linhas + '</tbody></table>';
  }
  function escTxt(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Botões "Ver os números em tabela": <button data-tabela="idDoCanvas" data-formato="brl|un">.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tabela]');
    if (!b || !window.Chart) return;
    var alvo = document.getElementById('tabela-' + b.getAttribute('data-tabela'));
    var chart = Chart.getChart(b.getAttribute('data-tabela'));
    if (!alvo || !chart) return;
    var abrir = alvo.hidden;
    if (abrir) alvo.innerHTML = tabela(chart, b.getAttribute('data-formato'));
    alvo.hidden = !abrir;
    b.textContent = abrir ? 'Esconder a tabela' : 'Ver os números em tabela';
    b.setAttribute('aria-expanded', String(abrir));
  });

  return { SERIES: SERIES, OUTROS: OUTROS, DESTAQUE: DESTAQUE, DESTAQUE_CLARO: DESTAQUE_CLARO, tema: tema, brlCurto: brlCurto, tabela: tabela };
})();
