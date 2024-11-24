import { bindContext } from '../../dist/context.js';
import { copy, data } from './common.js';

export const fs = bindContext('/new_root');

copy(data, fs);
