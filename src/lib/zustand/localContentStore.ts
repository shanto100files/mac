import { create } from "zustand";
import { mainStorage } from "../storage";
import type { LocalTitle } from "../localContent/model";
import {createLocalPlayback} from '../localContent/playback';

// This index belongs to this installation. Sync and settings exports only read
// the remote watchlist; local paths and their metadata stay out of both.
const KEY = "device-local-content-v1";
interface LocalContentState {
  titles: LocalTitle[];
  savePlayback: (id: string, uri: string, position: number, duration: number) => void;
  clearPlayback: (id: string) => void;
  saveTitles: (titles: LocalTitle[]) => void;
  setCollections: (id: string, collections: string[]) => void;
  hideFromLibrary: (id: string) => void;
}
const useLocalContentStore = create<LocalContentState>()((set) => ({
  titles: mainStorage.getArray<LocalTitle>(KEY) || [],
  savePlayback: (id, uri, position, duration) => set(state => ({
    titles: state.titles.map(title => {
      if (title.id !== id) return title;
      const playback = createLocalPlayback(title, uri, position, duration);
      return playback ? {...title, playback, continueWatchingHidden: false} : title;
    }),
  })),
  clearPlayback: id => set(state => ({titles: state.titles.map(title => title.id === id ? {...title, playback: undefined, continueWatchingHidden: true} : title)})),
  saveTitles: (titles) =>
    set((state) => ({
      titles: [
        ...state.titles.filter(
          (old) => !titles.some((title) => title.id === old.id),
        ),
        ...titles.map(title => ({...title, playback: title.playback ?? state.titles.find(item => item.id === title.id)?.playback, continueWatchingHidden: title.continueWatchingHidden ?? state.titles.find(item => item.id === title.id)?.continueWatchingHidden})),
      ],
    })),
  setCollections: (id, collections) =>
    set((state) => ({
      titles: state.titles.map((title) =>
        title.id === id
          ? {
              ...title,
              collections: [...new Set(collections)],
              inLibrary: collections.length > 0,
            }
          : title,
      ),
    })),
  hideFromLibrary: (id) =>
    set((state) => ({
      titles: state.titles.map((title) =>
        title.id === id ? { ...title, inLibrary: false } : title,
      ),
    })),
}));
useLocalContentStore.subscribe((state) =>
  mainStorage.setArray(KEY, state.titles),
);
export default useLocalContentStore;
