import {Game} from './engine.js';
import {Renderer, towerSVG} from './renderer.js';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const text = (id, value) => { if ($(id).textContent !== String(value)) $(id).textContent = String(value); };
const html = (id, value) => { if ($(id)._lastHTML !== value) { $(id).innerHTML = value; $(id)._lastHTML = value; } };
const format = n => Math.round(n).toLocaleString('ru-RU');
const time = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const names = {words: 'Слова', sentences: 'Предложения', code: 'Код', symbols: 'Символы'};
const fingerprint = 'keykeep.run.v1';
let catalog, game, renderer, user, accessToken = '', selectedType = 'arrow', selectedPad = -1;
let view = 'game', authTab = 'register', refreshing = null, busy = false, savePromise = null, savedResult = null;
let toastTimer, flashTimer, soundEnabled = false, audioContext = null, lastUI = 0, lastSnapshot = 0;
let rankingSequence = 0;

function toast(message) {
  text('toast', message);
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}

function sound(type, kind) {
  if (!soundEnabled) return;
  try {
    audioContext ||= new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    const notes = type === 'combo' ? [392, 494, 587, 784] : type === 'word' ? [440, 660, 880] : type === 'wave' ? [220, 330, 440] : [type === 'error' ? 130 : type === 'kill' ? 740 : type === 'shot' ? kind === 'ember' ? 100 : kind === 'frost' ? 1100 : 680 : 370];
    notes.forEach((frequency, i) => {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      const start = audioContext.currentTime + i * 0.045;
      const duration = type === 'word' || type === 'combo' ? 0.18 : 0.08;
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.type = type === 'shot' || type === 'kill' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (type === 'shot' ? 0.45 : 1.1), start + duration);
      gain.gain.setValueAtTime(type === 'shot' ? 0.006 : type === 'error' ? 0.025 : 0.022, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.start(start); oscillator.stop(start + duration);
    });
  } catch { soundEnabled = false; }
}

async function refreshAccess() {
  if (!refreshing) refreshing = (async () => {
    const response = await fetch('/api/v1/auth/refresh', {method: 'POST', credentials: 'same-origin'});
    if (!response.ok) throw new Error('Сессия истекла. Войди в аккаунт снова.');
    const data = await response.json();
    accessToken = data.access_token;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function api(path, {method = 'GET', body, auth = true, retry = true} = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body)});
  } catch { throw new Error('Нет связи с сервером. Проверь, что он запущен, и повтори попытку.'); }
  if (response.status === 401 && auth && retry) {
    await refreshAccess();
    return api(path, {method, body, auth, retry: false});
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const errors = {
      'Email already registered': 'Эта почта уже зарегистрирована. Перейди ко входу.',
      'invalid credentials': 'Неверная почта или пароль.',
      'Invalid or expired refresh token': 'Сессия истекла. Войди снова.',
      'Run not found': 'Этот забег не найден в текущем аккаунте.',
      'Run result is inconsistent with its duration or game rules': 'Не удалось проверить результат. Сохрани вкладку и повтори попытку.',
    };
    throw new Error(errors[data.detail] || (Array.isArray(data.detail) ? 'Проверь поля формы: имя, почту и длину пароля.' : typeof data.detail === 'string' ? data.detail : `Ошибка сервера (${response.status}).`));
  }
  return response.status === 204 ? null : response.json();
}

function checkpoint() {
  if (!game?.run || !user || savedResult) return;
  try { localStorage.setItem(fingerprint, JSON.stringify({userId: user.id, snapshot: game.snapshot()})); } catch { /* Private browsing may disable local storage; server results still work. */ }
}

function clearCheckpoint() { try { localStorage.removeItem(fingerprint); } catch {} }

function onEvent(type, data) {
  if (['key', 'word', 'kill', 'error', 'combo', 'shot', 'wave'].includes(type)) sound(type, data?.kind);
  if (type === 'combo' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('typing-panel').animate([{boxShadow: '0 0 0 2px #ffd487, 0 0 35px #edc28566'}, {boxShadow: '0 0 0 0 transparent'}], {duration: 600});
  }
  if (type === 'error') {
    $('typing-panel').classList.add('error-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => $('typing-panel').classList.remove('error-flash'), 150);
  }
  if (type === 'breach') toast('Враг прорвался! Крепость получила урон.');
  if (type === 'wave') toast(data.wave === 8 ? 'Древний страж пробудился. Последний рубеж!' : `Волна ${data.wave}. Печатай слова над врагами.`);
  if (type === 'reward') { checkpoint(); showReward(); }
  if (type === 'finish') { checkpoint(); showResult(); }
  if (['build', 'relic', 'wave', 'reward', 'finish'].includes(type)) { renderTowers(); checkpoint(); }
  renderUI();
}

function freshGame() {
  game = new Game(catalog, null, onEvent);
  savedResult = null;
  savePromise = null;
  selectedPad = -1;
  renderer.selectedPad = -1;
  $('result-dialog').close();
  $('reward-dialog').close();
  clearCheckpoint();
  renderTowers(); renderUI(); buildKeyboard();
}

async function startWave() {
  if (!game || busy) return;
  if (['victory', 'defeat', 'abandoned'].includes(game.phase)) { showResult(); return; }
  if (game.phase === 'reward') { showReward(); return; }
  if (game.phase === 'combat') { togglePause(); return; }
  busy = true;
  renderUI();
  try {
    if (!game.run) {
      const run = await api('/runs', {method: 'POST', body: {
        mode: $('mode-select').value, language: $('language-select').value,
        difficulty: $('difficulty-select').value,
      }});
      game.run = run;
      game.rngState = run.seed;
      $('language-select').value = run.language;
      buildKeyboard();
    }
    game.startWave();
    $('battle-canvas').focus({preventScroll: true});
    checkpoint();
  } catch (error) { toast(error.message); }
  finally { busy = false; renderUI(); }
}

function pause() {
  if (game?.phase === 'combat' && !game.paused) {
    game.paused = true; checkpoint(); renderUI();
  }
}

function togglePause() {
  if (!game || game.phase !== 'combat') return;
  game.paused = !game.paused;
  checkpoint(); renderUI();
  if (!game.paused) $('battle-canvas').focus({preventScroll: true});
}

function openDialog(id) {
  pause();
  if (!$(id).open) $(id).showModal();
}

function renderTowers() {
  if (!game) return;
  html('tower-list', catalog.towers.map((tower, i) => `<button class="tower-card ${selectedType === tower.id ? 'active' : ''}" data-tower="${tower.id}" aria-pressed="${selectedType === tower.id}" title="${tower.description}">${towerSVG(tower.id)}<span class="tower-body"><strong>${tower.name}</strong><small>${tower.role}</small><span class="tower-price">${icon('coin')}${tower.cost}</span></span><span class="tower-key">${i + 1}</span></button>`).join(''));
  document.querySelectorAll('[data-tower]').forEach(button => button.onclick = () => {
    selectedType = button.dataset.tower;
    renderer.selectedType = selectedType;
    renderTowers();
    if (game.phase !== 'prep') toast('Выбирай и строй башни между волнами.');
  });
  const container = $('selected-pad');
  if (selectedPad >= 0) {
    const tower = game.towers.find(t => t.pad === selectedPad);
    container.hidden = false;
    if (tower) {
      const def = catalog.towers.find(t => t.id === tower.type), cost = game.upgradeCost(tower), refund = Math.floor(tower.invested * 0.65);
      container.innerHTML = `<strong>${def.name} · уровень ${tower.level}</strong><p>${def.description}</p>${tower.level < 3 ? `<button class="primary-button" id="upgrade-tower" ${game.phase !== 'prep' || game.gold < cost ? 'disabled' : ''}>Улучшить · ${cost} ◈</button>` : '<p>Максимальный уровень</p>'}<button class="subtle-button" id="sell-tower" ${game.phase !== 'prep' ? 'disabled' : ''}>Убрать · +${refund} ◈</button>`;
      if ($('upgrade-tower')) $('upgrade-tower').onclick = () => { if (game.upgrade(selectedPad)) toast('Башня улучшена. Урон увеличен.'); };
      $('sell-tower').onclick = () => { if (game.sell(selectedPad)) { toast('Площадка освобождена.'); renderTowers(); } };
    } else {
      container.innerHTML = `<strong>Площадка ${String(selectedPad + 1).padStart(2, '0')}</strong><p>Выбери башню и нажми на площадку ещё раз, чтобы построить.</p>`;
    }
  } else container.hidden = true;
  document.querySelectorAll('[data-pad]').forEach(button => {
    button.classList.toggle('occupied', game.towers.some(t => t.pad === Number(button.dataset.pad)));
    button.classList.toggle('selected', selectedPad === Number(button.dataset.pad));
    const tower = game.towers.find(t => t.pad === Number(button.dataset.pad));
    button.setAttribute('aria-label', `Площадка ${Number(button.dataset.pad) + 1}${tower ? ', башня ' + catalog.towers.find(t => t.id === tower.type).name : ', свободна'}`);
  });
}

function selectPad(pad) {
  if (pad < 0) return;
  const occupied = game.towers.some(t => t.pad === pad);
  selectedPad = pad;
  renderer.selectedPad = pad;
  if (!occupied) {
    if (game.phase !== 'prep') toast('Строительство откроется после волны.');
    else if (game.build(pad, selectedType)) {
      sound('word');
      toast(`${catalog.towers.find(t => t.id === selectedType).name} на позиции.`);
    } else toast('Не хватает золота. Печатай слова и побеждай врагов.');
  }
  renderTowers(); renderUI();
}

function renderUI() {
  if (!game) return;
  text('wave-number', String(Math.max(1, game.wave)).padStart(2, '0'));
  text('hp-value', Math.ceil(game.hp)); text('hp-max', `/ ${game.maxHp}`);
  $('health-bar').style.width = `${game.hp / game.maxHp * 100}%`;
  $('health-bar').style.background = game.hp < 35 ? 'var(--red)' : 'var(--green)';
  text('gold-value', game.gold); text('live-cpm', Math.round(game.cpm));
  text('live-wpm', `${Math.round(game.cpm / 5)} слов / мин`);
  html('live-accuracy', `${game.accuracy.toFixed(game.errors ? 1 : 0)}<span>%</span>`);
  text('live-kills', game.kills); text('combo-multiplier', `×${game.multiplier}`);
  text('combo-count', `${game.combo} без ошибок`);
  $('combo-card').classList.toggle('combo-powered', game.multiplier > 1);
  document.querySelector('.battlefield').classList.toggle('battle-frenzy', game.multiplier >= 3);
  const threshold = game.combo < 10 ? 10 : game.combo < 25 ? 25 : game.combo < 50 ? 50 : null;
  text('combo-caption', threshold ? `${threshold - game.combo} нажатий до множителя ×${threshold === 10 ? 2 : threshold === 25 ? 3 : 5}` : 'Максимальный множитель. Держи ритм!');
  document.querySelectorAll('.combo-bars i').forEach((bar, i) => bar.classList.toggle('lit', i < Math.min(5, game.combo / 10)));
  text('run-timer', time(game.elapsed));
  html('wave-track', Array.from({length: 8}, (_, i) => `<span class="wave-node ${i < game.wavesCompleted ? 'done' : i === Math.max(0, game.wave - 1) ? 'current' : ''} ${i === 7 ? 'boss' : ''}">${i < game.wavesCompleted ? '✓' : i + 1}</span>`).join(''));
  text('relic-count', `${game.relics.length} / 7`);
  if (game.relics.length) html('relic-list', game.relics.map(id => {
    const relic = catalog.relics.find(r => r.id === id);
    return `<span class="relic-item" title="${escapeHTML(relic.name + ': ' + relic.description)}" tabindex="0" aria-label="${escapeHTML(relic.name + ': ' + relic.description)}">${icon(relic.icon)}</span>`;
  }).join(''));
  else html('relic-list', '<div class="empty-relic">✧</div><p class="muted small">Твоя история ещё не написана.<br>Пройди волну и выбери усиление.</p>');
  const phase = game.phase;
  $('pause-overlay').hidden = !game.paused || phase !== 'combat';
  $('pause-button').disabled = phase !== 'combat';
  $('pause-button').setAttribute('aria-label', game.paused ? 'Продолжить' : 'Пауза');
  $('pause-button').innerHTML = icon(game.paused ? 'play' : 'pause');
  $('start-wave').disabled = busy || !user;
  const startCopy = busy ? 'Готовим волну…' : phase === 'combat' ? game.paused ? 'Продолжить' : 'Пауза' : phase === 'reward' ? 'Выбрать реликвию' : ['victory', 'defeat', 'abandoned'].includes(phase) ? 'Итоги забега' : game.wave ? `Начать волну ${game.wave + 1}` : 'Начать волну';
  html('start-wave', `${startCopy}${icon(phase === 'combat' && !game.paused ? 'pause' : 'arrow')}`);
  text('build-note', phase === 'prep' ? 'Строительство доступно между волнами' : 'Строительство откроется после волны');
  $('map-start-label').hidden = phase !== 'prep';
  const description = phase === 'combat' ? `${game.spawned} / ${game.waveCount} появились · ${game.enemies.length} на пути` : phase === 'prep' ? game.wave ? `Волна ${game.wave} пройдена. Укрепляй оборону.` : 'Разбей щиты словами. Башни прикроют.' : phase === 'reward' ? 'Волна пройдена. Выбери свою силу.' : phase === 'victory' ? 'Рубеж выстоял. Лес запомнит тебя.' : 'Следующий дозор будет сильнее.';
  html('wave-description', `<span class="status-dot"></span>${description}`);
  text('journey-title', game.wave === 8 ? 'Последний рубеж' : game.wave > 3 ? 'В глубине леса' : 'Первый дозор');
  text('journey-copy', game.wave === 8 ? 'Три руны защищают босса. Сними щиты и добей его вместе с башнями.' : game.wave > 0 ? `Пройдено ${game.wavesCompleted} из 8 волн. Слова разбивают щиты, башни добивают врагов.` : 'Враги защищены рунами. Башни ослабляют их, но только целое слово снимает щит.');
  const locked = Boolean(game.run);
  $('mode-select').disabled = locked;
  $('language-select').disabled = locked || ['code', 'symbols'].includes($('mode-select').value);
  $('difficulty-select').disabled = locked;
  text('settings-note', locked ? 'Параметры можно изменить в новом забеге.' : 'Параметры фиксируются с первой волны.');
  renderTyping();
}

const ruRows = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю.'];
const enRows = ['qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./'];
const fingerIndexes = [[0, 1, 2, 3, 3, 6, 6, 7, 8, 9, 9, 9], [0, 1, 2, 3, 3, 6, 6, 7, 8, 9, 9], [0, 1, 2, 3, 3, 6, 6, 7, 8, 9]];
const fingerNames = ['Левый мизинец', 'Левый безымянный', 'Левый средний', 'Левый указательный', '', '', 'Правый указательный', 'Правый средний', 'Правый безымянный', 'Правый мизинец'];
const fingerColors = ['#bd969a', '#d7b988', '#92bca4', '#91adc2', '', '', '#91adc2', '#92bca4', '#d7b988', '#bd969a'];
let keyNodes = [];

function buildKeyboard() {
  const language = game?.run?.language || $('language-select').value;
  const rows = language === 'ru' ? ruRows : enRows;
  let out = `<div class="key-row"><span class="key wide-key" data-key="${language === 'ru' ? 'ё' : '`'}" data-finger="0">${language === 'ru' ? 'ё' : '`'}</span>${[...'1234567890-='.split('')].map((key, i) => `<span class="key" data-key="${key}" data-finger="${[0, 0, 1, 2, 3, 3, 6, 6, 7, 8, 9, 9][i]}">${key}</span>`).join('')}<span class="key wide-key">⌫</span></div>`;
  out += rows.map((row, i) => `<div class="key-row"><span class="key wide-key" ${i === 2 ? 'data-shift="true"' : ''}>${['tab', 'caps', 'shift'][i]}</span>${[...row].map((key, j) => `<span class="key" data-key="${escapeHTML(key)}" data-finger="${fingerIndexes[i][j] ?? 9}" ${i === 1 && [3, 6].includes(j) ? 'data-home="true"' : ''}>${escapeHTML(key)}</span>`).join('')}<span class="key wide-key" ${i === 2 ? 'data-shift="true"' : ''}>${['\\', 'enter', 'shift'][i]}</span></div>`).join('');
  out += '<div class="key-row"><span class="key wide-key">ctrl</span><span class="key wide-key">alt</span><span class="key space-key" data-key=" " data-finger="3">ПРОБЕЛ</span><span class="key wide-key">alt</span><span class="key wide-key">ctrl</span></div>';
  $('keyboard').innerHTML = out;
  keyNodes = [...$('keyboard').querySelectorAll('[data-key], [data-shift]')];
  text('home-keys', language === 'ru' ? 'Ф Ы В А · О Л Д Ж' : 'A S D F · J K L ;');
}

function highlightKey(char) {
  const shiftedSymbols = {'!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[', '}': ']', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '|': '\\', '~': '`'};
  let base = char?.toLowerCase();
  const language = game?.run?.language || $('language-select').value;
  let shift = char && char !== base;
  if (language === 'en' && shiftedSymbols[char]) { base = shiftedSymbols[char]; shift = true; }
  if (language === 'ru' && char === ',') { base = '.'; shift = true; }
  if (language === 'ru' && char === '!') { base = '1'; shift = true; }
  let finger = 3;
  keyNodes.forEach(node => {
    const active = Boolean(char != null && (node.dataset.key === base || (node.dataset.shift && shift)));
    node.classList.toggle('next-key', active);
    if (node.dataset.key === base) finger = Number(node.dataset.finger || 3);
    node.style.setProperty('--finger-color', fingerColors[Number(node.dataset.finger || 0)]);
  });
  return char === ' ' ? 'Пробел · большой палец' : `${fingerNames[finger] || 'Указательный палец'}${shift ? ' + Shift другой рукой' : ''}`;
}

function renderTyping() {
  if (!game) return;
  const enemy = game.target || game.nearest;
  if (game.phase === 'combat' && enemy) {
    const index = enemy.typed;
    html('typing-word', `<span class="typed">${escapeHTML(enemy.word.slice(0, index))}</span><span class="next">${enemy.word[index] === ' ' ? '·' : escapeHTML(enemy.word[index])}</span><span class="remaining">${escapeHTML(enemy.word.slice(index + 1))}</span>`);
    text('typing-label', game.target ? enemy.kind === 'boss' ? 'РУНА ДРЕВНЕГО СТРАЖА' : 'ЦЕЛЬ ВЫБРАНА · ПРОДОЛЖАЙ ПЕЧАТАТЬ' : 'ТВОЁ СЛЕДУЮЩЕЕ ЗАКЛИНАНИЕ');
    text('typing-tip', `${Math.max(0, Math.ceil(enemy.hp))} / ${Math.ceil(enemy.maxHp)} здоровья цели`);
    text('ward-status', enemy.ward > 0 ? `◇ РУНИЧЕСКИЙ ЩИТ ×${enemy.ward} · заверши слово, чтобы разбить слой` : game.isTypingTarget(enemy) ? '✎ ДОПЕЧАТАЙ СЛОВО · цель защищена до последней буквы' : '✧ ЩИТ СНЯТ · башни могут добить эту цель');
    $('ward-status').classList.toggle('ward-open', enemy.ward === 0);
    const char = enemy.word[index];
    html('finger-hint', `<span class="key-hint">${char === ' ' ? '␣' : escapeHTML(char.toUpperCase())}</span>${highlightKey(char)}`);
  } else {
    const copy = game.phase === 'combat' ? 'Руны приближаются…' : game.phase === 'prep' ? game.wave ? 'Вдох. Новая волна.' : 'Сила в каждом нажатии' : game.phase === 'reward' ? 'Выбери свою силу.' : 'История продолжится.';
    html('typing-word', `${copy}<span class="idle-cursor"></span>`);
    text('typing-label', 'ТВОЁ СЛЕДУЮЩЕЕ ЗАКЛИНАНИЕ');
    text('typing-tip', 'Начни с первой буквы слова над врагом');
    text('ward-status', game.phase === 'combat' ? '◇ Печатай целые слова: башни не могут пробить руническую защиту.' : '◇ Каждое завершённое слово разбивает один слой щита.');
    $('ward-status').classList.remove('ward-open');
    html('finger-hint', `<span class="key-hint">${game.phase === 'combat' ? '✧' : '↵'}</span>${game.phase === 'combat' ? 'Дождись врагов у разлома' : 'Начни волну, чтобы пробудить руны'}`);
    highlightKey(null);
  }
}

function showReward() {
  if (game.phase !== 'reward') return;
  text('reward-eyebrow', `ВОЛНА ${game.wave} ПРОЙДЕНА · +${40 + game.wave * 10} ЗОЛОТА`);
  $('reward-options').innerHTML = game.offers.map(id => {
    const r = catalog.relics.find(relic => relic.id === id);
    return `<button class="reward-option" data-relic="${r.id}"><span class="relic-icon">${icon(r.icon)}</span><span class="rarity">${r.rarity}</span><strong>${r.name}</strong><p>${r.description}</p></button>`;
  }).join('');
  document.querySelectorAll('[data-relic]').forEach(button => button.onclick = () => {
    if (game.chooseRelic(button.dataset.relic)) {
      $('reward-dialog').close(); checkpoint(); renderUI();
      toast('Реликвия твоя. Укрепи оборону перед следующей волной.');
      $('start-wave').focus({preventScroll: true});
    }
  });
  if (!$('reward-dialog').open) $('reward-dialog').showModal();
}

async function saveRun() {
  if (savedResult) return savedResult;
  if (savePromise) return savePromise;
  savePromise = (async () => {
    text('result-save', 'Сохраняем результат…');
    $('retry-save-button').hidden = true;
    $('new-run-button').disabled = true;
    $('result-stats-button').disabled = true;
    try {
      savedResult = await api(`/runs/${game.run.id}/finish`, {method: 'POST', body: game.result()});
      text('result-save', `Сохранено · +${format(savedResult.xp)} XP${user.is_guest ? ' · Создай аккаунт, чтобы сохранить доступ с других устройств.' : ''}`);
      clearCheckpoint();
      await updatePlayer();
      $('new-run-button').disabled = false;
      $('result-stats-button').disabled = false;
      return savedResult;
    } catch (error) {
      text('result-save', error.message + ' Результат остаётся в этой вкладке.');
      $('retry-save-button').hidden = false;
      throw error;
    } finally { savePromise = null; }
  })();
  return savePromise;
}

function showResult() {
  if (!game?.run) return;
  const won = game.phase === 'victory', abandoned = game.phase === 'abandoned';
  text('result-eyebrow', won ? 'КРЕПОСТЬ ВЫСТОЯЛА' : abandoned ? 'ДОЗОР ЗАВЕРШЁН' : 'КРЕПОСТЬ ПАЛА · МАСТЕРСТВО ОСТАЛОСЬ');
  text('result-title', won ? 'Лес запомнит тебя.' : abandoned ? 'До следующего дозора.' : 'Каждый рубеж — опыт.');
  text('result-copy', won ? 'Древний страж повержен. Все восемь волн позади.' : `Пройдено ${game.wavesCompleted} из 8 волн. Твой следующий забег начнётся с новых возможностей.`);
  $('result-grid').innerHTML = [[Math.round(game.cpm), 'символов / мин'], [`${game.accuracy.toFixed(1)}%`, 'точность'], [game.wavesCompleted + ' / 8', 'волн пройдено'], [format(game.points), 'очков'], [game.maxCombo, 'лучшая серия'], [time(game.elapsed), 'в бою']].map(([value, label]) => `<div class="result-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  if (!$('result-dialog').open) $('result-dialog').showModal();
  saveRun().catch(() => {});
}

async function updatePlayer() {
  try {
    const stats = await api('/stats/me');
    text('player-level', `Уровень ${stats.level} · ${format(stats.total_xp)} XP`);
  } catch { /* Keep the existing header while the server recovers. */ }
  text('player-name', user.profile.first_name);
}

async function showView(next) {
  if (!game) return;
  if (next !== 'game') pause();
  view = next;
  for (const name of ['game', 'stats', 'leaderboard']) $(`${name}-view`).hidden = name !== next;
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === next));
  if (next === 'stats') await renderStats();
  if (next === 'leaderboard') await renderLeaderboard();
  if (next === 'game') { renderer.resize(); renderUI(); }
}

function chart(history) {
  if (!history.length) return '<div class="empty-state">Здесь появится график после первого забега.</div>';
  const width = 580, height = 210, pad = 35, max = Math.max(200, Math.ceil(Math.max(...history.map(h => h.cpm)) / 50) * 50);
  const point = (value, i, total) => `${pad + i / Math.max(1, history.length - 1) * (width - pad * 2)},${height - pad - value / total * (height - pad * 2)}`;
  const lines = [0, 0.5, 1].map(ratio => `<line x1="${pad}" x2="${width - pad}" y1="${height - pad - ratio * (height - pad * 2)}" y2="${height - pad - ratio * (height - pad * 2)}" stroke="#384332" stroke-dasharray="3 5"/><text x="${pad - 7}" y="${height - pad - ratio * (height - pad * 2) + 3}" fill="#7e8e73" font-size="9" text-anchor="end">${Math.round(ratio * max)}</text><text x="${width - pad + 7}" y="${height - pad - ratio * (height - pad * 2) + 3}" fill="#7e8e73" font-size="9">${ratio * 100}%</text>`).join('');
  return `<svg class="stat-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Динамика скорости и точности за ${history.length} последних забегов">${lines}<polyline points="${history.map((h, i) => point(h.cpm, i, max)).join(' ')}" fill="none" stroke="#edc285" stroke-width="2"/><polyline points="${history.map((h, i) => point(h.accuracy, i, 100)).join(' ')}" fill="none" stroke="#9dbb90" stroke-width="2"/>${history.map((h, i) => { const [x, y] = point(h.cpm, i, max).split(','); return `<circle cx="${x}" cy="${y}" r="3" fill="#edc285"><title>${h.cpm} симв/мин · ${h.accuracy}%</title></circle>`; }).join('')}<text x="${pad}" y="${height - 7}" fill="#7e8e73" font-size="9">${new Date(history[0].date).toLocaleDateString('ru-RU')}</text><text x="${width - pad}" y="${height - 7}" fill="#7e8e73" font-size="9" text-anchor="end">${new Date(history.at(-1).date).toLocaleDateString('ru-RU')}</text></svg>`;
}

async function renderStats() {
  $('stats-content').innerHTML = '<div class="panel empty-state">Читаем летопись…</div>';
  try {
    const s = await api('/stats/me');
    const entries = Object.entries(s.character_errors), maxErrors = Math.max(1, ...entries.map(([, v]) => v));
    $('stats-content').innerHTML = `<div class="panel level-strip">${icon('shield')}<strong>Хранитель ${s.level} уровня</strong><div class="level-bar"><i style="width:${s.level_progress / s.level_target * 100}%"></i></div><small>${format(s.level_progress)} / ${format(s.level_target)} XP до следующего</small></div><div class="stats-overview">${[[format(s.best_cpm), 'ЛУЧШАЯ СКОРОСТЬ', 'символов в минуту'], [`${s.accuracy}%`, 'ОБЩАЯ ТОЧНОСТЬ', `${format(s.total_chars)} правильных символов`], [s.runs, 'ЗАВЕРШЕНО ЗАБЕГОВ', `${s.victories} побед`], [time(s.total_seconds), 'ВРЕМЯ ТРЕНИРОВКИ', `${s.best_combo} символов — лучшая серия`]].map(([value, label, sub]) => `<div class="panel overview-card"><span class="eyebrow">${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('')}</div><div class="stats-middle"><div class="panel stats-chart-panel"><h3>Скорость и точность</h3><div class="chart-caption"><span>Символы / мин · слева</span><span>Точность · справа</span></div>${chart(s.history)}<p class="tiny muted">Последние ${s.history.length} забегов · время только в бою</p></div><div class="panel errors-panel"><h3>Символы, требующие внимания</h3>${entries.length ? entries.map(([char, count]) => `<div class="error-item"><strong>${char === ' ' ? '␣' : escapeHTML(char)}</strong><span class="bar"><i style="width:${count / maxErrors * 100}%"></i></span><span>${count}</span></div>`).join('') : '<div class="empty-state">Ошибок пока нет.<br>Руны довольны.</div>'}</div></div><div class="panel achievements-panel"><h3>Знаки отличия</h3><div class="achievement-grid">${s.achievements.map(a => `<div class="achievement ${a.unlocked ? 'unlocked' : ''}">${icon(a.unlocked ? 'trophy' : 'shield')}<strong>${a.name}</strong><p>${a.description}</p><small>${a.unlocked ? 'ПОЛУЧЕНО' : format(a.progress) + ' / ' + format(a.target)}</small></div>`).join('')}</div></div><div class="panel history-panel"><h3>Летопись дозоров</h3>${s.history.length ? `<table><thead><tr><th>ДАТА</th><th>РЕЖИМ</th><th>ВОЛНЫ</th><th>СКОРОСТЬ</th><th>ТОЧНОСТЬ</th></tr></thead><tbody>${[...s.history].reverse().map(r => `<tr><td>${new Date(r.date).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</td><td>${names[r.mode]}</td><td>${r.waves} / 8 ${r.outcome === 'victory' ? '✧' : ''}</td><td>${r.cpm}</td><td>${r.accuracy}%</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">Первый дозор ещё впереди.</div>'}</div>`;
  } catch (error) { $('stats-content').innerHTML = `<div class="panel empty-state">${escapeHTML(error.message)}</div>`; }
}

async function renderLeaderboard() {
  const sequence = ++rankingSequence;
  $('leaderboard-content').innerHTML = '<div class="empty-state">Собираем хранителей…</div>';
  const mode = $('ranking-mode').value;
  if (['code', 'symbols'].includes(mode)) $('ranking-language').value = 'en';
  $('ranking-language').disabled = ['code', 'symbols'].includes(mode);
  const metric = $('ranking-metric').value;
  const query = new URLSearchParams({metric, period: $('ranking-period').value, mode, language: $('ranking-language').value, difficulty: $('ranking-difficulty').value});
  try {
    const rows = await api(`/leaderboard?${query}`, {auth: false});
    if (sequence !== rankingSequence) return;
    $('leaderboard-content').innerHTML = rows.length ? `<table><thead><tr><th>МЕСТО</th><th>ХРАНИТЕЛЬ</th><th>${{cpm: 'СИМВ / МИН', accuracy: 'ТОЧНОСТЬ, %', xp: 'ОПЫТ, XP'}[metric]}</th><th>ЗАБЕГОВ</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.user_id === user.id ? 'own-row' : ''}"><td class="rank-number">${String(row.rank).padStart(2, '0')}</td><td>${escapeHTML(row.name)}${row.user_id === user.id ? ' · ты' : ''}</td><td>${row.value}</td><td>${row.runs}</td></tr>`).join('')}</tbody></table>` : `<div class="empty-state">${icon('trophy')}<strong>Легенды ещё впереди.</strong>Зарегистрируйся и заверши забег от 50 символов,<br>чтобы первым занять место в этой категории.</div>`;
  } catch (error) { if (sequence === rankingSequence) $('leaderboard-content').innerHTML = `<div class="empty-state">${escapeHTML(error.message)}</div>`; }
}

function setAuthTab(tab) {
  authTab = tab;
  document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('active', b.dataset.authTab === tab));
  $('name-label').hidden = tab !== 'register';
  $('auth-form').elements.first_name.required = tab === 'register';
  $('auth-form').elements.password.minLength = tab === 'register' ? 8 : 1;
  $('auth-form').elements.password.autocomplete = tab === 'register' ? 'new-password' : 'current-password';
  text('auth-submit', tab === 'register' ? 'Создать аккаунт' : 'Войти');
  text('auth-error', '');
}

function openAccount() {
  if (!user) return;
  const guest = user.is_guest;
  $('auth-form').hidden = !guest;
  $('auth-tabs').hidden = !guest;
  $('signed-account').hidden = guest;
  text('account-title', guest ? 'Стань хранителем.' : 'Твой дозор.');
  text('account-copy', guest ? 'Создай аккаунт: гостевой прогресс останется с тобой. Вход в другой аккаунт завершит текущий забег.' : `${user.email} · Прогресс сохраняется на сервере.`);
  $('profile-name').value = user.profile.first_name;
  openDialog('account-dialog');
}

async function endBeforeAccountChange() {
  if (game.run && !['victory', 'defeat', 'abandoned'].includes(game.phase)) {
    game.phase = 'abandoned'; game.paused = false; checkpoint();
    await saveRun();
  } else if (game.run && !savedResult) await saveRun();
}

function wireEvents() {
  $('start-wave').onclick = startWave;
  $('pause-button').onclick = togglePause;
  $('resume-button').onclick = togglePause;
  $('abandon-button').onclick = () => { game.phase = 'abandoned'; game.paused = false; checkpoint(); renderUI(); showResult(); };
  $('help-button').onclick = () => openDialog('help-dialog');
  $('account-button').onclick = openAccount;
  $('sound-button').onclick = () => {
    soundEnabled = !soundEnabled;
    $('sound-button').setAttribute('aria-pressed', soundEnabled);
    $('sound-button').setAttribute('aria-label', soundEnabled ? 'Выключить звук' : 'Включить звук');
    if (soundEnabled) sound('word');
    toast(soundEnabled ? 'Звуки включены' : 'Звуки выключены');
  };
  $('battle-canvas').addEventListener('pointermove', event => {
    const pad = renderer.hitPad(event.clientX, event.clientY);
    renderer.hoverPad = pad;
    $('battle-canvas').style.cursor = pad >= 0 ? 'pointer' : 'default';
  });
  $('battle-canvas').addEventListener('pointerleave', () => { renderer.hoverPad = -1; });
  $('battle-canvas').addEventListener('click', event => selectPad(renderer.hitPad(event.clientX, event.clientY)));
  const padButtons = document.createElement('div'); padButtons.className = 'pad-accessibility';
  padButtons.setAttribute('role', 'group'); padButtons.setAttribute('aria-label', 'Площадки для строительства');
  padButtons.innerHTML = catalog.pads.map((_, i) => `<button data-pad="${i}" aria-label="Площадка ${i + 1}">${String(i + 1).padStart(2, '0')}</button>`).join('');
  $('typing-panel').before(padButtons);
  document.querySelectorAll('[data-pad]').forEach(button => button.onclick = () => selectPad(Number(button.dataset.pad)));
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => showView(button.dataset.view));
  document.querySelectorAll('[data-auth-tab]').forEach(button => button.onclick = () => setAuthTab(button.dataset.authTab));
  $('reward-dialog').addEventListener('cancel', event => event.preventDefault());
  $('result-dialog').addEventListener('cancel', event => { if (!savedResult) event.preventDefault(); });
  $('new-run-button').onclick = () => { if (savedResult) { freshGame(); toast('Новый дозор. Новая история.'); } };
  $('result-stats-button').onclick = () => { $('result-dialog').close(); showView('stats'); };
  $('retry-save-button').onclick = () => saveRun().catch(() => {});
  $('mode-select').onchange = () => {
    if (['code', 'symbols'].includes($('mode-select').value)) $('language-select').value = 'en';
    buildKeyboard(); renderUI();
  };
  $('language-select').onchange = buildKeyboard;
  ['ranking-metric', 'ranking-period', 'ranking-mode', 'ranking-language', 'ranking-difficulty'].forEach(id => $(id).onchange = renderLeaderboard);
  $('mobile-keyboard').onclick = () => $('mobile-input').focus({preventScroll: true});
  $('typing-panel').onclick = event => { if (event.target.tagName !== 'BUTTON' && game.active) $('mobile-input').focus({preventScroll: true}); };
  $('mobile-input').addEventListener('paste', event => event.preventDefault());
  $('mobile-input').addEventListener('input', event => {
    if (event.inputType !== 'insertFromPaste' && event.data && !event.isComposing) for (const char of event.data) game.key(char);
    $('mobile-input').value = '';
  });
  $('mobile-input').addEventListener('compositionend', event => { for (const char of event.data || '') game.key(char); $('mobile-input').value = ''; });
  document.addEventListener('keydown', event => {
    if (view !== 'game' || document.querySelector('dialog[open]') || !game || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const formControl = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target.tagName) && target !== $('mobile-input');
    if (event.key === 'Escape') { if (game.phase === 'combat') { event.preventDefault(); togglePause(); } return; }
    if (formControl) return;
    if (event.key === 'Enter' && game.phase === 'prep') { event.preventDefault(); startWave(); return; }
    if (game.phase === 'prep' && ['1', '2', '3'].includes(event.key)) {
      selectedType = catalog.towers[Number(event.key) - 1].id; renderer.selectedType = selectedType; renderTowers(); return;
    }
    if (!game.active) return;
    if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); game.cycleTarget(); }
    else if (event.key === 'Backspace') { event.preventDefault(); game.releaseTarget(); }
    else if (event.key.length === 1) { event.preventDefault(); game.key(event.key); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('beforeunload', checkpoint);
  $('auth-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), button = $('auth-submit');
    button.disabled = true; text('auth-error', '');
    try {
      const body = {email: form.get('email'), password: form.get('password')};
      if (authTab === 'register') {
        Object.assign(body, {first_name: String(form.get('first_name')).trim(), last_name: ''});
        user = await api('/auth/claim', {method: 'POST', body});
      } else {
        await endBeforeAccountChange();
        const result = await api('/auth/login', {method: 'POST', body, auth: false});
        user = result.user; accessToken = result.access_token;
        freshGame();
      }
      $('account-dialog').close(); $('auth-form').reset();
      await updatePlayer();
      toast(authTab === 'register' ? 'Аккаунт создан. Весь твой прогресс сохранён.' : 'С возвращением на рубеж.');
    } catch (error) { text('auth-error', error.message); }
    finally { button.disabled = false; }
  };
  $('save-profile').onclick = async () => {
    $('save-profile').disabled = true;
    try {
      user.profile = await api('/profile/me', {method: 'PATCH', body: {first_name: $('profile-name').value.trim()}});
      await updatePlayer(); $('account-dialog').close(); toast('Имя сохранено.');
    } catch (error) { toast(error.message); }
    finally { $('save-profile').disabled = false; }
  };
  $('logout-button').onclick = async () => {
    $('logout-button').disabled = true;
    try {
      await endBeforeAccountChange();
      await api('/auth/logout', {method: 'POST', auth: false});
      const result = await api('/auth/guest', {method: 'POST', auth: false});
      user = result.user; accessToken = result.access_token;
      $('account-dialog').close(); freshGame(); await updatePlayer(); toast('Ты вышел. Начат новый гостевой профиль.');
    } catch (error) { toast(error.message); }
    finally { $('logout-button').disabled = false; }
  };
  setAuthTab('register');
}

async function boot() {
  try {
    const [content, health] = await Promise.all([api('/game/catalog', {auth: false}), fetch('/health').then(r => r.json())]);
    catalog = content;
    try { await refreshAccess(); user = await api('/auth/me'); }
    catch {
      const result = await api('/auth/guest', {method: 'POST', auth: false});
      user = result.user; accessToken = result.access_token;
    }
    renderer = new Renderer($('battle-canvas'), catalog);
    game = new Game(catalog, null, onEvent);
    try {
      const stored = JSON.parse(localStorage.getItem(fingerprint) || 'null');
      if (stored?.userId === user.id) game = Game.restore(catalog, stored.snapshot, onEvent) || game;
    } catch { clearCheckpoint(); }
    if (game.run) {
      $('mode-select').value = game.run.mode;
      $('language-select').value = game.run.language;
      $('difficulty-select').value = game.run.difficulty;
    }
    wireEvents(); buildKeyboard(); renderTowers(); renderUI();
    text('connection-status', health.mode === 'local' ? 'Локальный сервер · прогресс сохраняется' : 'Сервер на связи · прогресс сохраняется');
    await updatePlayer();
    if (game.phase === 'reward') showReward();
    if (['victory', 'defeat', 'abandoned'].includes(game.phase)) showResult();
    let lastFrame = performance.now();
    function frame(now) {
      const delta = Math.min((now - lastFrame) / 1000, 0.1); lastFrame = now;
      if (view === 'game') {
        game.tick(delta);
        renderer.draw(game, delta);
        if (now - lastUI > 100) { renderUI(); lastUI = now; }
      }
      if (now - lastSnapshot > 3000) { checkpoint(); lastSnapshot = now; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (error) {
    text('connection-status', 'Не удалось подключиться к серверу');
    $('start-wave').disabled = false;
    text('start-wave', 'Повторить подключение');
    $('start-wave').onclick = () => location.reload();
    toast(error.message);
  }
}

boot();
