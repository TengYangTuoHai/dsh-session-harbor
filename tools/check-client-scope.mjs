import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Install only the development checker with:
// pnpm --dir tools/static-check install --ignore-scripts
const require = createRequire(new URL('./static-check/package.json', import.meta.url));
const { parse } = require('acorn');
const { analyze } = require('eslint-scope');
const globalsModule = require('globals');
const globals = globalsModule.default ?? globalsModule;
const known = new Set(Object.keys({ ...globals.es2025, ...globals.browser, ...globals.node }));
const files = process.argv.slice(2);
if (!files.length) files.push(
  't3-session-sidebar/client.js',
  't3-session-sidebar/client.remote-runtime.js',
  't3-session-sidebar/remote-runtime.js',
  't3-session-sidebar/device-realm.js',
  't3-session-sidebar/remote-transport.js',
  't3-session-sidebar/shortcuts-bridge.js',
);
let errors = 0;
for (const file of files) {
  const ast = parse(readFileSync(file === '--stdin' ? 0 : resolve(file), 'utf8'), {
    ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true,
  });
  const scope = analyze(ast, { ecmaVersion: 2024, sourceType: 'module' });
  for (const reference of scope.globalScope.through) {
    const { name, loc } = reference.identifier;
    if (known.has(name)) continue;
    console.error(`${file}:${loc.start.line}:${loc.start.column + 1}: undeclared ${name}`);
    errors++;
  }
}
if (errors) process.exitCode = 1;
else console.log(`No undeclared references in ${files.length} client files.`);
