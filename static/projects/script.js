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

async function imagePixelPopIn(img, pixelSize = 10) {
    // Set up canvas over the image
    const canvas = document.createElement('canvas');
    canvas.width = img.offsetWidth;
    canvas.height = img.offsetHeight;
    canvas.style.cssText = `
    position: absolute;
    top: 0; left: 0;
    pointer-events: none;
  `;

    // Position the wrapper
    img.parentElement.style.position = 'relative';
    img.parentElement.appendChild(canvas);
    img.style.opacity = '0'; // hide real image until done

    const ctx = canvas.getContext('2d');

    // 🔑 Sample the real image colors first
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    function getPixelColor(col, row) {
        const x = Math.floor(col * pixelSize + pixelSize / 2);
        const y = Math.floor(row * pixelSize + pixelSize / 2);
        const i = (y * canvas.width + x) * 4;
        const [r, g, b, a] = imageData.data.slice(i, i + 4);
        return `rgba(${r},${g},${b},${a / 255})`;
    }

    // Build diagonals
    const cols = Math.ceil(canvas.width / pixelSize);
    const rows = Math.ceil(canvas.height / pixelSize);
    const diagonals = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const d = c + r;
            if (!diagonals[d]) diagonals[d] = [];
            diagonals[d].push({ c, r, color: getPixelColor(c, r) });
        }
    }

    // Animate
    await new Promise((resolve) => {
        const active = [];
        const duration = 260;
        const delay = 30;
        let diagIdx = 0, lastWave = null;

        function easeOutBack(t) {
            const s = 1.55;
            return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
        }

        function tick(now) {
            if (lastWave === null) lastWave = now;

            if (diagIdx < diagonals.length && now - lastWave >= delay) {
                diagonals[diagIdx].forEach(p => active.push({ ...p, start: now }));
                diagIdx++;
                lastWave = now;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let stillGoing = diagIdx < diagonals.length;

            active.forEach(p => {
                const t = Math.min((now - p.start) / duration, 1);
                const scale = t < 1 ? easeOutBack(t) : 1;
                const cx = p.c * pixelSize + pixelSize / 2;
                const cy = p.r * pixelSize + pixelSize / 2;
                const s = pixelSize * scale;
                ctx.fillStyle = p.color;
                ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
                if (t < 1) stillGoing = true;
            });

            stillGoing ? requestAnimationFrame(tick) : resolve();
        }

        requestAnimationFrame(tick);
    });

    // Swap canvas for real image
    img.style.opacity = '1';
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