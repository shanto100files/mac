import { useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { LuPencil, LuRefreshCw } from "react-icons/lu";
import {
  getEpisodeLabel,
  naturalCompare,
  scanEpisodes,
  type LocalTitle,
} from "../../lib/localContent/model";
import { localContentLink } from "../../lib/localContent/library";
import { listLocalFolder } from "../../lib/localContent/files";
import useLocalContentStore from "../../lib/zustand/localContentStore";
import { cacheStorage } from "../../lib/storage";
import { EpisodeRow } from "./EpisodeRow";
import { SeasonSelector } from "./SeasonSelector";
import {
  EpisodeDetailsDialog,
  type EpisodeDetails,
} from "./EpisodeDetailsDialog";
import { FocusableButton } from "../layout/FocusableButton";
import { LocalContentDialog } from "../library/LocalContentDialog";

export function LocalSeasonList({
  title,
  themeStyle,
}: {
  title: LocalTitle;
  themeStyle?: CSSProperties;
}) {
  const navigate = useNavigate();
  const [folder, setFolder] = useState("");
  const [editing, setEditing] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<EpisodeDetails | null>(null);
  const seasons = useMemo(
    () =>
      [...new Set(title.episodes.map((episode) => episode.folder))]
        .sort(naturalCompare)
        .map((name) => ({ title: name })),
    [title.episodes],
  );
  const activeSeason =
    seasons.find((season) => season.title === folder) || seasons[0] || null;
  const episodes = title.episodes.filter(
    (episode) => episode.folder === activeSeason?.title,
  );
  const rescan = async () => {
    setRescanning(true);
    setError("");
    try {
      const episodes = await scanEpisodes(
        title.folderUri,
        listLocalFolder,
        undefined,
        !title.rootFilesOnly,
      );
      useLocalContentStore.getState().saveTitles([{ ...title, episodes }]);
    } catch (error) {
      setError(String(error));
    } finally {
      setRescanning(false);
    }
  };
  return (
    <section className="content-episodes-section" aria-label="Local episodes">
      <div className="local-content-actions">
        <h2>On this device</h2>
        <FocusableButton
          className="content-secondary-button"
          onClick={() => setEditing(true)}
        >
          <LuPencil size={16} /> Edit metadata
        </FocusableButton>
        <FocusableButton
          className="content-secondary-button"
          disabled={rescanning}
          onClick={() => void rescan()}
        >
          <LuRefreshCw size={16} className={rescanning ? "spin" : ""} /> Rescan
          folder
        </FocusableButton>
      </div>
      <div className="season-row">
        <SeasonSelector
          seasons={seasons}
          activeSeason={activeSeason}
          onChange={(season) => setFolder(season.title)}
          themeStyle={themeStyle}
        />
      </div>
      {error && (
        <p role="alert" className="local-content-error">
          {error}
        </p>
      )}
      <div className="content-episode-list">
        {episodes.map((episode, index) => {
          const matched = title.metadata?.videos?.find(
            (video) =>
              video.season === episode.season &&
              video.episode === episode.episode,
          );
          let progress = { position: 0, duration: 0 };
          try {
            progress =
              JSON.parse(cacheStorage.getString(episode.uri) || "null") ||
              progress;
          } catch {
            /* Ignore invalid progress. */
          }
          const percent =
            progress.duration > 0
              ? Math.min(100, (progress.position / progress.duration) * 100)
              : 0;
          return (
            <EpisodeRow
              key={episode.uri}
              index={index}
              title={getEpisodeLabel(episode, title)}
              description={matched?.overview}
              localFilePath={episode.uri}
              progressPercent={percent}
              watched={percent >= 85}
              extracting={false}
              hideDownload
              onDownload={() => {}}
              onShowDetails={
                matched?.overview
                  ? () =>
                      setDetails({
                        title: getEpisodeLabel(episode, title),
                        description: matched.overview!,
                      })
                  : undefined
              }
              onPlay={() =>
                navigate("/player", {
                  state: {
                    localContent: true,
                    doNotTrack: true,
                    episodeList: episodes.map((item) => ({
                      id: item.uri,
                      link: item.uri,
                      localFile: true,
                      title: getEpisodeLabel(item, title),
                    })),
                    linkIndex: index,
                    primaryTitle: title.metadata?.title || title.name,
                    secondaryTitle: activeSeason?.title,
                    type:
                      title.metadata?.type ||
                      (title.episodes.length === 1 ? "movie" : "series"),
                    providerValue: "local",
                    infoUrl: localContentLink(title.id),
                    poster: {
                      poster: title.metadata?.poster,
                      background: title.metadata?.background,
                      logo: title.metadata?.logo,
                    },
                  },
                })
              }
            />
          );
        })}
      </div>
      {!episodes.length && (
        <div className="episodes-inline-state">
          No videos found. Rescan the folder to update this title.
        </div>
      )}
      <EpisodeDetailsDialog
        details={details}
        onClose={() => setDetails(null)}
      />
      <LocalContentDialog
        open={editing}
        onOpenChange={setEditing}
        title={title}
        themeStyle={themeStyle}
      />
    </section>
  );
}
