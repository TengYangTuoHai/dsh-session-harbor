import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./check-client-scope.mjs', import.meta.url));
const check = input => spawnSync(process.execPath, [checker, '--stdin'], { input, encoding: 'utf8' });

test('scope checking catches the missing dependency variable that broke the live sidebar', () => {
  // Parse only: this fixture does not load React or construct any UI.
  const result = check("window.__ModuleLoader__.load({factory(require){const React=require('react');function RemoteOwner(){React.useEffect(()=>{},[connections]);}}});");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /undeclared connections/);
});

test('scope checking accepts lexical captures and standard browser globals', () => {
  const result = check("window.__ModuleLoader__.load({factory(require){const React=require('react');function RemoteOwner(connections){React.useEffect(()=>{window.setTimeout(()=>connections.length,0);},[connections]);}}});");
  assert.equal(result.status, 0, result.stderr);
});
