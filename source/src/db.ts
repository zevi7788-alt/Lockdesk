// Supabase client plus automatic schema detection.
// The app does not hard code column names. After login it checks which
// columns exist in each table and maps them to the fields the UI needs.

declare global {
  interface Window { supabase: any }
}

export const SUPABASE_URL = 'https://apcgtuyddityzolkrsyy.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_R1zb-f3tXRjYbvKTogFehQ_-HVITfGS'

export let sb: any = null
export function initClient() {
  if (!sb) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  }
  return sb
}

// Logical field -> candidate column names, in order of preference.
export const SPEC: Record<string, Record<string, string[]>> = {
  profiles: {
    id: ['id'],
    name: ['full_name', 'name', 'display_name', 'username'],
    role: ['role', 'app_role'],
    phone: ['phone', 'phone_number'],
    email: ['email'],
    active: ['is_active', 'active'],
    approved: ['approved'],
  },
  customers: {
    id: ['id'],
    name: ['full_name', 'name', 'customer_name'],
    first: ['first_name'],
    last: ['last_name'],
    phone: ['phone', 'phone_number', 'mobile'],
    email: ['email'],
    address: ['address', 'address_line1', 'street_address', 'street', 'address1'],
    city: ['city'],
    state: ['state'],
    zip: ['zip', 'zip_code', 'postal_code', 'zipcode'],
    notes: ['notes'],
    created_at: ['created_at'],
  },
  jobs: {
    id: ['id'],
    number: ['job_number', 'job_no', 'number', 'reference', 'job_code'],
    customer_id: ['customer_id'],
    customer_name: ['customer_name'],
    customer_phone: ['customer_phone'],
    customer_email: ['customer_email'],
    service_type: ['service_type', 'service', 'job_type'],
    category: ['service_category', 'category', 'job_category'],
    address: ['address', 'service_address', 'address_line1', 'street_address', 'street'],
    city: ['city', 'service_city'],
    state: ['state', 'service_state'],
    zip: ['zip', 'zip_code', 'postal_code', 'service_zip'],
    scheduled_at: ['scheduled_at', 'scheduled_for', 'scheduled_start', 'scheduled_datetime', 'appointment_at'],
    scheduled_date: ['scheduled_date', 'date'],
    scheduled_time: ['scheduled_time', 'time'],
    asap: ['is_asap', 'asap'],
    priority: ['priority'],
    status: ['status'],
    description: ['description', 'problem_description', 'details'],
    v_make: ['vehicle_make'],
    v_model: ['vehicle_model'],
    v_year: ['vehicle_year'],
    v_color: ['vehicle_color'],
    v_vin: ['vehicle_vin', 'vin'],
    lock_details: ['lock_key_details', 'lock_details', 'key_details', 'lock_key_info', 'lock_info'],
    estimate: ['estimated_amount', 'estimate_amount', 'estimated_price', 'estimate', 'estimated_amount_cents', 'estimate_cents'],
    final: ['final_amount', 'final_price', 'final_amount_cents', 'final_cents'],
    payment_status: ['payment_status'],
    payment_method: ['payment_method'],
    tech_id: ['assigned_technician_id', 'technician_id', 'assigned_to', 'assigned_tech_id', 'tech_id', 'assigned_technician'],
    dispatcher_notes: ['dispatcher_notes', 'office_notes', 'internal_notes'],
    tech_notes: ['technician_notes', 'tech_notes'],
    created_by: ['created_by', 'dispatcher_id'],
    created_at: ['created_at'],
    accepted_at: ['accepted_at', 'technician_accepted_at'],
    on_the_way_at: ['on_the_way_at', 'en_route_at', 'departed_at'],
    arrived_at: ['arrived_at'],
    completed_at: ['completed_at'],
    cancelled_at: ['cancelled_at'],
    paid_at: ['paid_at'],
  },
  job_events: {
    id: ['id'],
    job_id: ['job_id'],
    type: ['event_type', 'type', 'event', 'action', 'kind'],
    message: ['message', 'description', 'note', 'notes', 'details', 'summary'],
    from_status: ['from_status', 'old_status', 'previous_status'],
    to_status: ['to_status', 'new_status', 'status'],
    actor: ['created_by', 'actor_id', 'user_id', 'performed_by'],
    created_at: ['created_at', 'occurred_at'],
  },
  payments: {
    id: ['id'],
    job_id: ['job_id'],
    amount: ['amount', 'amount_paid', 'amount_cents'],
    status: ['status', 'payment_status'],
    method: ['method', 'payment_method'],
    processor: ['processor', 'payment_processor'],
    ref: ['processor_transaction_id', 'processor_reference', 'processor_ref', 'transaction_id', 'reference_id', 'reference'],
    by: ['processed_by', 'recorded_by', 'created_by'],
    at: ['processed_at', 'paid_at', 'created_at'],
    notes: ['notes'],
  },
  notifications: {
    id: ['id'],
    job_id: ['job_id'],
    customer_id: ['customer_id'],
    channel: ['channel'],
    status: ['status'],
    to: ['recipient', 'to_address', 'to_phone', 'to', 'phone', 'destination'],
    body: ['body', 'message', 'content', 'text'],
    template: ['template', 'kind', 'type', 'notification_type'],
    created_at: ['created_at'],
  },
  job_attachments: {
    id: ['id'],
    job_id: ['job_id'],
  },
  access_requests: {
    id: ['id'],
    email: ['email'],
  },
  job_parts: {
    id: ['id'],
    job_id: ['job_id'],
    name: ['name'],
    part_number: ['part_number'],
    quantity: ['quantity'],
    supplier: ['supplier'],
    cost: ['cost'],
    status: ['status'],
    notes: ['notes'],
    expected_on: ['expected_on'],
    ordered_at: ['ordered_at'],
    received_at: ['received_at'],
    created_by: ['created_by'],
    created_at: ['created_at'],
  },
}

export type Schema = {
  version: number
  tables: Record<string, boolean>
  cols: Record<string, Record<string, string | null>>
  allCols: Record<string, string[] | null>
  scannedAt: string
}

const SCHEMA_KEY = 'lockdesk.schema.v5'
export let schema: Schema = { version: 3, tables: {}, cols: {}, allCols: {}, scannedAt: '' }

function missingColumn(err: any) {
  if (!err) return false
  const m = String(err.message || '') + ' ' + String(err.details || '')
  return err.code === '42703' || /does not exist|could not find/i.test(m)
}
function missingTable(err: any) {
  if (!err) return false
  return err.code === 'PGRST205' || err.code === '42P01' || /relation .* does not exist|could not find the table/i.test(String(err.message))
}

async function probeTable(t: string) {
  const fields = SPEC[t]
  const res = await sb.from(t).select('*').limit(1)
  if (res.error && missingTable(res.error)) {
    schema.tables[t] = false
    schema.cols[t] = {}
    schema.allCols[t] = null
    return
  }
  schema.tables[t] = !res.error
  const row = res.data && res.data[0]
  const keys: string[] | null = row ? Object.keys(row) : null
  schema.allCols[t] = keys
  const out: Record<string, string | null> = {}
  // Try the OpenAPI shortcut-free path: if we have a row, the keys tell us everything.
  if (keys) {
    for (const f of Object.keys(fields)) out[f] = fields[f].find((c) => keys.includes(c)) || null
  } else {
    // Empty table: probe each candidate column.
    const cache: Record<string, boolean> = {}
    const exists = async (c: string) => {
      if (c in cache) return cache[c]
      const r = await sb.from(t).select(c).limit(0)
      cache[c] = !r.error
      return cache[c]
    }
    await Promise.all(
      Object.keys(fields).map(async (f) => {
        for (const c of fields[f]) {
          if (await exists(c)) { out[f] = c; return }
        }
        out[f] = null
      }),
    )
    schema.allCols[t] = Object.keys(cache).filter((c) => cache[c])
  }
  // Avoid ambiguous double mapping (e.g. scheduled_time 'time' vs others)
  if (t === 'jobs' && out.scheduled_at) { out.scheduled_date = null; out.scheduled_time = null }
  if (t === 'job_events' && out.to_status === out.type) out.to_status = null
  schema.cols[t] = out
}

export async function scanSchema(force = false) {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(SCHEMA_KEY) || 'null')
      if (cached && cached.version === 3) {
        schema = cached
        // refresh quietly in background
        scanSchema(true).catch(() => {})
        return schema
      }
    } catch {}
  }
  const next: Schema = { version: 3, tables: {}, cols: {}, allCols: {}, scannedAt: new Date().toISOString() }
  const prev = schema
  schema = next
  try {
    await Promise.all(Object.keys(SPEC).map(probeTable))
    try { localStorage.setItem(SCHEMA_KEY, JSON.stringify(schema)) } catch {}
  } catch (e) {
    schema = prev
    throw e
  }
  return schema
}

export function col(t: string, f: string): string | null {
  return schema.cols[t]?.[f] ?? null
}
export function has(t: string, f: string) { return !!col(t, f) }
export function get(row: any, t: string, f: string) {
  const c = col(t, f)
  return c && row ? row[c] : undefined
}
export function put(obj: any, t: string, f: string, v: any) {
  const c = col(t, f)
  if (c && v !== undefined) obj[c] = v
  return obj
}
function isCents(t: string, f: string) { return /cents/.test(col(t, f) || '') }
export function getAmt(row: any, t: string, f: string): number | null {
  const v = get(row, t, f)
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (isNaN(n)) return null
  return isCents(t, f) ? n / 100 : n
}
export function putAmt(obj: any, t: string, f: string, v: number | null) {
  if (v === null || v === undefined || isNaN(v as number)) return put(obj, t, f, null)
  return put(obj, t, f, isCents(t, f) ? Math.round(v * 100) : Math.round(v * 100) / 100)
}

export function errText(e: any): string {
  if (!e) return 'Unknown error'
  if (typeof e === 'string') return e
  const parts = [e.message, e.details, e.hint].filter(Boolean)
  return parts.join(' ') || JSON.stringify(e)
}
