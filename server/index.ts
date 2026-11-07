import 'dotenv/config'
import { compare } from 'bcryptjs'
import connectPgSimple from 'connect-pg-simple'
import express, { type Request } from 'express'
import session from 'express-session'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { database } from './db.js'

type LoginRequest = { username?: unknown; password?: unknown }
type CreateOrderRequest = {
  customerName?: unknown
  phoneNumber?: unknown
  address?: unknown
  totalCost?: unknown
  paymentAmount?: unknown
  paymentDetails?: unknown
  balanceDueDate?: unknown
  deliveryDate?: unknown
}
type RecordPaymentRequest = {
  amount?: unknown
  paymentDate?: unknown
  paymentMethod?: unknown
  reference?: unknown
  notes?: unknown
}
type DeliveryStatusRequest = { deliveryStatus?: unknown }

const app = express()
const port = Number(process.env.PORT ?? 3001)
const isProduction = process.env.NODE_ENV === 'production'
const sessionSecret = process.env.SESSION_SECRET ?? (isProduction ? '' : 'local-development-session-secret-change-before-production')
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const maxAttempts = 5
const attemptWindowMs = 15 * 60 * 1000
const validDate = /^\d{4}-\d{2}-\d{2}$/

if (!sessionSecret) throw new Error('SESSION_SECRET is required in production.')

const PostgreSqlSessionStore = connectPgSimple(session)

app.disable('x-powered-by')
if (isProduction) app.set('trust proxy', 1)
app.use(express.json({ limit: '20kb' }))
app.use(session({
  store: new PostgreSqlSessionStore({ pool: database, tableName: 'user_sessions', createTableIfMissing: false }),
  name: 'trackly.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}))

function requestKey(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown'
}

function hasExceededLoginLimit(request: Request): boolean {
  const key = requestKey(request)
  const attempt = loginAttempts.get(key)
  const now = Date.now()

  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + attemptWindowMs })
    return false
  }

  attempt.count += 1
  return attempt.count > maxAttempts
}

function clearLoginAttempts(request: Request): void {
  loginAttempts.delete(requestKey(request))
}

function requireAuthentication(request: Request, response: express.Response, next: express.NextFunction): void {
  if (!request.session.user) {
    response.status(401).json({ message: 'Please sign in to continue.' })
    return
  }
  next()
}

const orderSelect = `
  SELECT
    orders.id,
    orders.order_number,
    orders.customer_name,
    orders.phone_number,
    orders.address,
    orders.total_cost,
    orders.payment_amount,
    orders.balance_amount,
    orders.payment_details,
    TO_CHAR(orders.balance_due_date, 'YYYY-MM-DD') AS balance_due_date,
    TO_CHAR(orders.delivery_date, 'YYYY-MM-DD') AS delivery_date,
    orders.delivery_status,
    orders.delivered_at,
    orders.created_at,
    users.username AS created_by_username,
    CASE
      WHEN orders.balance_amount = 0 THEN 'paid'
      WHEN orders.balance_due_date < CURRENT_DATE THEN 'overdue'
      WHEN orders.payment_amount = 0 THEN 'unpaid'
      ELSE 'partial'
    END AS payment_status
  FROM orders
  JOIN users ON users.id = orders.created_by_user_id
`

app.get('/api/health', async (_request, response) => {
  try {
    await database.query('SELECT 1')
    response.json({ status: 'ok' })
  } catch {
    response.status(503).json({ status: 'unavailable' })
  }
})

app.post('/api/auth/login', async (request, response) => {
  const { username, password } = request.body as LoginRequest
  if (typeof username !== 'string' || typeof password !== 'string') {
    response.status(400).json({ message: 'Username and password are required.' })
    return
  }

  const normalizedUsername = username.trim().toLowerCase()
  if (!normalizedUsername || !password || normalizedUsername.length > 100 || password.length > 512) {
    response.status(400).json({ message: 'Username and password are required.' })
    return
  }

  if (hasExceededLoginLimit(request)) {
    response.status(429).json({ message: 'Too many sign-in attempts. Please try again in 15 minutes.' })
    return
  }

  try {
    const result = await database.query<{ id: string; username: string; password_hash: string }>(
      'SELECT id, username, password_hash FROM users WHERE username = $1 LIMIT 1',
      [normalizedUsername],
    )
    const user = result.rows[0]
    const passwordMatches = user ? await compare(password, user.password_hash) : false

    if (!user || !passwordMatches) {
      response.status(401).json({ message: 'Invalid username or password.' })
      return
    }

    clearLoginAttempts(request)
    request.session.regenerate((sessionError) => {
      if (sessionError) {
        console.error('Session creation failed:', sessionError)
        response.status(500).json({ message: 'Unable to start your session.' })
        return
      }
      request.session.user = { id: user.id, username: user.username }
      request.session.save((saveError) => {
        if (saveError) {
          console.error('Session save failed:', saveError)
          response.status(500).json({ message: 'Unable to start your session.' })
          return
        }
        response.json({ user: request.session.user })
      })
    })
  } catch (error) {
    console.error('Login request failed:', error)
    response.status(500).json({ message: 'Unable to verify credentials. Please try again later.' })
  }
})

app.get('/api/auth/session', (request, response) => {
  if (!request.session.user) {
    response.status(401).json({ message: 'No active session.' })
    return
  }
  response.json({ user: request.session.user })
})

app.post('/api/auth/logout', (request, response) => {
  request.session.destroy((error) => {
    if (error) {
      response.status(500).json({ message: 'Unable to sign out.' })
      return
    }
    response.clearCookie('trackly.sid')
    response.status(204).end()
  })
})

app.use('/api/dashboard', requireAuthentication)
app.use('/api/orders', requireAuthentication)

app.get('/api/dashboard/summary', async (_request, response) => {
  try {
    const result = await database.query<{
      pending_orders: string
      delivered_orders: string
      pending_dues: string
      overdue_dues: string
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE delivery_status = 'pending') AS pending_orders,
        COUNT(*) FILTER (WHERE delivery_status = 'delivered') AS delivered_orders,
        COALESCE(SUM(balance_amount), 0) AS pending_dues,
        COALESCE(SUM(balance_amount) FILTER (WHERE balance_amount > 0 AND balance_due_date < CURRENT_DATE), 0) AS overdue_dues
      FROM orders
    `)
    response.json({ summary: result.rows[0] })
  } catch (error) {
    console.error('Dashboard summary request failed:', error)
    response.status(500).json({ message: 'Unable to load the dashboard summary.' })
  }
})

app.get('/api/orders', async (request, response) => {
  const search = typeof request.query.search === 'string' ? request.query.search.trim() : ''
  const deliveryStatus = typeof request.query.deliveryStatus === 'string' ? request.query.deliveryStatus : 'all'
  const paymentStatus = typeof request.query.paymentStatus === 'string' ? request.query.paymentStatus : 'all'
  const values: unknown[] = []
  const conditions: string[] = []

  if (search) {
    values.push(`%${search}%`)
    conditions.push(`(orders.order_number::text ILIKE $${values.length} OR orders.customer_name ILIKE $${values.length} OR orders.phone_number ILIKE $${values.length})`)
  }
  if (deliveryStatus === 'pending' || deliveryStatus === 'delivered') {
    values.push(deliveryStatus)
    conditions.push(`orders.delivery_status = $${values.length}`)
  }
  const paymentExpression = `CASE WHEN orders.balance_amount = 0 THEN 'paid' WHEN orders.balance_due_date < CURRENT_DATE THEN 'overdue' WHEN orders.payment_amount = 0 THEN 'unpaid' ELSE 'partial' END`
  if (['unpaid', 'partial', 'paid', 'overdue'].includes(paymentStatus)) {
    values.push(paymentStatus)
    conditions.push(`${paymentExpression} = $${values.length}`)
  }

  try {
    const result = await database.query(
      `${orderSelect}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY orders.created_at DESC LIMIT 100`,
      values,
    )
    response.json({ orders: result.rows })
  } catch (error) {
    console.error('List orders request failed:', error)
    response.status(500).json({ message: 'Unable to load orders. Please try again later.' })
  }
})

app.get('/api/orders/:id', async (request, response) => {
  try {
    const orderResult = await database.query(`${orderSelect} WHERE orders.id = $1 LIMIT 1`, [request.params.id])
    const order = orderResult.rows[0]
    if (!order) {
      response.status(404).json({ message: 'Order not found.' })
      return
    }

    const paymentsResult = await database.query(
      `SELECT payments.id, payments.amount, TO_CHAR(payments.payment_date, 'YYYY-MM-DD') AS payment_date, payments.payment_method, payments.reference,
              payments.notes, payments.is_initial, payments.created_at, users.username AS recorded_by_username
       FROM payments
       JOIN users ON users.id = payments.recorded_by_user_id
       WHERE payments.order_id = $1
       ORDER BY payments.payment_date DESC, payments.created_at DESC`,
      [request.params.id],
    )
    response.json({ order, payments: paymentsResult.rows })
  } catch (error) {
    console.error('Order details request failed:', error)
    response.status(500).json({ message: 'Unable to load order details.' })
  }
})

app.post('/api/orders', async (request, response) => {
  const body = request.body as CreateOrderRequest
  if (
    typeof body.customerName !== 'string' || typeof body.phoneNumber !== 'string' ||
    typeof body.address !== 'string' || typeof body.deliveryDate !== 'string'
  ) {
    response.status(400).json({ message: 'Customer details and delivery date are required.' })
    return
  }

  const createdByUserId = request.session.user!.id
  const customerName = body.customerName.trim()
  const phoneNumber = body.phoneNumber.trim()
  const address = body.address.trim()
  const deliveryDate = body.deliveryDate.trim()
  const totalCost = typeof body.totalCost === 'number' ? body.totalCost : Number(body.totalCost)
  const paymentAmount = body.paymentAmount === undefined || body.paymentAmount === '' ? 0 : Number(body.paymentAmount)
  const paymentDetails = typeof body.paymentDetails === 'string' ? body.paymentDetails.trim() : ''
  const balanceDueDate = typeof body.balanceDueDate === 'string' ? body.balanceDueDate.trim() : ''

  if (
    !customerName || !phoneNumber || !address || !validDate.test(deliveryDate) ||
    !Number.isFinite(totalCost) || !Number.isFinite(paymentAmount) || totalCost <= 0 || paymentAmount < 0 || paymentAmount > totalCost
  ) {
    response.status(400).json({ message: 'Enter valid customer, payment, and delivery details.' })
    return
  }

  const balanceAmount = Number((totalCost - paymentAmount).toFixed(2))
  if ((balanceAmount > 0 && !validDate.test(balanceDueDate)) || (balanceAmount === 0 && balanceDueDate)) {
    response.status(400).json({ message: 'Provide a balance due date only when a balance remains.' })
    return
  }

  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query(
      `INSERT INTO orders (
        created_by_user_id, customer_name, phone_number, address, total_cost, payment_amount,
        payment_details, balance_amount, balance_due_date, delivery_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, '')::date, $10::date)
      RETURNING id, order_number, customer_name, total_cost, payment_amount, balance_amount, delivery_date, delivery_status, created_at`,
      [createdByUserId, customerName, phoneNumber, address, totalCost, paymentAmount, paymentDetails || null, balanceAmount, balanceDueDate, deliveryDate],
    )
    const order = orderResult.rows[0]

    if (paymentAmount > 0) {
      await client.query(
        `INSERT INTO payments (order_id, recorded_by_user_id, amount, payment_date, payment_method, notes, is_initial)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, TRUE)`,
        [order.id, createdByUserId, paymentAmount, 'Initial payment', paymentDetails || null],
      )
    }

    await client.query('COMMIT')
    response.status(201).json({ order })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Create order request failed:', error)
    response.status(500).json({ message: 'Unable to save the order. Please try again later.' })
  } finally {
    client.release()
  }
})

app.post('/api/orders/:id/payments', async (request, response) => {
  const body = request.body as RecordPaymentRequest
  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount)
  const recordedByUserId = request.session.user!.id
  const paymentDate = typeof body.paymentDate === 'string' ? body.paymentDate.trim() : ''
  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim() : ''
  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  if (!Number.isFinite(amount) || amount <= 0 || !validDate.test(paymentDate) || !paymentMethod) {
    response.status(400).json({ message: 'Enter a valid payment amount, date, and method.' })
    return
  }

  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query<{ balance_amount: string }>('SELECT balance_amount FROM orders WHERE id = $1 FOR UPDATE', [request.params.id])
    const order = orderResult.rows[0]
    if (!order) {
      await client.query('ROLLBACK')
      response.status(404).json({ message: 'Order not found.' })
      return
    }

    const currentBalance = Number(order.balance_amount)
    if (amount > currentBalance) {
      await client.query('ROLLBACK')
      response.status(400).json({ message: `Payment cannot exceed the remaining balance of $${currentBalance.toFixed(2)}.` })
      return
    }

    await client.query(
      `INSERT INTO payments (order_id, recorded_by_user_id, amount, payment_date, payment_method, reference, notes)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7)`,
      [request.params.id, recordedByUserId, amount, paymentDate, paymentMethod, reference || null, notes || null],
    )
    await client.query(
      `UPDATE orders
       SET payment_amount = payment_amount + $1,
           balance_amount = balance_amount - $1,
           balance_due_date = CASE WHEN balance_amount - $1 = 0 THEN NULL ELSE balance_due_date END,
           updated_at = NOW()
       WHERE id = $2`,
      [amount, request.params.id],
    )
    await client.query('COMMIT')
    response.status(201).json({ message: 'Payment recorded.' })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Record payment request failed:', error)
    response.status(500).json({ message: 'Unable to record the payment.' })
  } finally {
    client.release()
  }
})

app.patch('/api/orders/:id/delivery-status', async (request, response) => {
  const { deliveryStatus } = request.body as DeliveryStatusRequest
  if (deliveryStatus !== 'pending' && deliveryStatus !== 'delivered') {
    response.status(400).json({ message: 'Delivery status must be pending or delivered.' })
    return
  }

  try {
    const result = await database.query(
      `UPDATE orders
       SET delivery_status = $1::varchar(20),
           delivered_at = CASE WHEN $1::varchar(20) = 'delivered' THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, delivery_status, delivered_at`,
      [deliveryStatus, request.params.id],
    )
    if (!result.rows[0]) {
      response.status(404).json({ message: 'Order not found.' })
      return
    }
    response.json({ order: result.rows[0] })
  } catch (error) {
    console.error('Delivery status request failed:', error)
    response.status(500).json({ message: 'Unable to update delivery status.' })
  }
})

if (isProduction) {
  const currentFile = fileURLToPath(import.meta.url)
  const distDirectory = path.resolve(path.dirname(currentFile), '../dist')
  if (existsSync(distDirectory)) {
    app.use(express.static(distDirectory))
    app.get('/{*splat}', (_request, response) => response.sendFile(path.join(distDirectory, 'index.html')))
  }
}

app.listen(port, () => console.log(`API listening on port ${port}`))