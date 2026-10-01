// Renders the README demo (GIF + static poster) and the GitHub social preview
// from the HTML scenes next to this file. Run with `npm run marketing:render`.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { app, BrowserWindow } = require("electron");
const ffmpegPath = require("ffmpeg-static");

const rootDir = path.resolve(__dirname, "..", "..");
const assetsDir = path.join(rootDir, "assets");
const framesDir = path.join(rootDir, "tmp", "marketing-frames");

const FPS = 12;
const DEMO_SECONDS = 12;
const POSTER_SECONDS = 9.6;
const GIF_WIDTH = 800;

async function openScene(file, width, height) {
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, partition: "marketing-render" },
  });
  window.webContents.setZoomFactor(1);
  await window.loadFile(path.join(__dirname, file));
  await window.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
  return window;
}

// Windows stay open until the app quits: destroying one while the next
// file:// page loads kills their shared renderer and fails the load.

// Two animation frames make sure the offscreen renderer painted the change.
function nextPaint(window) {
  return window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))"
  );
}

async function capture(window, filePath) {
  await nextPaint(window);
  const image = await window.webContents.capturePage();
  fs.writeFileSync(filePath, image.toPNG());
}

async function renderDemo() {
  const window = await openScene("demo.html", 1600, 900);
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const frameCount = FPS * DEMO_SECONDS;

  for (let i = 0; i < frameCount; i++) {
    await window.webContents.executeJavaScript(`renderFrame(${i / FPS})`);
    await capture(window, path.join(framesDir, `frame-${String(i).padStart(4, "0")}.png`));
  }

  await window.webContents.executeJavaScript(`renderFrame(${POSTER_SECONDS})`);
  const posterSource = path.join(framesDir, "poster.png");
  await capture(window, posterSource);

  const scale = `scale=${GIF_WIDTH}:-1:flags=lanczos`;
  const palette = path.join(framesDir, "palette.png");
  const frames = path.join(framesDir, "frame-%04d.png");

  execFileSync(ffmpegPath, [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(FPS),
    "-i",
    frames,
    "-vf",
    `${scale},palettegen=stats_mode=diff`,
    palette,
  ]);
  execFileSync(ffmpegPath, [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(FPS),
    "-i",
    frames,
    "-i",
    palette,
    "-lavfi",
    `${scale}[x];[x][1:v]paletteuse=dither=sierra2_4a`,
    path.join(assetsDir, "demo.gif"),
  ]);
  execFileSync(ffmpegPath, [
    "-y",
    "-loglevel",
    "error",
    "-i",
    posterSource,
    "-vf",
    scale,
    path.join(assetsDir, "demo-poster.png"),
  ]);
}

async function renderSocialPreview() {
  const window = await openScene("social-preview.html", 1280, 640);
  await capture(window, path.join(assetsDir, "social-preview.png"));
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(assetsDir, { recursive: true });
    await renderSocialPreview();
    await renderDemo();
    console.log(`Rendered demo.gif, demo-poster.png and social-preview.png in ${assetsDir}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }

  app.quit();
});
