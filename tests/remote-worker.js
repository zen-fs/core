/* eslint-env node */

import { fs } from '@zenfs/core';
import { attach } from '../dist/remote.js';
import { parentPort } from 'node:worker_threads';

attach(parentPort, fs.mounts.get('/'));
