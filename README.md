# Speed Reader (RSVP) for Obsidian

Read a note or selected text one word at a time using rapid serial visual presentation (RSVP), with an optimal recognition point (ORP) highlight, adjustable speed, smart pauses, chunking, saved positions, reading statistics, and optional text-to-speech. Requires Obsidian 1.13.0 or newer.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the same [GitHub release](https://github.com/Bathert/obsidian-speed-reader/releases).
2. Create `<vault>/.obsidian/plugins/rsvp-speed-reader/` (or use your vault's custom configuration directory).
3. Copy all three files into that folder, restart Obsidian, and enable **Speed Reader (RSVP)** in **Settings → Community plugins**.
4. If an older manual installation used the folder `obsidian-speed-reader`, disable it, back up `data.json`, and rename the folder to `rsvp-speed-reader`. Keep `data.json` to retain settings and progress. Do not enable two copies.

## Usage

Open a Markdown note, optionally select a passage, and click the book icon in the ribbon. Alternatively, use the command palette: **Speed read current selection or active note**, **Speed read selected text**, or **Speed read entire active note**. Selected text also has a **Speed read selection** editor context-menu action.

Press Space to start or pause. Up/Down changes speed by 25 WPM; Left/Right skips the configured number of words; `[` / `]` navigates sentences; R (К) restarts; M (Ь) toggles speech; Escape closes the reader. Configure speed, font, focus, pacing, chunking, progress, and speech in **Settings → Speed Reader (RSVP)**. Settings appear in Obsidian's settings search.

Reading progress is stored per note when enabled. Use **Show speed reading statistics** to view statistics. Estimated time savings are relative to 200 WPM, not a measure or guarantee of comprehension. Speech uses the platform Web Speech API and available voices; timing is approximate, not word-synchronized. System voices may use online services, so check your system speech settings before reading sensitive notes.

## Development and releases

Use Node.js 24 or newer and npm. Run `npm ci` and `npm run check` to type-check, lint, test, and build. The resulting `main.js`, `manifest.json`, and `styles.css` are the installation files.

The registered plugin ID is `rsvp-speed-reader` and must remain unchanged. Release 1.0.1 requires Obsidian 1.13.0 for the searchable declarative settings API. To publish, commit the reviewed changes and push a tag matching `manifest.json` (for example `1.0.1`, without `v`). The release workflow checks metadata, builds from that tag, and uploads the exact repository manifest with the built assets. It creates GitHub provenance attestations when run successfully on GitHub; a local build does not create attestations or update an existing release.

## Описание по-русски

Продвинутый плагин скорочтения для Obsidian, созданный по патентам и психолингвистическим исследованиям **Spritz** и топовых читалкок (**SwiftRead**, **Readwise Reader**).

---

## 🎯 Научные принципы Spritz в плагине

### 1. Фирменная рамка «The Redicle» (Правило 35/65)
- Визир рамки и фокусная буква расположены **не строго по центру**, а на **35% от левого края** (как в оригинальном Spritz).
- Это компенсирует длину окончаний и суффиксов (длинные слова не съезжают за правый край, а поле зрения естественно охватывает правую часть слова).
- Доступно переключение: `Spritz Redicle (35/65)` или `Центр (50/50)`.

### 2. Нелинейные тайминги длины слов (Spritz Variable Timing Engine)
- **Короткие слова (1–2 буквы)**: союзы и предлоги (*«в»*, *«и»*, *«на»*, *«to»*, *«at»*) ускоряются на **20% (0.8x)**, так как мозг распознает их моментально.
- **Средние слова (3–8 букв)**: стандартное время (1.0x).
- **Длинные слова (9–12 букв)**: задержка +15% (1.15x).
- **Экстра-длинные слова (13+ букв)**: задержка +35% (1.35x).

### 3. Бимодальное чтение / TTS (Озвучка)
- Кнопка динамика `🔊` на панели и горячая клавиша `M`.
- Текст синхронно воспроизводится голосом через нативный Web Speech API на скорости, пропорциональной выбранному WPM.
- Озвучка зависит от системных голосов и не синхронизирована с каждым словом. Скорость чтения не гарантирует лучшее понимание текста.

### 4. Умный темп (Smart Pacing & Rhythm)
- 🏎️ **Speed Ramp-up (Плавный разгон)**: старт с 65% скорости и плавный выход на целевой WPM за первые 15 слов.
- ⏪ **Rewind on Pause (Авто-откат)**: при паузе ридер отступает на 3 слова назад, чтобы не терялся контекст.
- 🛑 **Паузы на абзацах и знаках**: удлиненные задержки на точках, вопросительных знаках и границах параграфов.
- 🔢 **Задержки на числах и аббревиатурах**: акцент на цифрах (`2026`) и аббревиатурах (`API`, `HTML`).

### 5. Память заметок и Аналитика
- 💾 Помнит место остановки в каждой заметке.
- 🎯 Синхронизирует курсор в Obsidian при выходе из окна скорочтения.
- 📊 Дашборд статистики: подсчет прочитанных слов, времени и сэкономленных минут.

---

### 6. Шрифты для чтения

- `Golos Text` — крупный x-height, открытые апертуры, полная кириллица и латиница. Основной вариант для русских текстов: в один столбец, на 60–72 px.
- `Atkinson Hyperlegible` — шрифт Института Брайля с различимыми формами букв. Важно: в нём **нет кириллицы**, для русских слов браузер подставит другой шрифт, поэтому он годится только для латиницы.
- Шрифты встроены в плагин (data URI в `styles.css`), без обращения к сети. Лицензии OFL лежат в `fonts/`.
- Выбор шрифта: **Настройки → Speed Reader (RSVP) → Шрифт ридера**. По умолчанию — шрифт темы Obsidian.

## ⌨️ Горячие клавиши

| Клавиша | Действие |
|---|---|
| `Space` | **Старт / Пауза** (с авто-откатом назад) |
| `M` / `Ь` | **Вкл / Выкл озвучку (TTS)** |
| `↑` / `↓` | **±25 WPM** (изменение скорости) |
| `←` / `→` | **±10 слов** (быстрая перемотка) |
| `[` / `]` | **Переход по предложениям** (в начало пред./след. предложения) |
| `R` / `К` | **Перезапуск** с первого слова |
| `Esc` | Закрыть ридер (сохраняет прогресс и курсор) |

---

## 📦 Установка в Obsidian

Скачайте файлы из одного релиза GitHub или соберите проект командами `npm ci` и `npm run check`. Нужен Obsidian 1.13.0 или новее.

1. Откройте папку плагинов вашего хранилища: `<Vault>/.obsidian/plugins/`
2. Создайте там папку `rsvp-speed-reader`.
3. Скопируйте туда 3 скомпилированных файла:
   - `manifest.json`
   - `main.js`
   - `styles.css`
4. В Obsidian: **Настройки** → **Сторонние плагины** → **Обновить** → Включите **Speed Reader (RSVP)**.

## 🚀 Запуск

- Значок раскрытой книги **Speed read note** на левой панели Obsidian.
- Или `Ctrl+P` → `Speed Reader (RSVP)`:
  - `Speed read current selection or active note` — выделение, если оно есть, иначе вся заметка;
  - `Speed read selected text`;
  - `Speed read entire active note`;
  - `Show speed reading statistics`.
- Правый клик по выделенному тексту → **Speed read selection**.

## 🧪 Проверка

```bash
npm run check          # типы, линт, тесты и сборка
npm run test:coverage  # покрытие чистой логики
```

Тесты покрывают расчёты темпа, разбор Markdown и смещения слов, настройки, команды плагина и поведение окна чтения (клавиши, кнопки, пауза, перемотка, сохранение места, озвучка, чанки, темы). Реальный звук TTS и отрисовка шрифтов проверяются только вручную в Obsidian.
