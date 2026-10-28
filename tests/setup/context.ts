import { fs as _fs, bindContext } from '@zenfs/core';
import { copySync, data } from '@zenfs/devel/tests/setup';

_fs.mkdirSync('/new_root');

export const { fs } = bindContext({ root: '/new_root' });

copySync(data, fs);
