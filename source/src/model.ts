import { sb, col, get, put, getAmt, putAmt, has, schema, errText } from './db'

export type Role = 'owner' | 'dispatcher' | 'technician'
export type Status = 'new' | 'scheduled' | 'assigned' | 'on_the_way' | 'arrived' | 'completed' | 'cancelled'
export type Priority = 'low' | 'normal' | 'high' | 'emergency'
export type PayStatus = 'unpaid' | 'pending' | 'paid' | 'refunded' | 'voided'
export type PayMethod = 'credit_card' | 'cash' | 'zelle' | 'check' | 'other'

export const STATUSES: Status[] = ['new', 'scheduled', 'assigned', 'on_the_way', 'arrived', 'completed', 'cancelled']
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'emergency']
export const PAY_METHODS: PayMethod[] = ['credit_card', 'cash', 'zelle', 'check', 'other']
export const CATEGORIES = ['residential', 'automotive', 'commercial']
export const SERVICE_TYPES = [
  'Lockout', 'House Lockout', 'Car Lockout', 'Business Lockout', 'Rekey', 'Lock Change', 'Lock Installation',
  'Lock Repair', 'Car Key Replacement', 'Key Programming', 'Key Duplication', 'Ignition Repair',
  'Safe Opening', 'Access Control', 'Master Key System', 'Mailbox Lock', 'Other',
]

export const STATUS_LABEL: Record<string, string> = {
  new: 'New', scheduled: 'Scheduled', assigned: 'Assigned', on_the_way: 'On the way',
  arrived: 'Arrived', completed: 'Completed', cancelled: 'Cancelled',
}
export const PAY_LABEL: Record<string, string> = {
  credit_card: 'Credit card', cash: 'Cash', zelle: 'Zelle', check: 'Check', other: 'Other',
}

export type Profile = { id: string; name: string; role: Role; phone: string; email: string; raw: any }
export type Customer = {
  id: string; name: string; phone: string; email: string; address: string; city: string; state: string; zip: string; notes: string; raw: any
}
export type Job = {
  id: string; number: string; customerId: string | null; customerName: string; phone: string; email: string
  address: string; city: string; state: string; zip: string; fullAddress: string
  serviceType: string; category: string; scheduledAt: Date | null; asap: boolean; priority: Priority; status: Status
  description: string; vehicle: { make: string; model: string; year: string; color: string; vin: string }
  lockDetails: string; estimate: number | null; final: number | null; payStatus: PayStatus; payMethod: string
  techId: string | null; dispatcherNotes: string; techNotes: string; createdAt: Date | null; completedAt: Date | null
  acceptedAt: Date | null; raw: any
}
export type Payment = { id: string; jobId: string; amount: number | null; status: string; method: string; ref: string; by: string; at: Date | null; notes: string; processor: string }
export type JobEvent = { id: string; jobId: string; type: string; message: string; from: string; to: string; actor: string; at: Date | null }

const s = (v: any) => (v === null || v === undefined ? '' : String(v))
const d = (v: any) => (v ? new Date(v) : null)

export function toProfile(r: any): Profile {
  return {
    id: s(get(r, 'profiles', 'id')) || r.id,
    name: s(get(r, 'profiles', 'name')) || s(get(r, 'profiles', 'email')) || 'Unnamed user',
    role: (s(get(r, 'profiles', 'role')) || 'dispatcher') as Role,
    phone: s(get(r, 'profiles', 'phone')),
    email: s(get(r, 'profiles', 'email')),
    raw: r,
  }
}

export function toCustomer(r: any): Customer {
  const first = s(get(r, 'customers', 'first')), last = s(get(r, 'customers', 'last'))
  return {
    id: s(get(r, 'customers', 'id')) || r.id,
    name: s(get(r, 'customers', 'name')) || [first, last].filter(Boolean).join(' ') || 'Unnamed customer',
    phone: s(get(r, 'customers', 'phone')),
    email: s(get(r, 'customers', 'email')),
    address: s(get(r, 'customers', 'address')),
    city: s(get(r, 'customers', 'city')),
    state: s(get(r, 'customers', 'state')),
    zip: s(get(r, 'customers', 'zip')),
    notes: s(get(r, 'customers', 'notes')),
    raw: r,
  }
}

export function jobNumber(raw: any, id: string) {
  const n = get(raw, 'jobs', 'number')
  if (n !== undefined && n !== null && n !== '') {
    const str = String(n)
    return /^\d+$/.test(str) ? 'LD-' + str : str
  }
  return 'LD-' + id.replace(/-/g, '').slice(0, 6).toUpperCase()
}

function schedFrom(r: any): Date | null {
  const at = get(r, 'jobs', 'scheduled_at')
  if (at) return new Date(at)
  const date = get(r, 'jobs', 'scheduled_date')
  if (date) {
    const time = s(get(r, 'jobs', 'scheduled_time')) || '09:00'
    return new Date(`${date}T${time.slice(0, 5)}:00`)
  }
  return null
}

export function toJob(r: any, custs: Map<string, Customer>, pays: Payment[]): Job {
  const id = s(get(r, 'jobs', 'id')) || r.id
  const cid = s(get(r, 'jobs', 'customer_id')) || null
  const c = cid ? custs.get(cid) : undefined
  const address = s(get(r, 'jobs', 'address')) || c?.address || ''
  const city = s(get(r, 'jobs', 'city')) || c?.city || ''
  const state = s(get(r, 'jobs', 'state')) || c?.state || ''
  const zip = s(get(r, 'jobs', 'zip')) || c?.zip || ''
  const status = (s(get(r, 'jobs', 'status')) || 'new') as Status
  let payStatus = s(get(r, 'jobs', 'payment_status')) as PayStatus
  let payMethod = s(get(r, 'jobs', 'payment_method'))
  const myPays = pays.filter((p) => p.jobId === id)
  const paid = myPays.find((p) => p.status === 'paid')
  if (!payStatus) payStatus = paid ? 'paid' : 'unpaid'
  if (!payMethod && paid) payMethod = paid.method
  const asapVal = get(r, 'jobs', 'asap')
  const scheduledAt = schedFrom(r)
  return {
    id, number: jobNumber(r, id), customerId: cid,
    customerName: s(get(r, 'jobs', 'customer_name')) || c?.name || 'Unknown customer',
    phone: s(get(r, 'jobs', 'customer_phone')) || c?.phone || '',
    email: s(get(r, 'jobs', 'customer_email')) || c?.email || '',
    address, city, state, zip,
    fullAddress: [address, [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', '),
    serviceType: s(get(r, 'jobs', 'service_type')),
    category: s(get(r, 'jobs', 'category')).toLowerCase(),
    scheduledAt,
    asap: asapVal === true || asapVal === 'true' || (!scheduledAt && s(get(r, 'jobs', 'priority')) === 'emergency'),
    priority: (s(get(r, 'jobs', 'priority')) || 'normal') as Priority,
    status,
    description: s(get(r, 'jobs', 'description')),
    vehicle: {
      make: s(get(r, 'jobs', 'v_make')), model: s(get(r, 'jobs', 'v_model')), year: s(get(r, 'jobs', 'v_year')),
      color: s(get(r, 'jobs', 'v_color')), vin: s(get(r, 'jobs', 'v_vin')),
    },
    lockDetails: s(get(r, 'jobs', 'lock_details')),
    estimate: getAmt(r, 'jobs', 'estimate'),
    final: getAmt(r, 'jobs', 'final'),
    payStatus, payMethod,
    techId: s(get(r, 'jobs', 'tech_id')) || null,
    dispatcherNotes: s(get(r, 'jobs', 'dispatcher_notes')),
    techNotes: s(get(r, 'jobs', 'tech_notes')),
    createdAt: d(get(r, 'jobs', 'created_at')),
    completedAt: d(get(r, 'jobs', 'completed_at')),
    acceptedAt: d(get(r, 'jobs', 'accepted_at')),
    raw: r,
  }
}

export function toPayment(r: any): Payment {
  return {
    id: s(get(r, 'payments', 'id')) || r.id,
    jobId: s(get(r, 'payments', 'job_id')),
    amount: getAmt(r, 'payments', 'amount'),
    status: s(get(r, 'payments', 'status')),
    method: s(get(r, 'payments', 'method')),
    ref: s(get(r, 'payments', 'ref')),
    by: s(get(r, 'payments', 'by')),
    at: d(get(r, 'payments', 'at')),
    notes: s(get(r, 'payments', 'notes')),
    processor: s(get(r, 'payments', 'processor')),
  }
}

export function toEvent(r: any): JobEvent {
  return {
    id: s(get(r, 'job_events', 'id')) || r.id,
    jobId: s(get(r, 'job_events', 'job_id')),
    type: s(get(r, 'job_events', 'type')),
    message: s(get(r, 'job_events', 'message')),
    from: s(get(r, 'job_events', 'from_status')),
    to: s(get(r, 'job_events', 'to_status')),
    actor: s(get(r, 'job_events', 'actor')),
    at: d(get(r, 'job_events', 'created_at')),
  }
}

// ---------- Loading ----------

async function selectAll(table: string, orderField?: string, limit = 1000) {
  if (schema.tables[table] === false) return []
  let q = sb.from(table).select('*').limit(limit)
  const oc = orderField ? col(table, orderField) : null
  if (oc) q = q.order(oc, { ascending: false })
  const { data, error } = await q
  if (error) throw new Error(`${table}: ${errText(error)}`)
  return data || []
}

export async function loadAll() {
  const [pr, cu, jo, pa] = await Promise.all([
    selectAll('profiles'),
    selectAll('customers', 'created_at', 5000),
    selectAll('jobs', 'created_at', 2000),
    selectAll('payments', 'at', 5000).catch(() => []),
  ])
  const profiles = pr.map(toProfile)
  const customers = cu.map(toCustomer)
  const cmap = new Map(customers.map((c: Customer) => [c.id, c]))
  const payments = pa.map(toPayment)
  const jobs = jo.map((r: any) => toJob(r, cmap, payments))
  return { profiles, customers, jobs, payments }
}

export async function loadEvents(jobId: string): Promise<JobEvent[]> {
  if (schema.tables.job_events === false || !col('job_events', 'job_id')) return []
  let q = sb.from('job_events').select('*').eq(col('job_events', 'job_id'), jobId)
  const oc = col('job_events', 'created_at')
  if (oc) q = q.order(oc, { ascending: true })
  const { data, error } = await q
  if (error) return []
  return (data || []).map(toEvent)
}

export async function loadNotifications(jobId: string): Promise<any[]> {
  if (schema.tables.notifications === false || !col('notifications', 'job_id')) return []
  const { data, error } = await sb.from('notifications').select('*').eq(col('notifications', 'job_id'), jobId)
  if (error) return []
  return data || []
}

// ---------- Writes ----------

export type JobForm = {
  customerId: string | null
  name: string; phone: string; email: string
  serviceType: string; category: string
  address: string; city: string; state: string; zip: string
  date: string; time: string; asap: boolean; priority: Priority
  description: string
  make: string; model: string; year: string; color: string; vin: string
  lockDetails: string; estimate: string; techId: string
  dispatcherNotes: string; techNotes: string
}

export const emptyJobForm = (): JobForm => ({
  customerId: null, name: '', phone: '', email: '', serviceType: '', category: 'residential',
  address: '', city: '', state: 'NY', zip: '', date: todayISO(), time: '', asap: false, priority: 'normal',
  description: '', make: '', model: '', year: '', color: '', vin: '', lockDetails: '', estimate: '', techId: '',
  dispatcherNotes: '', techNotes: '',
})

export function todayISO(dt = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

export function jobToForm(j: Job): JobForm {
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    customerId: j.customerId, name: j.customerName, phone: j.phone, email: j.email,
    serviceType: j.serviceType, category: j.category || 'residential',
    address: j.address, city: j.city, state: j.state, zip: j.zip,
    date: j.scheduledAt ? todayISO(j.scheduledAt) : todayISO(),
    time: j.scheduledAt ? `${p(j.scheduledAt.getHours())}:${p(j.scheduledAt.getMinutes())}` : '',
    asap: j.asap, priority: j.priority, description: j.description,
    make: j.vehicle.make, model: j.vehicle.model, year: j.vehicle.year, color: j.vehicle.color, vin: j.vehicle.vin,
    lockDetails: j.lockDetails, estimate: j.estimate === null ? '' : String(j.estimate), techId: j.techId || '',
    dispatcherNotes: j.dispatcherNotes, techNotes: j.techNotes,
  }
}

function cleanPhone(p: string) { return p.trim() }

async function upsertCustomer(f: JobForm): Promise<string | null> {
  if (schema.tables.customers === false) return null
  const row: any = {}
  const nameCol = col('customers', 'name')
  if (nameCol) row[nameCol] = f.name.trim()
  else {
    const [first, ...rest] = f.name.trim().split(' ')
    put(row, 'customers', 'first', first)
    put(row, 'customers', 'last', rest.join(' '))
  }
  put(row, 'customers', 'phone', cleanPhone(f.phone) || null)
  put(row, 'customers', 'email', f.email.trim() || null)
  put(row, 'customers', 'address', f.address.trim() || null)
  put(row, 'customers', 'city', f.city.trim() || null)
  put(row, 'customers', 'state', f.state.trim() || null)
  put(row, 'customers', 'zip', f.zip.trim() || null)
  if (f.customerId) {
    const { error } = await sb.from('customers').update(row).eq(col('customers', 'id') || 'id', f.customerId)
    if (error) console.warn('customer update', error)
    return f.customerId
  }
  const { data, error } = await sb.from('customers').insert(row).select('*').single()
  if (error) throw new Error('Could not save customer: ' + errText(error))
  return s(get(data, 'customers', 'id')) || data.id
}

function scheduleInto(row: any, f: JobForm) {
  put(row, 'jobs', 'asap', f.asap)
  if (has('jobs', 'scheduled_at')) {
    if (f.asap) put(row, 'jobs', 'scheduled_at', new Date().toISOString())
    else if (f.date) put(row, 'jobs', 'scheduled_at', new Date(`${f.date}T${f.time || '09:00'}:00`).toISOString())
    else put(row, 'jobs', 'scheduled_at', null)
  } else {
    put(row, 'jobs', 'scheduled_date', f.asap ? todayISO() : f.date || null)
    put(row, 'jobs', 'scheduled_time', f.asap ? null : f.time || null)
  }
}

export async function saveJob(f: JobForm, userId: string, existing?: Job): Promise<string> {
  if (!f.name.trim()) throw new Error('Customer name is required.')
  if (!f.phone.trim()) throw new Error('Customer phone is required.')
  const customerId = await upsertCustomer(f)
  const row: any = {}
  put(row, 'jobs', 'customer_id', customerId)
  put(row, 'jobs', 'customer_name', f.name.trim())
  put(row, 'jobs', 'customer_phone', cleanPhone(f.phone))
  put(row, 'jobs', 'customer_email', f.email.trim() || null)
  put(row, 'jobs', 'service_type', f.serviceType.trim() || null)
  put(row, 'jobs', 'category', f.category || null)
  put(row, 'jobs', 'address', f.address.trim() || null)
  put(row, 'jobs', 'city', f.city.trim() || null)
  put(row, 'jobs', 'state', f.state.trim() || null)
  put(row, 'jobs', 'zip', f.zip.trim() || null)
  scheduleInto(row, f)
  put(row, 'jobs', 'priority', f.priority)
  put(row, 'jobs', 'description', f.description.trim() || null)
  const auto = f.category === 'automotive'
  put(row, 'jobs', 'v_make', auto ? f.make.trim() || null : null)
  put(row, 'jobs', 'v_model', auto ? f.model.trim() || null : null)
  put(row, 'jobs', 'v_year', auto && f.year.trim() ? (/^\d+$/.test(f.year.trim()) ? Number(f.year.trim()) : f.year.trim()) : null)
  put(row, 'jobs', 'v_color', auto ? f.color.trim() || null : null)
  put(row, 'jobs', 'v_vin', auto ? f.vin.trim() || null : null)
  put(row, 'jobs', 'lock_details', f.lockDetails.trim() || null)
  putAmt(row, 'jobs', 'estimate', f.estimate.trim() ? Number(f.estimate) : null)
  put(row, 'jobs', 'tech_id', f.techId || null)
  put(row, 'jobs', 'dispatcher_notes', f.dispatcherNotes.trim() || null)
  put(row, 'jobs', 'tech_notes', f.techNotes.trim() || null)

  if (existing) {
    // Keep status in step with assignment for jobs that haven't started yet
    if (['new', 'scheduled', 'assigned'].includes(existing.status)) {
      put(row, 'jobs', 'status', f.techId ? 'assigned' : f.asap || !f.date ? 'new' : 'scheduled')
    }
    const { error } = await sb.from('jobs').update(row).eq(col('jobs', 'id') || 'id', existing.id)
    if (error) throw new Error('Could not save job: ' + errText(error))
    return existing.id
  }
  put(row, 'jobs', 'status', f.techId ? 'assigned' : f.asap || !f.date ? 'new' : 'scheduled')
  put(row, 'jobs', 'payment_status', 'unpaid')
  put(row, 'jobs', 'created_by', userId)
  const { data, error } = await sb.from('jobs').insert(row).select('*').single()
  if (error) throw new Error('Could not create job: ' + errText(error))
  return s(get(data, 'jobs', 'id')) || data.id
}

export async function updateJob(id: string, fields: Record<string, any>) {
  const row: any = {}
  for (const [f, v] of Object.entries(fields)) {
    if (f === 'final' || f === 'estimate') putAmt(row, 'jobs', f, v)
    else put(row, 'jobs', f, v)
  }
  if (!Object.keys(row).length) return
  const { error } = await sb.from('jobs').update(row).eq(col('jobs', 'id') || 'id', id)
  if (error) throw new Error(errText(error))
}

export async function setStatus(job: Job, status: Status, extra: Record<string, any> = {}) {
  const fields: Record<string, any> = { status, ...extra }
  const now = new Date().toISOString()
  if (status === 'on_the_way' && has('jobs', 'on_the_way_at')) fields.on_the_way_at = now
  if (status === 'arrived' && has('jobs', 'arrived_at')) fields.arrived_at = now
  if (status === 'completed' && has('jobs', 'completed_at')) fields.completed_at = now
  if (status === 'cancelled' && has('jobs', 'cancelled_at')) fields.cancelled_at = now
  await updateJob(job.id, fields)
}

export async function logEvent(jobId: string, userId: string, type: string, message: string) {
  if (schema.tables.job_events === false || !col('job_events', 'job_id')) return false
  const row: any = {}
  put(row, 'job_events', 'job_id', jobId)
  put(row, 'job_events', 'type', type)
  put(row, 'job_events', 'message', message)
  put(row, 'job_events', 'actor', userId)
  const { error } = await sb.from('job_events').insert(row)
  return !error
}

const ACCEPT_KEY = 'lockdesk.accepted'
export function locallyAccepted(): string[] {
  try { return JSON.parse(localStorage.getItem(ACCEPT_KEY) || '[]') } catch { return [] }
}
export async function acceptJob(job: Job, userId: string) {
  try {
    const list = locallyAccepted()
    if (!list.includes(job.id)) localStorage.setItem(ACCEPT_KEY, JSON.stringify([...list, job.id].slice(-300)))
  } catch {}
  if (has('jobs', 'accepted_at')) {
    try { await updateJob(job.id, { accepted_at: new Date().toISOString() }) } catch {}
  }
  if (job.status === 'new' || job.status === 'scheduled') {
    try { await updateJob(job.id, { status: 'assigned' }) } catch {}
  }
  await logEvent(job.id, userId, 'accepted', 'Technician accepted').catch(() => false)
}

export async function recordPayment(job: Job, userId: string, p: { amount: number; method: PayMethod; ref: string; notes: string }) {
  if (schema.tables.payments !== false && col('payments', 'job_id')) {
    const row: any = {}
    put(row, 'payments', 'job_id', job.id)
    putPayAmt(row, p.amount)
    put(row, 'payments', 'status', 'paid')
    put(row, 'payments', 'method', p.method)
    put(row, 'payments', 'processor', p.method === 'credit_card' ? 'manual' : null)
    put(row, 'payments', 'ref', p.ref.trim() || null)
    put(row, 'payments', 'by', userId)
    if (col('payments', 'at') && col('payments', 'at') !== 'created_at') put(row, 'payments', 'at', new Date().toISOString())
    put(row, 'payments', 'notes', p.notes.trim() || null)
    const { error } = await sb.from('payments').insert(row)
    if (error) throw new Error('Could not record payment: ' + errText(error))
  }
  const fields: Record<string, any> = { payment_status: 'paid', payment_method: p.method }
  if (has('jobs', 'paid_at')) fields.paid_at = new Date().toISOString()
  try { await updateJob(job.id, fields) } catch (e) {
    if (!col('payments', 'job_id')) throw e
  }
}
function putPayAmt(row: any, v: number) {
  const c = col('payments', 'amount')
  if (!c) return
  row[c] = /cents/.test(c) ? Math.round(v * 100) : Math.round(v * 100) / 100
}

export async function setPayStatus(job: Job, status: PayStatus) {
  await updateJob(job.id, { payment_status: status })
}

// Queue a customer text. This does NOT send anything. It records the message
// so an SMS provider can deliver it once one is connected.
export async function queueText(job: Job, body: string, template: string) {
  if (schema.tables.notifications === false || !col('notifications', 'job_id')) return false
  if (!job.phone) return false
  const row: any = {}
  put(row, 'notifications', 'job_id', job.id)
  put(row, 'notifications', 'customer_id', job.customerId)
  put(row, 'notifications', 'channel', 'sms')
  put(row, 'notifications', 'status', 'queued')
  put(row, 'notifications', 'to', job.phone)
  put(row, 'notifications', 'body', body)
  put(row, 'notifications', 'template', template)
  const { error } = await sb.from('notifications').insert(row)
  if (error) console.warn('notification queue failed', error)
  return !error
}

export async function saveCustomer(c: Customer, patch: Partial<Customer>) {
  const row: any = {}
  if (patch.name !== undefined) {
    if (col('customers', 'name')) put(row, 'customers', 'name', patch.name)
    else { const [a, ...b] = patch.name.split(' '); put(row, 'customers', 'first', a); put(row, 'customers', 'last', b.join(' ')) }
  }
  for (const k of ['phone', 'email', 'address', 'city', 'state', 'zip', 'notes'] as const) {
    if (patch[k] !== undefined) put(row, 'customers', k, (patch[k] as string) || null)
  }
  const { error } = await sb.from('customers').update(row).eq(col('customers', 'id') || 'id', c.id)
  if (error) throw new Error(errText(error))
}

export async function setRole(p: Profile, role: Role) {
  const rc = col('profiles', 'role')
  if (!rc) throw new Error('No role column found on profiles.')
  const { error } = await sb.from('profiles').update({ [rc]: role }).eq(col('profiles', 'id') || 'id', p.id)
  if (error) throw new Error(errText(error))
}

export async function updateMyProfile(id: string, patch: { name?: string; phone?: string }) {
  const row: any = {}
  if (patch.name !== undefined) put(row, 'profiles', 'name', patch.name)
  if (patch.phone !== undefined) put(row, 'profiles', 'phone', patch.phone)
  if (!Object.keys(row).length) return
  const { error } = await sb.from('profiles').update(row).eq(col('profiles', 'id') || 'id', id)
  if (error) throw new Error(errText(error))
}

// ---------- Formatting ----------

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? 'Not set' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function fmtWhen(j: Job) {
  if (j.asap && (!j.scheduledAt || isToday(j.scheduledAt))) return 'ASAP'
  if (!j.scheduledAt) return 'Not scheduled'
  return fmtDateTime(j.scheduledAt)
}
export function isToday(dt: Date) { return todayISO(dt) === todayISO() }
export function fmtTime(dt: Date) { return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
export function fmtDateTime(dt: Date) {
  if (isToday(dt)) return 'Today ' + fmtTime(dt)
  const tm = new Date(); tm.setDate(tm.getDate() + 1)
  if (todayISO(dt) === todayISO(tm)) return 'Tomorrow ' + fmtTime(dt)
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + fmtTime(dt)
}
export function titleCase(x: string) { return x ? x.charAt(0).toUpperCase() + x.slice(1) : '' }
export function telHref(p: string) { return 'tel:' + p.replace(/[^\d+]/g, '') }
export function mapsHref(addr: string) { return 'https://maps.google.com/?q=' + encodeURIComponent(addr) }

export const ACTIVE: Status[] = ['new', 'scheduled', 'assigned', 'on_the_way', 'arrived']

// ---------- Parts ----------

export type PartStatus = 'needed' | 'ordered' | 'received' | 'installed' | 'cancelled'
export const PART_LABEL: Record<string, string> = {
  needed: 'Needs ordering', ordered: 'Ordered', received: 'Received', installed: 'Installed', cancelled: 'Cancelled',
}
export type Part = {
  id: string; jobId: string; name: string; partNumber: string; quantity: number; supplier: string
  cost: number | null; status: PartStatus; notes: string; expectedOn: string; orderedAt: Date | null
  receivedAt: Date | null; createdAt: Date | null
}

export const partsEnabled = () => schema.tables.job_parts === true && !!col('job_parts', 'job_id')

export function toPart(r: any): Part {
  return {
    id: s(r.id), jobId: s(r.job_id), name: s(r.name), partNumber: s(r.part_number), quantity: Number(r.quantity) || 1,
    supplier: s(r.supplier), cost: r.cost === null || r.cost === undefined ? null : Number(r.cost),
    status: (s(r.status) || 'needed') as PartStatus, notes: s(r.notes), expectedOn: s(r.expected_on),
    orderedAt: d(r.ordered_at), receivedAt: d(r.received_at), createdAt: d(r.created_at),
  }
}

export async function loadParts(): Promise<Part[]> {
  if (!partsEnabled()) return []
  const { data, error } = await sb.from('job_parts').select('*').order('created_at', { ascending: true }).limit(5000)
  if (error) return []
  return (data || []).map(toPart)
}

export async function addPart(jobId: string, p: { name: string; quantity: number; partNumber: string; notes: string; supplier?: string; cost?: number | null }) {
  if (!p.name.trim()) throw new Error('Enter the part name.')
  const row: any = {
    job_id: jobId, name: p.name.trim(), quantity: p.quantity > 0 ? Math.round(p.quantity) : 1,
    part_number: p.partNumber.trim() || null, notes: p.notes.trim() || null, status: 'needed',
  }
  if (p.supplier !== undefined) row.supplier = p.supplier.trim() || null
  if (p.cost !== undefined) row.cost = p.cost
  const { error } = await sb.from('job_parts').insert(row)
  if (error) throw new Error('Could not add part: ' + errText(error))
}

export async function updatePart(id: string, patch: Record<string, any>) {
  const { error } = await sb.from('job_parts').update(patch).eq('id', id)
  if (error) throw new Error('Could not update part: ' + errText(error))
}

export async function deletePart(id: string) {
  const { error } = await sb.from('job_parts').delete().eq('id', id)
  if (error) throw new Error('Could not remove part: ' + errText(error))
}

// Summary used for badges: the "least done" open part decides the label
export function partsState(parts: Part[]): PartStatus | null {
  const open = parts.filter((p) => p.status !== 'cancelled')
  if (!open.length) return null
  for (const st of ['needed', 'ordered', 'received'] as PartStatus[]) if (open.some((p) => p.status === st)) return st
  return 'installed'
}
