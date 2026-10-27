import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { isWindowsPlatform, toggleWindowMaximize } from "./WindowControls";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import "./Layout.css";
import {doesFocusableExist, getCurrentFocusKey, setFocus} from '@noriginmedia/norigin-spatial-navigation-core';

const routeFocus = new Map<string, string>();

export const Layout: React.FC = () => {
  const location = useLocation();
  const contentRef = useRef<HTMLElement>(null);
  const focusRouteRef = useRef(location.pathname + location.search);
  useLayoutEffect(() => {
    contentRef.current?.scrollTo({top: 0, left: 0, behavior: 'instant'});
  }, [location.pathname, location.search]);
  const isHomePage = location.pathname === "/";
  const isContentPage =
    location.pathname.startsWith("/content/") ||
    location.pathname.startsWith("/watchlist/content/");
  const tvMode = settingsStorage.isTvModeEnabled();

  const { ref, focusKey, focusSelf } = useFocusable({
    focusable: tvMode,
    trackChildren: true,
    saveLastFocusedChild: true,
    preferredChildFocusKey: "SIDEBAR_HOME",
  });

  useEffect(() => {
    if (!tvMode) return;
    const route = location.pathname + location.search;
    // Restore focus after returning from playback, but do not restore an
    // offscreen control when switching tabs and scroll the new page back down.
    const previous = focusRouteRef.current === route ? routeFocus.get(route) : undefined;
    focusRouteRef.current = route;
    let attempts = 0;
    // The player unmounts Layout. Its old focus key cannot survive that
    // transition; restore a registered control after the page mounts again.
    const timer = window.setInterval(() => {
      if (previous && doesFocusableExist(previous)) {
        setFocus(previous);
        window.clearInterval(timer);
      } else if (!previous || ++attempts >= 20) {
        focusSelf();
        window.clearInterval(timer);
      }
    }, 50);
    const rememberFocus = () => {
      const key = getCurrentFocusKey();
      if (key && doesFocusableExist(key)) routeFocus.set(route, key);
    };
    // Capture before OK/click navigates away and unregisters its control.
    window.addEventListener('keydown', rememberFocus, true);
    window.addEventListener('click', rememberFocus, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', rememberFocus, true);
      window.removeEventListener('click', rememberFocus, true);
    };
  }, [tvMode, focusSelf, location.pathname, location.search]);

  const needsTopPadding = !isHomePage && !isContentPage;

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="layout-root" ref={ref as any}>
        <Sidebar />
        <div className="layout-main">
          {isWindowsPlatform() && (
            // Title bar area: drag to move, double-click to maximize.
            <div
              className="layout-drag-region"
              data-tauri-drag-region
              aria-hidden="true"
              onDoubleClick={() => void toggleWindowMaximize().catch(() => {})}
            />
          )}
          <Topbar />
          <main
            ref={contentRef}
            className={`layout-content ${needsTopPadding ? "layout-content-padded" : ""}`}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </FocusContext.Provider>
  );
};
