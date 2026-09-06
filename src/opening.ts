import type { Collection } from '../shared/types';
import { iconButton } from './icons';

const fallback = ['长风破浪会有时', '直挂云帆济沧海', '明月松间照', '清泉石上流', '行到水穷处', '坐看云起时', '海上生明月', '天涯共此时'];

/** Bound the decorative text without changing any saved excerpt. */
export function openingPhrases(collection: Collection, maxLength: number): string[] {
  const phrases = new Set<string>();
  for (const entries of Object.values(collection)) {
    for (const entry of entries) {
      for (const part of entry.text.slice(0, 2000).split(/[，,。.!！?？；;、\r\n]+/u)) {
        const text = part.trim().replace(/\s+/gu, ' ');
        const characters = Array.from(text);
        if (characters.length < 3) continue;
        phrases.add(characters.length > maxLength ? characters.slice(0, maxLength).join('') + '…' : text);
        if (phrases.size >= 128) return [...phrases];
      }
    }
  }
  return phrases.size ? [...phrases] : fallback;
}

interface OpeningOptions { enabled: boolean; collection: Collection; app: HTMLElement; landing: HTMLElement }

/** The workspace is already initialized. Every exit releases its temporary input lock. */
export function playOpening({ enabled, collection, app, landing }: OpeningOptions): void {
  if (!enabled) return;
  let overlay: HTMLElement | undefined;
  let skip: HTMLButtonElement | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let watchdogRemaining = 4400;
  let resumedAt = 0;
  let pausedForVisibility = false;
  let layoutFrame = 0;
  let events: AbortController | undefined;
  const animations: Animation[] = [];
  const visibilityPaused = new Set<Animation>();
  const wasInert = app.inert;
  const landingVisibility = landing.style.visibility;
  const previousFocus = document.activeElement as HTMLElement | null;
  let finished = false;
  let active = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    cancelAnimationFrame(layoutFrame);
    events?.abort();
    for (const animation of animations) { try { animation.cancel(); } catch { /* Continue cleanup if a browser animation failed. */ } }
    const restoreFocus = active && document.hasFocus() && (document.activeElement === skip || document.activeElement === document.body);
    landing.style.visibility = landingVisibility;
    app.inert = wasInert;
    overlay?.remove();
    if (restoreFocus && !wasInert) {
      const target = previousFocus && app.contains(previousFocus) ? previousFocus
        : app.querySelector<HTMLElement>(matchMedia('(pointer: fine)').matches ? '#text' : '.brand');
      target?.focus({ preventScroll: true });
    }
  };
  const armWatchdog = () => {
    resumedAt = performance.now();
    watchdog = setTimeout(finish, watchdogRemaining);
  };

  try {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches || !Element.prototype.animate) return;
    if (document.hidden) {
      // Embedded browser panels can load while hidden, before their first presentation.
      // Do not consume that document's opening until it is actually visible.
      events = new AbortController();
      const { signal } = events;
      const startWhenVisible = () => {
        if (finished || document.hidden) return;
        finished = true; events?.abort();
        playOpening({ enabled, collection, app, landing });
      };
      document.addEventListener('visibilitychange', startWhenVisible, { signal });
      window.addEventListener('pageshow', startWhenVisible, { signal });
      window.addEventListener('focus', startWhenVisible, { signal });
      window.addEventListener('pagehide', finish, { signal });
      return;
    }
    const mobile = innerWidth <= 600;
    const phrases = openingPhrases(collection, mobile ? 10 : 16);
    for (let i = phrases.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [phrases[i], phrases[j]] = [phrases[j], phrases[i]];
    }
    overlay = document.createElement('div');
    overlay.id = 'opening';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '余韵开屏');
    overlay.setAttribute('aria-describedby', 'opening-description');
    overlay.innerHTML = `<div class="opening-curtain" aria-hidden="true"></div><div class="opening-depth" aria-hidden="true"></div><div class="opening-feature" aria-hidden="true"><p class="opening-verse"></p><p class="opening-source"></p></div><div class="opening-controls">${iconButton('skip', '跳过开屏', 'skip-opening')}</div><span class="sr-only" id="opening-description">开屏播放中，按 Esc 跳过。</span>`;
    const space = overlay.querySelector<HTMLElement>('.opening-depth')!;
    const feature = overlay.querySelector<HTMLElement>('.opening-feature')!;
    const verse = feature.querySelector<HTMLElement>('.opening-verse')!;
    const source = feature.querySelector<HTMLElement>('.opening-source')!;
    skip = overlay.querySelector<HTMLButtonElement>('button')!;
    events = new AbortController();
    const { signal } = events;
    // Count visible playback time independently of animation completion or frames.
    armWatchdog();
    document.body.append(overlay);
    app.inert = true; active = true;
    skip.addEventListener('click', finish, { signal });
    document.addEventListener('keydown', event => {
      overlay?.classList.add('opening-keyboard');
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); finish(); }
      else if (event.key === 'Tab') { event.preventDefault(); skip?.focus({ preventScroll: true }); }
      else if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)
        || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')) event.preventDefault();
    }, { signal, capture: true });
    overlay.addEventListener('wheel', event => event.preventDefault(), { signal, passive: false });
    reduced.addEventListener('change', () => { if (reduced.matches) finish(); }, { signal });
    window.addEventListener('pagehide', finish, { signal });
    window.addEventListener('error', finish, { signal });
    window.addEventListener('unhandledrejection', finish, { signal });
    skip.focus({ preventScroll: true });

    const animate = (node: HTMLElement, frames: Keyframe[], delay: number, duration: number, easing = 'ease-out', fill: FillMode = 'both') => {
      const animation = node.animate(frames, { delay, duration, easing, fill });
      animations.push(animation); return animation;
    };
    const lanes = [[-.70, -.72], [.55, -.60], [-.38, .65], [.76, .72], [-.77, .18], [.68, -.20], [-.05, -.86], [.13, .89], [-.90, -.34], [.16, -.42], [-.45, -.10], [.39, .36]];
    const count = Math.min(mobile ? 6 : 12, phrases.length);
    const flights: { line: HTMLElement; animation: Animation }[] = [];
    const flightFrames = (i: number): Keyframe[] => {
      const [x, y] = lanes[i];
      const dx = x * innerWidth * .51, dy = y * innerHeight * .47;
      const transform = (z: number) => `translate3d(${dx}px,${dy}px,${z}px) translate(-50%,-50%)`;
      return [
        { transform: transform(-1700), opacity: 0, offset: 0 },
        { transform: transform(-1100), opacity: .14, offset: .16 },
        { transform: transform(-300), opacity: i % 3 === 0 ? .66 : .38, offset: .55 },
        { transform: transform(220), opacity: .25, offset: .82 },
        { transform: transform(570), opacity: 0, offset: 1 },
      ];
    };
    const sizeFlight = (line: HTMLElement, i: number) => {
      const narrow = innerWidth <= 600;
      line.hidden = narrow && i >= 6;
      line.style.fontSize = `${(narrow ? 18 : Math.min(34, Math.max(24, innerWidth * .018))) + i % 3 * 2}px`;
      const characters = Array.from(phrases[i]);
      line.textContent = narrow && characters.length > 10 ? characters.slice(0, 10).join('') + '…' : phrases[i];
    };
    for (let i = 0; i < count; i++) {
      const line = document.createElement('span'); line.className = 'opening-line';
      sizeFlight(line, i); space.append(line);
      flights.push({ line, animation: animate(line, flightFrames(i), 60 + i % 4 * 145, 2130, 'linear') });
    }

    const targetText = landing.querySelector<HTMLElement>('#showcase-text')!;
    const targetSource = landing.querySelector<HTMLElement>('#showcase-source')!;
    const hasPoems = Object.values(collection).some(entries => entries.length);
    let centered = '', canLand = false;
    let arrival: Animation | undefined, departure: Animation | undefined;
    const arrivalFrames = (): Keyframe[] => [{ transform: centered, opacity: 0 }, { transform: centered, opacity: 1 }];
    const departureFrames = (): Keyframe[] => [{ transform: centered, opacity: 1 }, { transform: canLand ? 'none' : centered, opacity: canLand ? 1 : 0 }];
    const layoutFeature = () => {
      const rect = landing.getBoundingClientRect();
      canLand = hasPoems && rect.top >= 24 && rect.bottom <= innerHeight - 16 && rect.height <= innerHeight * .28 && rect.width > 0;
      feature.style.cssText = ''; verse.style.cssText = ''; source.style.cssText = '';
      feature.classList.toggle('opening-feature-centered', !canLand);
      if (canLand) {
        verse.textContent = targetText.textContent;
        source.textContent = targetSource.textContent;
        for (const [from, to] of [[targetText, verse], [targetSource, source]]) {
          const css = getComputedStyle(from);
          for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'white-space', 'overflow-wrap', 'margin-top', 'color']) {
            to.style.setProperty(property, css.getPropertyValue(property));
          }
        }
        Object.assign(feature.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
        // offsetHeight is unaffected by the current animation's scale/translation.
        const height = feature.offsetHeight;
        const scale = Math.min(1.3, (innerWidth - 48) / rect.width, innerHeight * .3 / Math.max(1, height));
        centered = `translate(${innerWidth / 2 - (rect.left + rect.width / 2)}px,${innerHeight * .47 - (rect.top + height / 2)}px) scale(${scale})`;
      } else {
        // Keep a short central phrase when the strip is below the fold or unusually tall.
        verse.textContent = hasPoems ? openingPhrases({ opening: [{ text: targetText.textContent ?? '', title: '', author: '', dynasty: '', url: '' }] }, innerWidth <= 600 ? 18 : 32)[0] : '余韵';
        source.textContent = hasPoems ? targetSource.textContent : '';
        centered = 'translate(-50%,-50%)';
      }
      landing.style.visibility = canLand ? 'hidden' : landingVisibility;
      (arrival?.effect as KeyframeEffect | undefined)?.setKeyframes(arrivalFrames());
      (departure?.effect as KeyframeEffect | undefined)?.setKeyframes(departureFrames());
    };
    layoutFeature();
    arrival = animate(feature, arrivalFrames(), 1550, 600);
    departure = animate(feature, departureFrames(), 2470, 850, 'cubic-bezier(.4,0,.2,1)', 'forwards');
    const reveal = animate(overlay.querySelector<HTMLElement>('.opening-curtain')!, [{ opacity: 1 }, { opacity: 0 }], 2480, 870);
    void reveal.finished.then(finish, finish);

    let width = innerWidth, height = innerHeight;
    const relayout = () => {
      layoutFrame = 0;
      if (finished) return;
      try {
        width = innerWidth; height = innerHeight;
        flights.forEach(({ line, animation }, i) => {
          sizeFlight(line, i); (animation.effect as KeyframeEffect).setKeyframes(flightFrames(i));
        });
        layoutFeature();
      } catch { finish(); }
    };
    window.addEventListener('resize', () => {
      // Startup panels can emit redundant resize events. Real changes update geometry
      // on the existing timeline rather than cancelling or restarting the opening.
      if (layoutFrame || pausedForVisibility || (width === innerWidth && height === innerHeight)) return;
      layoutFrame = requestAnimationFrame(relayout);
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !pausedForVisibility) {
        pausedForVisibility = true;
        clearTimeout(watchdog); cancelAnimationFrame(layoutFrame); layoutFrame = 0;
        watchdogRemaining = Math.max(0, watchdogRemaining - (performance.now() - resumedAt));
        for (const animation of animations) {
          if (animation.playState === 'running' || animation.pending) {
            animation.pause(); visibilityPaused.add(animation);
          }
        }
      } else if (!document.hidden && pausedForVisibility) {
        try {
          relayout(); if (finished) return;
          pausedForVisibility = false;
          for (const animation of visibilityPaused) animation.play();
          visibilityPaused.clear();
          armWatchdog();
        } catch { finish(); }
      }
    }, { signal });
  } catch {
    finish();
  }
}
