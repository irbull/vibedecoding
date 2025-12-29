# Share the Vibe - Chrome Extension

A Chrome extension that allows you to share the current page URL to your Vibes collection with one click.

## Features

- 🔗 Share the current tab's URL with a single click
- ⚙️ Configurable API endpoint and API key
- 🎨 Beautiful dark theme UI
- 🔒 Secure storage of settings (synced across Chrome)

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `chrome-share` folder
6. The extension icon will appear in your toolbar

## Configuration

Before using the extension, you need to configure your API settings:

1. Click the extension icon in the toolbar
2. Click **⚙️ Settings** at the bottom of the popup
3. Enter your **API URL** (e.g., `https://your-project.supabase.co/functions/v1/share`)
4. Enter your **API Key**
5. Click **Save Settings**

## Usage

1. Navigate to any webpage you want to share
2. Click the **Share the Vibe** extension icon
3. The current page URL will be displayed
4. Click **Share Link** to send it to your API

## API Format

The extension sends a POST request to your configured Supabase API endpoint:

```http
POST <your-api-url>
Content-Type: application/json
apikey: <your-api-key>
Authorization: Bearer <your-api-key>
Prefer: return=minimal

{
  "url": "https://example.com/page-you-shared"
}
```

## File Structure

```
chrome-share/
├── manifest.json      # Extension configuration
├── popup.html         # Main popup UI
├── popup.css          # Popup styles
├── popup.js           # Popup logic
├── options.html       # Settings page
├── options.css        # Settings styles
├── options.js         # Settings logic
└── icons/
    ├── icon.svg       # Source icon
    ├── icon16.png     # 16x16 icon
    ├── icon32.png     # 32x32 icon
    ├── icon48.png     # 48x48 icon
    └── icon128.png    # 128x128 icon
```

## Permissions

- `activeTab` - Access the current tab's URL when you click the extension
- `storage` - Save your API settings securely

## Development

To modify the extension:

1. Make your changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

### Regenerating Icons

If you modify `icons/icon.svg`, regenerate the PNGs:

```bash
cd icons
rsvg-convert -w 16 -h 16 icon.svg -o icon16.png
rsvg-convert -w 32 -h 32 icon.svg -o icon32.png
rsvg-convert -w 48 -h 48 icon.svg -o icon48.png
rsvg-convert -w 128 -h 128 icon.svg -o icon128.png
```

## License

MIT
