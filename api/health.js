export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.OPENAI_API_KEY || process.env.CHATGPT || '';
  const source = process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : process.env.CHATGPT ? 'CHATGPT' : null;
  const result = {
    ok: true,
    openaiConfigured: Boolean(key),
    keySource: source,
    visionAccessConfigured: Boolean(process.env.VISION_ACCESS_TOKEN),
    env: process.env.VERCEL_ENV || null,
    openaiReachable: null,
  };

  if (req.query?.deep === '1' && key) {
    try {
      const r = await fetch('https://api.openai.com/v1/models/gpt-5.6-sol', {
        headers: { Authorization: `Bearer ${key}` },
      });
      result.openaiReachable = r.ok;
      if (!r.ok) result.openaiStatus = r.status;
    } catch {
      result.openaiReachable = false;
    }
  }

  return res.status(200).json(result);
}
