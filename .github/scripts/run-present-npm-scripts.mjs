import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts ?? {};
const names = ['build', 'lint', 'test'];

let failed = false;
for (const name of names) {
  if (!Object.hasOwn(scripts, name)) {
    console.log(`skip npm run ${name} (package.json has no "${name}" script)`);
    continue;
  }
  console.log(`npm run ${name}`);
  const result = spawnSync('npm', ['run', name], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
