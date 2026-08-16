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
    console.log(formatImage(row[2]));
    img.src = row.length > 2 ? formatImage(row[2]) : imagePath;
}

async function imagePixelPopIn(img, pixelSizes = [48, 24, 12, 6], opts = {}) {
    const { popDuration = 240, layerSweep = 700, revealDuration = 220 } = opts;

    // Backward compatible with the old imagePixelPopIn(img, 10) signature.
    if (typeof pixelSizes === 'number') {
        const finest = Math.max(1, Math.round(pixelSizes));
        pixelSizes = [finest * 4, finest * 2, finest];
    }
    pixelSizes = [...new Set(pixelSizes.map(n => Math.max(1, Math.round(n))))]
        .sort((a, b) => b - a); // coarsest first

    // --- Set up canvas over the image ---
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
    img.style.opacity = '0'; // hide real image until the final reveal

    const ctx = canvas.getContext('2d');

    // Sample the real image's colors once, at full resolution.
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Average color of a block (bounded sampling so large early blocks read
    // as a proper mosaic tile rather than one stray pixel).
    function getBlockColor(x0, y0, w, h) {
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

    function easeOutBack(t) {
        const s = 1.55;
        return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    }

    // Accumulates every block that has already settled, from this layer and
    // all previous ones, so each new layer pops in *over* the last mosaic
    // instead of over a blank canvas.
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = canvas.width;
    baseCanvas.height = canvas.height;
    const baseCtx = baseCanvas.getContext('2d');

    // Runs a single pop-in layer at the given block size; resolves once every
    // block in it has settled (and been baked into baseCanvas).
    function runLayer(pixelSize) {
        return new Promise((resolve) => {
            const cols = Math.ceil(canvas.width / pixelSize);
            const rows = Math.ceil(canvas.height / pixelSize);

            // Group cells into diagonals for the sweeping wave effect.
            const diagonals = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const color = getBlockColor(c * pixelSize, r * pixelSize, pixelSize, pixelSize);
                    const d = c + r;
                    (diagonals[d] || (diagonals[d] = [])).push({ c, r, color });
                }
            }

            // Scale delay-per-wave so every layer's sweep takes ~layerSweep ms
            // of wall-clock time, regardless of how many diagonals a finer grid
            // produces.
            const delay = Math.max(4, layerSweep / diagonals.length);

            const active = [];
            let diagIdx = 0, lastWave = null;

            function tick(now) {
                if (lastWave === null) lastWave = now;

                // While loop (not if) so we catch up multiple waves in one frame
                // when delay is smaller than the frame interval.
                while (diagIdx < diagonals.length && now - lastWave >= delay) {
                    diagonals[diagIdx].forEach(p => active.push({ ...p, start: now }));
                    diagIdx++;
                    lastWave += delay;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(baseCanvas, 0, 0); // previously settled layers, as backdrop

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
                        // Settled: bake into the base and stop tracking it, so future
                        // frames only do work for cells still mid-animation.
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

    // Run each layer in sequence, coarsest first, each one refining the last.
    for (const pixelSize of pixelSizes) {
        await runLayer(pixelSize);
    }

    // Final resolution: crossfade the real, sharp image in under the canvas,
    // then fade the canvas away to reveal it.
    canvas.style.transition = `opacity ${revealDuration}ms ease-out`;
    img.style.transition = `opacity ${revealDuration}ms ease-out`;
    img.style.opacity = '1';
    requestAnimationFrame(() => { canvas.style.opacity = '0'; });
    await new Promise(resolve => setTimeout(resolve, revealDuration + 20));

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

    const img = document.querySelector("img");
    img.addEventListener("load", async () => { 
        await imagePixelPopIn(img, 10);
    });
});