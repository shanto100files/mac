import test from 'node:test';
import assert from 'node:assert/strict';
import {ALL_WEBSITE_ORIGINS,hasAllWebsiteAccess,requireWebsiteAccess} from '../browser-extension/access.mjs';

test('all-website access is checked against Chrome grants and never requested implicitly',async()=>{
  let granted=false,requests=0;
  globalThis.chrome={permissions:{contains:async options=>{assert.deepEqual(options.origins,['http://*/*','https://*/*']);return granted;},request:()=>{requests++;}}};
  assert.deepEqual(ALL_WEBSITE_ORIGINS,['http://*/*','https://*/*']);
  assert.equal(await hasAllWebsiteAccess(),false);
  await assert.rejects(requireWebsiteAccess(), /Allow all websites/);
  granted=true;await requireWebsiteAccess();assert.equal(await hasAllWebsiteAccess(),true);
  granted=false;await assert.rejects(requireWebsiteAccess(), /Website access is required/);
  assert.equal(requests,0);
});
