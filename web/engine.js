// Pure simulation: drawing, networking and DOM stay outside this module.
export class Game {
  constructor(catalog, run = null, onEvent = () => {}) {
    this.catalog = catalog;
    this.onEvent = onEvent;
    this.run = run;
    this.rngState = run?.seed || 2026;
    this.phase = 'prep';
    this.paused = false;
    this.wave = 0;
    this.wavesCompleted = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.gold = 100;
    this.enemies = [];
    this.towers = [{pad: 1, type: 'arrow', level: 1, cooldown: 0, invested: 0}];
    this.relics = [];
    this.offers = [];
    this.effects = [];
    this.projectiles = [];
    this.effectSerial = 0;
    this.waveTime = 0;
    this.elapsed = 0;
    this.correct = 0;
    this.errors = 0;
    this.charErrors = {};
    this.combo = 0;
    this.maxCombo = 0;
    this.comboCounts = {'1': 0, '2': 0, '3': 0, '5': 0};
    this.kills = 0;
    this.points = 0;
    this.targetId = null;
    this.nextId = 0;
    this.spawnTimer = 0;
    this.spawned = 0;
    this.waveCount = 0;
    this.pathLength = catalog.path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - catalog.path[i][0], p[1] - catalog.path[i][1]), 0);
  }

  random() {
    this.rngState |= 0;
    this.rngState = (this.rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(this.rngState ^ this.rngState >>> 15, 1 | this.rngState);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  has(id) { return this.relics.includes(id); }
  get multiplier() { return this.combo >= 50 ? 5 : this.combo >= 25 ? 3 : this.combo >= 10 ? 2 : 1; }
  get active() { return this.phase === 'combat' && !this.paused; }
  get target() { return this.enemies.find(e => e.id === this.targetId) || null; }
  get accuracy() { return this.correct + this.errors ? this.correct / (this.correct + this.errors) * 100 : 100; }
  get cpm() { return this.elapsed > 0 ? this.correct / this.elapsed * 60 : 0; }
  get nearest() { return [...this.enemies].sort((a, b) => b.distance - a.distance || a.id - b.id)[0] || null; }

  position(distance) {
    let remaining = Math.max(0, distance);
    const path = this.catalog.path;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i];
      const length = Math.hypot(bx - ax, by - ay);
      if (remaining <= length) return {x: ax + (bx - ax) * remaining / length, y: ay + (by - ay) * remaining / length};
      remaining -= length;
    }
    return {x: path.at(-1)[0], y: path.at(-1)[1]};
  }

  startWave() {
    if (this.phase !== 'prep' || !this.run) return false;
    this.wave++;
    this.phase = 'combat';
    this.paused = false;
    this.spawned = 0;
    this.waveCount = this.wave === 8 ? 19 : 7 + this.wave * 2;
    this.spawnTimer = 0;
    this.waveTime = 0;
    this.targetId = null;
    this.effect('wave', 9, 5, {duration: 2.5, wave: this.wave});
    this.onEvent('wave', {wave: this.wave});
    return true;
  }

  word() {
    const mode = this.run?.mode || 'words';
    const language = ['code', 'symbols'].includes(mode) ? 'en' : (this.run?.language || 'ru');
    const list = this.catalog.content[mode][language];
    let word = list[Math.floor(this.random() * list.length)];
    for (let i = 0; i < 20 && this.enemies.some(e => e.word[0] === word[0]); i++) {
      word = list[Math.floor(this.random() * list.length)];
    }
    return word;
  }

  spawn() {
    const boss = this.wave === 8 && this.spawned === 0;
    const roll = this.random();
    const kind = boss ? 'boss' : this.wave >= 2 && roll < 0.25 ? 'tank' : roll > 0.64 ? 'swift' : 'normal';
    const word = this.word();
    const textFactor = Math.sqrt(Math.max(1, Math.min(4, word.length / 6)));
    const hp = boss ? 140 : (12 + this.wave * 2.2) * (kind === 'tank' ? 1.7 : kind === 'swift' ? 0.75 : 1) * textFactor;
    this.enemies.push({
      id: ++this.nextId, kind, word, typed: 0, hp, maxHp: hp,
      distance: 0, slow: 0, flash: 0, ward: boss ? 3 : kind === 'tank' ? 2 : 1,
      speed: (kind === 'boss' ? 0.7 : kind === 'tank' ? 0.69 : kind === 'swift' ? 1.32 : 0.95) * (1 + this.wave * 0.035),
    });
    this.spawned++;
    this.effect('spawn', 0, 3, {color: boss ? '#ef928c' : '#ba9bff', duration: 0.8, scale: boss ? 2 : 1});
    this.onEvent('spawn');
  }

  effect(type, x, y, extra = {}) {
    this.effects.push({type, x, y, life: 1, duration: 0.65, seed: ++this.effectSerial, ...extra});
    if (this.effects.length > 240) this.effects.shift();
  }

  isTypingTarget(enemy) {
    return enemy.id === this.targetId && enemy.typed > 0 && enemy.typed < enemy.word.length;
  }

  damage(enemy, amount, typed = false) {
    if (!this.enemies.includes(enemy)) return;
    // A rune ward cannot be destroyed by any number of autonomous towers.
    // Letters can weaken it to 1 HP; finishing the text removes one ward layer.
    const wardFloor = enemy.ward > 0 ? typed ? 1 : enemy.maxHp * 0.28 : 0;
    // Keep the active word stable under both letter damage and tower splash.
    // The last character completes the word and allows the finishing hit.
    const floor = Math.max(wardFloor, this.isTypingTarget(enemy) ? 1 : 0);
    const dealt = Math.max(0, Math.min(amount, enemy.hp - floor));
    enemy.hp -= dealt;
    if (dealt > 0) enemy.flash = 0.13;
    if (enemy.hp <= 0) {
      const pos = this.position(enemy.distance);
      this.enemies = this.enemies.filter(e => e !== enemy);
      this.gold += (enemy.kind === 'boss' ? 60 : 10) + (typed ? 8 : 0) + (this.has('bounty') ? 4 : 0);
      this.kills++;
      this.points += 100;
      if (this.targetId === enemy.id) this.targetId = null;
      this.effect('burst', pos.x, pos.y, {color: typed ? '#ffe2a0' : '#bd9eff', duration: 1, scale: enemy.kind === 'boss' ? 2.8 : enemy.kind === 'tank' ? 1.4 : 1});
      this.effect('number', pos.x, pos.y, {color: '#edc285', text: `+${(typed ? 18 : 10) + (this.has('bounty') ? 4 : 0)} ◈`, duration: 1.2, offset: 35});
      this.onEvent('kill', {typed});
    }
  }

  key(key) {
    if (!this.active || key.length !== 1 || !this.enemies.length) return false;
    let enemy = this.target;
    if (!enemy) {
      enemy = [...this.enemies].sort((a, b) => b.distance - a.distance)
        .find(e => e.word[e.typed] === key);
      if (enemy) this.targetId = enemy.id;
    }
    const expected = enemy?.word[enemy.typed] || this.nearest?.word[this.nearest.typed];
    if (!enemy || key !== expected) {
      this.errors++;
      this.combo = 0;
      if (expected) this.charErrors[expected] = (this.charErrors[expected] || 0) + 1;
      this.onEvent('error', {expected});
      return false;
    }
    this.correct++;
    const previousMultiplier = this.multiplier;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboCounts[String(this.multiplier)]++;
    this.points += this.multiplier * 10;
    if (this.multiplier !== previousMultiplier) {
      this.effect('combo', 9, 5, {duration: 1.3, multiplier: this.multiplier, color: '#ffcf73'});
      this.onEvent('combo', {multiplier: this.multiplier});
    }
    enemy.typed++;
    const complete = enemy.typed === enemy.word.length;
    const pos = this.position(enemy.distance);
    this.effect('rune', pos.x, pos.y, {color: '#ffe4a0', text: key === ' ' ? '·' : key, duration: 0.6});
    this.damage(enemy, 0.45, true);
    if (complete) {
      const power = (10 + this.wave * 0.55) * (1 + (this.multiplier - 1) * 0.12) * (this.has('power') ? 1.5 : 1);
      const hadWard = enemy.ward > 0;
      enemy.ward = Math.max(0, enemy.ward - 1);
      this.effect('cast', pos.x, pos.y, {color: '#ffe4a0', duration: 0.9, scale: 1 + this.multiplier * 0.12});
      this.effect('impact', pos.x, pos.y, {color: '#ffd38a', kind: 'spell', duration: 1.05, scale: 1.5});
      if (hadWard) this.effect('shatter', pos.x, pos.y, {color: '#b9d6ff', duration: 1, text: enemy.ward ? `ЩИТ ×${enemy.ward}` : 'ЩИТ РАЗБИТ'});
      this.effect('number', pos.x, pos.y, {color: '#fff1bc', text: `${Math.round(power)}`, duration: 1, offset: -10});
      if (this.has('echo')) {
        for (const other of [...this.enemies]) {
          const otherPos = this.position(other.distance);
          if (other !== enemy && Math.hypot(pos.x - otherPos.x, pos.y - otherPos.y) < 3) {
            this.effect('echo', otherPos.x, otherPos.y, {fromX: pos.x, fromY: pos.y, color: '#c5aaff', duration: 0.6});
            this.damage(other, power * 0.4, true);
          }
        }
      }
      if (this.has('mending')) this.hp = Math.min(this.maxHp, this.hp + 1);
      if (this.has('frost')) enemy.slow = 4;
      this.damage(enemy, power, true);
      if (this.enemies.includes(enemy)) {
        enemy.word = this.word();
        enemy.typed = 0;
      }
      this.onEvent('word');
    } else {
      this.onEvent('key');
    }
    return true;
  }

  cycleTarget() {
    if (!this.active || !this.enemies.length) return;
    const sorted = [...this.enemies].sort((a, b) => b.distance - a.distance || a.id - b.id);
    const index = sorted.findIndex(e => e.id === this.targetId);
    this.targetId = sorted[(index + 1) % sorted.length].id;
    this.onEvent('target');
  }

  releaseTarget() { this.targetId = null; this.onEvent('target'); }

  tick(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    if (this.phase === 'combat' && this.paused) return;
    for (const effect of this.effects) effect.life -= dt / effect.duration;
    this.effects = this.effects.filter(e => e.life > 0);
    if (!this.active) return;
    this.elapsed += dt;
    this.waveTime += dt;
    this.spawnTimer -= dt;
    if (this.spawned < this.waveCount && this.spawnTimer <= 0) {
      this.spawn();
      const pace = this.run.mode === 'sentences' ? 2.5 : this.run.mode === 'code' ? 1.75 : 1;
      const groupGap = this.spawned % 3 === 0 ? 2.9 : 1.25;
      this.spawnTimer = Math.max(0.7, groupGap - this.wave * 0.055) * pace;
    }
    const difficulty = {calm: 0.7, normal: 1, hard: 1.3}[this.run.difficulty];
    for (const enemy of [...this.enemies]) {
      enemy.slow = Math.max(0, enemy.slow - dt);
      enemy.flash = Math.max(0, enemy.flash - dt);
      const textPace = this.run.mode === 'sentences' ? 0.52 : this.run.mode === 'code' ? 0.7 : 1;
      enemy.distance += enemy.speed * dt * difficulty * textPace * (enemy.slow > 0 ? 0.6 : 1) * (this.has('focus') ? 0.85 : 1);
      if (enemy.distance >= this.pathLength) {
        this.hp = Math.max(0, this.hp - (enemy.kind === 'boss' ? 50 : enemy.kind === 'tank' ? 20 : 12));
        this.enemies = this.enemies.filter(e => e !== enemy);
        if (this.targetId === enemy.id) this.targetId = null;
        this.effect('breach', 17, 7, {color: '#ff8569', duration: 0.9, scale: enemy.kind === 'boss' ? 2 : 1});
        this.onEvent('breach');
        if (this.hp <= 0) {
          this.phase = 'defeat';
          this.onEvent('finish');
          return;
        }
      }
    }
    this.tickProjectiles(dt);
    for (const tower of this.towers) {
      tower.recoil = Math.max(0, (tower.recoil || 0) - dt);
      tower.cooldown -= dt * (this.has('overheat') && this.combo >= 20 ? 1.35 : 1);
      if (tower.cooldown > 0) continue;
      const def = this.catalog.towers.find(t => t.id === tower.type);
      const [tx, ty] = this.catalog.pads[tower.pad];
      const range = def.range * (this.has('reach') ? 1.25 : 1);
      const target = [...this.enemies].sort((a, b) => b.distance - a.distance).find(e => {
        const pos = this.position(e.distance);
        return Math.hypot(pos.x - tx, pos.y - ty) <= range;
      });
      if (!target) continue;
      tower.cooldown = def.interval;
      const pos = this.position(target.distance);
      const damage = def.damage * (1 + (tower.level - 1) * 0.65);
      tower.recoil = 0.22;
      const duration = 0.18 + Math.hypot(pos.x - tx, pos.y - ty) / 12;
      this.projectiles.push({fromX: tx, fromY: ty, toX: pos.x, toY: pos.y, targetId: target.id, kind: tower.type, damage, color: def.color, duration, remaining: duration, level: tower.level});
      this.effect('muzzle', tx, ty, {color: def.color, kind: tower.type, duration: 0.3, level: tower.level});
      this.onEvent('shot', {kind: tower.type});
    }
    if (this.spawned === this.waveCount && this.enemies.length === 0) {
      this.wavesCompleted = this.wave;
      this.gold += 40 + this.wave * 10;
      this.points += 500;
      this.targetId = null;
      this.projectiles = [];
      this.effect('clear', 9, 5, {color: '#dbefad', duration: 1.6});
      if (this.wave === this.catalog.total_waves) {
        this.phase = 'victory';
        this.onEvent('finish');
      } else {
        this.phase = 'reward';
        const pool = this.catalog.relics.filter(r => !this.has(r.id));
        this.offers = [];
        while (this.offers.length < 3 && pool.length) this.offers.push(pool.splice(Math.floor(this.random() * pool.length), 1)[0].id);
        this.onEvent('reward');
      }
    }
  }

  tickProjectiles(dt) {
    for (const shot of this.projectiles) {
      shot.remaining -= dt;
      const enemy = this.enemies.find(e => e.id === shot.targetId);
      if (enemy) {
        const pos = this.position(enemy.distance);
        shot.toX = pos.x; shot.toY = pos.y;
      }
      if (shot.remaining > 0) continue;
      this.effect('impact', shot.toX, shot.toY, {color: shot.color, kind: shot.kind, duration: shot.kind === 'ember' ? 0.75 : 0.45, scale: 1 + shot.level * 0.15});
      if (!enemy && shot.kind !== 'ember') continue;
      if (shot.kind === 'frost') enemy.slow = 2.2;
      const targets = shot.kind === 'ember' ? [...this.enemies].filter(e => {
        const p = this.position(e.distance);
        return Math.hypot(p.x - shot.toX, p.y - shot.toY) < 1.6;
      }) : [enemy];
      for (const hit of targets) {
        const hpBefore = hit.hp;
        this.damage(hit, shot.damage);
        const dealt = hpBefore - hit.hp;
        const pos = this.position(hit.distance);
        this.effect('number', pos.x, pos.y, {text: dealt > 0.1 ? `${Math.round(dealt)}` : hit.ward > 0 ? 'ЩИТ' : 'НАБОР', color: dealt > 0.1 ? shot.color : '#b1c9ff', duration: 0.75, offset: (hit.id % 3 - 1) * 18});
      }
    }
    this.projectiles = this.projectiles.filter(shot => shot.remaining > 0);
  }

  chooseRelic(id) {
    if (this.phase !== 'reward' || !this.offers.includes(id)) return false;
    this.relics.push(id);
    if (id === 'fortress') { this.maxHp += 30; this.hp += 30; }
    this.offers = [];
    this.phase = 'prep';
    this.onEvent('relic', {id});
    return true;
  }

  build(pad, type) {
    const def = this.catalog.towers.find(t => t.id === type);
    if (this.phase !== 'prep' || !def || !Number.isInteger(pad) || !this.catalog.pads[pad] || this.gold < def.cost || this.towers.some(t => t.pad === pad)) return false;
    this.gold -= def.cost;
    this.towers.push({pad, type, level: 1, cooldown: 0, invested: def.cost});
    const [x, y] = this.catalog.pads[pad];
    this.effect('build', x, y, {color: def.color, duration: 1.1});
    this.onEvent('build');
    return true;
  }

  upgradeCost(tower) {
    return Math.round(this.catalog.towers.find(t => t.id === tower.type).cost * (0.7 + (tower.level - 1) * 0.4));
  }

  upgrade(pad) {
    const tower = this.towers.find(t => t.pad === pad);
    if (this.phase !== 'prep' || !tower || tower.level >= 3) return false;
    const cost = this.upgradeCost(tower);
    if (this.gold < cost) return false;
    this.gold -= cost;
    tower.invested += cost;
    tower.level++;
    const [x, y] = this.catalog.pads[pad];
    this.effect('build', x, y, {color: '#ffe3a1', duration: 1.1});
    this.onEvent('build');
    return true;
  }

  sell(pad) {
    const tower = this.towers.find(t => t.pad === pad);
    if (this.phase !== 'prep' || !tower) return false;
    this.gold += Math.floor(tower.invested * 0.65);
    this.towers = this.towers.filter(t => t !== tower);
    this.onEvent('build');
    return true;
  }

  result(outcome = this.phase) {
    return {
      outcome, waves_completed: this.wavesCompleted, kills: this.kills,
      correct_chars: this.correct, errors: this.errors, max_combo: this.maxCombo,
      combo_counts: {...this.comboCounts}, elapsed_seconds: Math.max(0.01, this.elapsed),
      character_errors: {...this.charErrors}, relics: [...this.relics],
    };
  }

  snapshot() {
    const {catalog, onEvent, effects, ...data} = this;
    return {version: this.catalog.version, data};
  }

  static restore(catalog, snapshot, onEvent) {
    if (![1, catalog.version].includes(snapshot.version) || !snapshot.data?.run) return null;
    const game = new Game(catalog, snapshot.data.run, onEvent);
    Object.assign(game, snapshot.data);
    game.effects = [];
    for (const enemy of game.enemies) {
      if (enemy.ward == null) enemy.ward = enemy.kind === 'boss' ? 3 : enemy.kind === 'tank' ? 2 : 1;
    }
    if (game.phase === 'combat') game.paused = true;
    return game;
  }
}
