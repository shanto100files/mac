import { useEffect, useRef, useState } from "react";
import { settingsStorage } from "../storage/SettingsStorage";

type Direction = "up" | "down" | "left" | "right";

interface DirectionState {
  isHeld: boolean;
  firstPressTime: number;
  lastRepeatTime: number;
}

// Match Android's default key repeat timeout so a normal press on a Bluetooth remote
// (which Android exposes as a gamepad) doesn't auto-repeat.
const INITIAL_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 90;
const STICK_DEADZONE = 0.45;

export function useGamepadNavigation() {
  const [enabled, setEnabled] = useState(() => settingsStorage.isTvModeEnabled());
  const rafRef = useRef<number | null>(null);
  const prevButtonsRef = useRef<boolean[]>([]);
  const dirStatesRef = useRef<Record<Direction, DirectionState>>({
    up: { isHeld: false, firstPressTime: 0, lastRepeatTime: 0 },
    down: { isHeld: false, firstPressTime: 0, lastRepeatTime: 0 },
    left: { isHeld: false, firstPressTime: 0, lastRepeatTime: 0 },
    right: { isHeld: false, firstPressTime: 0, lastRepeatTime: 0 },
  });

  useEffect(() => {
    const update = () => setEnabled(settingsStorage.isTvModeEnabled());
    window.addEventListener("vega_tv_mode_changed", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("vega_tv_mode_changed", update);
      window.removeEventListener("storage", update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const stop = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      prevButtonsRef.current = [];
      Object.values(dirStatesRef.current).forEach(state => { state.isHeld = false; });
    };
    const notifyActivity = () => {
      window.dispatchEvent(new CustomEvent("vega:remote-activity"));
    };

    // Emulate exactly one real key press: dispatch once on the focused element and let it
    // bubble to window, where spatial navigation and other listeners handle it.
    const dispatchKeyEvent = (key: string, code: string, type: "keydown" | "keyup" = "keydown") => {
      const activeEl = document.activeElement || document.body;
      const event = new KeyboardEvent(type, {
        key,
        code,
        bubbles: true,
        cancelable: true,
        view: window,
      });
      activeEl.dispatchEvent(event);
    };

    // Navigation happens through the synthetic arrow key event (spatial navigation reads
    // event.code), so don't also call navigateByDirection() or each press moves focus twice.
    // This matters for Bluetooth TV remotes that Android exposes as gamepads.
    const triggerDirection = (dir: Direction) => {
      notifyActivity();

      const keyMap: Record<Direction, { key: string; code: string }> = {
        up: { key: "ArrowUp", code: "ArrowUp" },
        down: { key: "ArrowDown", code: "ArrowDown" },
        left: { key: "ArrowLeft", code: "ArrowLeft" },
        right: { key: "ArrowRight", code: "ArrowRight" },
      };

      const { key, code } = keyMap[dir];
      dispatchKeyEvent(key, code, "keydown");
      setTimeout(() => dispatchKeyEvent(key, code, "keyup"), 16);
    };

    const processDirection = (dir: Direction, isPressed: boolean, now: number) => {
      const state = dirStatesRef.current[dir];
      if (isPressed) {
        if (!state.isHeld) {
          state.isHeld = true;
          state.firstPressTime = now;
          state.lastRepeatTime = now;
          triggerDirection(dir);
        } else if (
          now - state.firstPressTime > INITIAL_DELAY_MS &&
          now - state.lastRepeatTime > REPEAT_INTERVAL_MS
        ) {
          state.lastRepeatTime = now;
          triggerDirection(dir);
        }
      } else {
        state.isHeld = false;
      }
    };

    const pollGamepads = () => {
      rafRef.current = null;
      if (document.visibilityState === "hidden") { stop(); return; }
      const gamepads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
      let activeGamepad: Gamepad | null = null;

      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp && gp.connected) {
          activeGamepad = gp;
          break;
        }
      }

      if (!activeGamepad) {
        stop();
        return;
      }

      const now = performance.now();
      const buttons = activeGamepad.buttons;
      const axes = activeGamepad.axes;

      // D-Pad and Left Analog Stick
      const stickX = axes[0] ?? 0;
      const stickY = axes[1] ?? 0;

      const dpadUp = Boolean(buttons[12]?.pressed) || stickY < -STICK_DEADZONE;
      const dpadDown = Boolean(buttons[13]?.pressed) || stickY > STICK_DEADZONE;
      const dpadLeft = Boolean(buttons[14]?.pressed) || stickX < -STICK_DEADZONE;
      const dpadRight = Boolean(buttons[15]?.pressed) || stickX > STICK_DEADZONE;

      processDirection("up", dpadUp, now);
      processDirection("down", dpadDown, now);
      processDirection("left", dpadLeft, now);
      processDirection("right", dpadRight, now);

      // Edge-triggered Action Buttons
      const prevButtons = prevButtonsRef.current;
      const isPressed = (idx: number) => Boolean(buttons[idx]?.pressed);
      const isJustPressed = (idx: number) => isPressed(idx) && !prevButtons[idx];

      // A / Cross (Button 0) -> Select / Enter
      if (isJustPressed(0)) {
        notifyActivity();
        dispatchKeyEvent("Enter", "Enter", "keydown");
        setTimeout(() => dispatchKeyEvent("Enter", "Enter", "keyup"), 16);
      }

      // B / Circle (Button 1) -> Back / Escape
      if (isJustPressed(1)) {
        notifyActivity();
        dispatchKeyEvent("Escape", "Escape", "keydown");
        setTimeout(() => dispatchKeyEvent("Escape", "Escape", "keyup"), 16);
      }

      // X / Square (Button 2) -> Play / Pause
      if (isJustPressed(2)) {
        notifyActivity();
        dispatchKeyEvent("k", "KeyK", "keydown");
        setTimeout(() => dispatchKeyEvent("k", "KeyK", "keyup"), 16);
      }

      // Y / Triangle (Button 3) -> Toggle Episode drawer / Subtitles
      if (isJustPressed(3)) {
        notifyActivity();
        window.dispatchEvent(new CustomEvent("vega:toggle-episodes"));
      }

      // LB (Button 4) -> Seek backward (-10s)
      if (isJustPressed(4)) {
        notifyActivity();
        dispatchKeyEvent("ArrowLeft", "ArrowLeft", "keydown");
        setTimeout(() => dispatchKeyEvent("ArrowLeft", "ArrowLeft", "keyup"), 16);
      }

      // RB (Button 5) -> Seek forward (+10s)
      if (isJustPressed(5)) {
        notifyActivity();
        dispatchKeyEvent("ArrowRight", "ArrowRight", "keydown");
        setTimeout(() => dispatchKeyEvent("ArrowRight", "ArrowRight", "keyup"), 16);
      }

      // LT (Button 6) -> Skip backward / Previous
      if (isJustPressed(6)) {
        notifyActivity();
        dispatchKeyEvent("p", "KeyP", "keydown");
        setTimeout(() => dispatchKeyEvent("p", "KeyP", "keyup"), 16);
      }

      // RT (Button 7) -> Skip forward / Next episode
      if (isJustPressed(7)) {
        notifyActivity();
        dispatchKeyEvent("n", "KeyN", "keydown");
        setTimeout(() => dispatchKeyEvent("n", "KeyN", "keyup"), 16);
      }

      // Start / Menu (Button 9) -> Toggle controls
      if (isJustPressed(9)) {
        notifyActivity();
        dispatchKeyEvent("m", "KeyM", "keydown");
        setTimeout(() => dispatchKeyEvent("m", "KeyM", "keyup"), 16);
      }

      // Save state for next frame
      prevButtonsRef.current = buttons.map((b) => Boolean(b.pressed));
      rafRef.current = requestAnimationFrame(pollGamepads);
    };

    // Wake for connection/visibility events instead of polling every frame
    // when there is no controller. Only an active controller needs a loop.
    const start = () => {
      if (rafRef.current === null) pollGamepads();
    };
    const reconnect = () => { stop(); start(); };
    const visibility = () => {
      if (document.visibilityState === "hidden") stop();
      else start();
    };
    window.addEventListener("gamepadconnected", start);
    window.addEventListener("gamepaddisconnected", reconnect);
    document.addEventListener("visibilitychange", visibility);
    start();

    return () => {
      stop();
      window.removeEventListener("gamepadconnected", start);
      window.removeEventListener("gamepaddisconnected", reconnect);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled]);
}
