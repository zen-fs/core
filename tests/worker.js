import { fs } from '@zenfs/core';
import { parentPort } from 'node:worker_threads';
import { attach } from '../dist/remote.js';

attach(parentPort, fs.mounts.get('/'));
