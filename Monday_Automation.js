require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const http = require("http");
const { https } = require("follow-redirects");
const { exec } = require("child_process");

let CREATED = null;

async function getFileUrlFromAssetId(assetId) {
  console.log("Asset ID:", assetId);
  const query = `query {
    assets(ids: [${assetId}]) {
      id
      name
      public_url
    }
  }`;

  try {
    const response = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: process.env.MONDAY_API_TOKEN,
      },
      body: JSON.stringify({ query }),
    });

    const result = await response.json();
    const asset = result.data.assets[0];
    console.log("response:", asset);
    return asset?.public_url || null;
  } catch (error) {
    console.error("Failed to fetch file URL from Monday:", error);
    return null;
  }
}

async function copyAndRenameDirectory(sourceDir, newRootName, assetIds) {
  try {
    const dirName = process.env.DESTINATION_FOLDER_PATH;
    const destinationDir = path.join(dirName, newRootName);
    const attachmentsDir = path.join(destinationDir, "Attachments");

    await fs.copy(sourceDir, destinationDir);
    await fs.ensureDir(attachmentsDir);

    applyGreenLabelToFolder(destinationDir);
    console.log(`Copied directory to: ${destinationDir}`);

    // Loop through each assetId and download the corresponding file
    for (const assetId of assetIds) {
      const freshUrl = await getFileUrlFromAssetId(assetId);
      if (!freshUrl) {
        console.warn(`No URL for assetId: ${assetId}`);
        continue;
      }

      const decodedFileName = decodeURIComponent(
        path.basename(new URL(freshUrl).pathname)
      );
      const safeFileName = decodedFileName.replace(/[^\x20-\x7E]/g, "_");
      const destPath = path.join(attachmentsDir, safeFileName);
      const file = fs.createWriteStream(destPath);

      https
        .get(freshUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
          if (res.statusCode !== 200) {
            console.error(
              `❌ Failed download for ${safeFileName}. Status: ${res.statusCode}`
            );
            res.resume();
            return;
          }

          res.pipe(file);
          file.on("finish", () => {
            file.close(() => {
              console.log(`✅ Downloaded ${safeFileName}`);
            });
          });
        })
        .on("error", (err) => {
          fs.unlink(destPath, () => {});
          console.error(`❌ Download error for ${safeFileName}:`, err.message);
        });
    }
  } catch (error) {
    console.error("❌ Error in copyAndRenameDirectory:", error);
  }
}

async function getDirectoryTree(pulseName, pulseId) {
  console.log("Fetching data for pulseId:", pulseId);
  const mondayData = await fetchData(pulseId);

  //  ------------------------------------------------------ //

  // --- Part 1: Dynamically extract ALL Column Labels and their Indices ---
  // We'll store this in a way that allows easy lookup from index to label

  const columnLabelMaps = {}; // Stores { "Column Title": { "index": "Label Text" } }
  const targetColumnLabelTitles = ["Status", "Function", "Business Unit"];

  if (mondayData.data.items && mondayData.data.items.length > 0) {
    const firstItemColumnValues = mondayData.data.items[0].column_values;

    firstItemColumnValues.forEach((colValue) => {
      const columnTitle = colValue.column.title;

      if (targetColumnLabelTitles.includes(columnTitle)) {
        try {
          const settings = JSON.parse(colValue.column.settings_str || "{}");
          const labels = settings.labels || {};
          const indexToLabelMap = {}; // Map index to label text

          for (const index in labels) {
            if (labels.hasOwnProperty(index)) {
              const labelText = labels[index];
              if (labelText !== "") {
                indexToLabelMap[parseInt(index, 10)] = labelText; // Store as { numerical_index: "Label Text" }
              }
            }
          }
          columnLabelMaps[columnTitle] = indexToLabelMap;
        } catch (e) {
          console.error(
            `Error parsing settings_str for column '${columnTitle}':`,
            e
          );
        }
      }
    });
  }

  // Optional: Log the collected label maps for verification
  console.log("--- Collected Column Label Maps (Index to Label) ---");
  console.log(JSON.stringify(columnLabelMaps, null, 2));

  // --- Part 2: Extract Item Values and translate Indices to Labels ---

  const itemColumnLabels = {}; // This will store the final desired output
  const targetValueColumnTitles = [
    "Status",
    "Function",
    "Business Unit",
    "Start Date",
    "Attachments",
  ];

  if (mondayData.data.items && mondayData.data.items.length > 0) {
    const firstItemColumnValues = mondayData.data.items[0].column_values;

    firstItemColumnValues.forEach((colValue) => {
      const columnTitle = colValue.column.title;

      if (targetValueColumnTitles.includes(columnTitle)) {
        try {
          let parsedValue = null;
          if (colValue.value) {
            parsedValue = JSON.parse(colValue.value);
          }

          let finalValue = null;

          if (
            columnTitle === "Status" ||
            columnTitle === "Function" ||
            columnTitle === "Business Unit"
          ) {
            if (parsedValue && parsedValue.index !== undefined) {
              const index = parseInt(parsedValue.index, 10);
              // Look up the label using the index from our pre-built map
              if (
                columnLabelMaps[columnTitle] &&
                columnLabelMaps[columnTitle][index] !== undefined
              ) {
                finalValue = columnLabelMaps[columnTitle][index];
              } else {
                finalValue = `Index ${index} (Label Not Found)`; // Fallback if index not found
              }
            }
          } else if (columnTitle === "Start Date") {
            if (parsedValue && parsedValue.date) {
              finalValue = parsedValue.date; // For date, the value is the date string
            }
          } else if (columnTitle === "Attachments") {
            if (parsedValue?.files?.length > 0) {
              finalValue = parsedValue.files.map((file) => file.assetId);
            }
          }

          itemColumnLabels[columnTitle] = finalValue;
        } catch (e) {
          console.error(`Error parsing value for column '${columnTitle}':`, e);
        }
      }
    });
  }

  console.log("\n--- Extracted Item Values (Labels) ---");
  console.log(JSON.stringify(itemColumnLabels, null, 2));

  //  ------------------------------------------------------ //

  const functionFolder = itemColumnLabels["Function"] || "UnknownFunction";
  const businessFolder =
    itemColumnLabels["Business Unit"] || "UnknownBusinessUnit";
  const baseName = `${itemColumnLabels["Function"]}_${itemColumnLabels["Start Date"]}_${pulseName}`;

  // Directory where numbered folders will be created
  const parentDir = path.join(functionFolder, businessFolder);

  // Ensure parentDir exists (relative to your DestinationFolder)
  const destinationRoot = process.env.DESTINATION_FOLDER_PATH;
  const fullParentDir = path.join(destinationRoot, parentDir);

  // Read existing directories and find the next available number
  let nextNumber = 1;
  if (fs.existsSync(fullParentDir)) {
    const dirs = fs
      .readdirSync(fullParentDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    // Match folders like 0001_Function_StartDate_PulseName
    const regex = /^(\d{4})_/;
    const numbers = dirs
      .map((name) => {
        const match = name.match(regex);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter((num) => num !== null);

    if (numbers.length > 0) {
      nextNumber = Math.max(...numbers) + 1;
    }
  }

  // Pad the number to 4 digits
  const numberPrefix = String(nextNumber).padStart(4, "0");
  const baseDir = path.join(
    functionFolder,
    businessFolder,
    `${numberPrefix}_${baseName}`
  );
  console.log("Base Directory:", baseDir);

  return { newRootName: baseDir, assetIds: itemColumnLabels["Attachments"] };
}

// Function to apply a green label to a folder
function applyGreenLabelToFolder(folderPath) {
  const appleScriptCommand = `
      tell application "Finder"
        set theFolder to POSIX file "${folderPath}" as alias
        set label index of theFolder to 6 -- Green label
      end tell
    `;

  exec(`osascript -e '${appleScriptCommand}'`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error applying label: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`AppleScript Error: ${stderr}`);
      return;
    }
    console.log(`Green label applied to folder: ${folderPath}`);
  });
}

async function fetchData(pulseId) {
  let query = `query {
      items (ids: [${pulseId}]) {
        column_values {
          column {
            title
            settings_str   
          }
          value
          text
        }
      }
    }`;

  console.log("Query:", query);

  try {
    let response = await fetch("https://api.monday.com/v2", {
      method: "post",
      headers: {
        "Content-Type": "application/json",
        Authorization: process.env.MONDAY_API_TOKEN,
      },
      body: JSON.stringify({
        query: query,
      }),
    });

    let data = await response.json();
    console.log("Response data:", data);

    return data;
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

// Start the server

// Create an HTTP server that listens on port 80
const server = http.createServer(async (req, res) => {
  if (req.method === "POST") {
    // Collect the data from the request
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString(); // Convert Buffer to string
    });

    req.on("end", async () => {
      // Try to parse the body as JSON
      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch (e) {
        console.error("Invalid JSON received");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      // Console log the parsed JSON
      console.log("Received webhook payload:", parsedBody);

      // Check if there's a 'challenge' field in the JSON
      if (parsedBody.challenge) {
        // Respond with the challenge
        const response = {
          challenge: parsedBody.challenge,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      } else {
        // Extract 'pulseName' from the JSON payload
        console.log(parsedBody.event);
        const pulseName = parsedBody.event.pulseName;
        const pulseId = parsedBody.event.pulseId;

        if (!pulseName || !pulseId) {
          // If 'pulseName' is missing, respond with an error
          console.error(
            "pulseName or pulseID is missing from the JSON payload"
          );
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "pulseName is required" }));
          return;
        }

        // Sanitize 'pulseName' to remove special characters but leave spaces
        const safePulseName = pulseName.replace(/[^a-zA-Z0-9 ]/g, "");

        try {
          // Get the base directory asynchronously
          const { newRootName, assetIds } = await getDirectoryTree(
            safePulseName,
            pulseId
          );

          // Source Template Folder
          const sourceDir = process.env.SOURCE_FOLDER_PATH;

          if (!CREATED) {
            await copyAndRenameDirectory(sourceDir, newRootName, assetIds);
          } else {
            CREATED = false;
          }

          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Directory structure created.\n");
        } catch (error) {
          console.error("Error creating directories:", error);
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal Server Error\n");
        }
      }
    });
  } else {
    // For other request methods, return a 405 Method Not Allowed
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed\n");
  }
});

// Start the server on port from env or 80
server.listen(process.env.PORT || 80, () => {
  console.log(`Server is listening on port ${process.env.PORT || 80}`);
});
