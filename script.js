(() => {
  'use strict';

  // USTAWIENIA GRY
  const WORLD_W = 360;
  const WORLD_H = 640;
  const GROUND_H = 86;

  const TARGET_SCORE = 6; // wygraj po 6 przeszkodach
  const PIPE_WIDTH = 64;
  const PIPE_GAP_START = 145;
  const PIPE_GAP_END = 120;
  const PIPE_SPAWN = 1.45; // s
  const PIPE_SPEED_START = 140; // px/s
  const PIPE_SPEED_END = 190;   // px/s

  const GRAVITY = 1400;       // px/s^2
  const JUMP_VELOCITY = -380; // px/s
  const MAX_FALL = 560;       // terminal velocity

  // DOM
  const root = document.getElementById('root');
  const canvas = document.getElementById('game');
  const scoreEl = document.getElementById('score');
  const ui = document.getElementById('ui');
  let playBtn = document.getElementById('playButton');
  const toasts = document.getElementById('toasts');

  const ctx = canvas.getContext('2d');
  let DPR = Math.min(window.devicePixelRatio || 1, 2);
  let viewScale = 1;

  // STAN
  let state = 'ready'; // 'ready' | 'running' | 'over' | 'win'
  let lastT = 0;
  let score = 0;
  let pipes = [];
  let clouds = [];
  let particles = [];
  let confetti = [];
  let bird = null;
  let spawnTimer = 0;
  let cloudTimer = 0;
  let audio = null; // AudioContext (inicjalizacja przy pierwszej interakcji)

  const rand = (a, b) => Math.random() * (b - a) + a;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => t<.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2;

  // AUDIO
  function ensureAudio() {
    if (!audio) {
      try {
        audio = new (window.AudioContext || window.webkitAudioContext)();
      } catch {}
    }
  }
  function beep(type='tick', vol = 0.05) {
    if (!audio) return;
    const ctxA = audio;
    const o = ctxA.createOscillator();
    const g = ctxA.createGain();
    o.type = (type === 'pass') ? 'triangle' : (type === 'win' ? 'sine' : 'square');
    const now = ctxA.currentTime;
    let f1 = 660, f2 = 440, dur = 0.08;
    if (type === 'jump') { f1 = 740; f2 = 680; dur = 0.06; }
    if (type === 'hit')  { f1 = 180; f2 = 120; dur = 0.12; }
    if (type === 'pass') { f1 = 520; f2 = 640; dur = 0.08; }
    if (type === 'win')  { f1 = 880; f2 = 980; dur = 0.2; vol = 0.07; }

    o.frequency.setValueAtTime(f1, now);
    o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.03);
    o.connect(g).connect(ctxA.destination);
    o.start(now);
    o.stop(now + dur + 0.05);
  }

  // RYSOWANIE POMOCNICZE
  function drawGround() {
    const y = WORLD_H - GROUND_H;
    ctx.save();
    ctx.translate(0, y);
    // Cień linii gruntu
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, -2, WORLD_W, 2);

    // Pasy ziemi
    const grad = ctx.createLinearGradient(0, 0, 0, GROUND_H);
    grad.addColorStop(0, '#6cc26a');
    grad.addColorStop(1, '#3a8b3d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD_W, GROUND_H);

    // Tekstura
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#2c6c30';
    const s = 16;
    for (let x = 0; x < WORLD_W + s; x += s) {
      ctx.fillRect(x, 24, 10, 2);
      ctx.fillRect(x + 6, 40, 8, 2);
      ctx.fillRect(x + 2, 58, 10, 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function circleRectCollision(cx, cy, cr, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx;
    const dy = cy - ny;
    return (dx*dx + dy*dy) <= cr*cr;
  }

  // OBIEKTY
  class Bird {
    constructor() { this.reset(); }
    reset() {
      this.x = WORLD_W * 0.25;
      this.y = WORLD_H * 0.5;
      this.r = 14;
      this.vy = 0;
      this.rot = 0;
      this.wing = 0;
      this.alive = true;
      this.trail = 0;
    }
    jump() {
      this.vy = JUMP_VELOCITY;
      this.trail = 1; // emisja cząsteczek
      beep('jump', 0.05);
    }
    update(dt) {
      this.vy = clamp(this.vy + GRAVITY * dt, -1000, MAX_FALL);
      this.y += this.vy * dt;
      // Obrót zależny od prędkości
      this.rot = clamp(this.vy / 600, -0.6, 1.2);
      // Animacja skrzydła
      this.wing += dt * 8 + (this.vy < 0 ? 4*dt : 0);
      // Cząsteczki
      if (this.trail > 0) {
        this.trail = Math.max(0, this.trail - dt * 2.2);
        for (let i=0;i<2;i++) {
          particles.push(new Particle(
            this.x - 14 + rand(-3,3),
            this.y + rand(-3,3),
            rand(28,42),
            0.85, '#ffffff'
          ));
        }
      }
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);

      // Ciało
      const bodyGrad = ctx.createRadialGradient(-6, -6, 2, 0, 0, 20);
      bodyGrad.addColorStop(0, '#fffbe6');
      bodyGrad.addColorStop(1, '#ffd166');
      ctx.fillStyle = bodyGrad;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 14, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();

      // Skrzydło
      ctx.save();
      const wingA = Math.sin(this.wing) * 0.7 - 0.6;
      ctx.rotate(wingA);
      ctx.translate(-5, -2);
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 6, 0.2, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();

      // Oko
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(8, -4, 3.4, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#1b1e2a';
      ctx.beginPath();
      ctx.arc(8.8, -4, 1.6, 0, Math.PI*2);
      ctx.fill();

      // Dziób
      ctx.fillStyle = '#fca311';
      ctx.beginPath();
      ctx.moveTo(16, -1);
      ctx.lineTo(24, 2);
      ctx.lineTo(16, 5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  class Pipe {
    constructor(x, gapY, gapH, speed) {
      this.x = x;
      this.gapY = gapY;
      this.gapH = gapH;
      this.speed = speed;
      this.passed = false;
      this.w = PIPE_WIDTH;
    }
    get topRect() {
      return { x: this.x, y: 0, w: this.w, h: this.gapY - this.gapH/2 };
    }
    get botRect() {
      return { x: this.x, y: this.gapY + this.gapH/2, w: this.w, h: WORLD_H - GROUND_H - (this.gapY + this.gapH/2) };
    }
    update(dt) {
      this.x -= this.speed * dt;
    }
    draw() {
      const lip = 10;
      const drawPipe = (rx, ry, rw, rh, flipped=false) => {
        // korpus
        const g = ctx.createLinearGradient(rx, ry, rx, ry + rh);
        g.addColorStop(0, '#9be86f');
        g.addColorStop(1, '#4dae42');
        ctx.fillStyle = g;
        ctx.fillRect(rx, ry, rw, rh);
        // brzeg
        ctx.fillStyle = '#78d25a';
        const ly = flipped ? (ry + rh - lip) : ry;
        ctx.fillRect(rx - 2, ly, rw + 4, lip);
        // cień
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ctx.fillRect(rx + rw - 6, ry, 6, rh);
      };

      const t = this.topRect;
      const b = this.botRect;
      drawPipe(t.x, t.y, t.w, t.h, true);
      drawPipe(b.x, b.y, b.w, b.h, false);
    }
  }

  class Cloud {
    constructor() {
      this.x = rand(WORLD_W, WORLD_W * 1.8);
      this.y = rand(30, WORLD_H * 0.5);
      this.s = rand(0.6, 1.3);
      this.v = rand(8, 18) * this.s; // wolny parallax
      this.alpha = rand(0.45, 0.85);
    }
    update(dt) { this.x -= this.v * dt; }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = '#ffffff';
      const r = 12 * this.s;
      const x = this.x, y = this.y;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI*2);
      ctx.arc(x+14*this.s, y-6*this.s, r*0.9, 0, Math.PI*2);
      ctx.arc(x+28*this.s, y+2*this.s, r*1.1, 0, Math.PI*2);
      ctx.arc(x+44*this.s, y-6*this.s, r*0.85, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  class Particle {
    constructor(x, y, lifeMs=300, alpha=1, color='#ffffff') {
      this.x = x; this.y = y;
      this.vx = rand(-40, -10);
      this.vy = rand(-30, 30);
      this.life = lifeMs / 1000;
      this.age = 0;
      this.alpha = alpha;
      this.color = color;
      this.size = rand(1.5, 2.8);
    }
    update(dt) {
      this.age += dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += 300 * dt * 0.5;
    }
    draw() {
      const t = clamp(1 - this.age / this.life, 0, 1);
      if (t <= 0) return;
      ctx.globalAlpha = this.alpha * t;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    get alive() { return this.age < this.life; }
  }

  class Confetti {
    constructor(x, y) {
      this.x = x; this.y = y;
      this.vx = rand(-120, 120);
      this.vy = rand(-260, -160);
      this.size = rand(3, 5);
      const colors = ['#ff5964','#35a7ff','#ffe74c','#6bf178','#ff8c42','#b084ff'];
      this.color = colors[(Math.random()*colors.length)|0];
      this.life = rand(1.2, 1.8);
      this.age = 0;
      this.rot = rand(0, Math.PI*2);
      this.vr = rand(-6, 6);
    }
    update(dt) {
      this.age += dt;
      this.vy += 700 * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.rot += this.vr * dt;
      // odbicie od ziemi
      const gy = WORLD_H - GROUND_H - this.size;
      if (this.y > gy) {
        this.y = gy;
        this.vy *= -0.35;
        this.vx *= 0.85;
      }
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.fillStyle = this.color;
      ctx.fillRect(-this.size/2, -this.size/2, this.size, this.size);
      ctx.restore();
    }
    get alive() { return this.age < this.life + 2; }
  }

  // ROZMIAR / SKALA
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const rect = root.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * DPR);
    canvas.height = Math.floor(rect.height * DPR);

    // Skala
    const sx = canvas.width / WORLD_W;
    const sy = canvas.height / WORLD_H;
    viewScale = Math.min(sx, sy);
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  window.addEventListener('resize', resize, { passive:true });

  // LOGIKA
  function resetGame() {
    score = 0;
    pipes = [];
    clouds = [];
    particles = [];
    confetti = [];
    spawnTimer = 0;
    cloudTimer = 0;
    bird = new Bird();
    scoreEl.textContent = '0';
    // startowe chmurki
    for (let i=0;i<5;i++){ const c = new Cloud(); c.x = rand(0, WORLD_W); clouds.push(c); }
  }

  function startGame() {
    ensureAudio(); // odblokuj audio po pierwszym kliknięciu/spacji
    resetGame();
    ui.classList.remove('show');
    state = 'running';
  }

  function endGame(win=false) {
    state = win ? 'win' : 'over';
    ui.classList.add('show');

    if (win) {
      // Ekran wygranej + auto-przekierowanie
      ui.querySelector('.panel').innerHTML = `
        <h2>Wygrana!</h2>
        <p>Świetnie! Przeszedłeś przez wszystkie przeszkody.</p>
        <p class="hint">Za chwilę przejdziesz dalej...</p>
      `;
      beep('win', 0.06);
      for (let i=0;i<120;i++) confetti.push(new Confetti(bird.x, bird.y));
      setTimeout(() => {
        window.location.href = 'https://emilkajestesmoja.github.io/Emilka2/';
      }, 1400); // delikatna pauza, potem przekierowanie
    } else {
      // Ekran porażki
      ui.querySelector('.panel').innerHTML = `
        <h2>Koniec gry</h2>
        <p>Spróbuj jeszcze raz!</p>
        <p class="hint">Spacja / klik — skok. R — restart.</p>
        <div class="buttons">
          <button id="playButton" class="primary">Jeszcze raz</button>
        </div>
      `;
      const pb = ui.querySelector('#playButton');
      if (pb) pb.addEventListener('click', startGame);
    }
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    toasts.appendChild(t);
    setTimeout(() => { t.remove(); }, 1600);
  }

  // WEJŚCIA
  function onJump(e) {
    if (e && e.type === 'keydown') {
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyR') {
        if (state !== 'running') startGame();
        return;
      }
      if (e.code !== 'Space') return;
    }
    ensureAudio();

    if (state === 'ready') {
      startGame();
      bird.jump();
      return;
    }
    if (state === 'running') {
      bird.jump();
      return;
    }
    if (state === 'over' || state === 'win') {
      toast('Naciśnij R, aby zagrać ponownie');
    }
  }

  window.addEventListener('keydown', onJump);
  window.addEventListener('pointerdown', onJump, { passive:true });
  if (playBtn) playBtn.addEventListener('click', startGame);

  // PĘTLA
  function update(dt) {
    // tło — chmury
    cloudTimer += dt;
    if (cloudTimer > 2.2) {
      cloudTimer = 0;
      if (clouds.length < 10) clouds.push(new Cloud());
    }
    clouds.forEach(c => c.update(dt));
    clouds = clouds.filter(c => c.x > -80);

    if (state === 'running') {
      // trudność skaluje się wraz z wynikiem
      const t = clamp(score / TARGET_SCORE, 0, 1);
      const curSpeed = lerp(PIPE_SPEED_START, PIPE_SPEED_END, easeInOut(t));
      const curGap = lerp(PIPE_GAP_START, PIPE_GAP_END, easeInOut(t));

      spawnTimer += dt;
      if (spawnTimer >= PIPE_SPAWN) {
        spawnTimer = 0;
        const margin = 60;
        const gy = rand(margin + curGap/2, (WORLD_H - GROUND_H) - margin - curGap/2);
        pipes.push(new Pipe(WORLD_W + 10, gy, curGap, curSpeed));
      }

      // Aktualizacja przeszkód i kolizje
      for (const p of pipes) {
        p.update(dt);

        // zaliczanie
        if (!p.passed && p.x + p.w < bird.x - bird.r) {
          p.passed = true;
          score += 1;
          scoreEl.textContent = String(score);
          beep('pass', 0.05);
          // efekt cząsteczek
          for (let i=0;i<10;i++){
            particles.push(new Particle(bird.x, bird.y, rand(200,400), 0.9, '#ffe08a'));
          }
          if (score >= TARGET_SCORE) {
            endGame(true);
          }
        }

        // kolizje
        const tr = p.topRect, br = p.botRect;
        if (circleRectCollision(bird.x, bird.y, bird.r, tr.x, tr.y, tr.w, tr.h) ||
            circleRectCollision(bird.x, bird.y, bird.r, br.x, br.y, br.w, br.h)) {
          beep('hit', 0.06);
          endGame(false);
        }
      }
      pipes = pipes.filter(p => p.x > -PIPE_WIDTH - 20);

      bird.update(dt);

      // ziemia / sufit
      if (bird.y + bird.r >= WORLD_H - GROUND_H) {
        bird.y = WORLD_H - GROUND_H - bird.r;
        beep('hit', 0.06);
        endGame(false);
      }
      if (bird.y - bird.r <= 0) {
        bird.y = bird.r + 0.1;
      }
    }

    // cząsteczki
    particles.forEach(p => p.update(dt));
    particles = particles.filter(p => p.alive);

    // konfetti (po wygranej nadal animujemy do przekierowania)
    confetti.forEach(c => c.update(dt));
    confetti = confetti.filter(c => c.alive);
  }

  function render() {
    // czyść
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);

    // niebo
    ctx.save();
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    sky.addColorStop(0, '#bfe3ff');
    sky.addColorStop(0.6, '#9ed2ff');
    sky.addColorStop(1, '#7fbfff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.restore();

    // chmury
    clouds.forEach(c => c.draw());

    // rury
    pipes.forEach(p => p.draw());

    // ptak
    if (bird) bird.draw();

    // cząsteczki i konfetti
    particles.forEach(p => p.draw());
    confetti.forEach(c => c.draw());

    // ziemia
    drawGround();

    // overlay stanu READY
    if (state === 'ready') {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Naciśnij Spację lub kliknij, aby zagrać', WORLD_W/2, WORLD_H*0.45);
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = '#f8f8f8';
      ctx.fillText('Przejdź przez 6 przeszkód, aby wygrać', WORLD_W/2, WORLD_H*0.45 + 28);
      ctx.restore();
    }
  }

  function loop(t) {
    if (!lastT) lastT = t;
    const dt = Math.min(0.033, (t - lastT) / 1000); // clamp 33ms
    lastT = t;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // INIT
  function init() {
    resize();
    resetGame();
    ui.classList.add('show');
    if (playBtn) playBtn.addEventListener('click', startGame);
    requestAnimationFrame(loop);
  }

  // START
  init();

})();