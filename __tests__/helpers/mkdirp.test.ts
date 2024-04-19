import { globSync } from '../../src/helpers/glob';
import { mkdirpSync } from '../../src/helpers/mkdirp';
import { cd } from '../../src/process';
import { setup } from '../../test-utils/interweb';
import { writeFileSync } from '../../src/process/os_sync';
import { detach, spawn } from '../../src/process/process';

beforeAll(setup);

it('mkdirpSync', async () => {
  mkdirpSync('./some/deeply/nested/directory/path');
  writeFileSync('./some/deeply/nested/directory/path/a.txt', 'hello!');
  cd('./some')
  mkdirpSync('./some/deeply/nested/directory/path');
  writeFileSync('./some/deeply/nested/directory/path/a.txt', 'hello!');
  // cd('../')

  // @ts-ignore
  // spawn({ cwd: '/' });
  spawn();
  cd('../')
  const files = globSync('.', '*.txt');
  expect(files).toMatchSnapshot();
  cd('./some');
  // detach();
  const files2 = globSync('.', '*');
  expect(files2).toMatchSnapshot();
});
