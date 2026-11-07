import 'dotenv/config'

const port = process.env.PORT ?? '3001'
const username = process.env.TEST_USERNAME
const password = process.env.TEST_PASSWORD

if (!username || !password) {
  throw new Error('Set TEST_USERNAME and TEST_PASSWORD before running test:api.')
}

const response = await fetch(`http://localhost:${port}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
})

console.log(`HTTP ${response.status}`, await response.json())
process.exitCode = response.ok ? 0 : 1