import { join } from '../../src/emulation/path';
import { minimatch } from 'minimatch';
import { globSync } from '../../src/helpers/glob';
import { fs, setup } from '../../test-utils/interweb';

beforeAll(setup);

it('globSync', () => {
  const files = globSync('./pyramation', '*.txt');
  expect(files).toMatchSnapshot();
});