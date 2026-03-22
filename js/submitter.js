/**
 * Submit the processed receipt image to the configured n8n webhook.
 *
 * @param {Blob}   imageBlob - JPEG blob of the processed receipt
 * @param {object} settings  - { webhookUrl, apiKey }
 * @returns {Promise<{ ok: boolean, status: number, message: string }>}
 */
export async function submitExpense(imageBlob, { webhookUrl, apiKey }) {
  if (!webhookUrl) throw new Error('Webhook URL is not configured');

  const form = new FormData();
  form.append('receipt', imageBlob, `receipt-${Date.now()}.jpg`);

  const headers = {};
  if (apiKey) headers['X-API-Key'] = apiKey;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: form,
  });

  let message = '';
  try {
    const text = await response.text();
    // n8n often returns JSON; try to parse for a friendlier message
    try {
      const json = JSON.parse(text);
      message = json.message || json.error || text;
    } catch {
      message = text;
    }
  } catch {
    message = response.statusText || 'Unknown error';
  }

  return { ok: response.ok, status: response.status, message };
}
