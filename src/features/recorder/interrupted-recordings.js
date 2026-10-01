// The media-recorder backend streams audio to a temp WebM file and converts
// it when the recording stops. If the app dies before that (crash, killed
// process, power loss), the WebM stays in the temp folder. On the next start
// it is converted into the output folder, so the recording is not lost.
const fs = require("fs");
const path = require("path");

const TEMP_SUFFIX = ".webm";
const TEMP_FILE_PATTERN = /^(audio-recording-.+\.(wav|mp3))\.webm$/;

function tempPathFor(tempDir, outputPath) {
  return path.join(tempDir, `${path.basename(outputPath)}${TEMP_SUFFIX}`);
}

function findInterruptedRecordings(tempDir) {
  let names;

  try {
    names = fs.readdirSync(tempDir);
  } catch (_error) {
    return [];
  }

  return names
    .map((name) => name.match(TEMP_FILE_PATTERN))
    .filter(Boolean)
    .map(([name, fileName, format]) => ({
      tempPath: path.join(tempDir, name),
      fileName,
      format,
    }));
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (_error) {
    return 0;
  }
}

// rename() fails across volumes (temp folder vs. an external drive).
async function moveFile(fromPath, toPath) {
  try {
    await fs.promises.rename(fromPath, toPath);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }

    await fs.promises.copyFile(fromPath, toPath);
    await fs.promises.unlink(fromPath);
  }
}

// convert(inputPath, outputPath, format): Promise<void>
async function recoverInterruptedRecordings({ tempDir, outputDir, convert }) {
  const result = { recovered: [], keptRaw: [] };

  for (const { tempPath, fileName, format } of findInterruptedRecordings(tempDir)) {
    const outputPath = path.join(outputDir, fileName);

    // Empty: nothing was recorded. Output exists: the conversion finished,
    // only removing the temp file did not.
    if (fileSize(tempPath) === 0 || fs.existsSync(outputPath)) {
      await fs.promises.unlink(tempPath).catch(() => {});
      continue;
    }

    try {
      await convert(tempPath, outputPath, format);
      await fs.promises.unlink(tempPath).catch(() => {});
      result.recovered.push(outputPath);
    } catch (error) {
      // A WebM cut off mid-write may not convert; it still plays in most
      // players, so hand it over as it is instead of deleting it.
      console.error(`Cannot convert interrupted recording ${fileName}:`, error.message);
      await fs.promises.unlink(outputPath).catch(() => {});
      const rawPath = path.join(outputDir, path.basename(tempPath));
      await moveFile(tempPath, rawPath);
      result.keptRaw.push(rawPath);
    }
  }

  return result;
}

module.exports = {
  tempPathFor,
  findInterruptedRecordings,
  recoverInterruptedRecordings,
};
