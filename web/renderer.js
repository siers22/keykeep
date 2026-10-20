import {cameraImpulse, drawCombatOverlay, drawEffect, drawProjectile} from './effects.js';

export const project = (x, y) => ({x: 425 + (x - y) * 31, y: 55 + (x + y) * 16});

const colors = {grass: ['#344f35', '#39553a', '#3d573a', '#355137', '#3d573b'], path: ['#8a8b66', '#92906a', '#9c9873', '#858766']};

function polygon(ctx, points, fill, stroke = null, width = 1) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

function diamond(ctx, x, y, w, h, fill, stroke) {
  polygon(ctx, [[x, y - h], [x + w, y], [x, y + h], [x - w, y]], fill, stroke);
}

function box(ctx, x, y, w, d, h, top, left, right) {
  polygon(ctx, [[x - w, y - h], [x, y + d - h], [x, y + d], [x - w, y]], left);
  polygon(ctx, [[x, y + d - h], [x + w, y - h], [x + w, y], [x, y + d]], right);
  diamond(ctx, x, y - h, w, d, top);
}

function glow(ctx, x, y, radius, color, opacity = 1) {
  ctx.save();
  ctx.globalAlpha = opacity;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r, color, stroke = null) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = color; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

export class Renderer {
  constructor(canvas, catalog) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.catalog = catalog;
    this.hoverPad = -1;
    this.selectedPad = -1;
    this.selectedType = 'arrow';
    this.time = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.background = document.createElement('canvas');
    this.background.width = 1100;
    this.background.height = 570;
    this.drawBackground(this.background.getContext('2d'));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
  }

  hitPad(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * 1100;
    const y = (clientY - rect.top) / rect.height * 570;
    let best = -1, distance = 43;
    this.catalog.pads.forEach(([gx, gy], i) => {
      const p = project(gx, gy);
      const d = Math.hypot(p.x - x, (p.y - y - 12) * 1.2);
      if (d < distance) { best = i; distance = d; }
    });
    return best;
  }

  drawBackground(ctx) {
    const road = new Set();
    const path = this.catalog.path;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i];
      const length = Math.abs(bx - ax) + Math.abs(by - ay);
      for (let n = 0; n <= length; n++) road.add(`${ax + Math.sign(bx - ax) * n},${ay + Math.sign(by - ay) * n}`);
    }
    ctx.fillStyle = '#07100a40';
    ctx.beginPath(); ctx.ellipse(550, 358, 455, 175, 0.05, 0, Math.PI * 2); ctx.fill();
    // A cutaway island: soil, stone edge, then hand-coloured isometric tiles.
    const a = project(-0.5, -0.5), b = project(17.5, -0.5), c = project(17.5, 10.5), d = project(-0.5, 10.5);
    polygon(ctx, [[d.x, d.y], [c.x, c.y], [c.x, c.y + 23], [d.x, d.y + 23]], '#253426');
    polygon(ctx, [[b.x, b.y], [c.x, c.y], [c.x, c.y + 23], [b.x, b.y + 23]], '#1e2d22');
    for (let depth = 0; depth < 29; depth++) {
      for (let x = 0; x < 18; x++) {
        const y = depth - x;
        if (y < 0 || y > 10) continue;
        const p = project(x, y);
        const hash = ((x * 4271 + y * 1733 + x * y * 59) % 101) / 101;
        const isRoad = road.has(`${x},${y}`);
        diamond(ctx, p.x, p.y, 31.2, 16.2, isRoad ? colors.path[Math.floor(hash * colors.path.length)] : colors.grass[Math.floor(hash * colors.grass.length)], isRoad ? '#a7a17b26' : '#63805216');
        if (isRoad) {
          ctx.strokeStyle = '#5c694d55'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x - 15, p.y + 4); ctx.lineTo(p.x + 2, p.y - 5); ctx.lineTo(p.x + 15, p.y + 1); ctx.stroke();
        } else if (hash > 0.54) {
          ctx.fillStyle = '#7a995346'; ctx.fillRect(p.x + hash * 18 - 9, p.y - 3, 3, 2);
          ctx.fillStyle = '#9aaf6635'; ctx.fillRect(p.x - 9, p.y + 5, 2, 1.4);
        }
      }
    }
    const treePositions = [];
    for (let x = 0; x < 18; x++) for (let y = 0; y <= 10; y++) {
      if (road.has(`${x},${y}`) || this.catalog.pads.some(([px, py]) => Math.hypot(px - x, py - y) < 1.4)) continue;
      const closeToPath = [...road].some(s => {const [px, py] = s.split(',').map(Number); return Math.hypot(px - x, py - y) < 1.2;});
      const hash = (x * 17 + y * 29 + x * y * 3) % 19;
      if (!closeToPath && (hash < 4 || (y >= 9 && hash < 12) || (x >= 16 && hash < 10))) treePositions.push([x, y, hash]);
      else if (!closeToPath && hash === 13) {
        const p = project(x, y);
        box(ctx, p.x, p.y, 8, 4, 9, '#6b795a', '#435840', '#526447');
      }
    }
    treePositions.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
    for (const [x, y, seed] of treePositions) this.tree(ctx, x, y, seed);
    // Small rune stones and warm lanterns establish the abandoned forest road.
    for (const [x, y] of [[0, 6], [6, 1], [10, 9], [16, 1], [2, 9]]) {
      const p = project(x, y);
      box(ctx, p.x, p.y, 9, 5, 21, '#7f8c6c', '#52644a', '#647555');
      ctx.strokeStyle = '#c2c690'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 17); ctx.lineTo(p.x - 3, p.y - 12); ctx.lineTo(p.x + 1, p.y - 9); ctx.stroke();
    }
    for (const [x, y] of [[5, 3], [8, 7], [14, 1], [15, 7]]) {
      const p = project(x, y);
      glow(ctx, p.x, p.y - 13, 25, '#e8be532c');
      box(ctx, p.x, p.y, 4, 2, 15, '#a19b6a', '#566145', '#6e7751');
      diamond(ctx, p.x, p.y - 16, 4, 3, '#e9c67b');
    }
    // A delicate dotted boundary, quieter than the road and tower pads.
    ctx.save(); ctx.setLineDash([3, 7]);
    polygon(ctx, [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]], null, '#8da26a27');
    ctx.restore();
  }

  tree(ctx, gx, gy, seed) {
    const p = project(gx, gy);
    const size = 0.78 + (seed % 5) * 0.075;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(size, size);
    ctx.fillStyle = '#0b1b1470'; ctx.beginPath(); ctx.ellipse(3, 5, 25, 10, 0, 0, Math.PI * 2); ctx.fill();
    box(ctx, 0, 0, 3, 2, 22, '#8a8050', '#534d32', '#655f3b');
    for (let i = 0; i < 3; i++) {
      const bottom = -10 - i * 13, w = 22 - i * 4;
      polygon(ctx, [[0, bottom - 34], [-w, bottom], [0, bottom + 8]], '#284a32');
      polygon(ctx, [[0, bottom - 34], [w, bottom], [0, bottom + 8]], '#325a38');
      ctx.strokeStyle = '#5d7e3b65'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, bottom - 33); ctx.lineTo(w, bottom); ctx.stroke();
    }
    ctx.restore();
  }

  draw(game, delta) {
    if (!this.reducedMotion && !game.paused) this.time += Math.min(delta, 0.1);
    const ctx = this.ctx;
    ctx.setTransform(this.canvas.width / 1100, 0, 0, this.canvas.height / 570, 0, 0);
    ctx.clearRect(0, 0, 1100, 570);
    ctx.save();
    const shake = cameraImpulse(game.effects, this.time, this.reducedMotion);
    ctx.translate(shake.x, shake.y);
    ctx.drawImage(this.background, 0, 0);
    this.portal(ctx);
    this.fortress(ctx, game);
    const activePad = this.hoverPad >= 0 ? this.hoverPad : this.selectedPad;
    if (activePad >= 0) {
      const tower = game.towers.find(t => t.pad === activePad);
      const def = this.catalog.towers.find(t => t.id === (tower?.type || this.selectedType));
      const [x, y] = this.catalog.pads[activePad];
      const range = def.range * (game.has('reach') ? 1.25 : 1);
      const points = Array.from({length: 49}, (_, i) => {
        const a = i / 48 * Math.PI * 2, p = project(x + Math.cos(a) * range, y + Math.sin(a) * range);
        return [p.x, p.y];
      });
      ctx.save(); ctx.setLineDash([4, 5]);
      polygon(ctx, points, `${def.color}0a`, `${def.color}60`, 1.5);
      ctx.restore();
    }
    this.catalog.pads.forEach(([x, y], i) => {
      const p = project(x, y), tower = game.towers.find(t => t.pad === i);
      const active = i === activePad;
      box(ctx, p.x, p.y + 3, 23, 12, 6, active ? '#758064' : '#596d50', '#394b35', '#465b3e');
      diamond(ctx, p.x, p.y - 3, 19, 10, active ? '#5e7250' : '#405a3d', active ? '#c8c08b' : '#93a77677');
      if (!tower) {
        ctx.save(); ctx.globalAlpha = game.phase === 'prep' ? 1 : 0.35;
        ctx.strokeStyle = active ? '#f2d59d' : '#a4b98c'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(p.x - 5, p.y - 4); ctx.lineTo(p.x + 5, p.y - 4); ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x, p.y + 1); ctx.stroke();
        ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#a0b080';
        ctx.fillText(String(i + 1).padStart(2, '0'), p.x, p.y + 24);
        ctx.restore();
      }
    });
    const entities = [
      ...game.towers.map(t => ({type: 'tower', data: t, depth: this.catalog.pads[t.pad][0] + this.catalog.pads[t.pad][1]})),
      ...game.enemies.map(e => {const p = game.position(e.distance); return {type: 'enemy', data: e, depth: p.x + p.y};}),
    ].sort((a, b) => a.depth - b.depth);
    for (const entity of entities) {
      if (entity.type === 'tower') this.tower(ctx, entity.data);
      else this.enemy(ctx, entity.data, game);
    }
    for (const shot of game.projectiles) drawProjectile(ctx, shot, project);
    for (const effect of game.effects) drawEffect(ctx, effect, project, this.time, this.reducedMotion);
    // Labels are drawn last so towers never cover training text.
    const occupied = [];
    for (const enemy of [...game.enemies].sort((a, b) => (b.id === game.targetId) - (a.id === game.targetId) || b.distance - a.distance)) this.enemyLabel(ctx, enemy, game, occupied);
    for (let i = 0; i < 17; i++) {
      const x = 160 + ((i * 71.3 + this.time * (2 + i % 3)) % 780);
      const y = 90 + ((i * 42.7 + Math.sin(this.time * 0.4 + i) * 14) % 370);
      ctx.globalAlpha = 0.14 + Math.sin(this.time * 0.7 + i) * 0.12;
      ctx.fillStyle = '#e8cc8d'; ctx.fillRect(x, y, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    drawCombatOverlay(ctx, game, this.reducedMotion);
  }

  portal(ctx) {
    const p = project(0, 3), pulse = 0.6 + Math.sin(this.time * 2) * 0.1;
    glow(ctx, p.x, p.y - 20, 68, '#a094ec', 0.13);
    ctx.save(); ctx.translate(p.x, p.y - 21);
    ctx.strokeStyle = '#746793'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.ellipse(0, 0, 18, 32, -0.35, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(191,173,236,${pulse})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 27, -0.35, 0, Math.PI * 2); ctx.stroke();
    const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
    fill.addColorStop(0, '#9374b05c'); fill.addColorStop(1, '#65527d15');
    ctx.fillStyle = fill; ctx.fill();
    ctx.restore();
    for (const [dx, dy] of [[-22, 3], [23, -2]]) box(ctx, p.x + dx, p.y + dy, 7, 4, 27, '#827b89', '#4b4857', '#625b70');
    ctx.font = '8px ui-monospace,monospace'; ctx.fillStyle = '#b2a2c6'; ctx.textAlign = 'center'; ctx.fillText('РАЗЛОМ', p.x, p.y + 31);
  }

  fortress(ctx, game) {
    const p = project(18, 7);
    glow(ctx, p.x, p.y - 35, 83, '#d5c27a', 0.13);
    box(ctx, p.x, p.y + 6, 43, 21, 12, '#7a8160', '#47583d', '#536749');
    box(ctx, p.x, p.y - 6, 31, 16, 38, '#95977a', '#687454', '#7a8460');
    for (const [dx, dy] of [[-27, -5], [25, -3], [-3, -18]]) {
      box(ctx, p.x + dx, p.y + dy, 13, 7, 60, '#b0ad87', '#6e7b58', '#89926a');
      box(ctx, p.x + dx, p.y + dy - 58, 16, 9, 8, '#c1b88b', '#838765', '#9ca27a');
      for (const ox of [-10, 0, 10]) box(ctx, p.x + dx + ox, p.y + dy - 62, 3, 2, 8, '#c6bd8f', '#7c8561', '#a1aa7a');
      polygon(ctx, [[p.x + dx - 2, p.y + dy - 40], [p.x + dx + 2, p.y + dy - 42], [p.x + dx + 2, p.y + dy - 28], [p.x + dx - 2, p.y + dy - 26]], '#d1b574');
    }
    polygon(ctx, [[p.x - 8, p.y + 2], [p.x - 8, p.y - 20], [p.x, p.y - 27], [p.x + 8, p.y - 20], [p.x + 8, p.y + 2]], '#344a32');
    ctx.strokeStyle = '#c2ae76'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x - 3, p.y - 5); ctx.lineTo(p.x + 3, p.y - 12); ctx.lineTo(p.x - 2, p.y - 17); ctx.stroke();
    const flagX = p.x - 3, flagY = p.y - 87;
    ctx.strokeStyle = '#b5ad7c'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(flagX, flagY + 8); ctx.lineTo(flagX, flagY - 26); ctx.stroke();
    polygon(ctx, [[flagX, flagY - 25], [flagX + 24, flagY - 19 + Math.sin(this.time * 2)], [flagX, flagY - 10]], '#b7bc7c');
    ctx.textAlign = 'center'; ctx.font = '8px ui-monospace,monospace'; ctx.fillStyle = '#c5c995'; ctx.fillText('ТВОЯ КРЕПОСТЬ', p.x, p.y + 48);
  }

  tower(ctx, tower) {
    const [x, y] = this.catalog.pads[tower.pad], p = project(x, y);
    if (!this.reducedMotion && tower.recoil > 0) p.y += Math.sin(tower.recoil / 0.22 * Math.PI) * 3;
    const h = 30 + tower.level * 5;
    const def = this.catalog.towers.find(t => t.id === tower.type);
    ctx.fillStyle = '#13261770'; ctx.beginPath(); ctx.ellipse(p.x + 4, p.y + 2, 23, 9, 0, 0, Math.PI * 2); ctx.fill();
    box(ctx, p.x, p.y - 3, 13, 7, h, '#a1a17d', '#677657', '#7e8c65');
    box(ctx, p.x, p.y - h - 2, 17, 9, 5, '#b1ac80', '#818564', '#919976');
    if (tower.type === 'arrow') {
      for (const dx of [-11, 0, 11]) box(ctx, p.x + dx, p.y - h - 5, 3, 2, 7, '#c7bb89', '#8c8b64', '#a5a879');
      ctx.strokeStyle = '#f0c578'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x - 8, p.y - h - 16); ctx.quadraticCurveTo(p.x + 10, p.y - h - 14, p.x + 10, p.y - h - 4); ctx.moveTo(p.x - 6, p.y - h - 16); ctx.lineTo(p.x + 10, p.y - h - 4); ctx.stroke();
      ctx.strokeStyle = '#dec88b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x - 6, p.y - h - 3); ctx.lineTo(p.x + 9, p.y - h - 18); ctx.stroke();
    } else if (tower.type === 'frost') {
      glow(ctx, p.x, p.y - h - 17, 27, '#a6e6e9', 0.15);
      polygon(ctx, [[p.x, p.y - h - 34], [p.x - 9, p.y - h - 13], [p.x, p.y - h - 3]], '#a8d8df');
      polygon(ctx, [[p.x, p.y - h - 34], [p.x + 9, p.y - h - 13], [p.x, p.y - h - 3]], '#7eb4d0');
      ctx.strokeStyle = '#d8f8f3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y - h - 34); ctx.lineTo(p.x, p.y - h - 3); ctx.stroke();
    } else {
      box(ctx, p.x, p.y - h - 3, 11, 6, 8, '#7b6550', '#584837', '#77634b');
      glow(ctx, p.x, p.y - h - 15, 32, '#edab61', 0.18);
      const sway = Math.sin(this.time * 5 + tower.pad) * 2;
      polygon(ctx, [[p.x - 7, p.y - h - 9], [p.x - 5, p.y - h - 24], [p.x, p.y - h - 17], [p.x + 4 + sway, p.y - h - 36], [p.x + 9, p.y - h - 16], [p.x + 6, p.y - h - 7]], '#dc8e5b');
      polygon(ctx, [[p.x - 3, p.y - h - 9], [p.x + 3, p.y - h - 26], [p.x + 5, p.y - h - 8]], '#f4d68b');
    }
    polygon(ctx, [[p.x - 2, p.y - 12], [p.x + 3, p.y - 15], [p.x + 3, p.y - 25], [p.x - 2, p.y - 22]], def.color);
    ctx.font = '8px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#d3d5ac';
    ctx.fillText('Ⅰ'.repeat(tower.level), p.x, p.y + 24);
  }

  enemy(ctx, enemy, game) {
    const pos = game.position(enemy.distance), p = project(pos.x, pos.y);
    const bob = this.reducedMotion ? 0 : Math.sin(this.time * 6 + enemy.id) * 2;
    const boss = enemy.kind === 'boss';
    const size = boss ? 2.1 : enemy.kind === 'tank' ? 1.5 : enemy.kind === 'swift' ? 1.08 : 1.25;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(size, size);
    ctx.fillStyle = '#11191880'; ctx.beginPath(); ctx.ellipse(0, 3, 15, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (enemy.ward > 0) {
      glow(ctx, 0, -15, 39, '#9e7bef', 0.13);
      ctx.strokeStyle = '#bc9af49c'; ctx.lineWidth = 1.4;
      const spin = this.time * 0.5 + enemy.id;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = i / 6 * Math.PI * 2 + spin, x = Math.cos(a) * 21, y = -16 + Math.sin(a) * 25;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = '#9b83eb'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, 2, 22, 10, 0, this.time, this.time + Math.PI * 1.4); ctx.stroke();
    }
    if (game.targetId === enemy.id) {
      ctx.strokeStyle = '#efcc8a'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.ellipse(0, 2, 18, 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const body = enemy.flash > 0 ? '#fff0d5' : boss ? '#a16f8b' : enemy.kind === 'tank' ? '#99a49b' : enemy.kind === 'swift' ? '#b087ba' : '#a18ea5';
    const dark = boss ? '#5d4e6d' : '#70627a';
    const sy = -14 + bob;
    const stride = this.reducedMotion ? 0 : Math.sin(this.time * 10 * enemy.speed + enemy.id) * 3;
    box(ctx, -6, stride, 4, 3, 9, '#79717e', '#4b4753', '#66566f');
    box(ctx, 6, 2 - stride, 4, 3, 9, '#79717e', '#4b4753', '#66566f');
    box(ctx, 0, sy + 12, 10, 6, 15, body, dark, body);
    polygon(ctx, [[0, sy - 11], [-11, sy - 2], [-8, sy + 6], [3, sy + 8], [12, sy], [8, sy - 9]], body, '#c0a8b233');
    polygon(ctx, [[-10, sy - 1], [-14, sy - 13], [-3, sy - 8]], dark);
    polygon(ctx, [[8, sy - 6], [14, sy - 16], [14, sy + 1]], dark);
    if (boss) {
      polygon(ctx, [[-9, sy - 9], [-11, sy - 23], [-3, sy - 17], [0, sy - 27], [5, sy - 17], [12, sy - 24], [9, sy - 8]], '#b39e71');
      glow(ctx, 0, sy, 22, '#d4b7ee', 0.1);
    }
    ctx.fillStyle = enemy.slow > 0 ? '#b1eef4' : '#f4c497';
    ctx.fillRect(-4, sy - 2, 3, 2); ctx.fillRect(5, sy - 3, 3, 2);
    if (enemy.slow > 0) {
      ctx.strokeStyle = '#a4dfe7'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  enemyLabel(ctx, enemy, game, occupied) {
    const pos = game.position(enemy.distance), p = project(pos.x, pos.y);
    const selected = enemy.id === game.targetId;
    const originalY = p.y - (enemy.kind === 'boss' ? 100 : enemy.kind === 'tank' ? 77 : 64);
    let y = originalY;
    let word = enemy.word;
    let start = 0;
    if (word.length > 20) {
      start = Math.max(0, enemy.typed - 6);
      word = (start ? '…' : '') + word.slice(start, start + 20) + (start + 20 < word.length ? '…' : '');
    }
    ctx.font = '15px ui-monospace, SFMono-Regular, monospace';
    const width = ctx.measureText(word).width + 20;
    const candidates = [];
    for (const dy of [0, -42, 42, -84, 84, -126, 126, 168]) for (const dx of [0, -80, 80, -160, 160, -240, 240]) {
      const x = p.x + dx, cy = originalY + dy;
      if (cy < 39 || cy > 510 || x - width / 2 < 20 || x + width / 2 > 1080) continue;
      candidates.push({x, y: cy, cost: Math.abs(dx) * 0.8 + Math.abs(dy) + (dy > 0 ? 20 : 0)});
    }
    candidates.sort((a, b) => a.cost - b.cost);
    const chosen = candidates.find(c => !occupied.some(r => Math.abs(r.x - c.x) < (r.width + width) / 2 + 6 && Math.abs(r.y - c.y) < 40)) || candidates[0] || {x: p.x, y: Math.max(39, originalY)};
    const labelX = chosen.x;
    y = chosen.y;
    occupied.push({x: labelX, y, width});
    if (Math.abs(y - originalY) > 10 || Math.abs(labelX - p.x) > 10) {
      ctx.strokeStyle = selected ? '#c9ac6b88' : '#9e9f8b55'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(labelX, y > p.y ? y - 20 : y + 26); ctx.lineTo(p.x, p.y - 30); ctx.stroke();
    }
    roundRect(ctx, labelX - width / 2, y - 18, width, 28, 4, selected ? '#343324fa' : '#111c17f5', selected ? '#f6d08b' : enemy.ward > 0 ? '#9b85bd' : '#788c61');
    ctx.textAlign = 'left';
    let x = labelX - width / 2 + 10;
    for (let i = 0; i < word.length; i++) {
      const realIndex = i + start - (start ? 1 : 0);
      ctx.fillStyle = realIndex < enemy.typed ? '#a9ce9b' : selected && realIndex === enemy.typed ? '#f0cc8b' : '#e1e3d2';
      ctx.fillText(word[i] === ' ' ? '·' : word[i], x, y + 1);
      x += ctx.measureText(word[i]).width;
    }
    const barWidth = Math.max(24, Math.min(width - 8, 80));
    ctx.fillStyle = '#273021'; ctx.fillRect(labelX - barWidth / 2, y + 13, barWidth, 3);
    ctx.fillStyle = selected ? '#e5be77' : '#a998ad'; ctx.fillRect(labelX - barWidth / 2, y + 13, barWidth * Math.max(0, enemy.hp / enemy.maxHp), 3);
    if (enemy.ward > 0) {
      ctx.fillStyle = '#bca8f5';
      for (let i = 0; i < enemy.ward; i++) {
        const x = labelX + (i - (enemy.ward - 1) / 2) * 8;
        diamond(ctx, x, y + 23, 3, 3, '#c5b1ff');
      }
    }
  }


}

export function towerSVG(type) {
  const palettes = {arrow: ['#b7ad81', '#778565', '#edc285'], frost: ['#9ba994', '#647b70', '#9dd4e6'], ember: ['#b7a080', '#83765c', '#ed9b70']};
  const [top, side, accent] = palettes[type];
  const weapon = type === 'arrow'
    ? `<path d="M12 18Q34 5 35 25M12 18 35 25M19 28 33 9" stroke="${accent}" stroke-width="2" fill="none"/>`
    : type === 'frost'
      ? `<path d="m24 2-9 16 9 12 10-13Z" fill="${accent}"/><path d="M24 2v28" stroke="#e5f4ee"/>`
      : `<path d="M16 27C7 14 19 13 20 5c9 9 0 8 8 12l5-14c13 15 9 26-7 27Z" fill="${accent}"/><path d="M21 27c-3-7 4-7 5-15 8 9 6 14-1 16Z" fill="#f2d595"/>`;
  return `<svg viewBox="0 0 48 60" fill="none" aria-hidden="true"><path d="m6 43 18-10 18 10-18 10Z" fill="${side}"/><path d="m24 53 18-10v6L24 59 6 49v-6Z" fill="#4c6145"/><path d="m14 25 10-6 10 6v21l-10 6-10-6Z" fill="${side}"/><path d="m24 31 10-6v21l-10 6Z" fill="${top}"/><path d="m9 24 15-8 15 8-15 8Z" fill="${top}"/><path d="m9 24 15 8 15-8v6l-15 8-15-8Z" fill="${side}"/>${weapon}<path d="m25 39 5-3v7l-5 3Z" fill="${accent}"/></svg>`;
}
