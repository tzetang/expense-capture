const KEYS = {
  webhookUrl: 'ec_webhook_url',
  apiKey:     'ec_api_key',
  debugMode:  'ec_debug_mode',
};

export function loadSettings() {
  return {
    webhookUrl: localStorage.getItem(KEYS.webhookUrl) || '',
    apiKey:     localStorage.getItem(KEYS.apiKey)     || '',
    debugMode:  localStorage.getItem(KEYS.debugMode) === 'true',
  };
}

export function saveSettings({ webhookUrl, apiKey, debugMode }) {
  localStorage.setItem(KEYS.webhookUrl, webhookUrl.trim());
  localStorage.setItem(KEYS.apiKey,     apiKey.trim());
  localStorage.setItem(KEYS.debugMode,  String(!!debugMode));
}
