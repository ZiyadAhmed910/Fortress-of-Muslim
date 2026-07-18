import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageRoot = new URL('../', import.meta.url);
const repositoryRoot = new URL('../../', packageRoot);
const supportedPortals = ['developers', 'status', 'admin'];
const requestedPortal = process.argv[2];
if (requestedPortal && !supportedPortals.includes(requestedPortal)) {
  throw new Error(`Unknown portal: ${requestedPortal}`);
}
const portals = requestedPortal ? [requestedPortal] : supportedPortals;

for (const portal of portals) {
  const appRoot = new URL(`apps/${portal}/`, repositoryRoot);
  const output = new URL('dist/', appRoot);
  await rm(output, { recursive: true, force: true });
  await mkdir(new URL('assets/', output), { recursive: true });
  await cp(new URL('public/', appRoot), output, { recursive: true });
  await cp(new URL('assets/', packageRoot), new URL('assets/', output), { recursive: true });
  if (portal === 'developers') {
    await cp(new URL('apps/api/openapi.yaml', repositoryRoot), new URL('openapi.yaml', output));
  }
  console.log(`Built ${portal}: ${fileURLToPath(output)}`);
}
