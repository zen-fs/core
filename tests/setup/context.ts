import { bindContext } from '../../dist/context.js';
import { copy, data } from './common.js';

copy(data);

export const fs = bindContext('/new_root');
