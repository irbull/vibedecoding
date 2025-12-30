// DOM Elements
const currentUrlElement = document.getElementById('current-url');
const shareButton = document.getElementById('share-btn');
const statusElement = document.getElementById('status');
const optionsLink = document.getElementById('options-link');

// Lifestream Edge Function URL (new system)
const LIFESTREAM_URL = ''; // Lifestream URL

// Current tab URL
let currentTabUrl = '';

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab URL
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      currentTabUrl = tab.url;
      currentUrlElement.textContent = currentTabUrl;
    } else {
      currentUrlElement.textContent = 'Unable to get current URL';
      shareButton.disabled = true;
    }
  } catch (error) {
    console.error('Error getting tab URL:', error);
    currentUrlElement.textContent = 'Error getting URL';
    shareButton.disabled = true;
  }
});

// Share button click handler
shareButton.addEventListener('click', async () => {
  if (!currentTabUrl) {
    showStatus('No URL to share', 'error');
    return;
  }

  // Get settings from storage
  const settings = await chrome.storage.sync.get(['apiUrl', 'apiKey']);
  
  if (!settings.apiUrl || !settings.apiKey) {
    showStatus('Please configure API settings first', 'warning');
    // Open options page after a short delay
    setTimeout(() => {
      chrome.runtime.openOptionsPage();
    }, 1500);
    return;
  }

  // Disable button and show loading state
  shareButton.disabled = true;
  shareButton.classList.add('loading');
  const buttonText = shareButton.querySelector('.button-text');
  const originalText = buttonText.textContent;
  buttonText.textContent = 'Sharing';

  try {
    // POST to both endpoints in parallel
    const [oldResult, lifestreamResult] = await Promise.allSettled([
      // Old endpoint (existing articles table)
      fetch(settings.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': settings.apiKey,
          'Authorization': `Bearer ${settings.apiKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ url: currentTabUrl })
      }),
      // New lifestream endpoint
      fetch(LIFESTREAM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({ url: currentTabUrl, source: 'chrome' })
      })
    ]);

    // Log results for debugging
    console.log('Old endpoint result:', oldResult);
    console.log('Lifestream result:', lifestreamResult);

    // Check lifestream result (primary - the new system)
    if (lifestreamResult.status === 'fulfilled' && lifestreamResult.value.ok) {
      const data = await lifestreamResult.value.json().catch(() => ({}));
      console.log('Lifestream success:', data);
      showStatus('✓ Link shared successfully!', 'success');
    } else if (lifestreamResult.status === 'fulfilled') {
      // Request completed but with error status
      const errorText = await lifestreamResult.value.text().catch(() => '');
      console.error('Lifestream failed:', lifestreamResult.value.status, errorText);
      showStatus(`Error: Server returned ${lifestreamResult.value.status}`, 'error');
    } else {
      // Request rejected (network error)
      console.error('Lifestream error:', lifestreamResult.reason);
      showStatus('Error: Unable to connect to lifestream', 'error');
    }

    // Log old endpoint status (for monitoring during transition)
    if (oldResult.status === 'fulfilled' && oldResult.value.ok) {
      console.log('Old endpoint: success');
    } else {
      console.warn('Old endpoint: failed (non-critical during transition)');
    }

  } catch (error) {
    console.error('Share error:', error);
    showStatus('Error: Unable to connect', 'error');
  } finally {
    // Reset button state
    shareButton.disabled = false;
    shareButton.classList.remove('loading');
    buttonText.textContent = originalText;
  }
});

// Options link click handler
optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Show status message
function showStatus(message, type) {
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
  
  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusElement.classList.add('hidden');
    }, 3000);
  }
}
