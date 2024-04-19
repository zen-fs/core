import { configure, InMemory } from '../src';

import { fs } from '../src';
import { join, relative } from 'path';
import { statSync, readFileSync, readdirSync } from 'fs';

export const fixturesDir = '__fixtures__/interweb';

export function setup(_p: string = fixturesDir) {
  const p = relative(fixturesDir, _p) || '/';
  const stats = statSync(_p);

  if (!stats.isDirectory()) {
    fs.writeFileSync(p, readFileSync(_p));
    return;
  }

  if (p != '/') {
    fs.mkdirSync(p);
  }
  for (const file of readdirSync(_p)) {
    setup(join(_p, file));
  }
}

export { fs };
