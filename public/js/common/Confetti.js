/**
 * A short confetti burst, for the moments worth celebrating.
 *
 * Draws to a throwaway full-screen canvas above the page and removes it when the last piece has fallen, so it costs
 * nothing when it isn't running and never has to be cleaned up by its caller. A visitor who asked for less motion
 * gets nothing at all.
 */
class Confetti {
  // Brand colors, read from the design tokens rather than repeated here. Jade and blue keep the mix from reading as
  // one warm smear on the banana-heavy screens this fires over.
  static #COLOR_TOKENS = [
    '--color-banana-600', '--color-pine-500', '--color-orange-500',
    '--color-blue-500', '--color-purple-400', '--color-jade-400',
  ];

  static #GRAVITY = 0.0011; // Per ms², in canvas px — a piece should fall clear of a phone screen in about 2s.
  static #DRAG = 0.9985;

  /**
   * The largest backing store a canvas may have, in device pixels. iOS Safari refuses anything past roughly
   * 4096x4096: `getContext` still hands back a context, but every draw on it is a silent no-op, so the only symptom
   * is a celebration that never appears.
   */
  static MAX_CANVAS_AREA = 4096 * 4096;

  /**
   * The backing-store ratio to draw a canvas of the given CSS size at, capped to stay inside MAX_CANVAS_AREA.
   *
   * The cap bites on exactly the phones this fires over: a page with no viewport meta is laid out at ~980 CSS px
   * wide and a couple of thousand tall, which at devicePixelRatio 3 asks for ~19M device pixels. Such a page is
   * displayed at well under 1:1 anyway, so the ratio being given up buys no sharpness — and the ~75MB of RGBA it
   * would have allocated is cleared every frame.
   *
   * @param {number} width Canvas width in CSS px.
   * @param {number} height Canvas height in CSS px.
   * @param {number} [deviceRatio=1] The display's device pixel ratio.
   * @returns {number} The ratio to size the backing store by — never above `deviceRatio`, and below it whenever
   *      the full device ratio would exceed the area budget. Falls back to `deviceRatio` for a zero-area canvas.
   */
  static backingRatio(width, height, deviceRatio = 1) {
    const area = width * height;
    if (!(area > 0)) return deviceRatio;
    return Math.min(deviceRatio, Math.sqrt(Confetti.MAX_CANVAS_AREA / area));
  }

  /**
   * Fires a burst from the top of the viewport.
   *
   * @param {Object} [options]
   * @param {number} [options.count=90] How many pieces to throw.
   * @param {number} [options.duration=2600] How long, in ms, before the canvas is torn down.
   * @param {number} [options.zIndex=1000] Stacking order for the canvas, above whatever is being celebrated.
   */
  static burst({ count = 90, duration = 2600, zIndex = 1000 } = {}) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Token-only: a page that doesn't carry the design tokens gets no confetti rather than confetti in some color
    // frozen here, which would drift the moment the palette moved.
    const rootStyle = getComputedStyle(document.documentElement);
    const colors = Confetti.#COLOR_TOKENS
      .map((token) => rootStyle.getPropertyValue(token).trim())
      .filter(Boolean);
    if (!colors.length) return;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = `position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none;
      z-index: ${zIndex};`;
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    // The page may be laid out at a viewport far wider than the screen (mobile Validate ships no viewport meta), so
    // the canvas is sized in CSS pixels of that layout and the pieces are scaled to it.
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    const ratio = Confetti.backingRatio(width, height, window.devicePixelRatio || 1);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);

    const size = width / 40;

    // Thrown from two points near the top corners, the way a pair of party poppers would.
    const pieces = Array.from({ length: count }, (unused, i) => {
      const fromLeft = i % 2 === 0;
      const spread = (Math.random() - 0.5) * 1.1;
      return {
        x: width * (fromLeft ? 0.15 : 0.85),
        y: height * 0.12,
        vx: (fromLeft ? 0.45 : -0.45) + spread,
        vy: -(0.45 + Math.random() * 0.5),
        spin: (Math.random() - 0.5) * 0.02,
        angle: Math.random() * Math.PI,
        w: size * (0.7 + Math.random() * 0.6),
        h: size * (0.4 + Math.random() * 0.3),
        color: colors[i % colors.length],
      };
    });

    let previous = null;
    let elapsed = 0;
    const step = (now) => {
      const dt = previous === null ? 16 : Math.min(now - previous, 50); // Clamp: a backgrounded tab returns huge gaps.
      previous = now;
      elapsed += dt;

      ctx.clearRect(0, 0, width, height);
      for (const piece of pieces) {
        piece.vy += Confetti.#GRAVITY * dt;
        piece.vx *= Confetti.#DRAG;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.angle += piece.spin * dt;

        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.angle);
        ctx.globalAlpha = Math.max(0, 1 - (elapsed / duration) ** 3); // Fades only at the very end.
        ctx.fillStyle = piece.color;
        // Squashed on one axis as it spins, so each piece reads as a tumbling paper rectangle rather than a dot.
        ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h * Math.abs(Math.cos(piece.angle)));
        ctx.restore();
      }

      if (elapsed < duration) window.requestAnimationFrame(step);
      else canvas.remove();
    };
    window.requestAnimationFrame(step);
  }
}
