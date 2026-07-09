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

  return { countUp: countUp, brl: brl };

})();
