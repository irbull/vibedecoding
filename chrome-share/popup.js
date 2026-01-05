// DOM Elements
const currentUrlElement = document.getElementById('current-url');
const shareButton = document.getElementById('share-btn');
const statusElement = document.getElementById('status');
const optionsLink = document.getElementById('options-link');

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
    // POST to Lifestream endpoint
    const response = await fetch(settings.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({ url: currentTabUrl, source: 'chrome' })
    });

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      console.log('Share success:', data);
      showStatus('✓ Link shared successfully!', 'success');
    } else {
      const errorText = await response.text().catch(() => '');
      console.error('Share failed:', response.status, errorText);
      showStatus(`Error: Server returned ${response.status}`, 'error');
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
