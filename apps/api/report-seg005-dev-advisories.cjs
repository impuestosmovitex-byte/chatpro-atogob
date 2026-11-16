'use strict';
/**
 * Read-only report of the full npm dependency advisory tree, without printing
 * package file paths, source code, tokens or private configuration.
 */
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const lock = JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const manifest = JSON.parse(fs.readFileSync('package.json','utf8'));
const run = (args) => {
  const child = spawnSync('npm', ['audit', '--json', ...args], {
    encoding:'utf8', maxBuffer:16*1024*1024, timeout:90000,
  });
  if(child.error) throw child.error;
  let report;
  try {report=JSON.parse(child.stdout||'');}
  catch {throw new Error('npm audit response could not be parsed');}
  if(!report.metadata?.vulnerabilities || !report.vulnerabilities)
    throw new Error('npm audit data incomplete');
  return report;
};
const full=run([]);
const runtime=run(['--omit=dev']);
const severityOrder={critical:0,high:1,moderate:2,low:3,info:4};
const entries=Object.entries(full.vulnerabilities).map(([name, data])=>{
  const paths=data.nodes||[];
  const nonDevPaths=paths.filter(p=>lock.packages[p] && lock.packages[p].dev!==true);
  const advisories=(Array.isArray(data.via)?data.via:[]).filter(v=>v&&typeof v==='object').map(v=>({
    ghsa:v.name||null,
    severity:v.severity||null,
    range:v.range||null,
    url:/^https:\/\/(github\.com\/advisories\/|github\.com\/.*\/security\/advisories\/|nvd\.nist\.gov\/vuln\/detail\/)/.test(v.url||'')?v.url:null,
  }));
  const packages=paths.map(p=>lock.packages[p]?.version).filter(Boolean);
  const direct=Boolean(manifest.dependencies?.[name]||manifest.devDependencies?.[name]);
  return {
    name, severity:data.severity,
    // Classify based on npm omit-dev rather than solely lockfile dev flags.
    runtimeFlag: Boolean(runtime.vulnerabilities[name]),
    lockNonDev:nonDevPaths.length>0,
    direct,
    installedVersions:[...new Set(packages)].sort(),
    advisoryCount:advisories.length,
    advisories:advisories.slice(0,3),
    viaPackages:(Array.isArray(data.via)?data.via:[]).filter(v=>typeof v==='string').slice(0,5),
    fixAvailable:data.fixAvailable===false?'no':data.fixAvailable===true?'yes':'requires-review',
  };
}).sort((a,b)=>(severityOrder[a.severity]??9)-(severityOrder[b.severity]??9)||a.name.localeCompare(b.name));
console.log('RUNTIME_COUNTS '+JSON.stringify(runtime.metadata.vulnerabilities));
console.log('FULL_COUNTS '+JSON.stringify(full.metadata.vulnerabilities));
console.log('AUDIT_DETAIL '+JSON.stringify(entries));
if(entries.some(x=>x.runtimeFlag)) throw new Error('Some runtime package advisories remain');
console.log('PASS: all remaining advisories are reported as development-only by npm --omit=dev. Assess build supply-chain risk separately.');
