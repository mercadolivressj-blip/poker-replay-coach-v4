const DEFAULT_FAST_MODEL = process.env.GEMINI_FAST_MODEL || 'gemini-3.1-flash-lite';
const DEFAULT_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash';

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!match) throw new Error('invalid image data url');
  return { mimeType: match[1], data: match[2] };
}

function responseText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
}

function normalizeSchema(schema) {
  // Gemini structured output supports the subset we use here. Drop OpenAI-only
  // strictness helpers that are not needed by responseSchema.
  if (Array.isArray(schema)) return schema.map(normalizeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties') continue;
    out[k] = normalizeSchema(v);
  }
  return out;
}

async function callModel({ apiKey, model, prompt, images, schema, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const parts = [{ text: prompt }];
    for (const image of images) {
      const { mimeType, data } = parseDataUrl(image);
      parts.push({ inlineData: { mimeType, data } });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: normalizeSchema(schema),
      },
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error?.message || `Gemini ${response.status}`;
      const err = new Error(message);
      err.status = response.status;
      throw err;
    }
    const text = responseText(json);
    if (!text) throw new Error('empty Gemini response');
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new Error('invalid Gemini JSON'); }
    return {
      parsed,
      model: json?.modelVersion || model,
      usage: json?.usageMetadata || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function geminiJson({
  prompt,
  images,
  schema,
  timeoutMs = 9000,
  fastModel = DEFAULT_FAST_MODEL,
  fallbackModel = DEFAULT_FALLBACK_MODEL,
  shouldFallback,
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY not configured');
    err.status = 501;
    throw err;
  }

  let first;
  try {
    first = await callModel({ apiKey, model: fastModel, prompt, images, schema, timeoutMs });
    if (!shouldFallback || !shouldFallback(first.parsed)) return { ...first, fallback: false };
  } catch (err) {
    if ([400, 401, 403].includes(Number(err?.status))) throw err;
  }

  const second = await callModel({
    apiKey,
    model: fallbackModel,
    prompt,
    images,
    schema,
    timeoutMs: Math.max(timeoutMs, 11000),
  });
  return { ...second, fallback: true };
}
