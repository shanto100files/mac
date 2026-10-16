import { useEffect, useState, type RefObject } from "react";
export function useHeroActivity(ref: RefObject<HTMLElement | null>) {
  const [inViewport, setInViewport] = useState(true);
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    const hero = ref.current;
    const scroller = hero?.closest(".layout-content");
    if (!hero || !scroller) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let moving = false;
    const onScroll = () => {
      if (!moving) {
        moving = true;
        setScrolling(true);
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        moving = false;
        setScrolling(false);
      }, 200);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        setInViewport(entries[0]?.isIntersecting === true);
      },
      { root: scroller },
    );
    observer.observe(hero);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [ref]);
  return { inViewport, scrolling };
}
