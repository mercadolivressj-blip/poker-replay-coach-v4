export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    visionAccessConfigured: Boolean(process.env.VISION_ACCESS_TOKEN),
    env: process.env.VERCEL_ENV || null,
  });
}
