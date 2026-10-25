import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../../src/lib/cardArtwork.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS}});
const module = {exports:{}};
new Function('exports','module',outputText)(module.exports,module);
const {cardArtwork} = module.exports;

test('TMDB card thumbnails offer screen-density variants without requesting the original', () => {
  for (const size of ['original','w500']) {
    const result = cardArtwork(`https://image.tmdb.org/t/p/${size}/poster.jpg`);
    assert.equal(result.src,'https://image.tmdb.org/t/p/w342/poster.jpg');
    assert.match(result.srcSet,/\/w780\/poster\.jpg 780w/);
    assert.doesNotMatch(result.srcSet,/original/);
  }
});
test('external, signed, local and vector artwork URLs keep their exact source', () => {
  for (const url of ['https://poster.example/p.jpg','https://image.tmdb.org.evil.example/t/p/original/p.jpg',
    'https://image.tmdb.org/t/p/original/p.jpg?signature=preserved','asset://localhost/poster.png',
    'blob:https://vega.example/poster','https://image.tmdb.org/t/p/original/logo.svg']) {
    assert.deepEqual(cardArtwork(url),{src:url});
  }
});
