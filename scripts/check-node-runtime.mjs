import {nodeRuntimeSecurity} from '../server/lib/nodeRuntimeSecurity.js';

const status = nodeRuntimeSecurity();
if (!status.projectRuntimeSupported) {
  console.error(`Unsupported Node.js ${status.nodeVersion}. Use Node.js >=24.22.1 <25, then retry. See the October 21, 2026 Node.js security release.`);
  process.exitCode = 1;
} else {
  console.info(`Node.js ${status.nodeVersion}: required October 2026 security patches present.`);
}
