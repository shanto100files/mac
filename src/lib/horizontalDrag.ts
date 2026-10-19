/** Mouse dragging for native scroll rows; touch and trackpads stay browser-native. */
export function installHorizontalDrag(element: HTMLElement) {
  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  let dragging = false;
  let suppressClick = false;

  const down = (event: PointerEvent) => {
    suppressClick = false;
    if (event.pointerType !== 'mouse' || event.button !== 0 ||
        (event.target as Element).closest('button, input, textarea, select, a')) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startScroll = element.scrollLeft;
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    if (event.buttons !== 1) { end(event); return; }
    const dx = event.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(event.clientY - startY) > Math.abs(dx)) { pointer = null; return; }
      dragging = true;
      suppressClick = true;
      element.classList.add('is-dragging');
      element.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    element.scrollLeft = startScroll - dx;
  };
  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    dragging = false;
    element.classList.remove('is-dragging');
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
  element.addEventListener('lostpointercapture', end);
  element.addEventListener('click', click, true);
  return () => {
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', end);
    element.removeEventListener('pointercancel', end);
    element.removeEventListener('lostpointercapture', end);
    element.removeEventListener('click', click, true);
    element.classList.remove('is-dragging');
  };
}
