import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LuArrowLeft,
  LuCircle,
  LuCircleCheck,
  LuFolderOpen,
  LuFolders,
  LuLoaderCircle,
  LuSearch,
  LuX,
} from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { FocusableInput } from "../layout/FocusableInput";
import { Switch } from "../ui/switch";
import { LibraryIcon } from "./LibraryIcon";
import { useDialogFocusBoundary } from "../../lib/hooks/useDialogFocusBoundary";
import useLocalContentStore from "../../lib/zustand/localContentStore";
import useWatchListStore from "../../lib/zustand/watchListStore";
import { DEFAULT_COLLECTION_ID } from "../../lib/storage/WatchListStorage";
import { pickLocalFolder, listLocalFolder } from "../../lib/localContent/files";
import {
  cleanFolderQuery,
  prepareLocalImport,
  type LocalTitle,
  type LocalMetadata,
} from "../../lib/localContent/model";
import { fetchLocalMetadata } from "../../lib/localContent/metadata";
import {
  fetchIMDbSuggestions,
  type IMDbSuggestion,
} from "../../lib/services/imdbSuggestions";
import "./LibraryCollectionDialog.css";
import "./LocalContentDialog.css";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: LocalTitle;
  collectionId?: string;
  themeStyle?: CSSProperties;
}

function MetadataPicker({
  title,
  onChoose,
  onBack,
}: {
  title: LocalTitle;
  onChoose: (meta: LocalMetadata) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<"search" | "id">("search");
  const [query, setQuery] = useState(cleanFolderQuery(title.name));
  const [id, setId] = useState(title.metadata?.imdbId || "");
  const [type, setType] = useState<"movie" | "series">(
    title.metadata?.type ||
      (title.episodes.length === 1 && title.episodes[0].episode === undefined
        ? "movie"
        : "series"),
  );
  const [results, setResults] = useState<IMDbSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]);
    if (mode !== "search" || query.trim().length < 3) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void fetchIMDbSuggestions(query, controller.signal).then((items) => {
        if (!controller.signal.aborted) {
          setResults(items.filter((item) => item.imdbId));
          setSearching(false);
        }
      });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, query]);
  const choose = async (imdbId: string, kind: "movie" | "series") => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const metadata = await fetchLocalMetadata(
        imdbId.trim(),
        kind,
        controller.signal,
      );
      if (!controller.signal.aborted) onChoose(metadata);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <>
      <div
        className="local-picker-tabs"
        role="tablist"
        aria-label="Metadata lookup"
      >
        {(["search", "id"] as const).map((value) => (
          <FocusableButton
            key={value}
            role="tab"
            aria-selected={mode === value}
            className={`library-icon-tab ${mode === value ? "selected" : ""}`}
            onClick={() => {
              setMode(value);
              setError("");
            }}
          >
            {value === "search" ? "Search titles" : "IMDb ID"}
          </FocusableButton>
        ))}
      </div>
      <div className="local-import-body">
        {mode === "search" ? (
          <>
            <FocusableInput
              wrapperClassName="extension-dialog-input"
              startIcon={<LuSearch size={18} />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search movie or series"
              aria-label="Search movie or series"
              disabled={busy}
              autoFocus
            />
            {searching && (
              <p className="local-content-status">
                <LuLoaderCircle className="spin" /> Searching…
              </p>
            )}
            <div className="local-metadata-results">
              {results.map((item) => (
                <FocusableButton
                  key={item.imdbId}
                  className="local-metadata-result"
                  disabled={busy}
                  onClick={() =>
                    void choose(
                      item.imdbId!,
                      item.type === "tv" ? "series" : "movie",
                    )
                  }
                >
                  {item.poster ? (
                    <img src={item.poster} alt="" />
                  ) : (
                    <span className="local-result-poster" />
                  )}
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {[
                        item.year,
                        item.type === "tv" ? "Series" : "Movie",
                        item.imdbId,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                </FocusableButton>
              ))}
              {!searching && !results.length && (
                <p className="local-content-hint">
                  Search by title, or switch to IMDb ID.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="local-import-fields">
            <label htmlFor="local-imdb-id">IMDb ID</label>
            <FocusableInput
              id="local-imdb-id"
              wrapperClassName="extension-dialog-input"
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="tt0944947"
              disabled={busy}
            />
            <div
              className="local-picker-tabs"
              role="group"
              aria-label="Content type"
            >
              {(["movie", "series"] as const).map((value) => (
                <FocusableButton
                  key={value}
                  className={`library-icon-tab ${type === value ? "selected" : ""}`}
                  aria-pressed={type === value}
                  onClick={() => setType(value)}
                  disabled={busy}
                >
                  {value === "movie" ? "Movie" : "Series"}
                </FocusableButton>
              ))}
            </div>
            <FocusableButton
              className="dialog-primary-button"
              disabled={busy || !id.trim()}
              onClick={() => void choose(id, type)}
            >
              Use IMDb ID
            </FocusableButton>
          </div>
        )}
        {busy && (
          <p className="local-content-status">
            <LuLoaderCircle className="spin" /> Fetching metadata…
          </p>
        )}
        {error && (
          <p role="alert" className="local-content-error">
            {error}. You can go back and use the folder name.
          </p>
        )}
      </div>
      <div className="extensions-dialog-actions">
        <FocusableButton className="dialog-text-button" onClick={onBack}>
          <LuArrowLeft /> Back
        </FocusableButton>
      </div>
    </>
  );
}

export function LocalContentDialog({
  open,
  onOpenChange,
  title,
  collectionId,
  themeStyle,
}: Props) {
  const collections = useWatchListStore((state) => state.collections);
  const [review, setReview] = useState<LocalTitle[]>([]);
  const [index, setIndex] = useState(0);
  const [bulk, setBulk] = useState(false);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const task = useRef<AbortController | null>(null);
  const accepted = useRef<LocalTitle[]>([]);
  const { ref, DialogFocusProvider } = useDialogFocusBoundary({
    isOpen: open,
    focusKey: "LOCAL_IMPORT_DIALOG",
  });
  useEffect(() => {
    if (!open) {
      task.current?.abort();
      return;
    }
    setReview(title ? [title] : []);
    setIndex(0);
    setBulk(false);
    setPicker(false);
    setBusy("");
    setError("");
    accepted.current = [];
  }, [open, title?.id]);
  useEffect(() => () => task.current?.abort(), []);
  const close = () => {
    task.current?.abort();
    onOpenChange(false);
  };
  const scan = async (bulk: boolean) => {
    if (task.current) return;
    const controller = new AbortController();
    task.current = controller;
    setBusy("Choose a folder");
    setError("");
    try {
      const root = await pickLocalFolder();
      if (!root || controller.signal.aborted) return;
      setBusy("Scanning folders…");
      const titles = await prepareLocalImport(
        root,
        bulk,
        listLocalFolder,
        useLocalContentStore.getState().titles,
        controller.signal,
        (name) => setBusy(`Scanning ${name}…`),
      );
      if (controller.signal.aborted) return;
      if (!titles.length) {
        setError("No video files found in this folder.");
        return;
      }
      const defaultId =
        collectionId && collections.some((c) => c.id === collectionId)
          ? collectionId
          : collections.find((c) => c.id === DEFAULT_COLLECTION_ID)?.id ||
            collections[0]?.id;
      setReview(
        titles.map((item) => ({
          ...item,
          collections: item.collections?.filter((id) =>
            collections.some((c) => c.id === id),
          ).length
            ? item.collections.filter((id) =>
                collections.some((c) => c.id === id),
              )
            : defaultId
              ? [defaultId]
              : [],
        })),
      );
      setIndex(0);
      setBulk(bulk);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      task.current = null;
      if (!controller.signal.aborted) setBusy("");
    }
  };
  const current = review[index];
  const update = (patch: Partial<LocalTitle>) =>
    setReview((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const advance = (save: boolean) => {
    if (save && current) accepted.current.push({ ...current, inLibrary: true });
    if (index + 1 < review.length) {
      setIndex(index + 1);
      return;
    }
    useLocalContentStore.getState().saveTitles(accepted.current);
    close();
  };
  const selected = current?.collections || [];
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="extensions-dialog-overlay" />
        <DialogFocusProvider>
          <Dialog.Content
            ref={ref as any}
            className="extensions-dialog-content library-dialog local-import-dialog"
            style={themeStyle}
            onEscapeKeyDown={(event) => {
              if (picker) {
                event.preventDefault();
                setPicker(false);
              }
            }}
          >
            <div className="extensions-dialog-header">
              <div className="library-dialog-title-row">
                {picker && (
                  <FocusableButton
                    className="extensions-dialog-close"
                    aria-label="Back to import"
                    onClick={() => setPicker(false)}
                  >
                    <LuArrowLeft size={20} />
                  </FocusableButton>
                )}
                <Dialog.Title>
                  {picker
                    ? "Choose movie or series"
                    : title
                      ? "Edit metadata"
                      : bulk && current
                        ? `Import ${index + 1} of ${review.length}`
                        : "Import local content"}
                </Dialog.Title>
              </div>
              <FocusableButton
                className="extensions-dialog-close"
                aria-label="Close import"
                onClick={close}
              >
                <LuX size={20} />
              </FocusableButton>
            </div>
            <Dialog.Description className="local-content-hint">
              {picker
                ? "Match your files to a title for artwork, synopsis and episode names."
                : title
                  ? "Update metadata and display preferences for this folder."
                  : "Add movies and series from this device to your library."}
            </Dialog.Description>
            {picker && current ? (
              <MetadataPicker
                key={current.id}
                title={current}
                onChoose={(metadata) => {
                  update({ metadata });
                  setPicker(false);
                }}
                onBack={() => setPicker(false)}
              />
            ) : current ? (
              <>
                <div className="local-import-body">
                  <div className="local-folder-summary">
                    <LuFolderOpen size={24} />
                    <div>
                      <h3>{current.name}</h3>
                      <p>
                        {current.episodes.length} video files ·{" "}
                        {
                          new Set(current.episodes.map((item) => item.folder))
                            .size
                        }{" "}
                        folders
                      </p>
                      <small>{current.folderUri}</small>
                    </div>
                  </div>
                  <div className="local-metadata-card">
                    {current.metadata?.poster && (
                      <img src={current.metadata.poster} alt="" />
                    )}
                    <div>
                      <h3>{current.metadata?.title || "Movie or series"}</h3>
                      <p>
                        {current.metadata
                          ? [
                              current.metadata.year,
                              current.metadata.type === "movie"
                                ? "Movie"
                                : "Series",
                              current.metadata.imdbId,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "Choose a title for artwork and synopsis, or use the folder name."}
                      </p>
                      <div className="local-content-actions">
                        <FocusableButton
                          className="dialog-text-button"
                          onClick={() => setPicker(true)}
                        >
                          {current.metadata
                            ? "Change movie or series"
                            : "Choose movie or series"}
                        </FocusableButton>
                        {current.metadata && (
                          <FocusableButton
                            className="dialog-text-button"
                            onClick={() => update({ metadata: undefined })}
                          >
                            Use folder name
                          </FocusableButton>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="local-metadata-toggle">
                    <label htmlFor="local-metadata-names">
                      <strong>Metadata names</strong>
                      <small>
                        Use matched episode titles and “Movie” for movies.
                        Unmatched episodes keep their filenames.
                      </small>
                    </label>
                    <Switch
                      id="local-metadata-names"
                      checked={current.useMetadataTitles}
                      onCheckedChange={(useMetadataTitles) =>
                        update({ useMetadataTitles })
                      }
                    />
                  </div>
                  <section className="local-library-section">
                    <h3>Save to library</h3>
                    <p className="local-content-hint">
                      Choose one or more categories.
                    </p>
                    <div className="library-pick-list">
                      {collections.map((collection) => (
                        <FocusableButton
                          key={collection.id}
                          className={`library-pick-row ${selected.includes(collection.id) ? "selected" : ""}`}
                          role="checkbox"
                          aria-checked={selected.includes(collection.id)}
                          onClick={() =>
                            update({
                              collections: selected.includes(collection.id)
                                ? selected.filter((id) => id !== collection.id)
                                : [...selected, collection.id],
                            })
                          }
                        >
                          <LibraryIcon
                            icon={collection.icon}
                            color={collection.color}
                            size={20}
                            tile
                          />
                          <span className="library-pick-name">
                            {collection.name}
                          </span>
                          {selected.includes(collection.id) ? (
                            <LuCircleCheck
                              className="library-pick-check"
                              size={22}
                            />
                          ) : (
                            <LuCircle
                              className="library-pick-check"
                              size={22}
                            />
                          )}
                        </FocusableButton>
                      ))}
                      {!collections.length && (
                        <p className="local-content-hint">
                          This title will appear under All.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
                <div className="extensions-dialog-actions">
                  <FocusableButton
                    className="dialog-text-button"
                    onClick={close}
                  >
                    Cancel
                  </FocusableButton>
                  {bulk && (
                    <FocusableButton
                      className="dialog-text-button"
                      onClick={() => advance(false)}
                    >
                      Skip folder
                    </FocusableButton>
                  )}
                  <FocusableButton
                    className="dialog-primary-button"
                    disabled={collections.length > 0 && selected.length === 0}
                    onClick={() => advance(true)}
                  >
                    {index + 1 < review.length
                      ? "Next"
                      : title
                        ? "Save changes"
                        : "Import"}
                  </FocusableButton>
                </div>
              </>
            ) : (
              <>
                <div className="local-import-body local-import-choices">
                  <FocusableButton
                    className="local-import-choice"
                    disabled={Boolean(busy)}
                    onClick={() => void scan(false)}
                  >
                    <LuFolderOpen size={28} />
                    <span>
                      <strong>Single movie or series</strong>
                      <small>
                        Select its folder. Subfolders become seasons.
                      </small>
                    </span>
                  </FocusableButton>
                  <FocusableButton
                    className="local-import-choice"
                    disabled={Boolean(busy)}
                    onClick={() => void scan(true)}
                  >
                    <LuFolders size={28} />
                    <span>
                      <strong>Bulk import</strong>
                      <small>
                        Select a parent folder containing multiple movies or
                        series.
                      </small>
                    </span>
                  </FocusableButton>
                  {busy && (
                    <p role="status" className="local-content-status">
                      <LuLoaderCircle className="spin" />
                      {busy}
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="local-content-error">
                      {error}
                    </p>
                  )}
                </div>
                <div className="extensions-dialog-actions">
                  <FocusableButton
                    className="dialog-text-button"
                    onClick={close}
                  >
                    Cancel
                  </FocusableButton>
                </div>
              </>
            )}
          </Dialog.Content>
        </DialogFocusProvider>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
