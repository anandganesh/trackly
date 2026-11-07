import 'dotenv/config'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL ?? 'postgresql:///order_tracking'

export const database = new Pool({
  connectionString,
})