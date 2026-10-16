import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../src/lib/", import.meta.url));
function fixture() {
  const values = new Map();
  const storage = {
    getArray: (key) => structuredClone(values.get(key)),
    setArray: (key, value) => values.set(key, structuredClone(value)),
    getBool: (key) => values.get(key) || false,
    setBool: (key, value) => values.set(key, value),
    getString: (key) => values.get(key),
    setString: (key, value) => values.set(key, value),
    delete: (key) => values.delete(key),
  };
  const cache = new Map();
  const mocks = new Map([
    [resolve(root, "storage/StorageService.ts"), { mainStorage: storage }],
  ]);
  function load(filename) {
    if (mocks.has(filename)) return mocks.get(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    });
    const execute = runInThisContext(
      `(function(require,module,exports){\n${outputText}\n})`,
      { filename },
    );
    execute(
      (specifier) => {
        if (!specifier.startsWith(".")) return require(specifier);
        const target = resolve(dirname(filename), specifier);
        return load(
          existsSync(`${target}.ts`)
            ? `${target}.ts`
            : resolve(target, "index.ts"),
        );
      },
      module,
      module.exports,
    );
    return module.exports;
  }
  const { watchListStorage } = load(
    resolve(root, "storage/WatchListStorage.ts"),
  );
  mocks.set(resolve(root, "storage/index.ts"), {
    mainStorage: storage,
    watchListStorage,
  });
  return {
    providerOverrides: load(resolve(root, "zustand/metadataOverrideStore.ts")),
    providerEpisodes: load(resolve(root, "providerEpisodeMetadata.ts")),
    metadata: load(resolve(root, "localContent/metadata.ts")),
    model: load(resolve(root, "localContent/model.ts")),
    library: load(resolve(root, "localContent/library.ts")),
    local: load(resolve(root, "zustand/localContentStore.ts")).default,
    watchlist: load(resolve(root, "zustand/watchListStore.ts")).default,
    values,
  };
}
const file = (uri, name) => ({ uri, name, directory: false });
const dir = (uri, name) => ({ uri, name, directory: true });
const tree = {
  root: [
    dir("series", "Series"),
    dir("movie", "Movie"),
    file("loose", "Loose.mp4"),
  ],
  series: [dir("season", "Season 01"), file("pilot", "Pilot.mp4")],
  season: [
    file("ep10", "Show.S01E10.mkv"),
    file("ep2", "Show.S01E02.mkv"),
    file("sub", "Show.srt"),
  ],
  movie: [file("moviefile", "Movie.2024.1080p.mkv")],
};
const list = async (uri) => tree[uri] || [];
const localTitle = {
  id: "C:\\Media\\Show",
  rootUri: "C:\\Media",
  folderUri: "C:\\Media\\Show",
  name: "Show",
  episodes: [
    {
      uri: "C:\\Media\\Show\\S01E02.mkv",
      name: "S01E02.mkv",
      folder: "Season 01",
      season: 1,
      episode: 2,
    },
  ],
  useMetadataTitles: true,
  collections: ["watchlist"],
  inLibrary: true,
  metadata: {
    imdbId: "tt123",
    type: "series",
    title: "Matched show",
    videos: [{ season: 1, episode: 2, title: "Second episode" }],
  },
};

test("bulk import separates series, movies and root videos without duplicates", async () => {
  const { model } = fixture();
  const titles = await model.prepareLocalImport(
    { uri: "root", name: "Media" },
    true,
    list,
    [],
  );
  assert.equal(titles.length, 3);
  assert.deepEqual(
    titles[0].episodes.map((item) => item.uri),
    ["loose"],
  );
  assert.equal(titles[0].rootFilesOnly, true);
  const show = titles.find((item) => item.folderUri === "series");
  assert.deepEqual(
    show.episodes.map((item) => [item.uri, item.folder]),
    [
      ["pilot", "Default"],
      ["ep2", "Season 01"],
      ["ep10", "Season 01"],
    ],
  );
});
test("single series recursively includes its seasons in one title", async () => {
  const { model } = fixture();
  const titles = await model.prepareLocalImport(
    { uri: "series", name: "Show" },
    false,
    list,
    [],
  );
  assert.equal(titles.length, 1);
  assert.equal(titles[0].episodes.length, 3);
  assert.deepEqual(model.parseEpisodeName("Movie.2024.1080p.mkv"), {
    season: undefined,
    episode: undefined,
  });
});
test("episode names match season and episode; unmatched files retain filenames", () => {
  const { model } = fixture();
  const episode = localTitle.episodes[0];
  assert.equal(
    model.getEpisodeLabel(episode, localTitle),
    "S1 E2 · Second episode",
  );
  assert.equal(
    model.getEpisodeLabel({ ...episode, episode: 3 }, localTitle),
    episode.name,
  );
  assert.equal(
    model.getEpisodeLabel(episode, { ...localTitle, useMetadataTitles: false }),
    episode.name,
  );
  assert.equal(
    model.getEpisodeLabel(episode, {
      ...localTitle,
      metadata: { ...localTitle.metadata, type: "movie" },
    }),
    "Movie",
  );
});
test("reimport preserves metadata, categories and naming preference", async () => {
  const { model } = fixture();
  const previous = {
    ...localTitle,
    folderUri: "series",
    useMetadataTitles: false,
  };
  const [imported] = await model.prepareLocalImport(
    { uri: "series", name: "Show" },
    false,
    list,
    [previous],
  );
  assert.deepEqual(imported.metadata, previous.metadata);
  assert.deepEqual(imported.collections, previous.collections);
  assert.equal(imported.useMetadataTitles, false);
});
test("cancelled and inaccessible scans reject without producing partial imports", async () => {
  const { model } = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    model.scanEpisodes("root", list, controller.signal),
    /cancelled/i,
  );
  await assert.rejects(
    model.prepareLocalImport(
      { uri: "root", name: "Media" },
      true,
      async (uri) => {
        if (uri === "season") throw new Error("Permission denied");
        return list(uri);
      },
      [],
    ),
    /Permission denied/,
  );
});
test("local Library changes persist separately without changing the synced watchlist", () => {
  const { local, watchlist, library, values } = fixture();
  const remote = {
    title: "Remote",
    link: "https://provider/movie",
    poster: "",
    provider: "provider",
  };
  watchlist.getState().addItem(remote);
  const synced = structuredClone(values.get("watchlist"));
  local.getState().saveTitles([localTitle]);
  watchlist
    .getState()
    .setItemCollections(library.localLibraryItem(localTitle), ["movies"]);
  assert.deepEqual(local.getState().titles[0].collections, ["movies"]);
  assert.deepEqual(values.get("watchlist"), synced);
  assert.deepEqual(watchlist.getState().watchList, synced);
  assert.equal(values.get("device-local-content-v1")[0].id, localTitle.id);
  watchlist.getState().removeItem(library.localContentLink(localTitle.id));
  assert.equal(local.getState().titles[0].inLibrary, false);
  assert.equal(local.getState().titles[0].episodes.length, 1);
  assert.deepEqual(values.get("watchlist"), synced);
});
test("category removal hides local titles only when no categories remain", () => {
  const { local, watchlist, library } = fixture();
  const other = watchlist
    .getState()
    .createCollection({ name: "Movies", icon: "movie", color: "#ff0000" });
  local
    .getState()
    .saveTitles([{ ...localTitle, collections: ["watchlist", other.id] }]);
  const link = library.localContentLink(localTitle.id);
  watchlist.getState().removeFromCollection([link], "watchlist");
  assert.deepEqual(local.getState().titles[0].collections, [other.id]);
  assert.equal(local.getState().titles[0].inLibrary, true);
  watchlist.getState().removeFromCollection([link], other.id);
  assert.equal(local.getState().titles[0].inLibrary, false);
});
test("local links preserve spaces, percent signs, Unicode and Windows separators", () => {
  const { library } = fixture();
  const path = "C:\\Media\\100% Movie\\日本語";
  assert.equal(library.localContentId(library.localContentLink(path)), path);
  assert.equal(library.localContentId("https://provider/movie"), undefined);
});


test("Cinemeta episode names become local episode labels", async () => {
  const axios = require("axios");
  const originalGet = axios.get;
  axios.get = async () => ({data: {meta: {name: "Mr. Robot", videos: [
    {season: 1, episode: 1, name: "eps1.0_hellofriend.mov", thumbnail: "https://episodes/1.jpg", overview: "Full description"},
    {season: 1, episode: 2, title: "Preferred title", name: "Fallback name"},
  ]}}});
  try {
    const {metadata, model} = fixture();
    const result = await metadata.fetchLocalMetadata("tt4158110", "series");
    assert.equal(result.videos[0].title, "eps1.0_hellofriend.mov");
    assert.equal(result.videos[0].thumbnail, "https://episodes/1.jpg");
    assert.equal(result.videos[0].overview, "Full description");
    assert.equal(result.videos[1].title, "Preferred title");
    const episode = {uri: "file:///episode.mkv", name: "Mr.Robot.S01E01.mkv", folder: "Season 1", season: 1, episode: 1};
    assert.equal(model.getEpisodeLabel(episode, {metadata: result, useMetadataTitles: true}), "S1 E1 · eps1.0_hellofriend.mov");
    assert.equal(model.getEpisodeLabel(episode, {metadata: result, useMetadataTitles: false}), episode.name);
  } finally {
    axios.get = originalGet;
  }
});


test("provider episode metadata matches season labels and filename formats without changing playback links", () => {
  const {providerEpisodes} = fixture();
  const metadata = {imdbId: "tt123", title: "Show", type: "series", useEpisodeMetadata: true, videos: [{season: 2, episode: 3, title: "Matched episode", overview: "Full description", thumbnail: "https://episode.jpg"}]};
  for (const [title, season] of [["Episode 03", "Season 2"], ["Ep03", "S02"], ["S02E03", "Season 2"], ["Show.2x03.1080p.mkv", "Season 2"], ["3", "Season 2"], ["03 - Episode", "2"], ["Show.S02E03.mkv", "Episodes"], ["Show.S02E03.1080p.mkv", "Season 2"]]) {
    const episode = {title, link: "https://provider/episode", id: "unchanged", quickDownload: true};
    assert.deepEqual(providerEpisodes.applyProviderEpisodeMetadata(episode, season, metadata), {...episode, title: "S2 E3 · Matched episode", description: "Full description", image: "https://episode.jpg"});
  }
  for (const [title, season] of [["Episode 04", "Season 2"], ["Episode 03", "Unknown"], ["S01E03", "Season 2"], ["Trailer", "Season 2"], ["Episode 3.5", "Season 2"], ["1080p", "Season 2"]]) {
    const episode = {title, link: "https://provider/episode"};
    assert.equal(providerEpisodes.applyProviderEpisodeMetadata(episode, season, metadata), episode);
  }
  const episode = {title: "Episode 3", link: "https://provider/episode"};
  assert.equal(providerEpisodes.applyProviderEpisodeMetadata(episode, "Season 2", {...metadata, useEpisodeMetadata: false}), episode);
  assert.equal(providerEpisodes.applyProviderEpisodeMetadata(episode, "Season 2", {...metadata, type: "movie"}), episode);
});

test("provider matches persist per provider and title and preserve playback information", () => {
  const {providerOverrides, values} = fixture();
  const {default: store, metadataOverrideKey, applyMetadataOverride} = providerOverrides;
  const metadata = {imdbId: "tt123", title: "Matched", type: "series", poster: "https://poster", useEpisodeMetadata: true};
  store.getState().setMetadata("provider", "link", metadata);
  const key = metadataOverrideKey("provider", "link");
  assert.deepEqual(JSON.parse(values.get("provider-metadata-overrides-v1"))[key], metadata);
  assert.equal(store.getState().overrides[metadataOverrideKey("other", "link")], undefined);
  const info = {title: "Provider title", image: "original", synopsis: "Synopsis", type: "series", quickDownload: true, populateMeta: false, linkList: [{title: "Season 1", episodesLink: "https://episodes"}]};
  const merged = applyMetadataOverride(info, metadata);
  assert.equal(merged.title, "Matched");
  assert.equal(merged.linkList, info.linkList);
  assert.equal(merged.quickDownload, true);
  assert.equal(info.title, "Provider title");
  store.getState().setMetadata("provider", "link", {...metadata, useEpisodeMetadata: false});
  assert.equal(store.getState().overrides[key].useEpisodeMetadata, false);
  store.getState().setMetadata("provider", "link");
  assert.deepEqual(store.getState().overrides, {});
  assert.equal(applyMetadataOverride(info), info);
});
