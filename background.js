/**
 * Service Worker for MTG Card Lookup extension
 * Handles background tasks and API calls
 * Uses Lambda backend for OCR and card lookup
 */

const API_BASE = 'https://ol1tn98osl.execute-api.us-west-2.amazonaws.com/prod';
const API_ENDPOINT = `${API_BASE}/lookup`;
const API_ENDPOINT_BY_NAME = `${API_BASE}/lookup-by-name`;

/**
 * Convert data URL to base64 string (without the data URL prefix)
 */
function dataUrlToBase64(dataUrl) {
  const parts = dataUrl.split(',');
  return parts.length > 1 ? parts[1] : dataUrl;
}

/**
 * Perform card lookup via Lambda backend (OCR + Scryfall in one call)
 */
async function lookupCardFromImage(imageDataUrl) {
  try {
    console.log('Sending image to Lambda backend...');

    const base64Image = dataUrlToBase64(imageDataUrl);

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image })
    });

    if (!response.ok) {
      throw new Error('Lookup failed');
    }

    const data = await response.json();
    console.log('Lambda response:', data);
    return data;
  } catch (error) {
    console.error('Lambda lookup error:', error);
    throw error;
  }
}

/**
 * Perform card lookup by name via Lambda backend
 */
async function lookupCardByName(cardName) {
  try {
    console.log('Looking up card by name:', cardName);

    const response = await fetch(API_ENDPOINT_BY_NAME, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: cardName })
    });

    if (!response.ok) {
      throw new Error('Lookup failed');
    }

    const data = await response.json();
    console.log('Lambda response:', data);
    return data;
  } catch (error) {
    console.error('Lambda lookup error:', error);
    throw error;
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'lookupCard') {
    console.log('Card lookup request received from content script');

    lookupCardFromImage(request.imageData)
      .then(result => {
        console.log('Sending lookup result back to content script:', result);
        sendResponse({ success: true, ...result });
      })
      .catch(error => {
        console.error('Lookup failed:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }

  if (request.action === 'lookupCardByName') {
    console.log('Card lookup by name request received:', request.cardName);

    lookupCardByName(request.cardName)
      .then(result => {
        console.log('Sending lookup result back to content script:', result);
        sendResponse({ success: true, ...result });
      })
      .catch(error => {
        console.error('Lookup failed:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }
});

// Extension installed/updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('MTG Card Lookup extension installed');
});

