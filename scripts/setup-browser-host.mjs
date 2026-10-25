import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import {readFile, writeFile} from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
// One implementation supplies the app and the extension; no maintained JS copy.
await build({root, configFile: false, publicDir: false, logLevel: 'warn', build: {
  target: 'es2022', outDir: 'browser-extension', emptyOutDir: false,
  lib: {entry: fileURLToPath(new URL('../src/lib/providers/cookieRules.ts', import.meta.url)), formats: ['es'], fileName: () => 'cookieRules.mjs'},
}});
const notices = await Promise.all(['tldts', 'tldts-core'].map(async name => `${name}\n${await readFile(new URL(`../node_modules/${name}/LICENSE`, import.meta.url), 'utf8')}`));
await build({root, configFile:false, publicDir:false, logLevel:'warn', build:{
  target:'es2022', outDir:'browser-extension', emptyOutDir:false,
  lib:{entry:fileURLToPath(new URL('../src/platform/publicNetworkPolicy.ts', import.meta.url)), formats:['es'], fileName:() => 'networkPolicy.mjs'},
}});
notices.push(`ipaddr.js\n${await readFile(new URL('../node_modules/ipaddr.js/LICENSE', import.meta.url), 'utf8')}`);
await writeFile(new URL('../browser-extension/THIRD_PARTY_NOTICES.txt', import.meta.url), notices.join('\n\n'));
