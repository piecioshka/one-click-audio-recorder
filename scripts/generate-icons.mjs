import { access, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import pngToIco from "png-to-ico";

const execFile = promisify(execFileCallback);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const iconsDir = path.join(rootDir, "icons");

const pngSourcePath = path.join(iconsDir, "app-icon.png");

const outputPngPath = path.join(iconsDir, "app-icon.png");
const outputIcoPath = path.join(iconsDir, "app-icon.ico");
const outputIcnsPath = path.join(iconsDir, "app-icon.icns");

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icnsEntries = [
  { size: 16, filename: "icon_16x16.png" },
  { size: 32, filename: "icon_16x16@2x.png" },
  { size: 32, filename: "icon_32x32.png" },
  { size: 64, filename: "icon_32x32@2x.png" },
  { size: 128, filename: "icon_128x128.png" },
  { size: 256, filename: "icon_128x128@2x.png" },
  { size: 256, filename: "icon_256x256.png" },
  { size: 512, filename: "icon_256x256@2x.png" },
  { size: 512, filename: "icon_512x512.png" },
  { size: 1024, filename: "icon_512x512@2x.png" },
];

async function pathExists(candidatePath) {
  try {
    await access(candidatePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getSourcePath() {
  if (await pathExists(pngSourcePath)) {
    return pngSourcePath;
  }

  throw new Error("No icon source found. Expected icons/app-icon.png");
}

async function renderPng(sourcePath, size, destinationPath) {
  if (process.platform === "darwin") {
    await execFile("sips", [
      "-z",
      String(size),
      String(size),
      sourcePath,
      "--out",
      destinationPath,
    ]);
    return;
  }

  // Non-macOS fallback keeps the source size and lets downstream tooling scale as needed.
  await copyFile(sourcePath, destinationPath);
}

async function generateMainPng(sourcePath) {
  await copyFile(sourcePath, outputPngPath);
  console.log(`Generated ${path.relative(rootDir, outputPngPath)}`);
}

async function generateIco(sourcePath) {
  if (process.platform !== "darwin") {
    if (await pathExists(outputIcoPath)) {
      console.log(`Keeping existing ${path.relative(rootDir, outputIcoPath)} (non-macOS build).`);
      return;
    }

    throw new Error(
      "Missing icons/app-icon.ico. Generate it on macOS first (npm run icons:generate) and commit the file."
    );
  }

  const tempDir = path.join(tmpdir(), `one-click-audio-recorder-ico-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const pngPaths = [];

    for (const size of icoSizes) {
      const targetPath = path.join(tempDir, `icon-${size}.png`);
      await renderPng(sourcePath, size, targetPath);
      pngPaths.push(targetPath);
    }

    const icoBuffer = await pngToIco(pngPaths);
    await writeFile(outputIcoPath, icoBuffer);
    console.log(`Generated ${path.relative(rootDir, outputIcoPath)}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function generateIcns(sourcePath) {
  if (process.platform !== "darwin") {
    console.log("Skipping ICNS generation (iconutil is only available on macOS).");
    return;
  }

  const iconsetDir = path.join(tmpdir(), `one-click-audio-recorder-iconset-${Date.now()}.iconset`);
  await mkdir(iconsetDir, { recursive: true });

  try {
    for (const entry of icnsEntries) {
      await renderPng(sourcePath, entry.size, path.join(iconsetDir, entry.filename));
    }

    await execFile("iconutil", ["-c", "icns", iconsetDir, "-o", outputIcnsPath]);
    console.log(`Generated ${path.relative(rootDir, outputIcnsPath)}`);
  } finally {
    await rm(iconsetDir, { recursive: true, force: true });
  }
}

async function main() {
  const sourcePath = await getSourcePath();
  const relativeSourcePath = path.relative(rootDir, sourcePath);
  console.log(`Using source icon: ${relativeSourcePath}`);

  await generateMainPng(sourcePath);
  await generateIco(sourcePath);
  await generateIcns(sourcePath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
