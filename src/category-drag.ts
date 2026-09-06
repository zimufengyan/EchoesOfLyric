/** Long press to reorder only the category DOM; commit one data change on release. */
export function bindCategoryDrag(list: HTMLElement, commit: (names: string[]) => void): void {
  let gesture: {
    id: number; row: HTMLElement; button: HTMLElement; original: HTMLElement[];
    startX: number; startY: number; x: number; y: number; offsetX: number; offsetY: number;
    active: boolean; horizontal: boolean; ghost?: HTMLElement;
  } | null = null;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let suppressClick = false;

  const move = () => {
    const drag = gesture; if (!drag?.active) return;
    drag.ghost!.style.left = `${drag.x - drag.offsetX}px`;
    drag.ghost!.style.top = `${drag.y - drag.offsetY}px`;
    const rows = [...list.children] as HTMLElement[];
    const point = drag.horizontal ? drag.x : drag.y;
    const next = rows.find(row => {
      if (row === drag.row) return false;
      const rect = row.getBoundingClientRect();
      const transform = new DOMMatrixReadOnly(getComputedStyle(row).transform);
      return point < (drag.horizontal ? rect.left - transform.m41 + rect.width / 2 : rect.top - transform.m42 + rect.height / 2);
    });
    if (drag.row.nextElementSibling === (next ?? null)) return;
    const before = new Map(rows.map(row => [row, row.getBoundingClientRect()]));
    list.insertBefore(drag.row, next ?? null);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const row of rows) {
        if (row === drag.row) continue;
        const old = before.get(row)!, rect = row.getBoundingClientRect();
        const x = old.left - rect.left, y = old.top - rect.top;
        if (x || y) row.animate([{ transform: `translate(${x}px,${y}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
      }
    }
  };
  const scroll = () => {
    const drag = gesture; if (!drag?.active) return;
    if (drag.horizontal) {
      const rect = list.getBoundingClientRect();
      if (drag.x < rect.left + 28) list.scrollLeft -= 7;
      else if (drag.x > rect.right - 28) list.scrollLeft += 7;
    } else {
      if (drag.y < 55) window.scrollBy(0, -8);
      else if (drag.y > innerHeight - 55) window.scrollBy(0, 8);
    }
    move(); frame = requestAnimationFrame(scroll);
  };
  const finish = (cancel = false) => {
    clearTimeout(hold); cancelAnimationFrame(frame);
    const drag = gesture; gesture = null; if (!drag) return;
    drag.button.classList.remove('hold-pending');
    if (!drag.active) return;
    suppressClick = true;
    drag.row.classList.remove('is-dragging'); drag.ghost?.remove(); document.body.classList.remove('sorting-categories');
    if (list.hasPointerCapture(drag.id)) list.releasePointerCapture(drag.id);
    const changed = drag.original.some((row, index) => list.children[index] !== row);
    if (cancel) list.replaceChildren(...drag.original);
    else if (changed) commit([...list.querySelectorAll<HTMLElement>('[data-category]')].map(button => button.dataset.category!));
  };
  list.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return;
    finish(true); suppressClick = false;
    const button = (event.target as Element).closest<HTMLElement>('[data-category]');
    if (!button || !list.contains(button)) return;
    const row = button.closest<HTMLElement>('.category-row')!;
    const rect = row.getBoundingClientRect();
    gesture = { id: event.pointerId, row, button, original: [...list.children] as HTMLElement[], startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.x, offsetY: event.clientY - rect.y, active: false, horizontal: getComputedStyle(list).flexDirection === 'row' };
    button.classList.add('hold-pending');
    hold = setTimeout(() => {
      const drag = gesture; if (!drag) return;
      drag.active = true; suppressClick = true; hideSelection();
      drag.button.classList.remove('hold-pending'); drag.row.classList.add('is-dragging');
      const ghost = drag.row.cloneNode(true) as HTMLElement;
      ghost.className = 'category-row category-drag-ghost'; ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`;
      ghost.querySelector('.category-options')?.remove();
      drag.ghost = ghost; document.body.append(ghost); document.body.classList.add('sorting-categories');
      list.setPointerCapture(drag.id); move(); frame = requestAnimationFrame(scroll);
    }, 350);
  });
  window.addEventListener('pointermove', event => {
    const drag = gesture; if (!drag || drag.id !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 7) { finish(true); return; }
    if (drag.active) { event.preventDefault(); move(); }
  }, { passive: false });
  window.addEventListener('pointerup', event => { if (gesture?.id === event.pointerId) finish(); });
  window.addEventListener('pointercancel', event => { if (gesture?.id === event.pointerId) finish(true); });
  list.addEventListener('lostpointercapture', () => finish(true));
  list.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; } }, true);
  list.addEventListener('dragstart', event => event.preventDefault());
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && gesture) { event.preventDefault(); finish(true); } });
  window.addEventListener('blur', () => finish(true));
  window.addEventListener('resize', () => finish(true));
}
function hideSelection(): void { window.getSelection()?.removeAllRanges(); }
