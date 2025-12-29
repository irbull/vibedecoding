// DOM Elements
const settingsForm = document.getElementById('settings-form');
const apiUrlInput = document.getElementById('api-url');
const apiKeyInput = document.getElementById('api-key');
const toggleKeyButton = document.getElementById('toggle-key');
const statusElement = document.getElementById('status');

// Load saved settings on page load
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.sync.get(['apiUrl', 'apiKey']);
  
  if (settings.apiUrl) {
    apiUrlInput.value = settings.apiUrl;
  }
  
  if (settings.apiKey) {
    apiKeyInput.value = settings.apiKey;
  }
});

// Toggle API key visibility
toggleKeyButton.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleKeyButton.textContent = '🙈';
  } else {
    apiKeyInput.type = 'password';
    toggleKeyButton.textContent = '👁️';
  }
});

// Save settings
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const apiUrl = apiUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiUrl) {
    showStatus('Please enter an API URL', 'error');
    return;
  }
  
  if (!apiKey) {
    showStatus('Please enter an API key', 'error');
    return;
  }
  
  try {
    await chrome.storage.sync.set({ apiUrl, apiKey });
    showStatus('✓ Settings saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings', 'error');
  }
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
