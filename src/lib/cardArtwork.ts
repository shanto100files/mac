// Cards need thumbnails, even when a provider supplies a full-size TMDB image.
// Leave other hosts (including signed/local URLs) untouched.
export function cardArtwork(source: string, aspectRatio = 2 / 3) {
  const match = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)(?:original|w\d+)(\/[^?#]+)$/.exec(source);
  if (!match || /\.svg$/i.test(match[2])) return {src: source};
  const url = (width: number) => `${match[1]}w${width}${match[2]}`;
  return {
    src: url(342),
    srcSet: [185, 342, 500, 780].map(width => `${url(width)} ${width}w`).join(', '),
    sizes: aspectRatio > 1.2 ? 'clamp(240px, 20vw, 300px)'
      : aspectRatio > 0.85 ? 'clamp(160px, 14vw, 200px)'
        : 'clamp(146px, 12.5vw, 190px)',
  };
}
