const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function writeText(element, text, delay) {
    element.innerHTML = "";
    for (let i = 0; i < text.length; i++) {
        await sleep(delay / (1 + (.1 * i)));
        element.innerHTML = text.substring(0, i + 1);
        if (i !== text.length - 1) {
            element.innerHTML += "_";
        }
    }
}

async function destroyText(element, t, delay) {
    const text = element.innerHTML;
    for (let i = 0; i < text.length; i++) {
        await sleep(delay / (1 + (.1 * i)));
        element.innerHTML = text.substring(0, text.length - i - 1);
        if (i !== text.length - 1) {
            element.innerHTML += "_";
        }
    }
}

const imagePath = "static/images/photo.jpg"
let labs = [];
let index = 0;

function formatImage(src) {
    const id = new URLSearchParams(src).get("https://drive.google.com/open?id");
    return `https://drive.google.com/thumbnail?id=${id}&sz=s800`;
}


async function render(row) {
    const writer = document.querySelector(".writer");
    const textBox = document.querySelector(".text-box");

    destroyText(writer, row[0], 100);
    await destroyText(textBox, row[1], 100);

    writeText(writer, row[0], 100);
    writeText(textBox, row[1], 100);

    const img = document.querySelector('img');
    const src = row.length > 2 ? formatImage(row[2]) : imagePath;
    console.log(src);
    imagePixelPopIn(img, src);
}

/**
 * Swaps an <img>'s source with a pixel-pop transition. If the image already
 * has content showing, it's first dissolved to white with a diagonal pixel
 * pop-in wave (using a frozen snapshot, so the animation keeps going even
 * after the src changes underneath it). Once the new image has loaded, the
 * same wave pops the real colors back in over that white base, cascading
 * from coarse to fine blocks, then crossfades to the sharp, full-resolution
 * image. If there's no previous content (e.g. the very first load), the
 * white-out step is skipped and it goes straight to the reveal.
 *
 * @param {HTMLImageElement} img
 * @param {string} newSrc              The image URL to transition to.
 * @param {number[]} [pixelSizes]      Reveal block sizes, largest first.
 *                                     The white-out reuses the coarsest one.
 * @param {object} [opts]
 * @param {number} [opts.popDuration=240]    ms for a single block's pop-in
 * @param {number} [opts.layerSweep=700]     target ms for one layer's
 *                                           diagonal wave to sweep the grid
 * @param {number} [opts.revealDuration=220] ms for the final crossfade to
 *                                           the real image
 */
async function imagePixelPopIn(img, newSrc, pixelSizes = [48, 24, 12, 6], opts = {}) {
    const { popDuration = 240, layerSweep = 700, revealDuration = 220 } = opts;

    pixelSizes = [...new Set(pixelSizes.map(n => Math.max(1, Math.round(n))))]
        .sort((a, b) => b - a); // coarsest first

    // This is the check the whole effect hinges on: was there already an
    // image showing before this call?
    const hasPreviousImage = img.complete && img.naturalWidth > 0 && !!img.getAttribute('src');

    // --- Set up one canvas overlay over the image, used for both phases ---
    const canvas = document.createElement('canvas');
    canvas.width = img.offsetWidth;
    canvas.height = img.offsetHeight;
    canvas.style.cssText = `
        position: absolute;
        top: 0; left: 0;
        pointer-events: none;
    `;

    img.parentElement.style.position = 'relative';
    img.parentElement.appendChild(canvas);

    const ctx = canvas.getContext('2d');

    // Accumulates every block that's already settled, so each wave pops in
    // over what's already there instead of over a blank canvas.
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = canvas.width;
    baseCanvas.height = canvas.height;
    const baseCtx = baseCanvas.getContext('2d');

    function easeOutBack(t) {
        const s = 1.55;
        return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    }

    // Average color of a block from a given ImageData, bounded-sampled so
    // large blocks read as a proper mosaic tile rather than one stray pixel.
    function sampleBlock(imageData, x0, y0, w, h) {
        const x1 = Math.min(canvas.width, x0 + w);
        const y1 = Math.min(canvas.height, y0 + h);
        const step = Math.max(1, Math.floor(Math.min(w, h) / 6));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let y = y0; y < y1; y += step) {
            for (let x = x0; x < x1; x += step) {
                const i = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
                r += imageData.data[i];
                g += imageData.data[i + 1];
                b += imageData.data[i + 2];
                a += imageData.data[i + 3];
                n++;
            }
        }
        if (!n) return 'rgba(0,0,0,0)';
        return `rgba(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0},${(a / n / 255).toFixed(3)})`;
    }

    // Runs one diagonal-wave pop-in layer at the given block size, using
    // colorFn(c, r) for each cell's color. Resolves once every block has
    // settled and been baked into baseCanvas.
    function runLayer(pixelSize, colorFn) {
        return new Promise((resolve) => {
            const cols = Math.ceil(canvas.width / pixelSize);
            const rows = Math.ceil(canvas.height / pixelSize);

            const diagonals = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const color = colorFn(c, r);
                    const d = c + r;
                    (diagonals[d] || (diagonals[d] = [])).push({ c, r, color });
                }
            }

            const delay = Math.max(4, layerSweep / diagonals.length);
            const active = [];
            let diagIdx = 0, lastWave = null;

            function tick(now) {
                if (lastWave === null) lastWave = now;

                while (diagIdx < diagonals.length && now - lastWave >= delay) {
                    diagonals[diagIdx].forEach(p => active.push({ ...p, start: now }));
                    diagIdx++;
                    lastWave += delay;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(baseCanvas, 0, 0);

                for (let i = active.length - 1; i >= 0; i--) {
                    const p = active[i];
                    const t = Math.min((now - p.start) / popDuration, 1);
                    const scale = t < 1 ? easeOutBack(t) : 1;
                    const cx = p.c * pixelSize + pixelSize / 2;
                    const cy = p.r * pixelSize + pixelSize / 2;
                    const s = pixelSize * scale;
                    ctx.fillStyle = p.color;
                    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);

                    if (t >= 1) {
                        baseCtx.fillStyle = p.color;
                        baseCtx.fillRect(p.c * pixelSize, p.r * pixelSize, pixelSize, pixelSize);
                        active.splice(i, 1);
                    }
                }

                if (diagIdx < diagonals.length || active.length) {
                    requestAnimationFrame(tick);
                } else {
                    resolve();
                }
            }

            requestAnimationFrame(tick);
        });
    }

    if (hasPreviousImage) {
        // Snapshot the current image now, before its src changes underneath it.
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const oldImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Seed the base with that snapshot, then hand off from the real <img>
        // to the canvas with no visible flicker.
        baseCtx.putImageData(oldImageData, 0, 0);
        img.style.opacity = '0';

        // One coarse wave is enough to wipe a photo to solid white quickly;
        // no need to cascade through finer sizes for a flat color.
        await runLayer(pixelSizes[0], () => '#ffffff');
    } else {
        img.style.opacity = '0';
    }

    // Load the new image, then sample its real colors at full resolution.
    await new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.src = newSrc;
    });

    // The new image may render at a different size (or aspect ratio) than
    // the old one — re-measure and resize both canvases to match, so we're
    // not sampling/drawing the new image into a leftover, wrongly-sized
    // buffer from before.
    const newWidth = img.offsetWidth || canvas.width;
    const newHeight = img.offsetHeight || canvas.height;
    if (newWidth !== canvas.width || newHeight !== canvas.height) {
        canvas.width = newWidth;
        canvas.height = newHeight;
        baseCanvas.width = newWidth;
        baseCanvas.height = newHeight;
        // Resizing a canvas clears it, so if we'd already wiped to white,
        // restore that fill at the new size before the reveal starts.
        if (hasPreviousImage) {
            baseCtx.fillStyle = '#ffffff';
            baseCtx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const newImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Cascade the new image's real colors in over the white (or blank) base.
    for (const pixelSize of pixelSizes) {
        await runLayer(pixelSize, (c, r) =>
            sampleBlock(newImageData, c * pixelSize, r * pixelSize, pixelSize, pixelSize)
        );
    }

    // Final resolution: crossfade the real, sharp image in under the canvas,
    // then fade the canvas away to reveal it.
    canvas.style.transition = `opacity ${revealDuration}ms ease-out`;
    img.style.transition = `opacity ${revealDuration}ms ease-out`;
    img.style.opacity = '1';
    requestAnimationFrame(() => { canvas.style.opacity = '0'; });
    await new Promise((resolve) => setTimeout(resolve, revealDuration + 20));

    canvas.remove();
}

async function pixelPopIn(canvas, ctx, options = {}) {
    const {
        pixelSize = 10,
        delay = 12,
        color = "#F66978",
        overshoot = 1.6,
        duration = 220,
    } = options;

    const W = canvas.width, H = canvas.height;
    const cols = Math.ceil(W / pixelSize);
    const rows = Math.ceil(H / pixelSize);

    const diagonals = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const d = c + r;
            if (!diagonals[d]) diagonals[d] = [];
            diagonals[d].push({ c, r });
        }
    }

    const active = [];
    let diagIdx = 0;
    let lastWave = 0;

    function easeOutBack(t) {
        const s = overshoot;
        return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    }

    return new Promise(resolve => {
        function tick(now) {
            if (diagIdx < diagonals.length && now - lastWave > delay) {
                diagonals[diagIdx].forEach(({ c, r }) => {
                    active.push({ c, r, color, start: now });
                });
                diagIdx++;
                lastWave = now;
            }

            ctx.clearRect(0, 0, W, H);

            active.forEach(p => {
                const t = Math.min((now - p.start) / duration, 1);
                const scale = t < 1 ? easeOutBack(t) : 1;
                const cx = p.c * pixelSize + pixelSize / 2;
                const cy = p.r * pixelSize + pixelSize / 2;
                const s = pixelSize * scale;

                ctx.fillStyle = p.color;
                ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
            });

            if (diagIdx < diagonals.length || active.some(p => (now - p.start) < duration)) {
                requestAnimationFrame(tick);
            } else {
                canvas.style.zIndex = -1;
                resolve();
            }
        }

        requestAnimationFrame(tick);
    });
}

document.addEventListener("DOMContentLoaded", async function () {
    const url = "https://sheets.wais-cshs.workers.dev/Labs";
    fetch(url)
        .then(res => res.json())
        .then(cells => {
            labs = cells.values.splice(1);
            labs = labs.map(lab => {
                return lab.splice(1);
            });
            index = 0;
            if (labs.length < 1) {
                labs = [["We have no labs/projects yet", "We'll add them to the site when we create our labs/projects. Please be as patient as possible."]]
            }
        });
    
        
    const canvas = document.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth / 2;
    canvas.height = window.innerHeight;
    await pixelPopIn(canvas, ctx);

    render(labs[index]);

    const links = document.querySelectorAll("a");
    links.forEach(link => {
        link.style.display = "block";
        writeText(link, link.innerHTML, 100);
    });

    const textBox = document.querySelector('.text-box');
    textBox.style.display = "block";
    writeText(textBox, textBox.innerHTML, 100);


    document.addEventListener("click", function () {
        index = (index + 1) % labs.length;
        render(labs[index]);
    });
});