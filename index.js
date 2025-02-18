const fs = require("fs");
const path = require("path");
var JSZip = require("jszip");

// Load the JSON file

function updateRef(ref, map) {
  const oldName = ref[0];
  const oldX = ref[2];
  const oldY = ref[3];
  if (!map[oldName]) {
    //console.log("No mapping found for", oldName);
    return;
  }

  ref[0] = map[oldName].sheet;
  ref[1] = map[oldName].sheetSize;
  ref[2] = map[oldName].offsetX + oldX;
  ref[3] = map[oldName].offsetY + oldY;
}

function handleDataJson(filePath, map, doneCallback) {
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading the file:", err);
      return;
    }

    try {
      const jsonData = JSON.parse(data);
      const objectData = jsonData["project"][3];

      for (const object of objectData) {
        const objectName = object[0];
        const singleImageData = object[6];
        const animationData = object[7];
        if (objectName && singleImageData) {
          updateRef(singleImageData, map);
        }
        if (objectName && animationData) {
          for (const animation of animationData) {
            const frameData = animation[7];
            for (const frame of frameData) {
              updateRef(frame, map);
            }
          }
        }
      }

      // write data back to data.json
      fs.writeFile(filePath, JSON.stringify(jsonData), (err) => {
        if (err) {
          console.error("Error writing the file:", err);
          return;
        }
        console.log("File has been written");
        if (doneCallback) {
          doneCallback();
        }
      });
    } catch (error) {
      console.error("Error parsing JSON:", error);
    }
  });
}

function preserveOldSheets(filePath, doneCallback) {
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading the file:", err);
      return;
    }

    try {
      const jsonData = JSON.parse(data);
      const objectData = jsonData["project"][3];
      const sheetNameMap = {};
      for (const object of objectData) {
        const objectName = object[0];
        const singleImageData = object[6];
        const animationData = object[7];
        if (objectName && singleImageData) {
          const sheetName = singleImageData[0];
          if (sheetName) {
            sheetNameMap[sheetName] = sheetNameMap[sheetName] || 0;
            sheetNameMap[sheetName]++;
          }
        }
        if (objectName && animationData) {
          for (const animation of animationData) {
            const frameData = animation[7];
            for (const frame of frameData) {
              const sheetName = frame[0];
              if (sheetName) {
                sheetNameMap[sheetName] = sheetNameMap[sheetName] || 0;
                sheetNameMap[sheetName]++;
              }
            }
          }
        }
      }

      for (const sheetName in sheetNameMap) {
        const sheetCount = sheetNameMap[sheetName];
        if (sheetCount === 1) {
          maybeCreateFolders(`oldSheets/${sheetName}`);
          if (fs.existsSync(`temp/${sheetName}`)) {
            fs.copyFileSync(`temp/${sheetName}`, `oldSheets/${sheetName}`);
            fs.unlinkSync(`temp/${sheetName}`);
          }
        }
      }

      if (doneCallback) {
        doneCallback();
      }
    } catch (error) {
      console.error("Error parsing JSON:", error);
    }
  });
}

function zipFolder(folderPath, zip) {
  const files = fs.readdirSync(folderPath);
  files.forEach((file) => {
    const filePath = path.join(folderPath, file);
    if (fs.lstatSync(filePath).isDirectory()) {
      zip.folder(file);
      zipFolder(filePath, zip.folder(file));
    } else {
      zip.file(file, fs.readFileSync(filePath));
    }
  });
}

function rePackSheets(source, destination) {
  // run TexturePacker config.tps --sheet sheet{n}.png --data sheet{n}.json source
  if (fs.existsSync(destination)) {
    fs.rmdirSync(destination, { recursive: true });
  }
  fs.mkdirSync(destination);
  const exec = require("child_process").exec;
  exec(
    `"C:/Program Files/CodeAndWeb/TexturePacker/bin/TexturePacker.exe" config.tps --sheet ${destination}/sheet{n}.webp --data ${destination}/sheet{n}.json ${source}`,
    (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return;
      }
      console.log(`stdout: ${stdout}`);
      console.log(`stderr: ${stderr}`);

      let map = createOldToNewMap(destination);
      handleDataJson("temp/data.json", map, () => {
        if (fs.existsSync(source)) {
          fs.rmdirSync(source, { recursive: true });
        }
        fs.mkdirSync(source);
        const files = fs.readdirSync(destination);
        files.forEach((file) => {
          if (file.endsWith(".webp")) {
            maybeCreateFolders(`${source}/${file}`);
            fs.copyFileSync(`${destination}/${file}`, `${source}/${file}`);
          }
        });

        const files2 = fs.readdirSync("oldSheets/images");
        files2.forEach((file) => {
          if (file.endsWith(".webp")) {
            maybeCreateFolders(`${source}/${file}`);
            fs.copyFileSync(`oldSheets/images/${file}`, `${source}/${file}`);
          }
        });

        // create a new zip file
        const newZip = new JSZip();
        const newZipFilePath = "newGame.zip";
        fs.unlinkSync(newZipFilePath);
        zipFolder("temp", newZip);
        newZip
          .generateNodeStream({
            type: "nodebuffer",
            streamFiles: true,
            compression: "DEFLATE",
            compressionOptions: {
              level: 9,
            },
          })
          .pipe(fs.createWriteStream(newZipFilePath))
          .on("finish", function () {
            console.log(`Zip file ${newZipFilePath} written.`);
          });
      });
    }
  );
}

function createOldToNewMap(destination) {
  // read all sheet{n}.json files
  const sheetFiles = fs.readdirSync(destination);

  const oldToNewMap = {};
  sheetFiles.forEach((file) => {
    if (file.endsWith(".json")) {
      const associatedImageData = file.replace(".json", ".webp");
      // get byte size of the image
      const stats = fs.statSync(`${destination}/${associatedImageData}`);
      const fileSizeInBytes = stats.size;
      const data = fs.readFileSync(`${destination}/${file}`);
      const jsonData = JSON.parse(data);
      const frames = jsonData["frames"];
      Object.keys(frames).forEach((key) => {
        const frame = frames[key];
        const oldName = "images/" + key;
        const offsetX = frame["frame"]["x"];
        const offsetY = frame["frame"]["y"];
        oldToNewMap[oldName] = {
          sheet: "images/" + associatedImageData,
          sheetSize: fileSizeInBytes,
          offsetX,
          offsetY,
        };
      });
    }
  });

  return oldToNewMap;
}

// Load the ZIP file
const zipFilePath = "game.zip";

function maybeCreateFolders(filePath) {
  const folder = path.dirname(filePath);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

if (fs.existsSync("temp")) {
  fs.rmdirSync("temp", { recursive: true });
}
fs.mkdirSync("temp");

if (fs.existsSync("oldSheets")) {
  fs.rmdirSync("oldSheets", { recursive: true });
}
fs.mkdirSync("oldSheets");

if (fs.existsSync("newSheets")) {
  fs.rmdirSync("newSheets", { recursive: true });
}
fs.mkdirSync("newSheets");

// extract the zip file to temp folder
fs.readFile(zipFilePath, function (err, data) {
  if (err) throw err;
  JSZip.loadAsync(data).then(function (zip) {
    const promises = [];
    zip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return;
      promises.push(
        zipEntry.async("nodebuffer").then((content) => {
          const filePath = `temp/${relativePath}`;
          maybeCreateFolders(filePath);
          fs.writeFileSync(filePath, content);
        })
      );
    });
    Promise.all(promises).then(() => {
      preserveOldSheets("temp/data.json", () => {
        rePackSheets("temp/images", "newSheets");
      });
    });
  });
});
