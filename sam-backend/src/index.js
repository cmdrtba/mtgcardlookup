/**
 * MTG Card Lookup Lambda Handler
 */

const EXPECTED_WIDTH = 250;
const EXPECTED_HEIGHT = 120;
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const SCRYFALL_API_BASE = 'https://api.scryfall.com';
const SCRYFALL_RATE_LIMIT_MS = 100;

let lastScryfallCall = 0;

async function rateLimitScryfall() {
  const now = Date.now();
  const elapsed = now - lastScryfallCall;
  if (elapsed < SCRYFALL_RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, SCRYFALL_RATE_LIMIT_MS - elapsed));
  }
  lastScryfallCall = Date.now();
}

function validateImage(base64Image) {
  try {
    const buffer = Buffer.from(base64Image, 'base64');
    if (buffer.length < 24 || buffer[0] !== 0x89 || buffer[1] !== 0x50 ||
        buffer[2] !== 0x4E || buffer[3] !== 0x47) {
      return false;
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width === EXPECTED_WIDTH && height === EXPECTED_HEIGHT;
  } catch {
    return false;
  }
}

async function performOCR(base64Image, apiKey) {
  const requestBody = {
    contents: [{
      parts: [
        { text: 'Extract Magic: The Gathering card names visible in this image. Return ONLY the single card name closest to center. If none visible, respond NONE.' },
        { inline_data: { mime_type: 'image/png', data: base64Image } }
      ]
    }]
  };
  const resp = await fetch(`${GEMINI_API_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  if (!resp.ok) {
    const errorBody = await resp.text();
    console.error('Gemini API error response:', errorBody);
    if (resp.status === 401 || resp.status === 403) throw new Error('Invalid Gemini API key');
    if (resp.status === 429) throw new Error('Rate limit exceeded');
    throw new Error(`Gemini API error: ${resp.status} - ${errorBody}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.filter(p => p.text).map(p => p.text).join(' ').trim();
  return (!text || text === 'NONE') ? null : text;
}

function cleanCardName(text) {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ').replace(/[^a-zA-Z0-9\s\-']/g, '').substring(0, 50);
}

async function lookupCard(cardName) {
  await rateLimitScryfall();
  const resp = await fetch(`${SCRYFALL_API_BASE}/cards/named?fuzzy=${encodeURIComponent(cardName)}`);
  if (!resp.ok) {
    if (resp.status === 404) throw new Error(`Card not found: "${cardName}"`);
    throw new Error(`Scryfall API error: ${resp.status}`);
  }
  const c = await resp.json();
  // Handle double-faced cards (transform, modal_dfc) which have images in card_faces
  const isDoubleFaced = c.card_faces && !c.image_uris;
  const imageUris = c.image_uris || c.card_faces?.[0]?.image_uris;
  const result = {
    name: c.name, imageUrl: imageUris?.normal || imageUris?.large,
    set: c.set, setName: c.set_name, type: c.type_line,
    oracleText: c.oracle_text || c.card_faces?.[0]?.oracle_text,
    manaCost: c.mana_cost || c.card_faces?.[0]?.mana_cost, rarity: c.rarity
  };
  // Add back face for double-faced cards
  if (isDoubleFaced && c.card_faces[1]?.image_uris) {
    result.backImageUrl = c.card_faces[1].image_uris.normal || c.card_faces[1].image_uris.large;
  }
  return result;
}

// noinspection JSUnusedGlobalSymbols
export const handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const badRequest = { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request' }) };
  const path = event.path || event.requestContext?.http?.path || '';

  try {
    const body = JSON.parse(event.body || '{}');

    // Handle /lookup-by-name endpoint - direct card name lookup
    if (path.endsWith('/lookup-by-name')) {
      if (!body.name) return badRequest;
      const cardName = cleanCardName(body.name);
      if (!cardName) return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
      const card = await lookupCard(cardName);
      return { statusCode: 200, headers, body: JSON.stringify({ found: true, card }) };
    }

    // Handle /lookup endpoint - OCR + card lookup
    if (!body.image) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image' }) };
    const base64 = body.image.replace(/^data:image\/\w+;base64,/, '');
    if (!validateImage(base64)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid image' }) };
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server config error' }) };
    const ocrText = await performOCR(base64, apiKey);
    if (!ocrText) return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
    const cardName = cleanCardName(ocrText);
    if (!cardName) return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
    const card = await lookupCard(cardName);
    return { statusCode: 200, headers, body: JSON.stringify({ found: true, card, detectedName: cardName }) };
  } catch (e) {
    if (e.message.includes('not found')) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
    }
    console.error('Lambda error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
