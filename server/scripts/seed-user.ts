import 'dotenv/config'
import { hash } from 'bcryptjs'
import { database } from '../db.js'

const username = process.env.SEED_USERNAME?.trim().toLowerCase()
const password = process.env.SEED_PASSWORD

if (!username || !password) {
  throw new Error('Set SEED_USERNAME and SEED_PASSWORD before running db:seed.')
}

try {
  const passwordHash = await hash(password, 12)
  await database.query(
    `INSERT INTO users (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = NOW()`,
    [username, passwordHash],
  )
  console.log(`Credential created or updated for ${username}.`)
} finally {
  await database.end()
}