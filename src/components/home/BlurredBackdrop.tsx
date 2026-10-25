import { useEffect, useRef } from "react";
import { paintHomeBackdrop } from "../../lib/homeBackdrop";
export function BlurredBackdrop({ image, active = true }: { image: HTMLImageElement; active?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const resumeRef = useRef<(() => void) | undefined>(undefined);
  activeRef.current = active;
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    let frame = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    let disposed = false;
    let bitmap: ImageBitmap | undefined;
    let ready = false;
    let preparing = false;
    const draw = () => {
      frame = 0;
      if (!activeRef.current) return;
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (lastWidth === width && lastHeight === height) return;
      if (!ready) return;
      if (paintHomeBackdrop(canvas, bitmap ?? image, width, height)) {
        lastWidth = width;
        lastHeight = height;
      }
    };
    const schedule = () => {
      if (!activeRef.current) return;
      if (!ready) { if (!preparing) void prepare(); return; }
      if (!frame) frame = requestAnimationFrame(draw);
    };
    // Decode and shrink the source before the first canvas paint. Drawing the
    // original directly can defer a full-size decode into a scrolling frame.
    const prepare = async () => {
      preparing = true;
      try {
        if (typeof createImageBitmap === 'function') {
          const decoded = await createImageBitmap(image, {
            resizeWidth: Math.min(320, image.naturalWidth), resizeQuality: 'low',
          });
          if (disposed) { decoded.close(); return; }
          bitmap = decoded;
        }
      } catch { /* Older WebViews retain the HTML image path. */ }
      if (!disposed) { ready = true; schedule(); }
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    resumeRef.current = schedule;
    schedule();
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      bitmap?.close();
      resumeRef.current = undefined;
    };
  }, [image]);
  useEffect(() => { if (active) resumeRef.current?.(); }, [active]);
  return (
    <canvas ref={ref} className="hero-backdrop-canvas" aria-hidden="true" />
  );
}
