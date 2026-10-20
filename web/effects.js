// Presentation only. Particle noise never consumes the simulation's seeded RNG.
const tau = Math.PI * 2;
const noise = (seed, n) => {
  const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

function halo(ctx, x, y, radius, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function line(ctx, points, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
}

function ring(ctx, x, y, radius, color, alpha = 1, width = 2, squash = 0.5) {
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, radius), Math.max(0.1, radius * squash), 0, 0, tau); ctx.stroke();
  ctx.restore();
}

function label(ctx, text, x, y, color, size = 15) {
  ctx.font = `600 ${size}px ui-monospace,monospace`; ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = '#112018'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function particles(ctx, e, p, count, radius, color, shards = false, gravity = 0) {
  const t = 1 - e.life;
  for (let i = 0; i < count; i++) {
    const a = noise(e.seed, i) * tau;
    const speed = 0.4 + noise(e.seed, i + 70) * 0.8;
    const x = p.x + Math.cos(a) * radius * t * speed;
    const y = p.y - 14 + Math.sin(a) * radius * t * speed * 0.65 - 25 * t + gravity * t * t;
    const size = (2 + noise(e.seed, i + 140) * 4) * Math.sqrt(e.life);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + t * (i % 2 ? 4 : -3));
    ctx.fillStyle = i % 4 === 0 ? '#fff5d4' : color;
    if (shards) {
      ctx.beginPath(); ctx.moveTo(0, -size * 1.8); ctx.lineTo(size * 0.6, size); ctx.lineTo(-size * 0.6, size); ctx.closePath(); ctx.fill();
    } else ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }
}

export function cameraImpulse(effects, time, reducedMotion) {
  if (reducedMotion) return {x: 0, y: 0};
  let strength = 0;
  for (const e of effects) {
    const impact = e.type === 'breach' ? 5 : e.type === 'cast' ? 2.5 : e.type === 'combo' ? 2 : e.type === 'burst' && e.scale > 2 ? 6 : 0;
    strength += impact * Math.pow(e.life, 4);
  }
  strength = Math.min(5, strength);
  return {x: Math.sin(time * 83) * strength, y: Math.cos(time * 71) * strength * 0.55};
}

export function drawProjectile(ctx, shot, project) {
  const a = project(shot.fromX, shot.fromY), b = project(shot.toX, shot.toY);
  a.y -= 47 + shot.level * 5; b.y -= 17;
  const t = Math.max(0, Math.min(1, 1 - shot.remaining / shot.duration));
  const arc = shot.kind === 'ember' ? 70 : shot.kind === 'frost' ? 25 : 14;
  const position = n => ({x: a.x + (b.x - a.x) * n, y: a.y + (b.y - a.y) * n - Math.sin(n * Math.PI) * arc});
  const p = position(t);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 1; i <= 7; i++) {
    const n = t - i * 0.025;
    if (n < 0) continue;
    const prev = position(n);
    ctx.globalAlpha = (1 - i / 8) * 0.7;
    ctx.fillStyle = shot.color;
    ctx.beginPath(); ctx.arc(prev.x, prev.y, shot.kind === 'ember' ? 6 - i * 0.5 : 3 - i * 0.2, 0, tau); ctx.fill();
  }
  ctx.globalAlpha = 1;
  halo(ctx, p.x, p.y, shot.kind === 'ember' ? 27 : 18, shot.color, 0.65);
  if (shot.kind === 'arrow') {
    const prev = position(Math.max(0, t - 0.03));
    const angle = Math.atan2(p.y - prev.y, p.x - prev.x);
    ctx.translate(p.x, p.y); ctx.rotate(angle);
    line(ctx, [[-18, 0], [5, 0]], '#ffeab2', 2.5);
    line(ctx, [[0, -4], [6, 0], [0, 4]], '#fff6dc', 2);
  } else if (shot.kind === 'frost') {
    ctx.translate(p.x, p.y); ctx.rotate(t * 6);
    ctx.strokeStyle = '#e0fbff'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {ctx.rotate(Math.PI / 3); line(ctx, [[-6, 0], [6, 0]], '#cbf6ff', 2);}
  } else {
    ctx.fillStyle = '#f29748'; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, tau); ctx.fill();
    ctx.fillStyle = '#ffe4a6'; ctx.beginPath(); ctx.arc(p.x - 1, p.y - 1, 4, 0, tau); ctx.fill();
  }
  ctx.restore();
}

export function drawEffect(ctx, e, project, time, reducedMotion) {
  if (['wave', 'combo', 'clear'].includes(e.type)) return;
  if (reducedMotion) {
    if (e.type === 'number' || e.type === 'shatter') {
      const p = project(e.x, e.y);
      ctx.save(); ctx.globalAlpha = e.life;
      label(ctx, e.text, p.x, p.y - 65, e.color || '#ffe3a1', 12);
      ctx.restore();
    }
    return;
  }
  const p = project(e.x, e.y), t = 1 - e.life, color = e.color || '#ffd68b', scale = e.scale || 1;
  ctx.save();
  ctx.globalAlpha = Math.min(1, e.life * 2);
  if (e.type === 'rune') {
    const a = noise(e.seed, 1) * tau;
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    label(ctx, e.text, p.x + Math.sin(a) * t * 32, p.y - 36 - t * 52, color, 18 - t * 5);
    halo(ctx, p.x, p.y - 15, 20, color, e.life * 0.2);
  } else if (e.type === 'number') {
    label(ctx, e.text, p.x + (e.offset || 0) + Math.sin(e.seed) * t * 8, p.y - 30 - t * 57, color, ['ЩИТ', 'НАБОР'].includes(e.text) ? 10 : 14);
  } else if (e.type === 'cast' || e.type === 'echo') {
    const start = e.type === 'cast' ? project(18, 7) : project(e.fromX, e.fromY);
    start.y -= e.type === 'cast' ? 70 : 20;
    const points = Array.from({length: 10}, (_, i) => {
      const n = i / 9, wobble = Math.sin(n * Math.PI) * (noise(e.seed, i) - 0.5) * 31;
      return [start.x + (p.x - start.x) * n + wobble, start.y + (p.y - 18 - start.y) * n - Math.sin(n * Math.PI) * 35 + wobble];
    });
    ctx.globalCompositeOperation = 'lighter';
    line(ctx, points, `${color}25`, 19 * e.life * scale);
    line(ctx, points, `${color}88`, 7 * e.life * scale);
    line(ctx, points, '#fff6d8', 2 * e.life);
    halo(ctx, p.x, p.y - 18, 64 * scale, color, e.life * 0.6);
  } else if (e.type === 'impact') {
    ctx.globalCompositeOperation = 'lighter';
    const flame = e.kind === 'ember', spell = e.kind === 'spell', frost = e.kind === 'frost';
    const radius = (flame ? 62 : spell ? 74 : frost ? 42 : 26) * scale;
    halo(ctx, p.x, p.y - 12, radius * (0.6 + t), color, e.life * (flame || spell ? 0.55 : 0.3));
    ring(ctx, p.x, p.y - 2, radius * Math.sqrt(t), color, e.life, 2.5 * e.life);
    if (spell) ring(ctx, p.x, p.y - 8, radius * t * 1.3, '#fff0b5', e.life, 1);
    particles(ctx, e, p, flame || spell ? 22 : frost ? 12 : 7, radius * 1.2, color, frost, flame ? 20 : 0);
    if (t < 0.45) {
      ctx.fillStyle = '#fff7d2'; ctx.beginPath(); ctx.arc(p.x, p.y - 13, (1 - t / 0.45) * (flame || spell ? 12 : 5) * scale, 0, tau); ctx.fill();
    }
    if (frost) for (let i = 0; i < 6; i++) {
      const a = i / 6 * tau;
      line(ctx, [[p.x, p.y - 12], [p.x + Math.cos(a) * 30 * t, p.y - 12 + Math.sin(a) * 20 * t]], '#cff6ff', 1.5 * e.life);
    }
  } else if (e.type === 'shatter') {
    ctx.globalCompositeOperation = 'lighter';
    ring(ctx, p.x, p.y - 19, 22 + t * 40, color, e.life, 2, 0.9);
    particles(ctx, e, p, 14, 90, color, true, 30);
    ctx.globalCompositeOperation = 'source-over';
    label(ctx, e.text, p.x, p.y - 76 - t * 22, '#cbe3ff', 10);
  } else if (e.type === 'burst') {
    ctx.globalCompositeOperation = 'lighter';
    halo(ctx, p.x, p.y - 12, 70 * scale, color, e.life * 0.35);
    ring(ctx, p.x, p.y, (15 + t * 58) * scale, color, e.life, 2 * e.life);
    particles(ctx, e, p, Math.round(23 * scale), 75 * scale, color, true, 40);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 5; i++) {
      const a = noise(e.seed, i + 250) * tau;
      const x = p.x + Math.cos(a) * 50 * t, y = p.y - Math.sin(t * Math.PI) * 50 + Math.sin(a) * 18 * t;
      ctx.fillStyle = '#ffd789';
      ctx.beginPath(); ctx.ellipse(x, y, 3 * Math.abs(Math.sin(t * 12 + i)) + 1, 4, 0, 0, tau); ctx.fill();
    }
  } else if (e.type === 'muzzle') {
    const y = p.y - (e.kind === 'frost' ? 70 : 53) - (e.level || 1) * 5;
    ctx.globalCompositeOperation = 'lighter';
    halo(ctx, p.x, y, 25, color, e.life * 0.8);
    ring(ctx, p.x, y, 4 + t * 18, color, e.life, 2, 0.9);
    ctx.fillStyle = '#fff5d2'; ctx.beginPath(); ctx.arc(p.x, y, 4 * e.life, 0, tau); ctx.fill();
  } else if (e.type === 'build') {
    ctx.globalCompositeOperation = 'lighter';
    halo(ctx, p.x, p.y - 20, 65, color, e.life * 0.4);
    ring(ctx, p.x, p.y - 2, 25 + t * 42, color, e.life, 2);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * tau + t;
      const x = p.x + Math.cos(a) * 27, y = p.y + Math.sin(a) * 13;
      line(ctx, [[x, y], [x, y - 55 * Math.sin(t * Math.PI)]], `${color}aa`, 2);
    }
    particles(ctx, e, p, 12, 35, color);
  } else if (e.type === 'spawn') {
    ctx.globalCompositeOperation = 'lighter';
    halo(ctx, p.x, p.y - 22, 55 * scale, color, e.life * 0.35);
    ring(ctx, p.x, p.y - 12, (8 + t * 32) * scale, color, e.life, 2, 0.85);
    particles(ctx, e, p, 9, 35 * scale, color, true);
  } else if (e.type === 'breach') {
    ctx.globalCompositeOperation = 'lighter';
    halo(ctx, p.x, p.y - 25, 100 * scale, '#ff7557', e.life * 0.65);
    ring(ctx, p.x, p.y, (20 + t * 100) * scale, color, e.life, 4 * e.life);
    particles(ctx, e, p, 32, 100 * scale, color, true, 40);
  }
  ctx.restore();
}

export function drawCombatOverlay(ctx, game, reducedMotion) {
  const breach = game.effects.find(e => e.type === 'breach');
  if ((breach || game.hp < game.maxHp * 0.3) && game.phase === 'combat') {
    ctx.save();
    const opacity = reducedMotion ? 0.08 : breach ? breach.life * 0.24 : 0.08;
    const gradient = ctx.createRadialGradient(550, 285, 180, 550, 285, 570);
    gradient.addColorStop(0, 'transparent'); gradient.addColorStop(1, `rgba(225,72,49,${opacity})`);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1100, 570); ctx.restore();
  }
  for (const e of game.effects) {
    if (!['wave', 'combo', 'clear'].includes(e.type)) continue;
    const t = 1 - e.life;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 8, e.life * 4);
    if (e.type === 'wave') {
      const x = 550, y = 47;
      const gradient = ctx.createLinearGradient(x - 240, 0, x + 240, 0);
      gradient.addColorStop(0, 'transparent'); gradient.addColorStop(0.25, '#102018eb'); gradient.addColorStop(0.75, '#102018eb'); gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient; ctx.fillRect(x - 260, 6, 520, 82);
      line(ctx, [[x - 150, 8], [x + 150, 8]], '#d8bc7e66', 1);
      label(ctx, e.wave === 8 ? 'ДРЕВНИЙ СТРАЖ' : `ВОЛНА ${String(e.wave).padStart(2, '0')}`, x, y, '#ffe3a3', e.wave === 8 ? 24 : 28);
      ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#bccbb0';
      ctx.fillText(e.wave === 1 ? 'ЗАВЕРШИ СЛОВО — РАЗБЕЙ РУНИЧЕСКИЙ ЩИТ' : e.wave === 8 ? 'ТРИ СЛОВА РАЗРУШАТ ЕГО ЗАЩИТУ' : 'ДЕРЖИ РИТМ. НЕ ДАЙ ИМ ПРОРВАТЬСЯ.', x, y + 23);
    } else if (e.type === 'combo') {
      halo(ctx, 975, 85, 85, '#ffd589', 0.2);
      label(ctx, `×${e.multiplier}`, 975, 79, '#ffda85', 46);
      label(ctx, 'КОМБО', 975, 103, '#ffedbf', 11);
      line(ctx, [[941, 114], [1009, 114]], '#e3bc72', 1);
    } else {
      label(ctx, 'РУБЕЖ УДЕРЖАН', 550, 220, '#dcf5b6', 29);
    }
    ctx.restore();
  }
}
