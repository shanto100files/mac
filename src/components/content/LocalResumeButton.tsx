import {useNavigate} from 'react-router-dom';
import type {LocalTitle} from '../../lib/localContent/model';
import {getLocalPlayerParams, getLocalResume} from '../../lib/localContent/playback';
import {cacheStorage} from '../../lib/storage';
import {ResumeButton} from './ResumeButton';

export function LocalResumeButton({title}: {title: LocalTitle}) {
  const navigate = useNavigate();
  const target = getLocalResume(title, uri => {
    try { return JSON.parse(cacheStorage.getString(uri) || 'null') || undefined; } catch { return undefined; }
  });
  if (!target) return null;
  return <ResumeButton target={target} onPress={() => {
    const params = getLocalPlayerParams(title, target.episode.uri);
    if (params) navigate('/player', {state: {...params, doNotTrack: true}});
  }} />;
}
