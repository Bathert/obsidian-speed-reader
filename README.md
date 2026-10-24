# Speed Reader (RSVP) for Obsidian

Read a note or selected text one word at a time using rapid serial visual presentation (RSVP), with an optimal recognition point (ORP) highlight, adjustable speed, smart pauses, chunking, saved positions, reading statistics, and optional text-to-speech. Requires Obsidian 1.13.0 or newer.

Russian version: [README.ru.md](README.ru.md)

## Features

### Spritz-style presentation

- **Redicle alignment (35/65)** keeps the focus letter at 35% from the left edge, so long word endings do not push the word out of view. A centered 50/50 mode is also available.
- **ORP highlight** marks the optimal recognition point with a configurable color and a width of one to three letters.
- **Variable timing by word length**: very short words (1-2 letters) are shown 20% faster, medium words (3-8) at normal speed, long words (9-12) 15% slower, and extra-long words (13+) 35% slower.
- **Fixation guides** frame the word and can be turned off.

### Pacing and rhythm

- **Speed ramp-up** starts at 65% of the target speed and reaches it over the first 15 words.
- **Rewind on pause** steps three words back, so the context is never lost.
- **Pauses on punctuation, paragraph breaks, numbers, and acronyms** use configurable multipliers.

### Chunking and bionic reading

- Show one, two, or three words per frame.
- Optionally bold the first part of each word inside a chunk (bionic reading).

### Speech

- The speaker button and the `M` key toggle text-to-speech through the platform Web Speech API, at a rate proportional to the chosen WPM.
- Speech uses installed system voices, is approximate rather than word-synchronized, and may use online services depending on your system settings. Check those settings before reading sensitive notes.

### Progress, cursor, and statistics

- The reading position is remembered per note and saved while reading, on pause, and on close.
- On close, the editor cursor moves to the word being read.
- **Show speed reading statistics** reports words read, time spent, top speed, and estimated time saved relative to 200 WPM. The saving is an estimate, not a measure or a guarantee of comprehension.

### Reading fonts

- **Golos Text** has a large x-height, open apertures, and full Cyrillic and Latin coverage. It is the recommended choice for Russian text.
- **Atkinson Hyperlegible** distinguishes similar letter shapes but has **no Cyrillic**, so Russian words fall back to another font; it suits Latin text only.
- Both fonts are embedded in `styles.css` as data URIs, so nothing is loaded from the network. OFL license texts are in `fonts/`.
- The font is selected in **Settings - Speed Reader (RSVP) - Reader font**; the default is the theme font.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Start or pause (with rewind) |
| `M` or the Russian `Ь` | Toggle text-to-speech |
| `Up` / `Down` | Increase or decrease speed by 25 WPM |
| `Left` / `Right` | Jump by the configured number of words |
| `[` / `]` | Move to the previous or next sentence |
| `R` or the Russian `К` | Restart from the first word |
| `Esc` | Close the reader (saves progress and cursor) |

## Installation

Download the three files from a single [GitHub release](https://github.com/Bathert/obsidian-speed-reader/releases), or build them with `npm ci` and `npm run check`.

1. Create `<vault>/.obsidian/plugins/rsvp-speed-reader/` (or use your vault's custom configuration directory).
2. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
3. Restart Obsidian, then enable **Speed Reader (RSVP)** in **Settings - Community plugins**.
4. If an older manual installation used the folder `obsidian-speed-reader`, disable it, back up `data.json`, and rename the folder to `rsvp-speed-reader`. Keep `data.json` to retain settings and progress. Do not enable two copies.

## Usage

Open a Markdown note, optionally select a passage, and click the book icon in the ribbon. Alternatively use the command palette:

- **Speed read current selection or active note** - reads the selection if there is one, the whole note otherwise;
- **Speed read selected text** - reads only the selection;
- **Speed read entire active note** - reads the whole note;
- **Show speed reading statistics** - shows your counters;
- **Run self-check** - opens and closes a short probe window, checks parsing, offsets, timing, navigation, progress bounds, and the reader window itself, then reports how many steps passed.

Selected text also has a **Speed read selection** item in the editor context menu.

## Settings

- **Speed**: default WPM, step size, speed ramp-up, rewinds.
- **Display**: theme, reader font, font size, ORP color, ORP width, fixation guides.
- **Pacing**: punctuation, comma, paragraph, number, and acronym multipliers.
- **Chunking**: words per frame and bionic bolding.
- **Progress**: remember position, sync the cursor on close, show pause statistics.
- **Speech**: enable or disable text-to-speech.

The settings tab uses the declarative settings API, so its controls appear in Obsidian's settings search.

## Development and releases

Use Node.js 24 or newer and npm. `npm ci` installs dependencies; `npm run check` type-checks, lints, tests, and builds; `npm run test:coverage` prints coverage for the pure logic modules.

The registered plugin ID is `rsvp-speed-reader` and must remain unchanged. To publish, commit the changes and push a tag matching the version in `manifest.json` (for example `1.0.3`, without a `v` prefix). The release workflow verifies the metadata, builds from that tag, creates GitHub artifact attestations for the assets, and publishes `main.js`, `manifest.json`, and `styles.css`.

## License

Mozilla Public License 2.0 (MPL-2.0). See [LICENSE](LICENSE). In short: you may use, modify, and redistribute the plugin, including in closed-source projects, but modifications to these MPL-covered files must stay under the MPL and be made available.
