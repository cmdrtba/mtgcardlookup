# MTG Card Lookup

A Chrome extension that identifies Magic: The Gathering cards on YouTube videos using OCR and displays card images from Scryfall.

## Features

- **Instant card lookup** - Press backtick (`` ` ``) while hovering over a card name on YouTube
- **OCR-powered detection** - Uses Google Gemini to read card names from video frames
- **Scryfall integration** - Fetches high-quality card images and data
- **Double-faced cards** - Displays both faces side by side (like MTG Arena)
- **Fallback search** - Manual text input when OCR fails
- **Clean UI** - Overlay dismisses with Escape key or clicking outside

## Installation

### From GitHub Release

1. Download the latest `.zip` from [Releases](../../releases)
2. Extract to a folder
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (toggle in top right)
5. Click **Load unpacked** and select the extracted folder

### From Source

```bash
git clone https://github.com/cmdrtba/mtgcardlookup.git
cd mtgcardlookup
```

Then load the folder as an unpacked extension (steps 3-5 above).

## Usage

1. Go to any YouTube video
2. Hover your cursor over a card name in the video
3. Press `` ` `` (backtick key)
4. The extension captures the area around your cursor, identifies the card, and shows the image
5. Press **Escape** or click outside to close

If OCR fails to detect a card, a text input appears where you can type the card name manually.

### Troubleshooting

Press `~` (tilde/shift+backtick) to enter **debug mode**. This shows:
- The captured image region sent to the backend
- The raw OCR text result
- Whether a card match was found

This helps diagnose issues like poor capture positioning or OCR misreads.

## Developer Setup

The extension uses a Lambda backend for OCR and Scryfall lookups. To deploy your own:

### Prerequisites

- [AWS CLI](https://aws.amazon.com/cli/) configured with credentials
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- [Google Gemini API key](https://aistudio.google.com/app/apikey)

### Deploy the Backend

1. Create an S3 bucket for deployment artifacts:
   ```bash
   aws s3 mb s3://your-bucket-name --region us-west-2
   ```

2. Deploy the SAM stack:
   ```bash
   cd sam-backend
   sam build
   sam deploy \
     --stack-name mtg-card-lookup \
     --s3-bucket your-bucket-name \
     --capabilities CAPABILITY_IAM \
     --parameter-overrides GeminiApiKey=YOUR_GEMINI_API_KEY
   ```

3. Get the API endpoint from the stack outputs:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name mtg-card-lookup \
     --query 'Stacks[0].Outputs[?OutputKey==`CardLookupApi`].OutputValue' \
     --output text
   ```

4. Update `background.js` with your API endpoint:
   ```javascript
   const API_ENDPOINT = 'https://your-api-id.execute-api.us-west-2.amazonaws.com/Prod/lookup';
   ```

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Chrome Extension│────▶│  API Gateway    │────▶│     Lambda      │
│                 │     │                 │     │                 │
│ - Captures frame│     │ - POST /lookup  │     │ - Gemini OCR    │
│ - Shows overlay │     │                 │     │ - Scryfall API  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Project Structure

```
mtgcardlookup/
├── manifest.json       # Chrome extension manifest
├── background.js       # Service worker - sends images to Lambda
├── content.js          # Content script - UI and capture logic
├── overlay.css         # Overlay styles
├── popup.html          # Extension popup (usage instructions)
├── images/             # Extension icons
└── sam-backend/
    ├── template.yaml   # SAM/CloudFormation template
    └── src/
        ├── index.js    # Lambda handler
        └── package.json
```

## License

Apache 2.0 - see [LICENSE](LICENSE)

