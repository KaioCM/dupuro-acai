// ==========================================================================
// Dupuro Açaí — Helpers de UI dos painéis (revendedor e admin)
// ==========================================================================

var DupuroUI = (function () {

  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Anima um número de 0 até value dentro do elemento. format é opcional
  // (recebe o valor parcial e devolve a string exibida — ex: moeda).
  function countUp(el, value, format) {
    if (!el) return;
    var render = format || function (v) { return Math.round(v).toString(); };

    if (prefersReducedMotion || !value) {
      el.textContent = render(value);
      return;
    }

    var duration = 900;
    var start = null;
    function step(timestamp) {
      if (!start) start = timestamp;
      var progress = Math.min((timestamp - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = render(value * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function brl(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // Foto de produto do Storage já no tamanho em que aparece (as originais têm
  // 1,5-2 MB cada; no caixa eram ~16 MB pra mostrar quadradinhos de 56 px).
  // Usa a transformação de imagem do Supabase; outra URL passa como veio.
  function miniatura(url, px) {
    if (!url || url.indexOf('/storage/v1/object/public/') === -1) return url;
    var lado = Math.round((px || 160) * 2); // 2x pra tela de alta densidade
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
      (url.indexOf('?') === -1 ? '?' : '&') + 'width=' + lado + '&height=' + lado + '&resize=contain&quality=75';
  }

  // Ordem da vitrine (pedido do Kayo): do menor pro maior — açaí/cremes por litragem
  // (500 ml, 1 L, 2 L, 5 L, 10 L); o que não tem litragem (água, refri, granola)
  // vem depois, do mais barato pro mais caro. Copo segue o preço; self-service no fim.
  function ordemVitrine(a, b) {
    var pa = a.modo === 'peso' ? 1 : 0, pb = b.modo === 'peso' ? 1 : 0;
    if (pa !== pb) return pa - pb;
    var la = Number(a.litros) || 0, lb = Number(b.litros) || 0;
    if ((la > 0) !== (lb > 0)) return la > 0 ? -1 : 1;
    if (la !== lb) return la - lb;
    return (Number(a.preco) || 0) - (Number(b.preco) || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  }

  return { countUp: countUp, brl: brl, miniatura: miniatura, ordemVitrine: ordemVitrine };

})();
