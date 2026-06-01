import { ref, isRef, type Ref } from 'vue'

export interface WCConfig {
  url: string
  consumerKey: string
  consumerSecret: string
}

export interface WCMetaData {
  key: string
  value: string
  display_value?: string
}

export interface WCLineItem {
  id: number
  name: string
  quantity: number
  total: string
  total_tax?: string
  meta_data: WCMetaData[]
}

export interface WCOrder {
  id: number
  number: string
  date_created: string
  status: string
  total: string
  total_tax: string
  discount_total: string
  payment_method: string
  payment_method_title: string
  line_items: WCLineItem[]
}

export type Period = 'today' | 'week' | 'month' | 'year' | 'all'

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('fr-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatCHF(amount: string | number): string {
  return parseFloat(String(amount || 0))
    .toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' CHF'
}

export function periodToDates(period: Period): { after?: string; before?: string } {
  const now = new Date()
  if (period === 'today') {
    return { after: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() }
  }
  if (period === 'week') {
    const start = new Date(now)
    const day = start.getDay() || 7
    start.setDate(start.getDate() - day + 1)
    start.setHours(0, 0, 0, 0)
    return { after: start.toISOString() }
  }
  if (period === 'month') {
    return { after: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }
  }
  if (period === 'year') {
    return { after: new Date(now.getFullYear(), 0, 1).toISOString() }
  }
  return {}
}

export function useWooOrders(config: Ref<WCConfig> | WCConfig) {
  const orders = ref<WCOrder[]>([])
  const loading = ref(false)
  const error = ref('')
  const totalPages = ref(1)
  const totalCount = ref(0)

  function cfg(): WCConfig {
    return isRef(config) ? config.value : config
  }

  function authHeader(): Record<string, string> {
    const c = cfg()
    return { Authorization: `Basic ${btoa(`${c.consumerKey}:${c.consumerSecret}`)}` }
  }

  function apiBase(): string {
    return cfg().url.replace(/\/$/, '') + '/wp-json/wc/v3'
  }

  async function fetchOrders(params: {
    after?: string
    before?: string
    search?: string
    per_page?: number
    page?: number
  } = {}): Promise<void> {
    loading.value = true
    error.value = ''

    const q = new URLSearchParams()
    q.set('per_page', String(params.per_page || 50))
    q.set('page', String(params.page || 1))
    if (params.after) q.set('after', params.after)
    if (params.before) q.set('before', params.before)
    if (params.search) q.set('search', params.search)
    q.append('status[]', 'completed')
    q.append('status[]', 'processing')
    q.append('status[]', 'on-hold')

    try {
      const res = await fetch(`${apiBase()}/orders?${q}`, { headers: authHeader() })
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status} — vérifiez vos clés API.`)
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        throw new Error("Le serveur a retourné une réponse non-JSON. Vérifiez l'URL WooCommerce.")
      }
      orders.value = await res.json()
      totalPages.value = parseInt(res.headers.get('X-WP-TotalPages') || '1')
      totalCount.value = parseInt(res.headers.get('X-WP-Total') || '0')
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
    }

    loading.value = false
  }

  return { orders, loading, error, totalPages, totalCount, fetchOrders }
}
