import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { database } from '../db.js'

const currentFile = fileURLToPath(import.meta.url)
const migrationsDirectory = path.resolve(path.dirname(currentFile), '../../database/migrations')

try {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort()

  for (const migrationFile of migrationFiles) {
    await database.query(await readFile(path.join(migrationsDirectory, migrationFile), 'utf8'))
    console.log(`Applied ${migrationFile}`)
  }
} finally {
  await database.end()
}