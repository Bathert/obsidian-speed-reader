import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('reader visibility is controlled by a scoped CSS class', () => {
  const css = read('styles.css');
  assert.match(css, /\.sr-modal-container\s+\.sr-hidden\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(read('src/readerModal.ts'), /\.style\s*[.[]/);
});

test('release metadata uses the registered ID and matching versions', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.id, 'rsvp-speed-reader');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.minAppVersion, '1.13.0');
});

test('note content is never rendered through HTML assignment', () => {
  assert.doesNotMatch(read('src/readerModal.ts'), /\.(?:innerHTML|outerHTML)\s*=/);
});

test('themes do not override host styles with important', () => {
  assert.doesNotMatch(read('styles.css'), /!important/);
});
