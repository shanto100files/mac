// Bake the hero blur into a small bitmap once, instead of filtering a
// window-sized surface whenever the scrolling page is composited.
export function paintHomeBackdrop(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  width: number,
  height: number,
): boolean {
  if (width <= 0 || height <= 0 || !image.naturalWidth || !image.naturalHeight)
    return false;
  const context = canvas.getContext("2d");
  if (!context) return false;
  canvas.width = Math.max(1, Math.min(320, Math.round(width)));
  canvas.height = Math.max(1, Math.round((canvas.width * height) / width));
  const scale = Math.max(
    canvas.width / image.naturalWidth,
    canvas.height / image.naturalHeight,
  );
  const imageWidth = image.naturalWidth * scale;
  const imageHeight = image.naturalHeight * scale;
  context.filter = `blur(${(28 * canvas.width) / width}px) brightness(0.7)`;
  context.drawImage(
    image,
    (canvas.width - imageWidth) / 2,
    (canvas.height - imageHeight) / 2,
    imageWidth,
    imageHeight,
  );
  return true;
}
