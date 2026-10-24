import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const manifest = read('manifest.json');
const pkg = read('package.json');
assert.equal(manifest.id, 'rsvp-speed-reader');
assert.equal(manifest.version, pkg.version);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(read('versions.json')[manifest.version], manifest.minAppVersion);
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, manifest.version, 'Tag must exactly match manifest.version');
}
for (const asset of ['main.js', 'styles.css']) {
  assert.ok(readFileSync(new URL(`../${asset}`, import.meta.url)).length > 0);
}
console.log(`Release metadata verified: ${manifest.id} ${manifest.version}`);
