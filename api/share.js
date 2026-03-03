import { Redis } from '@upstash/redis'
import { nanoid } from 'nanoid'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { scene } = req.body
  if (!scene || typeof scene !== 'string') {
    return res.status(400).json({ error: 'Missing scene data' })
  }

  try {
    const id = nanoid(8)
    await redis.set(`scene:${id}`, scene, { ex: 259200 }) // 72h TTL
    return res.status(200).json({ id })
  } catch (err) {
    console.error('Error storing scene:', err)
    return res.status(500).json({ error: 'Failed to store scene' })
  }
}
