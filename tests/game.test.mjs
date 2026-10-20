import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Game} from '../web/engine.js';
import {simulate} from './balance.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(execFileSync(path.join(root, '.venv/bin/python'), ['-c', 'import json; from keykeep.modules.game.catalog import CATALOG; print(json.dumps(CATALOG))'], {cwd: root, env: {...process.env, PYTHONPATH: 'src'}, encoding: 'utf8'}));
const run = (extra = {}) => ({id: 'test', seed: 2026, mode: 'words', language: 'ru', difficulty: 'normal', ...extra});

test('only correct characters advance the target; errors reset combo', () => {
  const game = new Game(catalog, run());
  game.startWave(); game.tick(0.05);
  const enemy = game.nearest, char = enemy.word[0];
  assert.equal(game.key(char), true);
  assert.equal(enemy.typed, 1);
  assert.equal(game.key('\0'), false);
  assert.equal(enemy.typed, 1);
  assert.equal(game.combo, 0);
  assert.equal(game.correct, 1);
  assert.equal(game.errors, 1);
  assert.equal(game.charErrors[enemy.word[1]], 1);
});

test('combo thresholds grant x2, x3 and x5 scores with consistent counters', () => {
  const game = new Game(catalog, run({language: 'en'}));
  game.startWave(); game.tick(0.05);
  const enemy = game.nearest;
  enemy.word = 'a'.repeat(100); enemy.hp = 100000; enemy.maxHp = 100000;
  for (let i = 0; i < 100; i++) game.key('a');
  assert.equal(game.combo, 100);
  assert.equal(game.multiplier, 5);
  assert.deepEqual(game.comboCounts, {'1': 9, '2': 15, '3': 25, '5': 51});
  assert.equal(game.points, 3690);
  assert.equal(Object.values(game.result().combo_counts).reduce((a, b) => a + b), game.correct);
});

test('build, upgrade and sell obey phase, funds and the free-tower refund', () => {
  const game = new Game(catalog, run());
  assert.equal(game.sell(1), true);
  assert.equal(game.gold, 100);
  assert.equal(game.build(0, 'frost'), true);
  assert.equal(game.gold, 20);
  assert.equal(game.build(0, 'arrow'), false);
  assert.equal(game.upgrade(0), false);
  assert.equal(game.sell(0), true);
  assert.equal(game.gold, 72);
  assert.equal(game.build(0, 'arrow'), true);
  assert.equal(game.startWave(), true);
  assert.equal(game.sell(0), false);
  assert.equal(game.build(2, 'arrow'), false);
  assert.equal(game.startWave(), false);
});

test('pause and restored snapshots preserve combat state without advancing time', () => {
  const game = new Game(catalog, run());
  game.startWave(); game.tick(0.05);
  game.key(game.nearest.word[0]);
  const restored = Game.restore(catalog, JSON.parse(JSON.stringify(game.snapshot())));
  assert.equal(restored.paused, true);
  const before = restored.snapshot();
  restored.tick(0.1);
  assert.equal(restored.elapsed, before.data.elapsed);
  assert.equal(restored.enemies[0].distance, before.data.enemies[0].distance);
  restored.paused = false; restored.tick(0.1);
  assert.ok(restored.elapsed > before.data.elapsed);
});

test('wave completion offers three distinct relics; choice cannot be repeated', () => {
  const game = new Game(catalog, run());
  game.startWave(); game.spawned = game.waveCount; game.enemies = [];
  game.tick(0.05);
  assert.equal(game.phase, 'reward');
  assert.equal(game.wavesCompleted, 1);
  assert.equal(new Set(game.offers).size, 3);
  const relic = game.offers[0];
  assert.equal(game.chooseRelic(relic), true);
  assert.equal(game.chooseRelic(relic), false);
  assert.deepEqual(game.relics, [relic]);
  assert.equal(game.phase, 'prep');
});

test('an undefended fortress can fall and cannot keep accumulating simulation time', () => {
  const game = new Game(catalog, run());
  game.towers = []; game.hp = 10;
  game.startWave(); game.tick(0.05);
  game.enemies[0].distance = game.pathLength - 0.001;
  game.tick(0.05);
  assert.equal(game.phase, 'defeat');
  assert.equal(game.hp, 0);
  const elapsed = game.elapsed; game.tick(0.1);
  assert.equal(game.elapsed, elapsed);
});

test('same seed generates the same enemies and relics', () => {
  const a = new Game(catalog, run()), b = new Game(catalog, run());
  a.startWave(); b.startWave();
  for (let i = 0; i < 300; i++) { a.tick(0.05); b.tick(0.05); }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('seven fully upgraded towers and range relics cannot win without typing', () => {
  for (const seed of [7, 42, 2026]) {
    const {game} = simulate({cpm: 0, seed, maxed: true});
    assert.equal(game.phase, 'defeat');
    assert.equal(game.kills, 0);
    assert.equal(game.correct, 0);
    assert.equal(game.wave, 1, `Idle build survived until wave ${game.wave}`);
  }
});

test('a ward prevents every autonomous damage source from killing the enemy', () => {
  const game = new Game(catalog, run());
  game.towers = [];
  game.startWave(); game.tick(0.05);
  const enemy = game.nearest;
  for (let hit = 0; hit < 20; hit++) game.damage(enemy, 9999);
  assert.equal(game.enemies.length, 1);
  assert.ok(enemy.hp > 0);
  const word = enemy.word;
  for (const char of word) game.key(char);
  assert.equal(enemy.ward, 0);
  game.damage(enemy, 9999);
  assert.equal(game.enemies.length, 0);
});

test('each completed text removes exactly one layer, including tank and boss wards', () => {
  for (const layers of [2, 3]) {
    const game = new Game(catalog, run());
    game.towers = [];
    game.startWave(); game.tick(0.05);
    const enemy = game.nearest;
    enemy.ward = layers; enemy.hp = 1000; enemy.maxHp = 1000;
    for (let left = layers - 1; left >= 0; left--) {
      for (const char of enemy.word) game.key(char);
      assert.equal(enemy.ward, left);
    }
  }
});

test('tower projectiles take time to land and pause freezes them', () => {
  const game = new Game(catalog, run());
  game.towers = [];
  game.build(0, 'arrow');
  game.startWave(); game.tick(0.05);
  const enemy = game.nearest;
  assert.equal(game.projectiles.length, 1);
  assert.equal(enemy.hp, enemy.maxHp);
  const remaining = game.projectiles[0].remaining;
  game.paused = true; game.tick(0.1);
  assert.equal(game.projectiles[0].remaining, remaining);
  game.paused = false;
  for (let i = 0; i < 10; i++) game.tick(0.05);
  assert.ok(enemy.hp < enemy.maxHp);
  assert.ok(game.effects.some(e => e.type === 'impact'));
});

for (const type of ['arrow', 'frost', 'ember']) test(`${type} and letter damage cannot kill the active target before its word is complete`, () => {
  const game = new Game(catalog, run({language: 'en'}));
  game.towers = [];
  assert.equal(game.build(0, type), true);
  game.startWave(); game.tick(0.05);
  const enemy = game.nearest;
  enemy.word = 'rune'; enemy.ward = 0; enemy.hp = 0.25;
  assert.equal(game.projectiles.length, 1);

  // The first letter itself would be lethal without word protection.
  assert.equal(game.key('r'), true);
  assert.ok(game.enemies.includes(enemy));
  for (let i = 0; i < 10; i++) game.tick(0.05);
  assert.ok(game.effects.some(e => e.type === 'impact'));
  assert.ok(game.enemies.includes(enemy));
  assert.equal(game.target, enemy);
  assert.equal(enemy.word, 'rune');
  assert.equal(enemy.typed, 1);

  for (const char of 'une') assert.equal(game.key(char), true);
  assert.ok(!game.enemies.includes(enemy));
  assert.equal(game.kills, 1);
  assert.equal(game.combo, 4);
  assert.equal(game.errors, 0);
});

test('word protection ends when the player releases the target or finishes its text', () => {
  for (const action of ['release', 'complete']) {
    const game = new Game(catalog, run({language: 'en'}));
    game.towers = [];
    game.startWave(); game.tick(0.05);
    const enemy = game.nearest;
    enemy.word = 'rune'; enemy.ward = 0; enemy.hp = 100;
    game.key('r');
    if (action === 'release') game.releaseTarget();
    else for (const char of 'une') game.key(char);
    game.damage(enemy, 9999);
    assert.ok(!game.enemies.includes(enemy), action);
  }
});

test('version-one active saves migrate with rune wards and keep user progress', () => {
  const game = new Game(catalog, run());
  game.startWave(); game.tick(0.05); game.key(game.nearest.word[0]);
  const snapshot = JSON.parse(JSON.stringify(game.snapshot()));
  snapshot.version = 1;
  delete snapshot.data.projectiles;
  for (const enemy of snapshot.data.enemies) delete enemy.ward;
  const restored = Game.restore(catalog, snapshot);
  assert.equal(restored.correct, 1);
  assert.equal(restored.run.id, game.run.id);
  assert.equal(restored.enemies[0].ward, 1);
  assert.equal(restored.paused, true);
});

for (const mode of ['words', 'sentences', 'code', 'symbols']) test(`a complete ${mode} campaign can be won with typing and strategic construction`, () => {
  const game = new Game(catalog, run({mode, language: mode === 'words' || mode === 'sentences' ? 'ru' : 'en'}));
  game.build(3, 'frost');
  let nextKey = 0;
  for (let step = 0; step < 60000 && !['victory', 'defeat'].includes(game.phase); step++) {
    if (game.phase === 'prep') {
      for (const pad of [5, 2, 4, 6, 0]) if (!game.towers.some(t => t.pad === pad) && game.gold >= 100) game.build(pad, pad % 2 ? 'ember' : 'arrow');
      for (const tower of game.towers) if (tower.level < 3 && game.gold >= game.upgradeCost(tower) + 30) game.upgrade(tower.pad);
      game.startWave();
    }
    if (game.phase === 'reward') {
      const priority = ['power', 'focus', 'echo', 'bounty', 'mending', 'overheat', 'fortress', 'frost', 'reach', 'scholar'];
      game.chooseRelic([...game.offers].sort((a, b) => priority.indexOf(a) - priority.indexOf(b))[0]);
    }
    game.tick(0.05);
    nextKey -= 0.05;
    if (game.active && game.enemies.length && nextKey <= 0) {
      const enemy = game.target || game.nearest;
      game.key(enemy.word[enemy.typed]);
      nextKey = 0.28;
    }
  }
  assert.equal(game.phase, 'victory', `${mode}: wave ${game.wave}, HP ${game.hp}, chars ${game.correct}`);
  assert.equal(game.wavesCompleted, 8);
  assert.equal(game.relics.length, 7);
  assert.ok(game.kills > 0 && game.correct > 100);
  assert.equal(game.errors, 0);
});
