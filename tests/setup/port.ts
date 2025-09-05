import { after, afterEach } from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { InMemory, Port, configureSingle, fs, resolveMountConfig, resolveRemoteMount, sync } from '../../dist/index.js';
import { copySync, data } from '../setup.js';

const { port1: localPort, port2: remotePort } = new MessageChannel();

fs.umount('/');
const tmpfs = await resolveMountConfig({ backend: InMemory, label: 'tmp' });

fs.mount('/', tmpfs);
copySync(data, fs);

await resolveRemoteMount(remotePort, tmpfs);

await configureSingle({ backend: Port, port: localPort });

afterEach(sync);

after(() => {
	localPort.close();
	remotePort.close();
});
