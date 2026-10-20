"""Public game balance and training content, shared with the browser."""

WORDS_RU = "лук маг лес щит меч руна свет тень огонь ветер башня камень искра страж замок стрела звезда поток клинок ворота молния кристалл защита дракон крепость рыцарь победа энергия воин битва кузня земля мороз портал корона факел пламя охота книга герой волна мастер север граница легенда алмаз комета".split()
WORDS_EN = "bow mage oak shield sword rune light shadow flame wind tower stone spark guard keep arrow star stream blade gate thunder crystal dragon castle knight victory energy battle forge earth frost portal crown torch hunter book hero wave master north border legend comet".split()

CATALOG = {
    "version": 2,
    "total_waves": 8,
    "path": [[0, 3], [4, 3], [4, 7], [9, 7], [9, 2], [14, 2], [14, 7], [17, 7]],
    "pads": [[2, 2], [3, 5], [6, 8], [8, 4], [11, 1], [12, 5], [16, 6]],
    "towers": [
        {"id": "arrow", "name": "Страж", "role": "Точный выстрел", "description": "Ослабляет врагов и добивает тех, чей рунический щит разбит словом.", "cost": 60, "damage": 2.8, "interval": 1.25, "range": 2.9, "color": "#ecbb72"},
        {"id": "frost", "name": "Иней", "role": "Замедление", "description": "Замедляет врагов на 40%, давая время разбить их щиты печатью.", "cost": 80, "damage": 1.2, "interval": 1.8, "range": 2.7, "color": "#8ecfdf"},
        {"id": "ember", "name": "Уголёк", "role": "Урон по области", "description": "Огненный взрыв задевает целую группу. Рунические щиты снимаются только словами.", "cost": 100, "damage": 4.2, "interval": 2.6, "range": 2.8, "color": "#ef9478"},
    ],
    "relics": [
        {"id": "echo", "name": "Эхо рун", "description": "Завершённое слово наносит 40% урона соседним врагам.", "icon": "echo", "rarity": "РЕДКАЯ"},
        {"id": "frost", "name": "Ледяная печать", "description": "Завершённое слово замедляет цель на 4 секунды.", "icon": "frost", "rarity": "ОБЫЧНАЯ"},
        {"id": "overheat", "name": "Перегрев", "description": "При комбо от 20 башни стреляют на 35% быстрее.", "icon": "flame", "rarity": "РЕДКАЯ"},
        {"id": "mending", "name": "Живой камень", "description": "Каждое завершённое слово восстанавливает 1 здоровье крепости.", "icon": "heart", "rarity": "ОБЫЧНАЯ"},
        {"id": "bounty", "name": "Золотая жила", "description": "Каждый поверженный враг приносит ещё 4 золота.", "icon": "coin", "rarity": "ОБЫЧНАЯ"},
        {"id": "power", "name": "Острый слог", "description": "Урон от завершённого слова увеличивается на 50%.", "icon": "sword", "rarity": "ЭПИЧЕСКАЯ"},
        {"id": "focus", "name": "Тихий час", "description": "Все враги движутся на 15% медленнее.", "icon": "clock", "rarity": "РЕДКАЯ"},
        {"id": "scholar", "name": "Знание древних", "description": "За забег получаешь на 30% больше опыта.", "icon": "book", "rarity": "ОБЫЧНАЯ"},
        {"id": "fortress", "name": "Каменное сердце", "description": "Максимальное здоровье крепости +30. Сразу лечит на 30.", "icon": "shield", "rarity": "РЕДКАЯ"},
        {"id": "reach", "name": "Зоркий глаз", "description": "Дальность всех башен увеличивается на 25%.", "icon": "target", "rarity": "ОБЫЧНАЯ"},
    ],
    "content": {
        "words": {"ru": WORDS_RU, "en": WORDS_EN},
        "sentences": {
            "ru": ["Свет укажет путь.", "Башня держит оборону.", "Ветер несёт искры.", "Защити древний лес.", "Новая волна близко.", "Руны хранят силу.", "Герой идёт вперёд.", "Пламя согревает камень."],
            "en": ["Light leads the way.", "Hold the ancient gate.", "A new wave is coming.", "The tower stands tall.", "Runes hold great power.", "Protect the forest.", "The fire burns bright.", "Keep your shield up."],
        },
        "code": {"ru": [], "en": ["print('hello')", "const hp = 100;", "return true;", "<h1>Keep</h1>", "for i in range(3):", "let wave = 1;", "if (hp > 0) {}", "color: #fff;", "def guard():", "items.map(fn)"]},
        "symbols": {"ru": [], "en": ["a7!k2", "x9@z3", "r2#f8", "b4$m1", "q6&v5", "d3+n7", "w8=p2", "s5%j9", "h1*t4", "c0?e6"]},
    },
}
