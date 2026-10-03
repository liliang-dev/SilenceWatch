import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Movement under this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 5;

/**
 * Lets a row of tabs that is wider than its screen be scrolled sideways: with a
 * finger, with a trackpad, with the mouse wheel, or by dragging with the mouse.
 *
 * Angular Material paginates a long tab strip instead — two arrow buttons that
 * move it a third at a time, and nothing on a touch screen that moves it under
 * your finger. Used with `disablePagination`, the strip is an ordinary
 * horizontally scrolling box, and this adds the two things a box does not do by
 * itself:
 *
 * - a mouse wheel turns the strip, but only in a direction it can still move, so
 *   the page scrolls on as soon as the strip reaches either end;
 * - the arrow keys bring the focused tab into view;
 * - dragging with the mouse scrolls it, and the click that ends a drag is
 *   swallowed so letting go over a tab does not select it.
 *
 * It also marks the host `can-scroll-start` / `can-scroll-end` so the stylesheet
 * can fade the edge that has more behind it. Touch needs nothing: the browser
 * scrolls a box under a finger, with momentum, on its own.
 */
@Directive({
  selector: 'mat-tab-group[swScrollTabs]',
})
export class ScrollTabsDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // The tab header is drawn by the group's own template, so it exists only
    // once the first render is done.
    afterNextRender(() => this.attach());
  }

  private attach(): void {
    const strip = this.host.querySelector<HTMLElement>('.mat-mdc-tab-label-container');
    if (strip === null) return;

    const update = (): void => {
      const max = strip.scrollWidth - strip.clientWidth;
      this.host.classList.toggle('can-scroll-start', strip.scrollLeft > 1);
      this.host.classList.toggle('can-scroll-end', strip.scrollLeft < max - 1);
      this.host.classList.toggle('is-scrollable', max > 1);
    };

    // A wheel that turns the page turns the strip instead — but only in a
    // direction the strip can still move. At either end it is left alone, so the
    // page carries on scrolling instead of the wheel going dead over the tabs.
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = strip.scrollWidth - strip.clientWidth;
      const room = event.deltaY > 0 ? max - strip.scrollLeft : strip.scrollLeft;
      if (max <= 1 || room <= 1) return;
      strip.scrollLeft = Math.min(max, Math.max(0, strip.scrollLeft + event.deltaY));
      event.preventDefault();
    };

    // Moving focus with the arrow keys brings the tab into view: with Material's
    // own pagination switched off nothing else does. Deferred by a microtask
    // because Material, right after it focuses a tab, sets the strip's scrollLeft
    // back to 0 — a leftover from when it moved the strip with a transform — and
    // that would undo this.
    const onFocusIn = (event: FocusEvent): void => {
      const tab = event.target as HTMLElement | null;
      queueMicrotask(() => tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    };

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;

    const onPointerDown = (event: PointerEvent): void => {
      // Touch and pen scroll natively; only a mouse needs help.
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (strip.scrollWidth - strip.clientWidth <= 1) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = strip.scrollLeft;
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      const delta = event.clientX - startX;
      if (!moved && Math.abs(delta) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        this.host.classList.add('is-dragging');
      }
      strip.scrollLeft = startScroll - delta;
    };

    const onPointerUp = (): void => {
      if (!dragging) return;
      dragging = false;
      this.host.classList.remove('is-dragging');
    };

    // The click that follows a drag lands on whichever tab the mouse was over.
    const onClick = (event: MouseEvent): void => {
      if (!moved) return;
      moved = false;
      event.stopPropagation();
      event.preventDefault();
    };

    strip.addEventListener('scroll', update, { passive: true });
    strip.addEventListener('wheel', onWheel, { passive: false });
    strip.addEventListener('focusin', onFocusIn);
    strip.addEventListener('pointerdown', onPointerDown);
    strip.addEventListener('click', onClick, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    const resize = new ResizeObserver(update);
    resize.observe(strip);
    const list = strip.firstElementChild;
    if (list !== null) resize.observe(list);

    // The tab in use starts in view, whatever the width.
    strip
      .querySelector<HTMLElement>('.mdc-tab--active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    update();

    this.destroyRef.onDestroy(() => {
      resize.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    });
  }
}
