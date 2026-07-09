// ==========================================================================
// Dupuro Açaí — Landing page interactions
// ==========================================================================

document.addEventListener('DOMContentLoaded', function () {

  // ---- Mobile nav toggle ----
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ---- Header background on scroll ----
  var header = document.querySelector('.site-header');
  window.addEventListener('scroll', function () {
    if (window.scrollY > 12) {
      header.style.background = 'rgba(46, 11, 34, 0.98)';
    } else {
      header.style.background = 'rgba(46, 11, 34, 0.92)';
    }
  });

  // ---- Scrollspy: destaca o link da seção visível no menu ----
  var sectionLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  var sections = Array.prototype.map.call(sectionLinks, function (link) {
    return document.querySelector(link.getAttribute('href'));
  }).filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = document.querySelector('.nav-links a[href="#' + entry.target.id + '"]');
        if (!link) return;
        if (entry.isIntersecting) {
          sectionLinks.forEach(function (l) { l.classList.remove('active'); });
          link.classList.add('active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach(function (s) { spy.observe(s); });
  }

  // ---- Contador animado (hero stats) ----
  var prefersReducedMotionEarly = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-count-to]').forEach(function (el) {
    var target = parseFloat(el.getAttribute('data-count-to'));
    var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var suffix = el.getAttribute('data-suffix') || '';

    function render(value) {
      var text = decimals ? value.toFixed(decimals).replace('.', ',') : Math.round(value).toString();
      el.textContent = text + suffix;
    }

    if (prefersReducedMotionEarly) { render(target); return; }

    var start = null;
    var duration = 1100;
    function step(timestamp) {
      if (!start) start = timestamp;
      var progress = Math.min((timestamp - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      render(target * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    setTimeout(function () { requestAnimationFrame(step); }, 500);
  });

  // ---- Formulário "Seja um Revendedor" (cria conta real, pendente de aprovação) ----
  var form = document.getElementById('revendaForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var valid = true;

      var nome = document.getElementById('nome');
      var telefone = document.getElementById('telefone');
      var email = document.getElementById('email');
      var senha = document.getElementById('senha');
      var senhaConfirma = document.getElementById('senhaConfirma');
      var submitBtn = form.querySelector('button[type="submit"]');
      var errorNote = document.getElementById('formError');

      function setInvalid(input, invalid) {
        var field = input.closest('.field');
        field.classList.toggle('invalid', invalid);
        if (invalid) valid = false;
      }

      setInvalid(nome, nome.value.trim().length < 3);

      var phoneDigits = telefone.value.replace(/\D/g, '');
      setInvalid(telefone, phoneDigits.length < 10);

      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      setInvalid(email, !emailOk);

      setInvalid(senha, senha.value.length < 6);
      setInvalid(senhaConfirma, senhaConfirma.value !== senha.value || senha.value.length < 6);

      if (errorNote) errorNote.classList.remove('show');
      if (!valid) return;

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Criando conta...'; }

      DupuroCliente.signup({
        nome: nome.value.trim(),
        empresa: document.getElementById('empresa').value.trim(),
        telefone: telefone.value.trim(),
        email: email.value.trim(),
        cidade: document.getElementById('cidade').value.trim(),
        senha: senha.value
      }).then(function (result) {
        if (result.error) {
          if (errorNote) {
            errorNote.textContent = result.error.message === 'User already registered'
              ? 'Já existe uma conta com esse e-mail. Tente entrar na área do revendedor.'
              : 'Não foi possível concluir o cadastro. Verifique os dados ou fale direto pelo WhatsApp.';
            errorNote.classList.add('show');
          }
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Criar minha conta de revendedor'; }
          return;
        }

        // Aviso opcional pro admin via Formspree (best-effort — não bloqueia o cadastro
        // se falhar). Configurar o ID em data-formspree-action no HTML.
        var formspreeAction = form.getAttribute('data-formspree-action');
        if (formspreeAction && formspreeAction.indexOf('SEU_FORM_ID') === -1) {
          fetch(formspreeAction, {
            method: 'POST',
            body: new FormData(form),
            headers: { 'Accept': 'application/json' }
          }).catch(function () { /* notificação é best-effort, não afeta o cadastro */ });
        }

        document.getElementById('formWrapper').classList.add('hidden');
        document.getElementById('formSuccess').style.display = 'block';
      });
    });
  }

  // ---- Reveal on scroll (leve) ----
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealTargets = document.querySelectorAll('.feature-card, .product-card, .testimonial-card, .step-card');
  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    revealTargets.forEach(function (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      observer.observe(el);
    });
  }

  // ---- Parallax leve no hero (foto e cards flutuantes em velocidades diferentes) ----
  var heroSection = document.querySelector('.hero');
  var heroPhoto = document.querySelector('.hero-photo-frame');
  var floatCards = document.querySelectorAll('.hero-visual .float-card');

  if (heroSection && heroPhoto && !prefersReducedMotion) {
    var parallaxTicking = false;

    function updateParallax() {
      var rect = heroSection.getBoundingClientRect();
      // Só anima enquanto o hero estiver (ao menos parcialmente) na tela.
      if (rect.bottom > 0 && rect.top < window.innerHeight) {
        var scrolled = Math.max(0, -rect.top);
        heroPhoto.style.transform = 'rotate(-2deg) translate3d(0, ' + (scrolled * 0.12).toFixed(1) + 'px, 0)';
        floatCards.forEach(function (card, i) {
          var speed = 0.05 + i * 0.05;
          card.style.transform = 'translate3d(0, ' + (scrolled * speed).toFixed(1) + 'px, 0)';
        });
      }
      parallaxTicking = false;
    }

    window.addEventListener('scroll', function () {
      if (!parallaxTicking) {
        requestAnimationFrame(updateParallax);
        parallaxTicking = true;
      }
    }, { passive: true });
  }

});
