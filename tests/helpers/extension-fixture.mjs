import {cpSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from '@playwright/test';

// Test-only copy. Production never exempts localhost/private destinations.
// Allow exactly the ephemeral fixture servers; all other URLs use the real guard.
export function fixtureExtension(testInfo, origins) {
  const root = fileURLToPath(new URL('../../browser-extension', import.meta.url));
  const target = testInfo.outputPath('fixture-extension');
  cpSync(root, target, {recursive:true});
  const guard = path.join(target, 'network-guard.mjs');
  writeFileSync(path.join(target, 'network-guard.real.mjs'), readFileSync(guard));
  writeFileSync(guard, `import {assertPublicDestination as check} from './network-guard.real.mjs';
    const fixtureOrigins=new Set(${JSON.stringify(origins)});
    export async function assertPublicDestination(value,signal){
      const url=new URL(value);if(fixtureOrigins.has(url.origin))return url.href;
      return check(value,signal);
    }`);
  return target;
}

// Provision an isolated already-approved profile using the pre-0.5 manifest,
// then upgrade the same extension to optional hosts. Chrome retains that grant.
// This tests real Chrome permission state without automating a security prompt.
export async function approvedFixtureContext(testInfo, extension, profileName='profile') {
  const manifestPath=path.join(extension,'manifest.json');
  const current=JSON.parse(readFileSync(manifestPath,'utf8'));
  const legacy={...current,version:'0.4.1',host_permissions:['http://*/*','https://*/*']};
  delete legacy.optional_host_permissions;
  const launch=()=>chromium.launchPersistentContext(testInfo.outputPath(profileName),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let provision;
  try {
    writeFileSync(manifestPath,JSON.stringify(legacy));
    provision=await launch();
    const worker=provision.serviceWorkers()[0]||await provision.waitForEvent('serviceworker');
    if(!await worker.evaluate(()=>chrome.permissions.contains({origins:['http://*/*','https://*/*']})))throw new Error('Approved fixture could not be provisioned');
  } finally {if(provision)await provision.close();writeFileSync(manifestPath,JSON.stringify(current));}
  return launch();
}
