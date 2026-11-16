'use strict';
/** Read-only npm advisory report: never runs npm audit fix. */
const { spawnSync } = require('node:child_process');
function audit(label, args) {
  const result = spawnSync('npm', ['audit', '--json', ...args], {
    encoding: 'utf8', timeout: 90000, maxBuffer: 15 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  let report;
  try { report = JSON.parse(result.stdout || ''); }
  catch { throw new Error('Cannot parse npm audit response for ' + label); }
  if (!report.metadata || !report.vulnerabilities) {
    throw new Error('npm audit did not return package advisories for ' + label);
  }
  const summary = report.metadata.vulnerabilities;
  const affected = Object.entries(report.vulnerabilities)
    .map(([pkg, data]) => ({
      package: pkg,
      severity: data.severity,
      direct: Boolean(data.isDirect),
      fix: data.fixAvailable === false ? 'not indicated' :
        data.fixAvailable === true ? 'available' : 'requires review',
    }))
    .filter(x => x.severity === 'critical' || x.severity === 'high')
    .sort((a, b) => (a.severity === b.severity ? a.package.localeCompare(b.package) : a.severity === 'critical' ? -1 : 1));
  console.log(label + ' counts ' + JSON.stringify(summary));
  console.log(label + ' critical/high packages ' + JSON.stringify(affected.slice(0, 40)));
  console.log(label + ' affected package count: ' + Object.keys(report.vulnerabilities).length);
  return summary;
}
audit('production-deps-only', ['--omit=dev']);
audit('all-deps-build-included', []);
console.log('READ-ONLY: no fixes, installs, deployments or secret reads');
