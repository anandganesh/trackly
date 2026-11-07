import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { appBrand } from './config/brand'
import './App.css'

type SignedInUser = { id: string; username: string }
type View = 'dashboard' | 'new-order' | 'details'
type DeliveryStatus = 'pending' | 'delivered'
type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overdue'
type Summary = { pending_orders: string; delivered_orders: string; pending_dues: string; overdue_dues: string }
type Order = {
  id: string
  order_number: string
  customer_name: string
  phone_number: string
  address: string
  total_cost: string
  payment_amount: string
  payment_details: string | null
  balance_amount: string
  balance_due_date: string | null
  delivery_date: string
  delivery_status: DeliveryStatus
  delivered_at: string | null
  created_at: string
  created_by_username: string
  payment_status: PaymentStatus
}
type Payment = {
  id: string
  amount: string
  payment_date: string
  payment_method: string
  reference: string | null
  notes: string | null
  is_initial: boolean
  recorded_by_username: string
}

const today = new Date().toISOString().slice(0, 10)
const money = (value: string | number) => `$${Number(value).toFixed(2)}`
const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const paymentLabels: Record<PaymentStatus, string> = { unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue' }

function App() {
  const [signedInUser, setSignedInUser] = useState<SignedInUser | null>(null)
  const [sessionChecking, setSessionChecking] = useState(true)
  const [view, setView] = useState<View>('dashboard')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginMessage, setLoginMessage] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const [summary, setSummary] = useState<Summary | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardMessage, setDashboardMessage] = useState('')
  const [search, setSearch] = useState('')
  const [deliveryFilter, setDeliveryFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [paymentEntry, setPaymentEntry] = useState({ amount: '', date: today, method: '', reference: '', notes: '' })

  const [orderForm, setOrderForm] = useState({ customerName: '', phoneNumber: '', address: '', totalCost: '', paymentAmount: '', paymentDetails: '', balanceDueDate: '', deliveryDate: '' })
  const [orderMessage, setOrderMessage] = useState('')
  const [orderSaving, setOrderSaving] = useState(false)
  const balance = useMemo(() => Math.max((Number(orderForm.totalCost) || 0) - (Number(orderForm.paymentAmount) || 0), 0), [orderForm])

  async function api<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options)
    const text = await response.text()
    const result = text ? JSON.parse(text) : {}
    if (!response.ok) throw new Error(result.message ?? 'Request failed.')
    return result as T
  }

  useEffect(() => {
    void api<{ user: SignedInUser }>('/api/auth/session')
      .then((result) => setSignedInUser(result.user))
      .catch(() => setSignedInUser(null))
      .finally(() => setSessionChecking(false))
  }, [])

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true)
    setDashboardMessage('')
    const query = new URLSearchParams({ search, deliveryStatus: deliveryFilter, paymentStatus: paymentFilter })
    try {
      const [summaryResult, orderResult] = await Promise.all([
        api<{ summary: Summary }>('/api/dashboard/summary'),
        api<{ orders: Order[] }>(`/api/orders?${query}`),
      ])
      setSummary(summaryResult.summary)
      setOrders(orderResult.orders)
    } catch (error) {
      setDashboardMessage(error instanceof Error ? error.message : 'Unable to load dashboard.')
    } finally {
      setDashboardLoading(false)
    }
  }, [deliveryFilter, paymentFilter, search])

  useEffect(() => {
    if (!signedInUser || view !== 'dashboard') return
    const timer = window.setTimeout(() => void loadDashboard(), 200)
    return () => window.clearTimeout(timer)
  }, [loadDashboard, signedInUser, view])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password) return setLoginMessage('Enter both your username and password.')
    setLoginLoading(true)
    setLoginMessage('')
    try {
      const result = await api<{ user: SignedInUser }>('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password }) })
      setSignedInUser(result.user)
      setPassword('')
      setView('dashboard')
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : 'Unable to sign in.')
    } finally {
      setLoginLoading(false)
    }
  }

  async function openOrder(orderId: string) {
    setView('details')
    setDetailLoading(true)
    setActionMessage('')
    try {
      const result = await api<{ order: Order; payments: Payment[] }>(`/api/orders/${orderId}`)
      setSelectedOrder(result.order)
      setPayments(result.payments)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Unable to load order.')
    } finally {
      setDetailLoading(false)
    }
  }

  async function updateDeliveryStatus(status: DeliveryStatus) {
    if (!selectedOrder) return
    if (status === 'pending' && !window.confirm('Change this delivered order back to pending?')) return
    try {
      await api(`/api/orders/${selectedOrder.id}/delivery-status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryStatus: status }) })
      await openOrder(selectedOrder.id)
      setActionMessage(status === 'delivered' ? 'Order marked as delivered.' : 'Order returned to pending.')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Unable to update status.')
    }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedOrder || !signedInUser) return
    setActionMessage('')
    try {
      await api(`/api/orders/${selectedOrder.id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(paymentEntry.amount), paymentDate: paymentEntry.date, paymentMethod: paymentEntry.method, reference: paymentEntry.reference, notes: paymentEntry.notes }),
      })
      setPaymentEntry({ amount: '', date: today, method: '', reference: '', notes: '' })
      await openOrder(selectedOrder.id)
      setActionMessage('Payment recorded successfully.')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Unable to record payment.')
    }
  }

  function setOrderField(field: keyof typeof orderForm, value: string) {
    setOrderForm((current) => ({ ...current, [field]: value }))
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!signedInUser) return
    if (!orderForm.customerName.trim() || !orderForm.phoneNumber.trim() || !orderForm.address.trim() || !orderForm.totalCost || !orderForm.deliveryDate) return setOrderMessage('Complete the customer details, total cost, and delivery date.')
    if (Number(orderForm.totalCost) <= 0 || Number(orderForm.paymentAmount || 0) < 0 || Number(orderForm.paymentAmount || 0) > Number(orderForm.totalCost)) return setOrderMessage('Payment amount must be between 0 and the total cost.')
    if (balance > 0 && !orderForm.balanceDueDate) return setOrderMessage('Add the balance due date for the outstanding amount.')
    setOrderSaving(true)
    setOrderMessage('')
    try {
      const result = await api<{ order: { order_number: string } }>('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderForm, totalCost: Number(orderForm.totalCost), paymentAmount: Number(orderForm.paymentAmount || 0), balanceDueDate: balance > 0 ? orderForm.balanceDueDate : '' }),
      })
      setOrderMessage(`Order #${result.order.order_number} was saved.`)
      setOrderForm({ customerName: '', phoneNumber: '', address: '', totalCost: '', paymentAmount: '', paymentDetails: '', balanceDueDate: '', deliveryDate: '' })
    } catch (error) {
      setOrderMessage(error instanceof Error ? error.message : 'Unable to save order.')
    } finally {
      setOrderSaving(false)
    }
  }

  async function signOut() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } finally {
      setSignedInUser(null)
      setSelectedOrder(null)
      setView('dashboard')
    }
  }

  if (sessionChecking) return <main className="login-page"><p className="empty-state">Loading Trackly…</p></main>

  if (!signedInUser) return (
    <main className="login-page"><section className="login-card">
      <header className="login-brand"><img className="company-logo" src={appBrand.logoUrl} alt={`${appBrand.companyName} logo`} /><span>{appBrand.companyName}</span></header>
      <div className="login-intro"><p className="eyebrow">ORDER TRACKING</p><h1>Welcome back</h1><p>Sign in to manage orders.</p></div>
      <form className="login-form" onSubmit={handleLogin}>
        <Field label="Username"><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></Field>
        {loginMessage && <Message text={loginMessage} error />}
        <button className="primary-button" disabled={loginLoading}>{loginLoading ? 'Verifying…' : 'Sign in'}</button>
      </form>
    </section></main>
  )

  return <main className="app-page">
    <header className="app-header">
      <button className="brand brand-button" onClick={() => setView('dashboard')}><img className="company-logo" src={appBrand.logoUrl} alt="" /><span>{appBrand.companyName}</span></button>
      <div className="account-actions"><span>{signedInUser.username}</span><button className="text-button" onClick={() => void signOut()}>Sign out</button></div>
    </header>

    {view === 'dashboard' && <Dashboard summary={summary} orders={orders} loading={dashboardLoading} message={dashboardMessage} search={search} deliveryFilter={deliveryFilter} paymentFilter={paymentFilter} onSearch={setSearch} onDeliveryFilter={setDeliveryFilter} onPaymentFilter={setPaymentFilter} onOpen={openOrder} onDeliver={async (id) => { try { await api(`/api/orders/${id}/delivery-status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryStatus: 'delivered' }) }); await loadDashboard() } catch (error) { setDashboardMessage(error instanceof Error ? error.message : 'Unable to update delivery status.') } }} />}

    {view === 'new-order' && <section><PageTitle eyebrow="NEW ORDER" title="Place an order" description="Add customer, payment, and delivery details." /><form className="order-form" onSubmit={createOrder}>
      <FormCard title="Customer details"><div className="form-grid"><Field label="Customer name"><input value={orderForm.customerName} onChange={(e) => setOrderField('customerName', e.target.value)} /></Field><Field label="Phone number"><input type="tel" value={orderForm.phoneNumber} onChange={(e) => setOrderField('phoneNumber', e.target.value)} /></Field><Field label="Address" wide><textarea rows={3} value={orderForm.address} onChange={(e) => setOrderField('address', e.target.value)} /></Field></div></FormCard>
      <FormCard title="Payment details"><div className="form-grid"><Field label="Total cost"><input type="number" min="0" step="0.01" value={orderForm.totalCost} onChange={(e) => setOrderField('totalCost', e.target.value)} /></Field><Field label="Payment amount"><input type="number" min="0" step="0.01" value={orderForm.paymentAmount} onChange={(e) => setOrderField('paymentAmount', e.target.value)} /></Field><Field label="Payment details" wide><input value={orderForm.paymentDetails} onChange={(e) => setOrderField('paymentDetails', e.target.value)} placeholder="Method, reference, or notes" /></Field></div><div className="balance-row"><span>Balance to be paid</span><strong>{money(balance)}</strong></div>{balance > 0 && <Field label="Balance due date"><input type="date" value={orderForm.balanceDueDate} onChange={(e) => setOrderField('balanceDueDate', e.target.value)} /></Field>}</FormCard>
      <FormCard title="Delivery"><Field label="Delivery date"><input type="date" value={orderForm.deliveryDate} onChange={(e) => setOrderField('deliveryDate', e.target.value)} /></Field></FormCard>
      {orderMessage && <Message text={orderMessage} error={!orderMessage.includes('was saved')} />}<button className="primary-button" disabled={orderSaving}>{orderSaving ? 'Saving order…' : 'Place order'}</button>
    </form></section>}

    {view === 'details' && <OrderDetails order={selectedOrder} payments={payments} loading={detailLoading} message={actionMessage} paymentEntry={paymentEntry} onPaymentEntry={setPaymentEntry} onBack={() => setView('dashboard')} onPayment={recordPayment} onStatus={updateDeliveryStatus} />}

    {view !== 'details' && <nav className="bottom-nav"><button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><span>⌂</span>Dashboard</button><button className={view === 'new-order' ? 'active' : ''} onClick={() => setView('new-order')}><span>＋</span>New Order</button></nav>}
  </main>
}

function Dashboard({ summary, orders, loading, message, search, deliveryFilter, paymentFilter, onSearch, onDeliveryFilter, onPaymentFilter, onOpen, onDeliver }: { summary: Summary | null; orders: Order[]; loading: boolean; message: string; search: string; deliveryFilter: string; paymentFilter: string; onSearch: (v: string) => void; onDeliveryFilter: (v: string) => void; onPaymentFilter: (v: string) => void; onOpen: (id: string) => void; onDeliver: (id: string) => Promise<void> }) {
  return <section><PageTitle eyebrow="OVERVIEW" title="Dashboard" description="Track deliveries, dues, and payments." />
    <div className="summary-grid"><SummaryCard label="Pending orders" value={summary?.pending_orders ?? '0'} /><SummaryCard label="Delivered orders" value={summary?.delivered_orders ?? '0'} /><SummaryCard label="Pending dues" value={money(summary?.pending_dues ?? 0)} /><SummaryCard label="Overdue dues" value={money(summary?.overdue_dues ?? 0)} danger /></div>
    <div className="dashboard-tools"><input className="search-input" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search order, customer, or phone" /><div className="filters"><select value={deliveryFilter} onChange={(e) => onDeliveryFilter(e.target.value)}><option value="all">All deliveries</option><option value="pending">Pending</option><option value="delivered">Delivered</option></select><select value={paymentFilter} onChange={(e) => onPaymentFilter(e.target.value)}><option value="all">All payments</option><option value="unpaid">Unpaid</option><option value="partial">Partially paid</option><option value="paid">Paid</option><option value="overdue">Overdue</option></select></div></div>
    {message && <Message text={message} error />}{loading ? <p className="empty-state">Loading orders…</p> : orders.length === 0 ? <p className="empty-state">No orders match these filters.</p> : <div className="order-list">{orders.map((order) => <OrderCard key={order.id} order={order} onOpen={onOpen} onDeliver={onDeliver} />)}</div>}
  </section>
}

function OrderCard({ order, onOpen, onDeliver }: { order: Order; onOpen: (id: string) => void; onDeliver: (id: string) => Promise<void> }) {
  return <article className={`order-card ${order.payment_status === 'overdue' ? 'overdue-card' : ''}`}><div className="order-card-head"><div><p className="order-number">Order #{order.order_number}</p><h2>{order.customer_name}</h2><p className="muted">{order.phone_number}</p></div><StatusBadge kind={order.delivery_status} label={order.delivery_status === 'pending' ? 'Pending' : 'Delivered'} /></div><div className="order-meta"><span>Delivery <strong>{dateLabel(order.delivery_date)}</strong></span><StatusBadge kind={order.payment_status} label={paymentLabels[order.payment_status]} /></div><div className="amount-grid"><span>Total<strong>{money(order.total_cost)}</strong></span><span>Paid<strong>{money(order.payment_amount)}</strong></span><span>Balance<strong>{money(order.balance_amount)}</strong></span></div><div className="card-actions"><button className="secondary-button" onClick={() => onOpen(order.id)}>View details</button>{order.delivery_status === 'pending' && <button className="primary-small" onClick={() => void onDeliver(order.id)}>Mark delivered</button>}</div></article>
}

function OrderDetails({ order, payments, loading, message, paymentEntry, onPaymentEntry, onBack, onPayment, onStatus }: { order: Order | null; payments: Payment[]; loading: boolean; message: string; paymentEntry: { amount: string; date: string; method: string; reference: string; notes: string }; onPaymentEntry: (value: typeof paymentEntry) => void; onBack: () => void; onPayment: (event: FormEvent<HTMLFormElement>) => void; onStatus: (status: DeliveryStatus) => void }) {
  if (loading || !order) return <section><button className="back-button" onClick={onBack}>← Back</button><p className="empty-state">Loading order…</p></section>
  return <section><button className="back-button" onClick={onBack}>← Dashboard</button><div className="details-title"><div><p className="eyebrow">ORDER #{order.order_number}</p><h1>{order.customer_name}</h1><p className="muted">{order.phone_number}</p></div><StatusBadge kind={order.delivery_status} label={order.delivery_status === 'pending' ? 'Pending' : 'Delivered'} /></div>
    {message && <Message text={message} />}
    <FormCard title="Customer & delivery"><dl className="details-list"><div><dt>Address</dt><dd>{order.address}</dd></div><div><dt>Delivery date</dt><dd>{dateLabel(order.delivery_date)}</dd></div><div><dt>Status</dt><dd>{order.delivery_status === 'pending' ? 'Pending delivery' : `Delivered${order.delivered_at ? ` on ${new Date(order.delivered_at).toLocaleDateString()}` : ''}`}</dd></div></dl><button className={order.delivery_status === 'pending' ? 'primary-button' : 'secondary-button full-button'} onClick={() => onStatus(order.delivery_status === 'pending' ? 'delivered' : 'pending')}>{order.delivery_status === 'pending' ? 'Mark delivered' : 'Return to pending'}</button></FormCard>
    <FormCard title="Payment summary"><div className="amount-grid detail-amounts"><span>Total<strong>{money(order.total_cost)}</strong></span><span>Paid<strong>{money(order.payment_amount)}</strong></span><span>Balance<strong>{money(order.balance_amount)}</strong></span></div>{order.balance_due_date && <p className="due-note">Balance due {dateLabel(order.balance_due_date)}</p>}</FormCard>
    {Number(order.balance_amount) > 0 && <FormCard title="Record payment"><form className="payment-form" onSubmit={onPayment}><div className="form-grid"><Field label="Amount"><input type="number" min="0.01" max={order.balance_amount} step="0.01" value={paymentEntry.amount} onChange={(e) => onPaymentEntry({ ...paymentEntry, amount: e.target.value })} /></Field><Field label="Payment date"><input type="date" value={paymentEntry.date} onChange={(e) => onPaymentEntry({ ...paymentEntry, date: e.target.value })} /></Field><Field label="Payment method"><input value={paymentEntry.method} onChange={(e) => onPaymentEntry({ ...paymentEntry, method: e.target.value })} placeholder="Cash, card, bank transfer…" /></Field><Field label="Reference"><input value={paymentEntry.reference} onChange={(e) => onPaymentEntry({ ...paymentEntry, reference: e.target.value })} /></Field><Field label="Notes" wide><textarea rows={2} value={paymentEntry.notes} onChange={(e) => onPaymentEntry({ ...paymentEntry, notes: e.target.value })} /></Field></div><button className="primary-button">Record payment</button></form></FormCard>}
    <FormCard title="Payment history">{payments.length === 0 ? <p className="muted">No payments recorded.</p> : <div className="payment-list">{payments.map((payment) => <div className="payment-item" key={payment.id}><div><strong>{payment.payment_method}</strong><p>{dateLabel(payment.payment_date)} · by {payment.recorded_by_username}</p>{payment.reference && <p>Ref: {payment.reference}</p>}{payment.notes && <p>{payment.notes}</p>}</div><strong>{money(payment.amount)}</strong></div>)}</div>}</FormCard>
  </section>
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={`field-group ${wide ? 'full-width' : ''}`}><span>{label}</span>{children}</label> }
function FormCard({ title, children }: { title: string; children: React.ReactNode }) { return <section className="form-card"><h2>{title}</h2>{children}</section> }
function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div> }
function SummaryCard({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) { return <article className={`summary-card ${danger ? 'danger' : ''}`}><span>{label}</span><strong>{value}</strong></article> }
function StatusBadge({ kind, label }: { kind: string; label: string }) { return <span className={`status-badge ${kind}`}>{label}</span> }
function Message({ text, error = false }: { text: string; error?: boolean }) { return <p className={`form-message ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{text}</p> }

export default App