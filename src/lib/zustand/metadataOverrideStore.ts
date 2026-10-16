import { create } from "zustand";
import { mainStorage } from "../storage";
import type { LocalMetadata } from "../localContent/model";
import type { Info } from "../providers/types";
export interface ProviderMetadata extends LocalMetadata {
  useEpisodeMetadata?: boolean;
}
export const metadataOverrideKey = (provider: string, link: string) =>
  JSON.stringify([provider, link]);
export const applyMetadataOverride = (
  info: Info,
  metadata?: ProviderMetadata,
): Info =>
  metadata
    ? {
        ...info,
        title: metadata.title,
        imdbId: metadata.imdbId,
        image: metadata.background || metadata.poster || info.image,
        poster: metadata.poster || info.poster,
        logo: metadata.logo,
        synopsis: metadata.description || info.synopsis,
        rating: metadata.rating || info.rating,
        tmdbId: undefined,
      }
    : info;
const KEY = "provider-metadata-overrides-v1";
interface State {
  overrides: Record<string, ProviderMetadata>;
  setMetadata: (
    provider: string,
    link: string,
    metadata?: ProviderMetadata,
  ) => void;
}
function readOverrides(): State["overrides"] {
  try {
    return JSON.parse(mainStorage.getString(KEY) || "{}");
  } catch {
    return {};
  }
}
const useMetadataOverrideStore = create<State>()((set) => ({
  overrides: readOverrides(),
  setMetadata: (provider, link, metadata) =>
    set((state) => {
      const overrides = { ...state.overrides };
      const key = metadataOverrideKey(provider, link);
      if (metadata) overrides[key] = metadata;
      else delete overrides[key];
      return { overrides };
    }),
}));
useMetadataOverrideStore.subscribe((state) =>
  mainStorage.setString(KEY, JSON.stringify(state.overrides)),
);
export default useMetadataOverrideStore;
