# Review notes

Obsidian community plugin, TypeScript, built with esbuild into a single CommonJS `main.js`.

## Layout

- `src/main.ts` - plugin entry: commands, ribbon, context menu, cursor sync, settings load/save, self-check.
- `src/readerModal.ts` - the reading window: playback timer, pause/rewind, progress, chunks, TTS, pause summary, keyboard handling.
- `src/textParser.ts` - Markdown cleanup, word splitting with ORP, char offsets back into the source note, chunk grouping.
- `src/speedEngine.ts` - timing math, ramp-up, sentence navigation, session summary, formatting.
- `src/settings.ts` - declarative settings tab (`getSettingDefinitions`) and settings normalization.
- `tests/` - Node test runner suites; `tests/helpers/*` mock the Obsidian API.
- `styles.css` - plugin styles plus embedded fonts as data URIs (font block starts at `reader fonts`).

## Commands

```
npm ci
npm run check          # typecheck + eslint + tests + build
npm run test:coverage
```

## What to look at

- Correctness of playback state transitions (play/pause/seek/completion, chunk boundaries).
- Progress persistence and cursor offset mapping for Markdown constructs.
- Timer and stats arithmetic (no drift, no double counting, pause time excluded).
- Any place where note text could be interpreted as HTML.
- Test quality: do the DOM-less harness tests actually assert behaviour, or only mocks?

## Constraints

- Obsidian API is mocked in tests; the real API is not available outside the app.
- `main.js` is generated - review `src/`, not the bundle.
- Plugin ID `rsvp-speed-reader` and `minAppVersion` 1.13.0 must stay as is.
