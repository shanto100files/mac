import {useEffect, useState} from 'react';

/** Keep an overlay painted only long enough to finish its closing transition. */
export function useExitPresence(visible: boolean, duration: number) {
  const [present, setPresent] = useState(visible);
  useEffect(() => {
    if (visible) { setPresent(true); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPresent(false);
      return;
    }
    const timer = setTimeout(() => setPresent(false), duration);
    return () => clearTimeout(timer);
  }, [visible, duration]);
  return visible || present;
}
