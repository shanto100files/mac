export interface IMDbSuggestion {
  title: string;
  type: 'movie' | 'tv';
  year?: number;
  imdbId?: string;
  poster?: string;
}

export const fetchIMDbSuggestions = async (
  query: string,
  signal?: AbortSignal,
): Promise<IMDbSuggestion[]> => {
  const clean = query.trim().toLowerCase();
  if (clean.length < 3) {
    return [];
  }

  const firstChar = /^[a-z0-9]/.test(clean) ? clean.charAt(0) : 'x';
  const url = `https://v3.sg.media-imdb.com/suggestion/titles/${encodeURIComponent(
    firstChar,
  )}/${encodeURIComponent(clean)}.json`;

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const items = data?.d;
    if (!Array.isArray(items)) {
      return [];
    }

    const suggestions: IMDbSuggestion[] = [];
    const seenTitles = new Set<string>();

    for (const item of items) {
      const title = item?.l?.trim();
      if (!title) continue;

      const normalizedTitle = item?.id || title.toLowerCase();
      if (seenTitles.has(normalizedTitle)) continue;
      seenTitles.add(normalizedTitle);

      const q = String(item?.q || '').toLowerCase();
      const qid = String(item?.qid || '').toLowerCase();
      const isTv =
        qid.startsWith('tv') ||
        qid.includes('series') ||
        q.includes('tv') ||
        q.includes('series') ||
        q.includes('episode');

      suggestions.push({
        title,
        type: isTv ? 'tv' : 'movie',
        year: item?.y,
        imdbId: /^tt\d+$/.test(item?.id || '') ? item.id : undefined,
        poster: item?.i?.imageUrl,
      });
    }

    return suggestions;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return [];
    }
    console.warn('Error fetching IMDb suggestions:', error);
    return [];
  }
};
