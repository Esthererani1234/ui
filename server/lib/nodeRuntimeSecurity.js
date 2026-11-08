// October 21, 2026 Node.js security release, including CVE-2026-111497.
// Keep server-only. A version result is patch evidence, not a compromise verdict.
export const NODE_SECURITY_RELEASE = '2026-10-21';
const minimums = {22: [23, 4], 24: [22, 1], 26: [12, 1]};

export function nodeRuntimeSecurity(version = process.version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  const [major, minor, patch] = match ? match.slice(1).map(Number) : [];
  const minimum = minimums[major];
  const patched = Boolean(minimum && (minor > minimum[0] || (minor === minimum[0] && patch >= minimum[1])));
  return {
    nodeVersion: match ? `${major}.${minor}.${patch}` : 'unrecognized',
    advisory: NODE_SECURITY_RELEASE,
    patched,
    projectRuntimeSupported: major === 24 && patched,
  };
}

export function createRuntimeReporter(logger = console, version = process.version) {
  let reported = false;
  return () => {
    if (reported) return;
    reported = true;
    const status = nodeRuntimeSecurity(version);
    // No request data, environment variables, identifiers or credentials.
    const message = `node_runtime_security ${JSON.stringify(status)}`;
    if (status.projectRuntimeSupported) logger.info(message);
    else logger.error(message);
  };
}

export const reportRuntimeSecurityOnce = createRuntimeReporter();
