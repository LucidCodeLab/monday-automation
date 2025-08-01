# 🗂️ Monday Automation – File & Folder Handler

This Node.js script automates folder creation and file downloads based on webhook events from [Monday.com](https://monday.com). When a webhook is received (via [Ngrok](https://ngrok.com)), it:

- Fetches pulse metadata (e.g., Status, Function, Business Unit)
- Creates a uniquely numbered folder
- Downloads any attached files from Monday.com into an `Attachments` subfolder
- Applies a green Finder label to the folder (macOS only)

---

## 🚀 Features

- ✅ Receives Monday.com webhook events via Ngrok tunnel
- 📁 Creates structured, versioned folders
- 📎 Downloads files from Monday.com `assetId`s
- 🍏 Applies macOS Finder label (green) to folders
- 🔐 Uses Monday.com GraphQL API

---

## 📦 Project Structure

```
monday-automation/
├── Monday_Automation.js      # Main automation script
├── SourceFolder/             # Template folder copied for each new item
└── DestinationFolder/        # Output folder with downloaded assets
```

---

## 🛠️ Installation

1. Clone the repo:

   ```bash
   git clone https://github.com/your-username/monday-automation.git
   cd monday-automation
   ```

2. Install dependencies:

   ```bash
   npm install fs-extra follow-redirects
   ```

3. Start the script:

   ```bash
   sudo node Monday_Automation.js
   ```

4. [Install Ngrok](https://ngrok.com/download) if you haven't already.

5. Start Ngrok to expose your local port 80:

   ```bash
   ngrok http 80
   ```

6. Copy the HTTPS URL provided by Ngrok (e.g., `https://abc123.ngrok.io`) and set it as the webhook URL in your Monday.com board automation.

---

## ⚙️ Configuration

- Update the hardcoded **Monday API token** in the script with your own.
- Customize the column titles in `targetColumnLabelTitles` and `targetValueColumnTitles` as needed.

---

## 🖥️ Usage Flow

1. Monday.com sends a webhook with `pulseId` and `pulseName`
2. The script:
   - Queries item data using GraphQL
   - Builds a folder path like:  
     `Function/Business Unit/0004_Function_StartDate_PulseName`
   - Copies contents of `SourceFolder` into the new path
   - Downloads attached files into `/Attachments`
   - Applies a green Finder label (macOS only)

---

## 🌐 Webhook Setup with Ngrok

1. Start the server:

   ```bash
   sudo node Monday_Automation.js
   ```

2. In a new terminal:

   ```bash
   ngrok http 80
   ```

3. Copy the Ngrok HTTPS forwarding URL (e.g., `https://abc123.ngrok.io`)

4. Add it to your Monday.com webhook automation:
   ```
   When status changes to something, send webhook to https://abc123.ngrok.io
   ```

---

## ✅ Example

Webhook payload:

```json
{
  "event": {
    "pulseId": 123456789,
    "pulseName": "Q2 Campaign Launch"
  }
}
```

Resulting folder:

```
DestinationFolder/
└── Marketing/Corporate/
    └── 0003_Marketing_2025-08-01_Q2 Campaign Launch/
        ├── [copied contents of SourceFolder]
        └── Attachments/
            └── campaign_brief.pdf
```

---

## 🔒 Notes

- Only works on macOS for label coloring (uses AppleScript)
- Folder numbering is auto-incremented
- Ensure Monday.com's GraphQL schema includes `public_url` for assets

---

## 📜 License

MIT — use, modify, and enjoy.
