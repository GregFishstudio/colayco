import { invoke } from '@tauri-apps/api/core'

// Requêtes HTTP pour WooCommerce, exécutées côté Rust (commande `woo_request`)
// plutôt que via le fetch() du navigateur/plugin-http : ça permet de résoudre
// les noms de domaine via un DNS public (Cloudflare/Google) au lieu du DNS
// système, qui peut être mal configuré sur certains postes.

interface ReponseRust {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export interface WooFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface WooFetchResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<any>
  text(): Promise<string>
}

export async function wooFetch(url: string, opts: WooFetchOptions = {}): Promise<WooFetchResponse> {
  const res = await invoke<ReponseRust>('woo_request', {
    url,
    method: opts.method || 'GET',
    headers: opts.headers || {},
    body: opts.body,
  })

  const headersMinuscules: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(res.headers || {})) {
    headersMinuscules[cle.toLowerCase()] = valeur
  }

  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    headers: { get: (name: string) => headersMinuscules[name.toLowerCase()] ?? null },
    json: async () => JSON.parse(res.body),
    text: async () => res.body,
  }
}
