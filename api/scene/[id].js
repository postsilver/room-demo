import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { id } = req.query

  try {
    const scene = await redis.get(`scene:${id}`)

    if (!scene) {
      return res.status(404).json({ error: 'Scene not found or expired' })
    }

    return res.status(200).json({ scene })
  } catch (err) {
    console.error('Error fetching scene:', err)
    return res.status(500).json({ error: 'Failed to fetch scene' })
  }
}
