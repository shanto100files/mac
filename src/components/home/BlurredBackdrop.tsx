import { useEffect, useRef } from "react";
import { paintHomeBackdrop } from "../../lib/homeBackdrop";
export function BlurredBackdrop({ image }: { image: HTMLImageElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    let frame = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    const draw = () => {
      frame = 0;
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (lastWidth === width && lastHeight === height) return;
      if (paintHomeBackdrop(canvas, image, width, height)) {
        lastWidth = width;
        lastHeight = height;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [image]);
  return (
    <canvas ref={ref} className="hero-backdrop-canvas" aria-hidden="true" />
  );
}
