(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const G = window.gsap && window.ScrollTrigger && !reduced ? window.gsap : null;

  $('#year').textContent = new Date().getFullYear();

  /* ---------- Scroll progress + nav ---------- */
  const progress = $('.progress');
  const nav = $('#nav');
  const onScroll = () => {
    const h = document.documentElement;
    const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
    progress.style.transform = `scaleX(${p})`;
    nav.classList.toggle('scrolled', h.scrollTop > 40);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Counters ---------- */
  const fmt = (n, el) => {
    const v = el.dataset.format === 'it' || n >= 1000 ? Math.round(n).toLocaleString('it-IT') : Math.round(n);
    return (el.dataset.prefix || '') + v + (el.dataset.suffix || '');
  };
  const count = (el) => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const target = +el.dataset.count;
    if (reduced) { el.textContent = fmt(target, el); return; }
    const dur = 1600, t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(target * (1 - Math.pow(1 - k, 4)), el);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const countIn = (el) => { $$('[data-count]', el).forEach(count); if (el.matches('[data-count]')) count(el); };
  setTimeout(() => $$('.mock [data-count]').forEach(count), 1200);

  /* ---------- Showcase steps → phone screens ---------- */
  const screens = $$('.phone .screen');
  const steps = $$('.step');
  const setStep = (n) => {
    screens.forEach((s, i) => s.classList.toggle('on', i === n));
    steps.forEach((s, i) => s.classList.toggle('active', i === n));
  };
  setStep(0);
  const stepIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) setStep(+en.target.dataset.step); });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => stepIO.observe(s));

  /* ---------- Fallback reveal (IntersectionObserver) ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      countIn(en.target);
      io.unobserve(en.target);
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });

  if (!G) {
    $$('.reveal').forEach((el) => {
      const sibs = $$(':scope > .reveal', el.parentElement);
      const i = sibs.indexOf(el);
      if (i > 0) el.style.setProperty('--d', `${Math.min(i, 6) * 0.08}s`);
      io.observe(el);
    });
    $$('.sec-visual, .compare').forEach((el) => io.observe(el));
  } else {
    initGsap(G);
  }

  /* ---------- GSAP + ScrollTrigger ---------- */
  function splitWords(el) {
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const w = document.createElement('span'); w.className = 'w';
            const inner = document.createElement('span'); inner.textContent = part;
            w.appendChild(inner); frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(el);
    return $$('.w > span', el);
  }

  function initGsap(gsap) {
    gsap.registerPlugin(ScrollTrigger);
    document.documentElement.classList.add('has-gsap');
    // steps keep their IO-driven class logic
    steps.forEach((s) => s.classList.add('in'));

    /* Hero intro */
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .from('.nav', { y: -40, opacity: 0, duration: 1.1 })
      .from('.hero .eyebrow', { y: 20, opacity: 0, duration: 1 }, 0.15)
      .from('.hero-sub, .hero-cta, .hero-trust', { y: 30, opacity: 0, duration: 1.2, stagger: 0.12 }, 0.55)
      .from('.hero-visual', { y: 80, opacity: 0, scale: 0.94, duration: 1.6 }, 0.4);

    /* Hero parallax on scroll */
    gsap.timeline({ scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.6 } })
      .to('.hero-inner', { yPercent: -18, opacity: 0.2, ease: 'none' }, 0)
      .to('.hero-visual', { yPercent: 14, ease: 'none' }, 0)
      .to('.hero-covers', { yPercent: 20, ease: 'none' }, 0)
      .to('.hero-glow', { yPercent: 40, ease: 'none' }, 0);

    /* Marquee: speed follows scroll velocity */
    const mq = $('.marquee-track');
    if (mq) {
      mq.style.animation = 'none';
      const loop = gsap.to(mq, { xPercent: -50, duration: 32, ease: 'none', repeat: -1 });
      ScrollTrigger.create({
        onUpdate: (self) => {
          const v = gsap.utils.clamp(-6, 6, self.getVelocity() / 300);
          gsap.to(loop, { timeScale: (self.direction || 1) * (1 + Math.abs(v)), duration: 0.2, overwrite: true });
          gsap.to(loop, { timeScale: self.direction || 1, duration: 1.2, delay: 0.25 });
        },
      });
    }

    /* Word-by-word headings */
    $$('.section-head h2, .sectors-intro h2, .sec-text h2, .final h2').forEach((h) => {
      const words = splitWords(h);
      gsap.from(words, {
        yPercent: 110, rotate: 4, duration: 1.1, ease: 'expo.out', stagger: 0.05,
        scrollTrigger: { trigger: h, start: 'top 85%' },
      });
    });

    /* Generic reveals (batched + staggered) */
    const revealEls = $$('.reveal').filter((el) => !el.closest('.hero') && !el.classList.contains('step') && !el.matches('.sec-text h2, .sec-list li, .price-card'));
    gsap.set(revealEls, { opacity: 0, y: 50 });
    ScrollTrigger.batch(revealEls, {
      start: 'top 88%',
      onEnter: (batch) => {
        gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.1, overwrite: 'auto' });
        batch.forEach((el) => { el.classList.add('in'); countIn(el); });
      },
    });

    /* Feature cards: subtle 3D entrance */
    gsap.from('.feature', {
      rotateX: -18, transformPerspective: 900, transformOrigin: '50% 100%',
      duration: 1.2, ease: 'expo.out', stagger: 0.08,
      scrollTrigger: { trigger: '.features', start: 'top 80%' },
    });

    /* Sectors: pinned horizontal scroll (desktop) */
    const mm = gsap.matchMedia();
    mm.add('(min-width: 801px)', () => {
      const track = $('.sectors-track');
      const panels = $$('.sector', track);
      const dist = () => track.scrollWidth - innerWidth;
      const tween = gsap.to(track, {
        x: () => -dist(), ease: 'none',
        scrollTrigger: {
          trigger: '.sectors', start: 'top top', end: () => '+=' + dist(),
          pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1,
        },
      });
      panels.forEach((p) => {
        gsap.fromTo($('.sector-bg img', p), { xPercent: -8 }, {
          xPercent: 8, ease: 'none',
          scrollTrigger: { trigger: p, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true },
        });
        gsap.from($$('.sector-n, h3, p, li', p), {
          y: 40, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.06,
          scrollTrigger: { trigger: p, containerAnimation: tween, start: 'left 70%' },
        });
      });
    });
    mm.add('(max-width: 800px)', () => {
      $$('.sector').forEach((p) => {
        gsap.from(p, { scale: 0.92, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: p, start: 'top 85%' } });
        gsap.fromTo($('.sector-bg img', p), { yPercent: -6 }, {
          yPercent: 6, ease: 'none', scrollTrigger: { trigger: p, start: 'top bottom', end: 'bottom top', scrub: true },
        });
      });
    });

    /* Stats: pop scale */
    gsap.from('.stat b', {
      scale: 0.6, duration: 1.2, ease: 'back.out(1.8)', stagger: 0.1,
      scrollTrigger: { trigger: '.stats', start: 'top 85%' },
    });

    /* Security: shield + rings driven by scroll */
    ScrollTrigger.create({ trigger: '.sec-visual', start: 'top 75%', onEnter: () => $('.sec-visual').classList.add('in') });
    gsap.fromTo('.shield-wrap', { scale: 0.75, rotate: -20 }, {
      scale: 1, rotate: 0, ease: 'none',
      scrollTrigger: { trigger: '#sicurezza', start: 'top bottom', end: 'center center', scrub: 1 },
    });
    gsap.from('.sec-list li', {
      x: 40, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.1,
      scrollTrigger: { trigger: '.sec-list', start: 'top 85%' },
    });
    gsap.fromTo('.section.dark', { borderRadius: 120, scale: 0.94 }, {
      borderRadius: 48, scale: 1, ease: 'none',
      scrollTrigger: { trigger: '.section.dark', start: 'top bottom', end: 'top 30%', scrub: true },
    });

    /* Pricing */
    ScrollTrigger.create({ trigger: '.compare', start: 'top 80%', onEnter: () => $('.compare').classList.add('in') });
    gsap.from('.price-card', {
      y: 120, rotate: 3, scale: 0.9, duration: 1.4, ease: 'expo.out',
      scrollTrigger: { trigger: '.pricing', start: 'top 80%' },
    });
    gsap.from('.incl li', {
      x: -20, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.07,
      scrollTrigger: { trigger: '.incl', start: 'top 90%' },
    });

    /* Final CTA: grows into view */
    gsap.fromTo('.final-inner', { scale: 0.86, borderRadius: 140 }, {
      scale: 1, borderRadius: 48, ease: 'none',
      scrollTrigger: { trigger: '.final', start: 'top bottom', end: 'top 25%', scrub: true },
    });

    addEventListener('load', () => ScrollTrigger.refresh());
  }

  /* ---------- Pointer effects ---------- */
  if (!reduced && fine) {
    $$('[data-tilt]').forEach((el) => {
      const target = el.querySelector('.mock') || el;
      const base = target.classList.contains('mock') ? { x: 6, y: -10 } : { x: 0, y: 0 };
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        target.style.transform = `rotateX(${base.x - py * 10}deg) rotateY(${base.y + px * 14}deg)`;
      });
      el.addEventListener('mouseleave', () => { target.style.transform = ''; });
    });

    $$('.magnetic').forEach((b) => {
      b.addEventListener('mousemove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.translate = `${(e.clientX - r.left - r.width / 2) * 0.25}px ${(e.clientY - r.top - r.height / 2) * 0.35}px`;
      });
      b.addEventListener('mouseleave', () => { b.style.translate = ''; });
    });

    $$('.spot').forEach((c) => {
      c.addEventListener('mousemove', (e) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', `${e.clientX - r.left}px`);
        c.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
  }

  /* ---------- Hero constellation canvas ---------- */
  const cv = $('.hero-canvas');
  if (cv && !reduced) {
    const ctx = cv.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w, h, pts = [], running = true;
    const mouse = { x: -999, y: -999 };
    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(90, (w * h) / 16000));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.6 + 0.6,
      }));
    };
    resize();
    addEventListener('resize', resize);
    cv.parentElement.addEventListener('mousemove', (e) => {
      const r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    });
    cv.parentElement.addEventListener('mouseleave', () => { mouse.x = mouse.y = -999; });

    const LINK = 130;
    const draw = () => {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
        if (d < 140 && d > 0) { p.x += (dx / d) * 0.8; p.y += (dy / d) * 0.8; }
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(136,189,57,${(1 - d / LINK) * 0.35})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      ctx.fillStyle = 'rgba(166,214,90,.85)';
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      requestAnimationFrame(draw);
    };
    new IntersectionObserver(([en]) => {
      const was = running; running = en.isIntersecting;
      if (running && !was) requestAnimationFrame(draw);
    }).observe(cv);
    requestAnimationFrame(draw);
  }
})();
