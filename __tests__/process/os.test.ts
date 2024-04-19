import { join } from '../../src/emulation/path';
import { minimatch } from 'minimatch';
import { globSync } from '../../src/helpers/glob';
import { cd } from '../../src/process';
import { initialize, spawn } from '../../src/process/process';
import { fs, setup } from '../../test-utils/interweb';

beforeAll(initialize);
beforeAll(setup);

it('globSync', () => {
  const files = globSync('./', '*');
  expect(files).toMatchSnapshot();
});
