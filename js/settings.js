const KEYS = {
  webhookUrl: 'ec_webhook_url',
  apiKey:     'ec_api_key',
};

export function loadSettings() {
  return {
    webhookUrl: localStorage.getItem(KEYS.webhookUrl) || '',
    apiKey:     localStorage.getItem(KEYS.apiKey)     || '',
  };
}

export function saveSettings({ webhookUrl, apiKey }) {
  localStorage.setItem(KEYS.webhookUrl, webhookUrl.trim());
  localStorage.setItem(KEYS.apiKey,     apiKey.trim());
}
