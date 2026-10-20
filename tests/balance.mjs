import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Game} from '../web/engine.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export const catalog = JSON.parse(execFileSync(path.join(root, '.venv/bin/python'), ['-c', 'import json; from keykeep.modules.game.catalog import CATALOG; print(json.dumps(CATALOG))'], {cwd: root, env: {...process.env, PYTHONPATH: 'src'}, encoding: 'utf8'}));

export function simulate({cpm = 200, seed = 2026, mode = 'words', difficulty = 'normal', maxed = false} = {}) {
  const game = new Game(catalog, {id: 'simulation', seed, mode, language: ['words', 'sentences'].includes(mode) ? 'ru' : 'en', difficulty});
  if (maxed) {
    game.gold = 100000;
    for (let i = 0; i < catalog.pads.length; i++) {
      if (!game.towers.some(t => t.pad === i)) game.build(i, i % 3 === 0 ? 'frost' : i % 2 ? 'ember' : 'arrow');
      game.upgrade(i); game.upgrade(i);
    }
    game.relics = ['reach', 'focus', 'overheat', 'bounty'];
  } else game.build(3, 'frost');
  let budget = 0, maxOnScreen = 0;
  for (let step = 0; step < 100000 && !['victory', 'defeat'].includes(game.phase); step++) {
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
    maxOnScreen = Math.max(maxOnScreen, game.enemies.length);
    if (game.active) {
      budget += 0.05 * cpm / 60;
      if (!game.enemies.length) budget = Math.min(1, budget);
      while (game.enemies.length && budget >= 1 && game.active) {
        const enemy = game.target || game.nearest;
        game.key(enemy.word[enemy.typed]);
        budget--;
      }
    }
  }
  return {game, maxOnScreen};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = [];
  for (const cpm of [0, 90, 140, 200, 280]) for (const seed of [7, 42, 2026]) {
    const {game, maxOnScreen} = simulate({cpm, seed, maxed: cpm === 0});
    results.push({cpm, seed, outcome: game.phase, wave: game.wave, hp: Math.ceil(game.hp), kills: game.kills, seconds: Math.round(game.elapsed), crowd: maxOnScreen});
  }
  console.table(results);
}
