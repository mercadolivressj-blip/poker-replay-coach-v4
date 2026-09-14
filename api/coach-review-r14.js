export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({
    error: 'disabled',
    message: 'This experimental endpoint is not active in R14. Replay study remains file-only and uses the validated reconstruction pipeline.',
  });
}
