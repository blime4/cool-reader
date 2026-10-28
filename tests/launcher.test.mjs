import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
test('protocol registration uses a fixed quoted script and never forwards a URI', async () => {
  const installer = await source('scripts/install-protocol.ps1');
  assert.match(installer, /HKCU:\\Software\\Classes\\folio-plants/);
  assert.match(installer, /powershell\.exe/);
  assert.match(installer, /-File/);
  assert.doesNotMatch(installer, /%1|%L|Invoke-Expression|iex\s|HKEY_LOCAL_MACHINE|HKLM:/i);
  assert.match(installer, /start-local\.ps1/);
});
test('launcher only starts its fixed local server and verifies service identity', async () => {
  const launcher = await source('scripts/start-local.ps1');
  assert.match(launcher, /127\.0\.0\.1:4173\/api\/health/);
  assert.match(launcher, /folio-plants/);
  assert.match(launcher, /Threading\.Mutex/);
  assert.match(launcher, /-WindowStyle Hidden/);
  assert.match(launcher, /server\.mjs/);
  assert.doesNotMatch(launcher, /Stop-Process|taskkill|Invoke-Expression|\$args|DownloadString|Invoke-WebRequest[^\n]+https:/i);
});
test('public portal has explicit local launch links without accessing private data', async () => {
  const html = await source('docs/index.html');
  assert.match(html, /href="folio-plants:\/\/start"/);
  assert.match(html, /http:\/\/127\.0\.0\.1:4173/);
  assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|C:\\Users\\|config\.local\.json|api\/plants|api\/storage/);
});
