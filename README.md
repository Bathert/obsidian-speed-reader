# Speed Reader (RSVP) for Obsidian

Read a note or a selection one word at a time with rapid serial visual presentation (RSVP): an optimal recognition point (ORP) highlight, adjustable speed, smart pauses, chunking, a table of contents, saved positions, reading statistics, and optional text-to-speech through the system voice or the Unreal Speech cloud API. Requires Obsidian 1.13.0 or newer. Current version: **1.3.3**.

Russian version: [README.ru.md](README.ru.md)

## Features

### Reading and presentation

- **One, two, or three words per frame**, with optional bionic bolding inside chunks.
- **ORP highlight** with a configurable colour and a width of one to three letters.
- **Redicle alignment (35/65)** keeps the focus letter at 35% from the left edge, so long word endings do not push the word out of view. A centred 50/50 mode is also available.
- **Variable timing by word length**: very short words (1-2 letters) are shown 20% faster, medium words (3-8) at normal speed, long words (9-12) 15% slower, and extra-long words (13+) 35% slower.
- **Fixation guides** frame the word and can be turned off.
- **Adaptive window**: the frame, padding, and header scale with the height of the app window, so the word, progress bar, and controls stay visible in short windows instead of being clipped.

### Pacing and rhythm

- **Speed ramp-up** starts at 65% of the target speed and reaches it over the first words.
- **Rewind on pause** steps a few words back so the context is not lost; the rewind is based only on words read since the last resume.
- **Pauses on punctuation, paragraph breaks, numbers, and acronyms** use configurable multipliers.
- **Trainer mode** raises the target WPM every N read words up to a configured ceiling.
- **Pause summary** shows words read, actual average WPM, speed-up against 200 WPM, time saved, time remaining, and a short coaching line.

### Navigation and focus

- **Table of contents**: the reader header lists every heading of the note and follows the current chapter while you read; pick any section to jump there.
- **Speed read from Cursor**: a command starts the whole note at the word under the editor cursor; selected text also has a context-menu item.
- **Highlight on the fly** (`H` / `Р`): wraps the current sentence in `==highlight==` directly in the open note, or copies the sentence when no editor is available.
- **Interactive context**: on pause, 15 words around the current position are shown and every neighbour is clickable for an instant jump. During playback the line stays compact.
- **Zen mode** (`F` / `А`): dims the header, context, progress bar, and controls during playback, leaving only the word in focus; pointing at the window restores them.
- **Status bar estimate**: shows the reading progress and remaining time for the active note (`📖 42% · ~3 min`); clicking it opens the reader.
- **Touch gestures**: on the reading frame, tap the left or right third to step, tap the centre to play or pause, swipe up or down by 25 WPM.

### Technical notes: code, math, tables

- **Fenced code blocks** are skipped by default so a listing does not interrupt the rhythm; enable **Read code in notes** to read them word by word. Fences never reach the word stream.
- **Display math** (`$$...$$`, `\[...\]`) is skipped. Short inline math (`$x$`, `$O(n)$`) is read as plain text; long inline formulas are dropped instead of being spelled out symbol by symbol.
- **Tables** are flattened into their cells, pipes never reach the reader, cells keep their source offsets, and each row ends with a short comma pause.
- **Markdown cleanup** handles Obsidian comments (`%%...%%`), HTML comments, callout markers, footnotes, bare URLs (shortened to the domain), highlights, and table separators, while keeping `snake_case` names and comparisons such as `a < b`.

### Interface language

- **Russian and English UI** with automatic detection from the Obsidian language, plus a manual **Interface language** setting (`auto`, `ru`, `en`).
- Reader buttons, hints, resume banner, pause summary, and notices follow the selected language.
- **Speech language detection** picks `ru-RU` or `en-US` for the system voice based on the current sentence.

### Speech

- The speaker button and the `M` key toggle text-to-speech at a rate proportional to the chosen WPM.
- Two engines are available in settings:
  - **System (Web Speech)** - installed OS voices, works offline; quality and availability depend on the system.
  - **Unreal Speech** - cloud API, needs a key from [unrealspeech.com/dashboard](https://unrealspeech.com/dashboard). The voice list follows the API (Amelia is the default; Charlotte, Emily, Giulia, Lucía and others are available). The API has **no Russian voice**, so Russian text is pronounced with an accent.
- **Limits and reliability for Unreal Speech**: requests are split into chunks of at most 1000 characters and sent sequentially with a 600 ms gap, staying inside the free plan's 2 requests/second. A request times out after 20 seconds; only one sentence is fetched or played at a time.
- **Character counter**: the settings show how many characters this vault has sent, with a reset button, plus a **Test key** button and a **Test speech key** command.
- **Graceful fallback**: a bad key, exhausted quota, rate limit, or network failure is reported once and playback continues with the system voice.
- The key is stored only in this vault's plugin data (`data.json`) and is never written to the repository.
- Speech is approximate rather than word-synchronised, and cloud voices may use online services; check those settings before reading sensitive notes.

### Progress, cursor, statistics

- The reading position is remembered per note and saved while reading, on pause, and on close. Closing a freshly opened reader without any interaction keeps the previous position.
- On close, the editor cursor moves to the word being read; the offset is clamped to the current document length, so parallel edits cannot throw.
- **Show speed reading statistics** reports words read, time spent, top speed, and estimated time saved against 200 WPM. The saving is an estimate, not a measure or a guarantee of comprehension.

### Reading fonts

- **Golos Text** has a large x-height, open apertures, and full Cyrillic and Latin coverage; recommended for Russian text.
- **Atkinson Hyperlegible** distinguishes similar letter shapes but has **no Cyrillic**, so Russian words fall back to another font; it suits Latin text only.
- Both fonts are embedded in `styles.css` as data URIs, so nothing is loaded from the network. OFL licence texts are in `fonts/`.
- The font is selected in **Settings → Speed Reader (RSVP) → Reader font**; the default is the theme font.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Start or pause (with rewind) |
| `M` or the Russian `Ь` | Toggle text-to-speech |
| `Up` / `Down` | Increase or decrease speed by 25 WPM |
| `Left` / `Right` | Jump by the configured number of words |
| `[` / `]` | Move to the previous or next sentence |
| `H` or the Russian `Р` | Highlight the current sentence in the note |
| `F` or the Russian `А` | Toggle zen mode |
| `R` or the Russian `К` | Restart from the first word |
| `Esc` | Close the reader (saves progress and cursor) |

## Installation

Download the three files from a single [GitHub release](https://github.com/Bathert/obsidian-speed-reader/releases), or build them with `npm ci` and `npm run check`.

1. Create `<vault>/.obsidian/plugins/rsvp-speed-reader/` (or use your vault's custom configuration directory).
2. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
3. Restart Obsidian, then enable **Speed Reader (RSVP)** in **Settings → Community plugins**.
4. If an older manual installation used the folder `obsidian-speed-reader`, disable it, back up `data.json`, and rename the folder to `rsvp-speed-reader`. Keep `data.json` to retain settings, the saved position, and the Unreal Speech key. Do not enable two copies.

## Usage

Open a Markdown note, optionally select a passage, and click the book icon in the ribbon. Alternatively use the command palette:

- **Speed read current selection or active note** - reads the selection if there is one, the whole note otherwise;
- **Speed read selected text** - reads only the selection;
- **Speed read entire active note** - reads the whole note;
- **Speed read from Cursor** - starts the whole note at the editor cursor;
- **Show speed reading statistics** - shows your counters;
- **Test speech key** - sends a one-word request to Unreal Speech and reports success or the exact error;
- **Run self-check** - opens and closes a short probe window, checks parsing, offsets, timing, navigation, progress bounds, and the reader window itself, then reports how many steps passed.

Selected text also has a **Speed read selection** item in the editor context menu.

## Settings

- **Reader analytics**: words read, reading time, top speed, time saved; reset the counters.
- **Language**: interface language (auto / Russian / English).
- **Speed and display**: default WPM, word step, reader theme, font size, reader font, ORP highlight and width, ORP colour, fixation guides, redicle alignment, variable timing by word length, zen mode.
- **Pacing**: ramp-up and its length, trainer mode with step, interval and ceiling, pause statistics, rewind and its length, pauses on punctuation, commas, paragraphs, numbers and acronyms with their multipliers.
- **Chunking**: words per frame, bionic bolding.
- **Technical notes**: read code blocks.
- **Progress**: remember position, sync cursor on close, show the status-bar estimate.
- **Speech**: engine (system / Unreal Speech), Unreal Speech key, voice, character counter with reset, test key; enable text-to-speech.

The settings tab uses the declarative settings API, so its controls appear in Obsidian's settings search.

## Development and releases

Use Node.js 24 or newer and npm. `npm ci` installs dependencies; `npm run check` type-checks, lints, tests, and builds; `npm run test:coverage` prints coverage for the pure logic modules.

The registered plugin ID is `rsvp-speed-reader` and must remain unchanged. To publish, commit the changes and push a tag matching the version in `manifest.json` (for example `1.3.3`, without a `v` prefix). The release workflow verifies the metadata, builds from that tag, creates GitHub artifact attestations for the assets, and publishes `main.js`, `manifest.json`, and `styles.css`.

## Licence

Mozilla Public License 2.0 (MPL-2.0). See [LICENSE](LICENSE). In short: you may use, modify, and redistribute the plugin, including in closed-source projects, but modifications to these MPL-covered files must stay under the MPL and be made available.
