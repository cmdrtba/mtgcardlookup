/**
 * Content script for MTG Card Lookup extension
 * Runs on YouTube pages and listens for backtick (`) key press
 */

// Global cursor position tracking
let currentCursorX = 0;
let currentCursorY = 0;

// Track mouse position globally
document.addEventListener('mousemove', (event) => {
  currentCursorX = event.clientX;
  currentCursorY = event.clientY;
});

// Listen for backtick key press
document.addEventListener('keydown', (event) => {
  // Debug logging to help diagnose key press issues
  console.log('Key pressed:', event.key, 'Code:', event.code, 'Shift:', event.shiftKey);

  // Handle escape key to dismiss any open overlay
  if (event.key === 'Escape') {
    dismissOverlay();
    return;
  }

  // Check if the key pressed is backtick (`)
  if (event.key === '`') {
    // Don't trigger if user is typing in an input field
    const target = event.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }

    event.preventDefault();
    handleCardLookup();
  }

  // Check if the key pressed is tilde (~) for debug mode
  // Tilde requires Shift+backtick on most keyboards
  if (event.key === '~' || (event.shiftKey && event.key === '`') || (event.shiftKey && event.code === 'Backquote')) {
    // Don't trigger if user is typing in an input field
    const target = event.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }

    event.preventDefault();
    handleDebugMode();
  }
});

/**
 * Handle card lookup when backtick is pressed
 */
function handleCardLookup() {
  // Use the globally tracked cursor position
  const cursorX = currentCursorX;
  const cursorY = currentCursorY;

  // Show loading spinner immediately
  showLoadingSpinner(null, 'Looking up card...');

  // Capture region and send to backend
  performCardLookup(cursorX, cursorY)
    .then((result) => {
      dismissOverlay();
      if (result.found && result.card && result.card.imageUrl) {
        showCardOverlay(result.card);
      } else {
        showFallbackInput(result.detectedName || '', 'No card detected. Please enter card name manually.');
      }
    })
    .catch(() => {
      dismissOverlay();
      showFallbackInput('', 'Unable to detect card. Please enter card name manually.');
    });
}

/**
 * Perform card lookup via Lambda backend
 * Captures region, sends to backend which does OCR + Scryfall lookup
 * @param {number} cursorX - X coordinate of cursor
 * @param {number} cursorY - Y coordinate of cursor
 * @returns {Promise<Object>} - Result with found, card, detectedName
 */
async function performCardLookup(cursorX, cursorY) {
  const regionWidth = 125;
  const regionHeight = 60;
  const canvas = captureRegionAroundCursor(cursorX, cursorY, regionWidth, regionHeight);

  if (!canvas) {
    throw new Error('Failed to capture region');
  }

  const imageDataUrl = canvas.toDataURL('image/png');

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'lookupCard', imageData: imageDataUrl },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response && response.success) {
          resolve({ found: response.found, card: response.card, detectedName: response.detectedName });
        } else {
          reject(new Error(response?.error || 'Lookup failed'));
        }
      }
    );
  });
}

/**
 * Handle debug mode when tilde (~) is pressed
 * Shows what the backend is seeing and the OCR result
 */
function handleDebugMode() {
  const cursorX = currentCursorX;
  const cursorY = currentCursorY;

  console.log('Debug mode triggered at:', cursorX, cursorY);

  try {
    const regionWidth = 125;
    const regionHeight = 60;
    const canvas = captureRegionAroundCursor(cursorX, cursorY, regionWidth, regionHeight);

    if (!canvas) {
      showDebugOverlay(null, cursorX, cursorY, 'Failed to capture region');
      return;
    }

    // Show loading state
    showDebugOverlay(canvas, cursorX, cursorY, null, 'Calling backend...', 'Lambda Backend');

    // Call the backend and show the OCR result
    const imageDataUrl = canvas.toDataURL('image/png');
    chrome.runtime.sendMessage(
      { action: 'lookupCard', imageData: imageDataUrl },
      (response) => {
        if (chrome.runtime.lastError) {
          showDebugOverlay(canvas, cursorX, cursorY, `Error: ${chrome.runtime.lastError.message}`);
          return;
        }

        if (response && response.success) {
          const detectedText = response.detectedName || '(no text detected)';
          const cardInfo = response.found && response.card
            ? `Card found: ${response.card.name}`
            : 'No card match found';
          showDebugOverlay(canvas, cursorX, cursorY, null, `OCR Result: "${detectedText}"\n${cardInfo}`, 'Lambda Backend');
        } else {
          showDebugOverlay(canvas, cursorX, cursorY, `Backend error: ${response?.error || 'Unknown error'}`);
        }
      }
    );
  } catch (error) {
    showDebugOverlay(null, cursorX, cursorY, `Error: ${error.message}`);
  }
}



/**
 * Capture a region of the screen around the cursor position
 * @param {number} cursorX - X coordinate of cursor
 * @param {number} cursorY - Y coordinate of cursor
 * @param {number} regionWidth - Width of the region to capture (in pixels)
 * @param {number} regionHeight - Height of the region to capture (in pixels)
 * @returns {HTMLCanvasElement|null} - Canvas with captured region or null if failed
 */
function captureRegionAroundCursor(cursorX, cursorY, regionWidth, regionHeight) {
  try {
    // Calculate region bounds
    const startX = Math.max(0, cursorX - regionWidth / 2);
    const startY = Math.max(0, cursorY - regionHeight / 2);
    const endX = Math.min(window.innerWidth, startX + regionWidth);
    const endY = Math.min(window.innerHeight, startY + regionHeight);

    const width = endX - startX;
    const height = endY - startY;

    // Create canvas at 2x resolution for better OCR quality
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Try to capture video content first
    const video = document.querySelector('video');
    let capturedContent = false;

    if (video && video.readyState >= 2) { // HAVE_CURRENT_DATA or better
      try {
        // Get video element's position and dimensions
        const videoRect = video.getBoundingClientRect();

        // Check if cursor region overlaps with video
        if (startX < videoRect.right && endX > videoRect.left &&
            startY < videoRect.bottom && endY > videoRect.top) {

          // Calculate scaling factors from video display size to actual video dimensions
          const scaleX = video.videoWidth / videoRect.width;
          const scaleY = video.videoHeight / videoRect.height;

          // Calculate source coordinates on the video
          const sourceX = Math.max(0, (startX - videoRect.left) * scaleX);
          const sourceY = Math.max(0, (startY - videoRect.top) * scaleY);
          const sourceWidth = Math.min(video.videoWidth - sourceX, width * scaleX);
          const sourceHeight = Math.min(video.videoHeight - sourceY, height * scaleY);

          // Draw from video to canvas
          ctx.drawImage(video,
            sourceX, sourceY, sourceWidth, sourceHeight,  // source rect
            0, 0, width, height);  // dest rect

          capturedContent = true;
        }
      } catch (videoError) {
        // Video capture failed (possibly cross-origin), will fall back
        console.debug('Video capture failed:', videoError.message);
      }
    }

    // If video capture didn't work, try to capture images under cursor
    if (!capturedContent) {
      const elements = document.elementsFromPoint(cursorX, cursorY);

      for (const element of elements) {
        if (element.tagName === 'IMG') {
          try {
            const rect = element.getBoundingClientRect();

            // Check if image is in our region
            if (rect.right > startX && rect.left < endX &&
                rect.bottom > startY && rect.top < endY) {

              const x = Math.max(0, rect.left - startX);
              const y = Math.max(0, rect.top - startY);
              const imgWidth = Math.min(rect.width, width - x);
              const imgHeight = Math.min(rect.height, height - y);

              ctx.drawImage(element, x, y, imgWidth, imgHeight);
              capturedContent = true;
              break;
            }
          } catch (imgError) {
            // Image capture failed (possibly cross-origin), continue
            console.debug('Image capture failed:', imgError.message);
          }
        }
      }
    }

    // If still no content captured, fill with white as fallback
    if (!capturedContent) {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
    }

    return canvas;
  } catch (error) {
    console.error('captureRegionAroundCursor error:', error);
    return null;
  }
}

/**
 * Show loading spinner with detected card name or custom message
 * @param {string|null} cardName - The detected card name (optional)
 * @param {string} customMessage - Custom message to display (optional)
 */
function showLoadingSpinner(cardName, customMessage) {
  // Remove any existing overlay first
  dismissOverlay();

  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'mtg-overlay-backdrop';
  backdrop.id = 'mtg-backdrop';

  // Create loading spinner container
  const spinner = document.createElement('div');
  spinner.className = 'mtg-loading-spinner';
  spinner.id = 'mtg-loading-spinner';

  // Create spinner animation element
  const spinnerElement = document.createElement('div');
  spinnerElement.className = 'mtg-spinner';

  // Create loading text
  const loadingText = document.createElement('div');
  loadingText.className = 'mtg-loading-text';
  loadingText.id = 'mtg-loading-text';
  loadingText.textContent = customMessage || `Searching for: ${cardName}`;

  // Assemble and add to DOM
  spinner.appendChild(spinnerElement);
  spinner.appendChild(loadingText);
  document.body.appendChild(backdrop);
  document.body.appendChild(spinner);

  // Add dismiss handlers
  addDismissHandlers();
}

/**
 * Show card overlay with image
 * @param {Object} cardData - Card data from Scryfall
 */
function showCardOverlay(cardData) {
  // Remove any existing overlay first
  dismissOverlay();

  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'mtg-overlay-backdrop';
  backdrop.id = 'mtg-backdrop';

  // Create card overlay container
  const overlay = document.createElement('div');
  overlay.className = 'mtg-card-overlay';
  overlay.id = 'mtg-card-overlay';

  // Create close button
  const closeButton = document.createElement('button');
  closeButton.className = 'mtg-close-button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Close card overlay');
  closeButton.addEventListener('click', dismissOverlay);

  // Create container for card image(s)
  const cardContainer = document.createElement('div');
  cardContainer.className = 'mtg-card-container';

  // Create front card image
  const cardImage = document.createElement('img');
  cardImage.className = 'mtg-card-image';
  cardImage.src = cardData.imageUrl;
  cardImage.alt = cardData.name;
  cardContainer.appendChild(cardImage);

  // Add back face for double-faced cards (side by side like Arena)
  if (cardData.backImageUrl) {
    cardContainer.classList.add('mtg-double-faced');
    const backImage = document.createElement('img');
    backImage.className = 'mtg-card-image';
    backImage.src = cardData.backImageUrl;
    backImage.alt = cardData.name + ' (back)';
    cardContainer.appendChild(backImage);
  }

  // Assemble and add to DOM
  overlay.appendChild(closeButton);
  overlay.appendChild(cardContainer);
  document.body.appendChild(backdrop);
  document.body.appendChild(overlay);

  // Add dismiss handlers
  addDismissHandlers();
}

/**
 * Show fallback text input modal
 * @param {string} detectedText - Pre-filled text from OCR (if any)
 * @param {string} errorMessage - Error message to display (optional)
 */
function showFallbackInput(detectedText, errorMessage = '') {
  // Remove any existing overlay first
  dismissOverlay();

  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'mtg-overlay-backdrop';
  backdrop.id = 'mtg-backdrop';

  // Create modal container
  const modal = document.createElement('div');
  modal.className = 'mtg-text-input-modal';
  modal.id = 'mtg-text-input-modal';

  // Add error message if provided
  if (errorMessage) {
    const errorDiv = document.createElement('div');
    errorDiv.style.color = '#ff6b6b';
    errorDiv.style.fontSize = '12px';
    errorDiv.style.marginBottom = '10px';
    errorDiv.textContent = errorMessage;
    modal.appendChild(errorDiv);
  }

  // Create label
  const label = document.createElement('label');
  label.textContent = 'Enter card name:';
  label.style.color = 'white';
  label.style.fontSize = '14px';

  // Create input field
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Card name...';
  input.value = detectedText || '';
  input.setAttribute('aria-label', 'Card name input');

  // Create submit button
  const submitButton = document.createElement('button');
  submitButton.textContent = 'Search';
  submitButton.addEventListener('click', () => {
    const cardName = input.value.trim();
    if (cardName) {
      dismissOverlay();
      handleCardLookupWithName(cardName);
    }
  });

  // Allow Enter key to submit
  input.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      submitButton.click();
    }
  });

  // Assemble and add to DOM
  modal.appendChild(label);
  modal.appendChild(input);
  modal.appendChild(submitButton);
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  // Focus input for immediate typing
  input.focus();

  // Add dismiss handlers
  addDismissHandlers();
}

/**
 * Dismiss any active overlay
 */
function dismissOverlay() {
  const backdrop = document.getElementById('mtg-backdrop');
  const spinner = document.getElementById('mtg-loading-spinner');
  const overlay = document.getElementById('mtg-card-overlay');
  const modal = document.getElementById('mtg-text-input-modal');
  const debugOverlay = document.getElementById('mtg-debug-overlay');

  if (backdrop) backdrop.remove();
  if (spinner) spinner.remove();
  if (overlay) overlay.remove();
  if (modal) modal.remove();
  if (debugOverlay) debugOverlay.remove();
}

/**
 * Add event listeners for dismissing overlays
 */
function addDismissHandlers() {
  // Backdrop click to dismiss
  const backdrop = document.getElementById('mtg-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', dismissOverlay);
  }
  // Note: Escape key handling is already in the main keydown listener above
}

/**
 * Show debug overlay with captured canvas and OCR result
 * @param {HTMLCanvasElement|null} canvas - The captured canvas region
 * @param {number} cursorX - X coordinate of cursor
 * @param {number} cursorY - Y coordinate of cursor
 * @param {string} errorMessage - Optional error message to display
 * @param {string} detectedText - Optional text detected by OCR
 * @param {string} ocrMethod - The OCR method used (e.g., 'Gemini Vision API' or 'TextDetector (Native)')
 */
function showDebugOverlay(canvas, cursorX, cursorY, errorMessage = '', detectedText = null, ocrMethod = 'Gemini Vision API') {
  // Remove any existing overlay first
  dismissOverlay();

  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'mtg-overlay-backdrop';
  backdrop.id = 'mtg-backdrop';

  // Create debug overlay container
  const overlay = document.createElement('div');
  overlay.className = 'mtg-debug-overlay';
  overlay.id = 'mtg-debug-overlay';

  // Create close button
  const closeButton = document.createElement('button');
  closeButton.className = 'mtg-debug-close-button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Close debug overlay');
  closeButton.addEventListener('click', dismissOverlay);

  // Create title
  const title = document.createElement('div');
  title.className = 'mtg-debug-title';
  title.textContent = 'Debug Mode - OCR Detection';

  // Create OCR text display if available
  let ocrContainer = null;
  if (detectedText) {
    ocrContainer = document.createElement('div');
    ocrContainer.className = 'mtg-debug-ocr-container';
    ocrContainer.style.marginBottom = '15px';
    ocrContainer.style.padding = '10px';
    ocrContainer.style.backgroundColor = '#1a1a1a';
    ocrContainer.style.borderRadius = '4px';
    ocrContainer.style.borderLeft = '3px solid #00ff00';

    const ocrLabel = document.createElement('div');
    ocrLabel.style.fontSize = '12px';
    ocrLabel.style.color = '#888';
    ocrLabel.style.marginBottom = '5px';
    ocrLabel.textContent = `${ocrMethod} Text:`;

    const ocrTextElem = document.createElement('div');
    ocrTextElem.style.fontSize = '14px';
    ocrTextElem.style.color = '#00ff00';
    ocrTextElem.style.fontFamily = 'monospace';
    ocrTextElem.textContent = detectedText;

    ocrContainer.appendChild(ocrLabel);
    ocrContainer.appendChild(ocrTextElem);
  }

  // Create canvas container
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'mtg-debug-canvas-container';

  if (canvas) {
    // Convert canvas to image and display
    const img = document.createElement('img');
    img.className = 'mtg-debug-canvas-image';
    img.src = canvas.toDataURL();
    img.alt = 'Captured region for OCR';
    canvasContainer.appendChild(img);
  } else {
    const noCanvasMsg = document.createElement('div');
    noCanvasMsg.className = 'mtg-debug-no-canvas';
    noCanvasMsg.textContent = 'No canvas captured';
    canvasContainer.appendChild(noCanvasMsg);
  }

  // Add error message if provided
  if (errorMessage) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'mtg-debug-error';
    errorDiv.textContent = errorMessage;
    overlay.appendChild(errorDiv);
  }

  // Assemble and add to DOM
  overlay.appendChild(closeButton);
  overlay.appendChild(title);
  if (ocrContainer) {
    overlay.appendChild(ocrContainer);
  }
  overlay.appendChild(canvasContainer);
  document.body.appendChild(backdrop);
  document.body.appendChild(overlay);

  // Add dismiss handlers
  addDismissHandlers();
}

/**
 * Handle card lookup with a specific card name
 * Used by fallback text input - calls Scryfall directly
 * @param {string} cardName - The card name to search for
 */
function handleCardLookupWithName(cardName) {
  showLoadingSpinner(cardName);

  chrome.runtime.sendMessage(
    { action: 'lookupCardByName', cardName: cardName },
    (response) => {
      if (chrome.runtime.lastError) {
        showFallbackInput(cardName, `Error: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (response && response.success && response.found && response.card) {
        dismissOverlay();
        showCardOverlay(response.card);
      } else {
        showFallbackInput(cardName, `Card not found: "${cardName}"`);
      }
    }
  );
}

