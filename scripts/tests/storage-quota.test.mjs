import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {test} from "node:test";
import ts from "typescript";

const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;
const storageCode = compile("../../src/platform/storage.ts");
const homeCode = compile("../../src/lib/hooks/useHomePageData.ts");

function fixture(limit = Infinity, errorName = "QuotaExceededError") {
  const values = new Map();
  const warnings = [];
  const removals = [];
  let blocked = false;
  let writes = 0;
  const localStorage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      writes++;
      if (blocked) throw new DOMException("Storage denied", "SecurityError");
      const next = new Map(values).set(key, value);
      const size = [...next].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
      if (size > limit) throw new DOMException("Storage quota exhausted", errorName);
      values.set(key, value);
    },
    removeItem(key) { removals.push(key); values.delete(key); },
    clear() { assert.fail("Quota recovery must never clear all user storage"); },
  };
  const module = {exports: {}};
  runInNewContext(storageCode, {
    exports: module.exports, module, localStorage,
    console: {warn: (...args) => warnings.push(args), error() {}},
  });
  return {
    ...module.exports, values, removals, warnings,
    block: () => { blocked = true; },
    setLimit: value => { limit = value; },
    get writes() { return writes; },
    usage: () => [...values].reduce((sum, [k, v]) => sum + k.length + v.length, 0),
  };
}

function seedUserData(f) {
  for (const key of ["tvModeEnabled", "watchHistory", "watchList", "installedProviders", "provider-source-tokens_author", "provider_kv_author_setting"]) {
    f.values.set(key, `${key}:keep`);
  }
  return new Map(f.values);
}

test("reported homepage cache quota error evicts disposable cache and retries without touching user data", () => {
  const f = fixture();
  const userData = seedUserData(f);
  f.cacheStorage.setString("homeDataold", "x".repeat(150));
  f.cacheStorage.setString("heroMeta:old", "old hero");
  const data = JSON.stringify([{title: "Comedy Movies", Posts: [{title: "A movie"}]}]);
  f.setLimit(f.usage() + "cache_homeDatakartoons".length + data.length - 1);
  const before = f.writes;
  assert.doesNotThrow(() => f.cacheStorage.setString("homeDatakartoons", data));
  assert.equal(f.cacheStorage.getString("homeDatakartoons"), data);
  assert.equal(f.writes - before, 2, "one initial write and one bounded retry");
  for (const [key, value] of userData) assert.equal(f.values.get(key), value);
  assert.ok(f.removals.every(key => key.startsWith("cache_")));
  assert.equal(f.warnings.length, 0);
});

test("an entry larger than the quota becomes a cache miss instead of an uncaught exception", () => {
  const f = fixture();
  const userData = seedUserData(f);
  f.setLimit(f.usage() + 30);
  assert.doesNotThrow(() => f.cacheStorage.setString("homeDatakartoons", "x".repeat(1000)));
  assert.equal(f.cacheStorage.getString("homeDatakartoons"), undefined);
  assert.doesNotThrow(() => f.cacheStorage.setString("another", "x".repeat(1000)));
  assert.equal(f.warnings.length, 1, "avoid flooding logs with repeated cache failures");
  assert.deepEqual(f.values, userData);
});

test("durable writes reclaim cache space, but a real user-data save failure remains visible", () => {
  const f = fixture();
  f.mainStorage.setString("watchHistory", "saved history");
  f.cacheStorage.setString("old", "x".repeat(150));
  f.setLimit(f.usage());
  f.mainStorage.setObject("preferences", {tvMode: false});
  assert.equal(f.mainStorage.getObject("preferences").tvMode, false);
  assert.equal(f.mainStorage.getString("watchHistory"), "saved history");
  const before = new Map(f.values);
  assert.throws(() => f.mainStorage.setString("watchHistory", "x".repeat(1000)), {name: "QuotaExceededError"});
  assert.deepEqual(f.values, before, "failed replacement must preserve existing user data");
});

test("all typed cache setters share quota recovery", () => {
  const f = fixture(0);
  for (const write of [
    () => f.cacheStorage.setBool("boolean", true),
    () => f.cacheStorage.setNumber("number", 123),
    () => f.cacheStorage.setObject("object", {value: 1}),
    () => f.cacheStorage.setArray("array", [1, 2]),
  ]) assert.doesNotThrow(write);
  assert.equal(f.values.size, 0);
});

test("unrelated storage errors do not delete caches or hide failed user-data writes", () => {
  const f = fixture();
  f.cacheStorage.setString("old", "still here");
  f.block();
  assert.doesNotThrow(() => f.cacheStorage.setString("optional", "not persisted"));
  assert.equal(f.removals.length, 0);
  assert.equal(f.cacheStorage.getString("old"), "still here");
  assert.throws(() => f.mainStorage.setBool("setting", true), {name: "SecurityError"});
});

test("ordinary writes keep existing cache entries", () => {
  const f = fixture();
  f.cacheStorage.setString("old", "keep");
  f.mainStorage.setNumber("volume", 70);
  f.cacheStorage.setArray("new", ["one", "two"]);
  assert.equal(f.cacheStorage.getString("old"), "keep");
  assert.equal(f.mainStorage.getNumber("volume"), 70);
  assert.deepEqual(Array.from(f.cacheStorage.getArray("new")), ["one", "two"]);
  assert.equal(f.removals.length, 0);
});

test("homepage effect still returns fetched posts when browser storage has no capacity", () => {
  const f = fixture(0);
  const query = {data: [{title: "Latest Shows", Posts: [{title: "A show", link: "show"}]}]};
  const effects = [];
  const module = {exports: {}};
  runInNewContext(homeCode, {
    module, exports: module.exports,
    require(name) {
      if (name === "react") return {useEffect: fn => effects.push(fn)};
      if (name === "@tanstack/react-query") return {useQuery: () => query};
      if (name === "../getHomepagedata") return {};
      if (name === "../storage") return {cacheStorage: f.cacheStorage};
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  const result = module.exports.useHomePageData({provider: {value: "kartoons"}});
  assert.doesNotThrow(() => effects.forEach(effect => effect()));
  assert.equal(result, query);
  assert.equal(result.data[0].Posts[0].title, "A show");
});
