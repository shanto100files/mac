import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../../src/lib/homeBackdrop.ts", import.meta.url), "utf8");
const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}});
const module = {exports: {}};
new Function("exports", "module", outputText)(module.exports, module);
const {paintHomeBackdrop} = module.exports;
function fixture() {const draws = []; const context = {filter: "none", drawImage: (...args) => draws.push(args)}; const canvas = {width: 0, height: 0, getContext: () => context}; return {canvas, context, draws};}
test("large hero backgrounds use a bounded bitmap with scaled blur", () => {
 const {canvas, context, draws} = fixture(); const image = {naturalWidth: 2000, naturalHeight: 3000};
 assert.equal(paintHomeBackdrop(canvas, image, 2560, 1440), true);
 assert.deepEqual([canvas.width, canvas.height], [320, 180]);
 assert.equal(context.filter, "blur(3.5px) brightness(0.7)");
 assert.equal(draws.length, 1);
 const [,x,y,width,height] = draws[0];
 assert.equal(x, 0); assert.equal(y, -150); assert.equal(width, 320); assert.equal(height, 480);
});
test("wide images cover the canvas with the same centered crop as the hero", () => {
 const {canvas, draws} = fixture(); const image = {naturalWidth: 1920, naturalHeight: 1080};
 paintHomeBackdrop(canvas, image, 1000, 1000);
 const [,x,y,width,height] = draws[0];
 assert.equal(canvas.height, 320); assert.equal(y, 0); assert.equal(height, 320); assert.ok(x < 0); assert.ok(width > 320);
});
test("small windows do not allocate an upscaled bitmap", () => {
 const {canvas} = fixture(); paintHomeBackdrop(canvas, {naturalWidth: 100, naturalHeight: 200}, 200, 100);
 assert.deepEqual([canvas.width, canvas.height], [200, 100]);
});
test("predecoded bitmaps retain the centered cover crop", () => {
 const {canvas, draws} = fixture(); const bitmap = {width: 160, height: 240};
 assert.equal(paintHomeBackdrop(canvas, bitmap, 1000, 500), true);
 assert.deepEqual([canvas.width, canvas.height], [320, 160]);
 assert.deepEqual(draws[0], [bitmap, 0, -160, 320, 480]);
});
test("unloaded images, missing contexts and zero-sized layouts do not draw", () => {
 const {canvas, draws} = fixture();
 assert.equal(paintHomeBackdrop(canvas, {naturalWidth: 0, naturalHeight: 0}, 1000, 500), false);
 assert.equal(paintHomeBackdrop(canvas, {naturalWidth: 100, naturalHeight: 200}, 0, 500), false);
 assert.equal(paintHomeBackdrop({...canvas, getContext: () => null}, {naturalWidth: 100, naturalHeight: 200}, 1000, 500), false);
 assert.equal(draws.length, 0);
});
