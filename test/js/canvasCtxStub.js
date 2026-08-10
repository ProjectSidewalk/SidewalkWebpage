/**
 * Test helper: a CanvasRenderingContext2D stand-in that records what was drawn.
 *
 * Explore's label rendering is pure geometry on a 2D context, so the cheapest faithful way to test it is to hand it
 * a recorder and read the calls back. Two kinds of thing are captured:
 *
 * - `alphas`, the globalAlpha in effect for each *painting* call. Recorded at paint time rather than by trusting
 *   that save/restore were called in the right order, since a restore() in the wrong place is exactly the bug worth
 *   catching (see exploreLabelDialogFade.test.js).
 * - the geometry of each call, for the tests that check the icon's decorations track its size
 *   (see labelIconSizing.test.js).
 *
 * jsdom's own canvas is a no-op without the optional `canvas` package, and a real context would not let us read
 * back what was drawn anyway, so a stub is the only option here rather than a shortcut.
 *
 * @returns {Object} A recording 2D-context stand-in.
 */
function makeRecordingCtx() {
    const savedAlphas = [];
    return {
        // Recorded output.
        alphas: [],    // globalAlpha in effect for each painting call, in order.
        arcs: [],      // { cx, cy, r, lineWidth }
        ellipses: [],  // { cx, cy, rx, ry }
        images: [],    // { dx, dy, w, h }
        texts: [],     // { t, x, y, font }
        saveCount: 0,

        // Context state the code under test sets.
        globalAlpha: 1,
        lineWidth: 1,
        strokeStyle: '',
        fillStyle: '',
        font: '',
        textAlign: '',

        save() { this.saveCount += 1; savedAlphas.push(this.globalAlpha); },
        restore() { this.globalAlpha = savedAlphas.pop(); },

        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},

        // lineWidth is captured with the arc rather than at stroke() time; the code under test sets it before its
        // arcs, and pairing it here is what lets a test compare stroke weight against the arc it painted.
        arc(cx, cy, r) { this.arcs.push({ cx, cy, r, lineWidth: this.lineWidth }); },
        ellipse(cx, cy, rx, ry) { this.ellipses.push({ cx, cy, rx, ry }); },

        drawImage(img, dx, dy, w, h) {
            this.images.push({ dx, dy, w, h });
            this.alphas.push(this.globalAlpha);
        },
        fillText(t, x, y) {
            this.texts.push({ t, x, y, font: this.font });
            this.alphas.push(this.globalAlpha);
        },
        fill() { this.alphas.push(this.globalAlpha); },
        stroke() { this.alphas.push(this.globalAlpha); },
        measureText: () => ({ width: 0 }),
    };
}

module.exports = { makeRecordingCtx };
