import { useEffect, useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LuArrowLeft, LuPencil, LuRotateCcw, LuX } from "react-icons/lu";
import { MetadataPicker } from "../library/LocalContentDialog";
import { FocusableButton } from "../layout/FocusableButton";
import { Switch } from "../ui/switch";
import { useDialogFocusBoundary } from "../../lib/hooks/useDialogFocusBoundary";
import useMetadataOverrideStore, {
  metadataOverrideKey,
} from "../../lib/zustand/metadataOverrideStore";
import type { Info } from "../../lib/providers/types";
export function ProviderMetadataDialog({
  open,
  onOpenChange,
  info,
  provider,
  link,
  themeStyle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  info: Info;
  provider: string;
  link: string;
  themeStyle?: CSSProperties;
}) {
  const metadata = useMetadataOverrideStore(
    (state) => state.overrides[metadataOverrideKey(provider, link)],
  );
  const [picker, setPicker] = useState(false);
  const [episodeMetadata, setEpisodeMetadata] = useState(false);
  const { ref, DialogFocusProvider } = useDialogFocusBoundary({
    isOpen: open,
    focusKey: "PROVIDER_METADATA_DIALOG",
  });
  useEffect(() => {
    if (!open) setPicker(false);
    else setEpisodeMetadata(metadata?.useEpisodeMetadata === true);
  }, [open, metadata?.useEpisodeMetadata]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
                    aria-label="Back to metadata options"
                    onClick={() => setPicker(false)}
                  >
                    <LuArrowLeft size={20} />
                  </FocusableButton>
                )}
                <Dialog.Title>
                  {picker ? "Choose movie or series" : "Metadata"}
                </Dialog.Title>
              </div>
              <FocusableButton
                className="extensions-dialog-close"
                aria-label="Close metadata"
                onClick={() => onOpenChange(false)}
              >
                <LuX size={20} />
              </FocusableButton>
            </div>
            <Dialog.Description className="local-content-hint">
              Choose artwork and synopsis for this provider title. Episode
              metadata can also match season and episode numbers.
            </Dialog.Description>
            {picker ? (
              <>
                <div className="local-metadata-toggle">
                  <label htmlFor="provider-episode-metadata">
                    <strong>Episode metadata</strong>
                    <small>
                      Use matched episode names, descriptions and thumbnails.
                      Unmatched episodes keep provider details.
                    </small>
                  </label>
                  <Switch
                    aria-label="Episode metadata"
                    id="provider-episode-metadata"
                    checked={episodeMetadata}
                    onCheckedChange={(enabled) => {
                      setEpisodeMetadata(enabled);
                      if (metadata)
                        useMetadataOverrideStore
                          .getState()
                          .setMetadata(provider, link, {
                            ...metadata,
                            useEpisodeMetadata: enabled,
                          });
                    }}
                  />
                </div>
                <MetadataPicker
              errorHint="You can go back and keep the provider metadata."
                  title={{
                    id: link,
                    rootUri: "",
                    folderUri: "",
                    name: info.title,
                    useMetadataTitles: true,
                    episodes: [
                      {
                        uri: "",
                        name: "",
                        folder: "",
                        episode: info.type === "series" ? 1 : undefined,
                      },
                    ],
                    metadata:
                      metadata ||
                      (info.imdbId
                        ? {
                            imdbId: info.imdbId,
                            title: info.title,
                            type: info.type === "movie" ? "movie" : "series",
                          }
                        : undefined),
                  }}
                  onBack={() => setPicker(false)}
                  onChoose={(value) => {
                    useMetadataOverrideStore
                      .getState()
                      .setMetadata(provider, link, {
                        ...value,
                        ...(episodeMetadata
                          ? { useEpisodeMetadata: true }
                          : {}),
                      });
                    onOpenChange(false);
                  }}
                />
              </>
            ) : (
              <div className="local-content-actions">
                <FocusableButton
                  className="content-secondary-button"
                  onClick={() => setPicker(true)}
                >
                  <LuPencil size={18} /> Edit metadata
                </FocusableButton>
                {metadata && (
                  <FocusableButton
                    className="content-secondary-button"
                    onClick={() => {
                      useMetadataOverrideStore
                        .getState()
                        .setMetadata(provider, link);
                      onOpenChange(false);
                    }}
                  >
                    <LuRotateCcw size={18} /> Use provider metadata
                  </FocusableButton>
                )}
              </div>
            )}
          </Dialog.Content>
        </DialogFocusProvider>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
