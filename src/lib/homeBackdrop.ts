// Bake the hero blur into a small bitmap once, instead of filtering a
// window-sized surface whenever the scrolling page is composited.
export function paintHomeBackdrop(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement | ImageBitmap,
  width: number,
  height: number,
): boolean {
  const sourceWidth = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const sourceHeight = 'naturalHeight' in image ? image.naturalHeight : image.height;
  if (width <= 0 || height <= 0 || !sourceWidth || !sourceHeight)
    return false;
  // This is a one-shot, 320px bitmap. Avoid creating a GPU canvas and
  // synchronously uploading/decoding its source during a scrolling frame.
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  canvas.width = Math.max(1, Math.min(320, Math.round(width)));
  canvas.height = Math.max(1, Math.round((canvas.width * height) / width));
  const scale = Math.max(
    canvas.width / sourceWidth,
    canvas.height / sourceHeight,
  );
  const imageWidth = sourceWidth * scale;
  const imageHeight = sourceHeight * scale;
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
