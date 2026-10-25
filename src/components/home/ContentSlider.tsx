import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { installHorizontalDrag } from "../../lib/horizontalDrag";
import {
  LuChevronLeft as ChevronLeft,
  LuChevronRight as ChevronRight,
} from "react-icons/lu";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { PostCardItem, Post, parseAspectRatio } from "./PostCardItem";
import { settingsStorage } from "../../lib/storage/SettingsStorage";
import { FocusableButton } from "../layout/FocusableButton";
import { Skeleton } from "../ui/skeleton";
import "./ContentSlider.css";

interface ContentSliderProps {
  title: string;
  posts: Post[];
  isLoading?: boolean;
  providerValue?: string;
  filter?: string;
  searchQuery?: string;
  onRemove?: (post: Post, e: React.MouseEvent) => void;
  windowRows?: boolean;
  defer?: boolean;
}

function estimatedRowHeight(posts: Post[]) {
  const ratios = new Map<string, number>();
  for (const post of posts) {
    const ratio = parseAspectRatio(post.aspectRatio);
    const width = ratio > 1.2 ? "clamp(240px, 20vw, 300px)"
      : ratio > 0.85 ? "clamp(160px, 14vw, 200px)" : "clamp(146px, 12.5vw, 190px)";
    ratios.set(width, Math.min(ratios.get(width) ?? Infinity, ratio));
  }
  const heights = [...ratios].map(([width, ratio]) => `calc(${width} / ${ratio} + 66px)`);
  return heights.length > 1 ? `max(${heights.join(", ")})` : heights[0];
}

export const ContentSlider = memo(function ContentSlider({
  title,
  posts,
  isLoading,
  providerValue,
  filter,
  searchQuery,
  onRemove,
  windowRows = false,
  defer = false,
}: ContentSliderProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(!defer);
  const [tvMode, setTvMode] = useState(() => settingsStorage.isTvModeEnabled() || /android/i.test(navigator.userAgent));
  const renderPosts = !windowRows || tvMode || typeof IntersectionObserver === "undefined" || revealed;
  const navigate = useNavigate();
  const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_");

  const {
    ref: focusRef,
    focusKey,
    hasFocusedChild,
  } = useFocusable({
    trackChildren: true,
  });

  useEffect(() => {
    if (!windowRows) return;
    const update = () => setTvMode(settingsStorage.isTvModeEnabled() || /android/i.test(navigator.userAgent));
    window.addEventListener("vega_tv_mode_changed", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("vega_tv_mode_changed", update);
      window.removeEventListener("storage", update);
    };
  }, [windowRows]);

  useEffect(() => {
    const host = focusRef.current;
    if (!windowRows || tvMode || isLoading || !host || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      // Defer the first mount, then retain the row. Destroying it whenever it
      // leaves the viewport repeats focus registration, layout and image
      // decoding each time the user scrolls back over the same posters.
      if (entry.isIntersecting) {
        setRevealed(true);
        observer.disconnect();
      }
    }, {root: host.closest(".layout-content"), rootMargin: "400px 0px"});
    observer.observe(host);
    return () => observer.disconnect();
  }, [windowRows, tvMode, isLoading, posts.length, focusRef]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    return installHorizontalDrag(row);
  }, [isLoading, posts.length, renderPosts]);

  const handleScroll = (direction: "left" | "right") => {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({
      left: row.clientWidth * 0.8 * (direction === "left" ? -1 : 1),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  const handlePostClick = useCallback((post: Post) => {
    const finalProvider = post.providerValue || providerValue;

    let url = `/content/${encodeURIComponent(post.link)}`;
    const params = new URLSearchParams();
    if (finalProvider) params.append("provider", finalProvider);
    if (post.image) params.append("poster", post.image);

    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
    navigate(url);
  }, [navigate, providerValue]);

  if (isLoading) {
    return (
      <div className="slider-container">
        <Skeleton className="slider-title-skeleton" />
        <div className="slider-row skeleton-row">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="post-card">
              <Skeleton className="skeleton-card" />
              <Skeleton className="skeleton-card-title" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return null;
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        className={`slider-container ${hasFocusedChild ? "has-focused-child" : ""}`}
        ref={focusRef as any}
      >
        <div className="slider-header">
          <h2 className="slider-title headline-md">{title}</h2>
          {(typeof filter === "string" || typeof searchQuery === "string") && (
            <FocusableButton
              className="slider-see-all"
              onClick={() => {
                if (typeof searchQuery === "string") {
                  navigate(
                    `/catalog?title=${encodeURIComponent(title)}&searchQuery=${encodeURIComponent(searchQuery)}&provider=${encodeURIComponent(providerValue || "")}`,
                  );
                } else {
                  navigate(
                    `/catalog?title=${encodeURIComponent(title)}&filter=${encodeURIComponent(filter || "")}&provider=${encodeURIComponent(providerValue || "")}`,
                  );
                }
              }}
            >
              View all
            </FocusableButton>
          )}
        </div>

        {renderPosts ? <div className="slider-wrapper">
          <button
            className="slider-arrow left"
            onClick={() => handleScroll("left")}
            aria-label="Scroll left"
            tabIndex={-1}
          >
            <ChevronLeft size={32} />
          </button>

          <div
            ref={rowRef}
            className="slider-row"
            role="group"
            aria-label={title}>
            {posts.map((post, index) => (
              <div
                className="content-slider-slide"
                key={`${post.link}-${index}`}>
                <PostCardItem
                  post={post}
                  focusKey={`CARD_${sanitizedTitle}_${index}_${post.link.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                  onClick={handlePostClick}
                  onRemove={onRemove}
                />
              </div>
            ))}
          </div>

          <button
            className="slider-arrow right"
            onClick={() => handleScroll("right")}
            aria-label="Scroll right"
            tabIndex={-1}
          >
            <ChevronRight size={32} />
          </button>
        </div> : <div className="slider-row-placeholder" aria-hidden="true"
          style={{height: estimatedRowHeight(posts)}} />}
      </div>
    </FocusContext.Provider>
  );
});
