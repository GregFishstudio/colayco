<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useWooOrders, formatDate, formatCHF, periodToDates } from '../composables/useWooOrders'

const props = defineProps({ wooConfig: Object })
const emit = defineEmits(['update:wooConfig'])

// ── Config locale ─────────────────────────────────────────────────────────
const configLocale = ref({
  url:            props.wooConfig?.url            || '',
  consumerKey:    props.wooConfig?.consumerKey    || '',
  consumerSecret: props.wooConfig?.consumerSecret || '',
})
// Auto-save après 800ms sans frappe (pas de boucle car debounce + v-if recrée le composant)
let autoSaveTimer = null
watch(configLocale, (v) => {
  clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => emit('update:wooConfig', { ...v }), 800)
}, { deep: true })

const configMsg  = ref('')
const configErr  = ref('')
const testLoad   = ref(false)

const sauvegarderConfig = () => {
  emit('update:wooConfig', { ...configLocale.value })
  configMsg.value = 'Configuration sauvegardée.'
  setTimeout(() => { configMsg.value = '' }, 2000)
}

// ── Tabs ──────────────────────────────────────────────────────────────────
const onglet = ref(configLocale.value.url ? 'pos' : 'config')

// ── Helper : fetch JSON sécurisé ──────────────────────────────────────────
const safeFetch = async (url, opts = {}) => {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status} — vérifiez vos clés API et l'URL.`)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json'))
    throw new Error("Le serveur a retourné une réponse non-JSON. Vérifiez l'URL WooCommerce et que WooCommerce est bien activé sur ce domaine.")
  return res
}

const authHdr = () => ({ Authorization: `Basic ${btoa(`${configLocale.value.consumerKey}:${configLocale.value.consumerSecret}`)}` })
const apiUrl  = (ep) => configLocale.value.url.replace(/\/$/, '') + '/wp-json/wc/v3/' + ep

// ── Test connexion ────────────────────────────────────────────────────────
const testerConnexion = async () => {
  configMsg.value = ''
  configErr.value = ''
  testLoad.value  = true
  try {
    const res   = await safeFetch(apiUrl('products?per_page=1'), { headers: authHdr() })
    const total = res.headers.get('X-WP-Total') || '?'
    configMsg.value = `Connexion réussie — ${total} produit(s) trouvé(s).`
  } catch (e) {
    configErr.value = e.message
  }
  testLoad.value = false
}

// ══════════════════════════════════════════════════════════════════════════
// ── POS — Ventes / Tickets
// ══════════════════════════════════════════════════════════════════════════
const { orders, loading: posLoad, error: posErr, totalPages, totalCount, fetchOrders } = useWooOrders(configLocale)

const PERIODS = [
  { key: 'today', label: "Auj." },
  { key: 'week',  label: 'Semaine' },
  { key: 'month', label: 'Mois' },
  { key: 'year',  label: 'Année' },
  { key: 'all',   label: 'Tout' },
]
const activePeriod  = ref('month')
const paymentFilter = ref('')
const posSearch     = ref('')
const posPage       = ref(1)
const selected      = ref(null)

const chargerVentes = async () => {
  const { after, before } = periodToDates(activePeriod.value)
  await fetchOrders({ after, before, search: posSearch.value || undefined, per_page: 50, page: posPage.value })
}

const selectPeriod = (p) => { activePeriod.value = p; posPage.value = 1; chargerVentes() }
const goPage       = (n) => { posPage.value = n; chargerVentes() }

const ordresAffiches = computed(() => {
  if (!paymentFilter.value) return orders.value
  return orders.value.filter(o => o.payment_method === paymentFilter.value)
})

const statsVentes = computed(() => {
  const list = ordresAffiches.value
  const totalRevenue = list.reduce((s, o) => s + Number(o.total), 0)
  const totalTax     = list.reduce((s, o) => s + Number(o.total_tax), 0)
  const avgOrder     = list.length ? totalRevenue / list.length : 0
  const especes = list.filter(o => ['especes','cod'].includes(o.payment_method)).reduce((s, o) => s + Number(o.total), 0)
  const carte   = list.filter(o => !['especes','cod'].includes(o.payment_method)).reduce((s, o) => s + Number(o.total), 0)
  return { totalRevenue, totalTax, avgOrder, byPayment: { especes, carte } }
})

const openDetail = (o) => { selected.value = o }

const paymentClass = (m) => (m === 'especes' || m === 'cod') ? 'pay-cash' : 'pay-card'

const getItemMeta = (item) =>
  (item.meta_data || [])
    .filter(m => !String(m.key).startsWith('_'))
    .map(m => m.display_value ?? m.value)
    .filter(Boolean)
    .join(' · ')

const lineItemsHT = (o) => o.line_items.reduce((s, i) => s + Number(i.total), 0)

// ══════════════════════════════════════════════════════════════════════════
// ── Inventaire — Produits
// ══════════════════════════════════════════════════════════════════════════
const invLoad  = ref(false)
const invErr   = ref('')
const invMsg   = ref('')
const produits = ref([])
const filtreCategorie  = ref('')
const filtreRecherche  = ref('')
const miseAJourEnCours = ref({})

const chargerProduits = async () => {
  if (!configLocale.value.url || !configLocale.value.consumerKey) {
    invErr.value = 'Configurez d\'abord la connexion WooCommerce.'
    onglet.value = 'config'
    return
  }
  invLoad.value = true
  invErr.value  = ''
  invMsg.value  = ''
  produits.value = []
  filtreCategorie.value = ''
  try {
    let page = 1, totalPg = 1
    while (page <= totalPg) {
      const res = await safeFetch(apiUrl(`products?per_page=100&page=${page}&status=publish`), { headers: authHdr() })
      const data = await res.json()
      totalPg = parseInt(res.headers.get('X-WP-TotalPages') || '1')
      produits.value.push(...data)
      page++
    }
    onglet.value = 'inventaire'
    invMsg.value = `${produits.value.length} produit(s) chargé(s).`
    setTimeout(() => { invMsg.value = '' }, 3000)
  } catch (e) {
    invErr.value = e.message
  }
  invLoad.value = false
}

// Catégories extraites des produits chargés (IDs garantis cohérents)
const categoriesFromProduits = computed(() => {
  const map = new Map()
  produits.value.forEach(p =>
    (p.categories || []).forEach(c => { if (!map.has(c.id)) map.set(c.id, c.name) })
  )
  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
})

const produitsFiltres = computed(() => {
  let list = produits.value
  if (filtreCategorie.value !== '') {
    const catId = Number(filtreCategorie.value)
    list = list.filter(p => (p.categories || []).some(c => c.id === catId))
  }
  if (filtreRecherche.value) {
    const q = filtreRecherche.value.toLowerCase()
    list = list.filter(p => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q))
  }
  return list
})

const totalValeurStock = computed(() =>
  produits.value.reduce((s, p) => s + parseFloat(p.price || 0) * Math.max(0, p.stock_quantity || 0), 0)
)
const nbRuptures = computed(() => produits.value.filter(p => p.manage_stock && (p.stock_quantity ?? 0) <= 0).length)
const nbFaible   = computed(() => produits.value.filter(p => p.manage_stock && (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= 5).length)

const parCategorie = computed(() => {
  const map = {}
  produits.value.forEach(p => {
    const cats = p.categories?.length ? p.categories : [{ id: 0, name: 'Sans catégorie' }]
    cats.forEach(c => {
      if (!map[c.id]) map[c.id] = { nom: c.name, nb: 0, valeur: 0, enStock: 0 }
      map[c.id].nb++
      map[c.id].valeur += parseFloat(p.price || 0) * Math.max(0, p.stock_quantity || 0)
      if (p.manage_stock && (p.stock_quantity || 0) > 0) map[c.id].enStock++
    })
  })
  return Object.values(map).sort((a, b) => b.valeur - a.valeur)
})

const mettreAJourStock = async (produit) => {
  miseAJourEnCours.value[produit.id] = true
  invErr.value = ''
  try {
    const res = await safeFetch(apiUrl(`products/${produit.id}`), {
      method: 'PUT',
      headers: { ...authHdr(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_quantity: produit._stockEdit, manage_stock: true })
    })
    const updated = await res.json()
    const idx = produits.value.findIndex(p => p.id === produit.id)
    if (idx !== -1) {
      produits.value[idx] = { ...produits.value[idx], stock_quantity: updated.stock_quantity }
      delete produits.value[idx]._stockEdit
    }
    invMsg.value = `Stock mis à jour : ${produit.name}`
    setTimeout(() => { invMsg.value = '' }, 2500)
  } catch (e) {
    invErr.value = `Erreur mise à jour : ${e.message}`
  }
  delete miseAJourEnCours.value[produit.id]
}

const initEditStock = (p) => { p._stockEdit = p.stock_quantity ?? 0 }
const annulerEdit   = (p) => { delete p._stockEdit }

const chf = (v) => parseFloat(v || 0).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const statutStock = (p) => {
  if (!p.manage_stock) return { label: 'Non géré', cls: 'badge-info' }
  const q = p.stock_quantity ?? 0
  if (q <= 0) return { label: 'Rupture', cls: 'badge-danger' }
  if (q <= 5)  return { label: 'Faible',  cls: 'badge-warn'   }
  return { label: 'En stock', cls: 'badge-ok' }
}

const categoriesNoms = (p) => p.categories?.map(c => c.name).join(', ') || '—'
const dateAujourdhui = () => new Date().toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })

// Auto-load POS on mount if config is set
onMounted(() => {
  if (configLocale.value.url && configLocale.value.consumerKey) chargerVentes()
})
</script>

<template>
  <div>
    <!-- Header -->
    <div class="header">
      <div>
        <h2>WooCommerce — Panneau de contrôle</h2>
        <p class="subtitle" style="margin-bottom:0;">
          Ventes, inventaire et rapport fiduciaire · {{ configLocale.url || 'Non configuré' }}
        </p>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <button v-if="onglet === 'pos'"        class="btn-secondary" @click="chargerVentes"  :disabled="posLoad">
          <span>↻</span> Actualiser
        </button>
        <button v-if="onglet === 'inventaire'" class="btn-secondary" @click="chargerProduits" :disabled="invLoad">
          <span>↻</span> Actualiser
        </button>
        <button v-if="onglet !== 'inventaire'" class="btn-success" @click="chargerProduits" :disabled="invLoad">
          <span v-if="invLoad">⏳</span> Charger l'inventaire
        </button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="woo-tabs">
      <button :class="['woo-tab', onglet === 'pos'       && 'active']" @click="onglet = 'pos'">
        Caisse / POS
      </button>
      <button :class="['woo-tab', onglet === 'inventaire' && 'active']" @click="onglet = 'inventaire'">
        Inventaire
        <span v-if="produits.length > 0" class="tab-badge">{{ produits.length }}</span>
      </button>
      <button :class="['woo-tab', onglet === 'rapport'   && 'active']" @click="onglet = 'rapport'">
        Rapport Fiduciaire
      </button>
      <button :class="['woo-tab', onglet === 'config'    && 'active']" @click="onglet = 'config'">
        Configuration
      </button>
    </div>

    <!-- ══ ONGLET POS ══════════════════════════════════════════════════════ -->
    <div v-if="onglet === 'pos'">

      <!-- Barre filtres -->
      <div class="topbar">
        <div class="period-tabs">
          <button v-for="p in PERIODS" :key="p.key"
            :class="['period-btn', activePeriod === p.key && 'active']"
            @click="selectPeriod(p.key)">
            {{ p.label }}
          </button>
        </div>
        <select class="filter-select" v-model="paymentFilter">
          <option value="">Tous paiements</option>
          <option value="especes">Espèces / Caisse</option>
          <option value="cod">Espèces (COD)</option>
          <option value="carte">Carte</option>
          <option value="stripe">Stripe</option>
        </select>
        <input class="search-input" v-model="posSearch" placeholder="N° commande, produit…" @keyup.enter="chargerVentes" />
        <button class="btn-refresh" @click="chargerVentes" :disabled="posLoad">
          {{ posLoad ? '⟳' : '↺' }} Actualiser
        </button>
      </div>

      <!-- Stats -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Ventes</div>
          <div class="stat-value">{{ totalCount }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">CA TTC</div>
          <div class="stat-value gold">{{ formatCHF(statsVentes.totalRevenue) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Panier moyen</div>
          <div class="stat-value">{{ formatCHF(statsVentes.avgOrder) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Espèces</div>
          <div class="stat-value">{{ formatCHF(statsVentes.byPayment.especes) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Carte</div>
          <div class="stat-value">{{ formatCHF(statsVentes.byPayment.carte) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">TVA 8.1%</div>
          <div class="stat-value muted">{{ formatCHF(statsVentes.totalTax) }}</div>
        </div>
      </div>

      <div v-if="posErr" class="alerte-erreur">⚠ {{ posErr }}</div>

      <!-- Tableau commandes -->
      <div class="table-wrap">
        <table class="orders-table">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Articles</th>
              <th>Paiement</th>
              <th class="right">Total TTC</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="posLoad">
              <td colspan="6" class="center muted">Chargement…</td>
            </tr>
            <tr v-else-if="!configLocale.url">
              <td colspan="6" class="center muted">
                Configurez la connexion WooCommerce pour voir les ventes.
                <button class="btn-detail" style="margin-left:0.75rem;" @click="onglet = 'config'">Configurer →</button>
              </td>
            </tr>
            <tr v-else-if="ordresAffiches.length === 0">
              <td colspan="6" class="center muted">Aucune vente sur cette période.</td>
            </tr>
            <tr v-for="o in ordresAffiches" :key="o.id" class="order-row" @click="openDetail(o)">
              <td class="mono gold">CBJ-{{ o.number }}</td>
              <td class="muted small">{{ formatDate(o.date_created) }}</td>
              <td class="items-cell">
                <span v-for="(item, i) in o.line_items.slice(0, 3)" :key="item.id">
                  {{ item.name }}<span v-if="item.quantity > 1"> ×{{ item.quantity }}</span><span v-if="i < Math.min(o.line_items.length, 3) - 1">, </span>
                </span>
                <span v-if="o.line_items.length > 3" class="muted"> +{{ o.line_items.length - 3 }}</span>
              </td>
              <td>
                <span :class="['pay-badge', paymentClass(o.payment_method)]">{{ o.payment_method_title }}</span>
              </td>
              <td class="right bold">{{ formatCHF(o.total) }}</td>
              <td class="right">
                <button class="btn-detail" @click.stop="openDetail(o)">Voir →</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="pagination">
        <button :disabled="posPage <= 1" @click="goPage(posPage - 1)">← Préc.</button>
        <span class="page-info">Page {{ posPage }} / {{ totalPages }}</span>
        <button :disabled="posPage >= totalPages" @click="goPage(posPage + 1)">Suiv. →</button>
      </div>

    </div>

    <!-- ══ ONGLET INVENTAIRE ═══════════════════════════════════════════════ -->
    <div v-if="onglet === 'inventaire'">
      <div v-if="invErr"  class="alerte-erreur">⚠ {{ invErr }}</div>
      <div v-if="invMsg"  class="alerte-succes">✓ {{ invMsg }}</div>

      <div v-if="produits.length === 0" class="vide-msg">
        <div class="vide-icon">📦</div>
        <p>Aucun produit chargé. Cliquez sur <strong>Charger l'inventaire</strong>.</p>
        <button class="btn-success" @click="chargerProduits" :disabled="invLoad">
          <span v-if="invLoad">⏳ Chargement…</span><span v-else>Charger l'inventaire</span>
        </button>
      </div>

      <template v-else>
        <!-- KPI -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Produits</div>
            <div class="kpi-value">{{ produits.length }}</div>
            <div class="kpi-sub">publiés</div>
          </div>
          <div class="kpi-card kpi-vert">
            <div class="kpi-label">Valeur de stock</div>
            <div class="kpi-value">CHF {{ chf(totalValeurStock) }}</div>
            <div class="kpi-sub">prix × quantité</div>
          </div>
          <div class="kpi-card kpi-rouge">
            <div class="kpi-label">Ruptures</div>
            <div class="kpi-value">{{ nbRuptures }}</div>
            <div class="kpi-sub">à approvisionner</div>
          </div>
          <div class="kpi-card kpi-orange">
            <div class="kpi-label">Stock faible</div>
            <div class="kpi-value">{{ nbFaible }}</div>
            <div class="kpi-sub">≤ 5 unités</div>
          </div>
        </div>

        <!-- Filtres -->
        <div class="filter-bar">
          <input v-model="filtreRecherche" type="text" placeholder="Rechercher par nom ou SKU…" style="flex:1;" />
          <select v-model="filtreCategorie" style="width:220px;">
            <option value="">Toutes les catégories ({{ produits.length }})</option>
            <option v-for="cat in categoriesFromProduits" :key="cat.id" :value="String(cat.id)">
              {{ cat.name }}
            </option>
          </select>
          <span class="filter-count">{{ produitsFiltres.length }} produit(s)</span>
        </div>

        <!-- Table produits -->
        <section class="card" style="padding:0;overflow:hidden;">
          <table class="standard-table">
            <thead>
              <tr>
                <th style="width:40%">Produit</th>
                <th>SKU</th>
                <th class="text-right">Prix</th>
                <th class="text-center">Stock</th>
                <th class="text-right">Valeur</th>
                <th class="text-center">Statut</th>
                <th class="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in produitsFiltres" :key="p.id">
                <td>
                  <div class="produit-nom">{{ p.name }}</div>
                  <div class="produit-cat">{{ categoriesNoms(p) }}</div>
                </td>
                <td><span class="sku-tag">{{ p.sku || '—' }}</span></td>
                <td class="text-right bold-text">CHF {{ chf(p.price) }}</td>
                <td class="text-center">
                  <span v-if="p._stockEdit === undefined"
                    @click="initEditStock(p)"
                    class="stock-qty"
                    :class="{ 'stock-zero': (p.stock_quantity ?? 0) <= 0 }">
                    {{ p.manage_stock ? (p.stock_quantity ?? 0) : '∞' }}
                  </span>
                  <div v-else class="stock-edit-zone">
                    <input v-model.number="p._stockEdit" type="number" min="0" class="stock-input"
                      @keyup.enter="mettreAJourStock(p)" @keyup.esc="annulerEdit(p)" />
                    <button class="btn-save-xs" @click="mettreAJourStock(p)" :disabled="miseAJourEnCours[p.id]">✓</button>
                    <button class="btn-cancel-xs" @click="annulerEdit(p)">✕</button>
                  </div>
                </td>
                <td class="text-right">
                  <span v-if="p.manage_stock && (p.stock_quantity || 0) > 0">
                    CHF {{ chf(parseFloat(p.price || 0) * (p.stock_quantity || 0)) }}
                  </span>
                  <span v-else class="muted-text">—</span>
                </td>
                <td class="text-center">
                  <span :class="['badge-statut', statutStock(p).cls]">{{ statutStock(p).label }}</span>
                </td>
                <td class="text-center">
                  <button v-if="p.manage_stock && p._stockEdit === undefined" class="btn-edit-xs" @click="initEditStock(p)">✏</button>
                  <span v-if="miseAJourEnCours[p.id]">⏳</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <div class="table-footer muted-text">Cliquez sur une quantité pour modifier · Entrée pour valider · Échap pour annuler</div>
      </template>
    </div>

    <!-- ══ ONGLET RAPPORT ══════════════════════════════════════════════════ -->
    <div v-if="onglet === 'rapport'">
      <div v-if="produits.length === 0" class="vide-msg">
        <div class="vide-icon">📊</div>
        <p>Chargez l'inventaire pour générer le rapport.</p>
        <button class="btn-success" @click="chargerProduits" :disabled="invLoad">Charger l'inventaire</button>
      </div>

      <template v-else>
        <div class="rapport-header">
          <div>
            <div class="rapport-titre">Rapport d'inventaire — Valeur de stock</div>
            <div class="rapport-date">Généré le {{ dateAujourdhui() }} · Source : {{ configLocale.url }}</div>
          </div>
          <button class="btn-secondary" onclick="window.print()">🖨 Imprimer</button>
        </div>

        <div class="rapport-kpi-grid">
          <div class="rapport-kpi">
            <div class="rapport-kpi-titre">Total produits</div>
            <div class="rapport-kpi-val">{{ produits.length }}</div>
          </div>
          <div class="rapport-kpi rapport-kpi--vert">
            <div class="rapport-kpi-titre">Valeur totale de stock</div>
            <div class="rapport-kpi-val">CHF {{ chf(totalValeurStock) }}</div>
          </div>
          <div class="rapport-kpi">
            <div class="rapport-kpi-titre">Produits avec stock géré</div>
            <div class="rapport-kpi-val">{{ produits.filter(p => p.manage_stock).length }}</div>
          </div>
          <div class="rapport-kpi rapport-kpi--rouge">
            <div class="rapport-kpi-titre">Ruptures</div>
            <div class="rapport-kpi-val">{{ nbRuptures }}</div>
          </div>
        </div>

        <section class="card">
          <h3>Répartition par catégorie</h3>
          <table class="standard-table">
            <thead>
              <tr>
                <th>Catégorie</th>
                <th class="text-right">Nb produits</th>
                <th class="text-right">En stock</th>
                <th class="text-right">Valeur de stock</th>
                <th class="text-right">% du total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cat in parCategorie" :key="cat.nom">
                <td class="bold-text">{{ cat.nom }}</td>
                <td class="text-right">{{ cat.nb }}</td>
                <td class="text-right">{{ cat.enStock }}</td>
                <td class="text-right bold-text">CHF {{ chf(cat.valeur) }}</td>
                <td class="text-right">
                  <span class="pct-badge">{{ totalValeurStock > 0 ? ((cat.valeur / totalValeurStock) * 100).toFixed(1) : '0.0' }}%</span>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td><strong>TOTAL</strong></td>
                <td class="text-right"><strong>{{ produits.length }}</strong></td>
                <td class="text-right"><strong>{{ produits.filter(p => p.manage_stock && (p.stock_quantity || 0) > 0).length }}</strong></td>
                <td class="text-right"><strong>CHF {{ chf(totalValeurStock) }}</strong></td>
                <td class="text-right"><strong>100%</strong></td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section class="card">
          <h3>Détail complet de l'inventaire</h3>
          <table class="standard-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th>SKU</th>
                <th>Catégorie</th>
                <th class="text-right">Prix unitaire</th>
                <th class="text-right">Quantité</th>
                <th class="text-right">Valeur stock</th>
                <th class="text-center">Statut</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in produits" :key="p.id">
                <td>{{ p.name }}</td>
                <td><span class="sku-tag">{{ p.sku || '—' }}</span></td>
                <td>{{ categoriesNoms(p) }}</td>
                <td class="text-right">CHF {{ chf(p.price) }}</td>
                <td class="text-right">{{ p.manage_stock ? (p.stock_quantity ?? 0) : '∞' }}</td>
                <td class="text-right bold-text">
                  {{ p.manage_stock && (p.stock_quantity || 0) > 0 ? 'CHF ' + chf(parseFloat(p.price || 0) * (p.stock_quantity || 0)) : '—' }}
                </td>
                <td class="text-center">
                  <span :class="['badge-statut', statutStock(p).cls]">{{ statutStock(p).label }}</span>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td colspan="5"><strong>VALEUR TOTALE DE STOCK</strong></td>
                <td class="text-right"><strong>CHF {{ chf(totalValeurStock) }}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </section>

        <div class="rapport-note">
          <strong>Note comptable :</strong> La valeur de stock est calculée sur la base du prix de vente affiché sur WooCommerce multiplié par la quantité en stock. Pour une évaluation au prix de revient, ajustez selon vos marges.
        </div>
      </template>
    </div>

    <!-- ══ ONGLET CONFIGURATION ═══════════════════════════════════════════ -->
    <div v-if="onglet === 'config'">
      <div v-if="configMsg" class="alerte-succes">✓ {{ configMsg }}</div>
      <div v-if="configErr" class="alerte-erreur">⚠ {{ configErr }}</div>

      <section class="card">
        <h3>Connexion à l'API WooCommerce</h3>
        <p style="font-size:0.85rem;color:#6b5e4e;margin:0 0 1.25rem;line-height:1.6;">
          Dans WooCommerce → Réglages → Avancé → REST API, créez une clé avec permission <strong>Lecture/Écriture</strong>.
        </p>
        <div class="config-form-grid">
          <div class="form-field full">
            <label class="form-label">URL du site WooCommerce</label>
            <input v-model="configLocale.url" type="text" placeholder="https://votre-boutique.com" />
            <span class="form-hint">Sans slash final. Ex : https://colayco.ch</span>
          </div>
          <div class="form-field">
            <label class="form-label">Consumer Key</label>
            <input v-model="configLocale.consumerKey" type="text" placeholder="ck_xxxxxxxxxxxxxxxxxxxx" />
          </div>
          <div class="form-field">
            <label class="form-label">Consumer Secret</label>
            <input v-model="configLocale.consumerSecret" type="password" placeholder="cs_xxxxxxxxxxxxxxxxxxxx" />
          </div>
        </div>
        <div style="display:flex;gap:0.75rem;margin-top:1.5rem;align-items:center;">
          <button class="btn-success" @click="sauvegarderConfig">💾 Sauvegarder</button>
          <button class="btn-secondary" @click="testerConnexion" :disabled="testLoad">
            <span v-if="testLoad">⏳</span><span v-else>🔌</span> Tester la connexion
          </button>
          <button class="btn-blue" style="margin-top:0;" @click="chargerProduits" :disabled="invLoad">
            Charger l'inventaire →
          </button>
        </div>
      </section>

      <section class="card">
        <h3>Comment obtenir les clés API</h3>
        <ol class="guide-list">
          <li>Dans WordPress, allez dans <strong>WooCommerce → Réglages → Avancé → REST API</strong></li>
          <li>Cliquez sur <strong>Ajouter une clé</strong></li>
          <li>Nom : "Colayco App", Utilisateur : admin, Permissions : <strong>Lecture/Écriture</strong></li>
          <li>Cliquez sur <strong>Générer la clé API</strong> et copiez les deux clés</li>
        </ol>
        <div class="info-note">
          <strong>Note HTTPS :</strong> L'auth Basic Auth nécessite HTTPS. Si l'erreur persiste, vérifiez que WooCommerce REST API est activé et que l'URL ne contient pas de slash final.
        </div>
      </section>
    </div>

    <!-- ══ MODAL TICKET ════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="selected" class="modal-overlay" @click.self="selected = null">
        <div class="modal-box">

          <div class="receipt-header">
            <div class="receipt-shop">COLAYCO BIJOUX</div>
            <div class="receipt-sub">Rue du Seyon 4 · 2000 Neuchâtel · colayco.ch</div>
            <div class="receipt-sub">CHE-000.000.000 TVA</div>
          </div>
          <div class="divider" />

          <div class="receipt-meta">
            <span class="mono gold">CBJ-{{ selected.number }}</span>
            <span class="muted small">{{ formatDate(selected.date_created) }}</span>
          </div>
          <div class="divider" />

          <div class="line-items">
            <div v-for="item in selected.line_items" :key="item.id" class="line-item">
              <div class="line-item-top">
                <span class="line-item-name">{{ item.name }}</span>
                <span class="line-item-total">{{ formatCHF(Number(item.total) + Number(item.total_tax || 0)) }}</span>
              </div>
              <div v-if="item.quantity > 1 || getItemMeta(item)" class="line-item-sub muted small">
                <span v-if="item.quantity > 1">{{ item.quantity }} ×</span>
                <span v-if="getItemMeta(item)"> {{ getItemMeta(item) }}</span>
              </div>
            </div>
          </div>
          <div class="divider" />

          <div class="totals">
            <div class="total-row">
              <span class="muted">Sous-total HT</span>
              <span>{{ formatCHF(lineItemsHT(selected)) }}</span>
            </div>
            <div v-if="Number(selected.discount_total) > 0" class="total-row green">
              <span>Remise</span>
              <span>− {{ formatCHF(selected.discount_total) }}</span>
            </div>
            <div class="total-row">
              <span class="muted">TVA 8.1%</span>
              <span>{{ formatCHF(selected.total_tax) }}</span>
            </div>
            <div class="total-row grand">
              <span>TOTAL TTC</span>
              <span class="gold">{{ formatCHF(selected.total) }}</span>
            </div>
            <div class="total-row">
              <span class="muted">Paiement</span>
              <span>{{ selected.payment_method_title }}</span>
            </div>
          </div>
          <div class="divider" />
          <div class="receipt-footer muted small">Merci de votre visite ! · Bijoux avec garantie 2 ans</div>

          <div class="modal-actions no-print">
            <button class="btn-close" @click="selected = null">Fermer</button>
            <button class="btn-print" @click="() => window.print()">🖨 Imprimer</button>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
/* ── Tabs ─────────────────────────────────────────────────────────────────── */
.woo-tabs {
  display: flex; gap: 0; margin-bottom: 1.5rem;
  border-bottom: 2px solid #e0d5c5;
}
.woo-tab {
  background: transparent; border: none; border-bottom: 3px solid transparent;
  margin-bottom: -2px; padding: 0.65rem 1.35rem;
  font-size: 0.88rem; font-weight: 600; color: #9a8870;
  cursor: pointer; transition: all 0.15s; border-radius: 0;
  display: flex; align-items: center; gap: 0.45rem;
}
.woo-tab:hover { color: #0B3D2E; }
.woo-tab.active { color: #0B3D2E; border-bottom-color: #C5A059; }
.tab-badge {
  background: rgba(197,160,89,0.15); color: #C5A059;
  font-size: 0.65rem; font-weight: 700; padding: 0.1rem 0.45rem;
  border-radius: 20px; border: 1px solid rgba(197,160,89,0.2);
}

/* ── Alertes ──────────────────────────────────────────────────────────────── */
.alerte-erreur { background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:.88rem; }
.alerte-succes { background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:.88rem; }

/* ── POS topbar ───────────────────────────────────────────────────────────── */
.topbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 1.25rem; background: #fff;
  border: 1px solid #e8dcc8; border-radius: 10px; padding: 0.75rem 1rem;
}
.period-tabs { display: flex; gap: 3px; }
.period-btn {
  padding: 5px 12px; border-radius: 20px; border: 1px solid #d4c89a;
  background: #fff; cursor: pointer; font-size: 0.82rem; color: #6b5e4e; transition: all .12s;
}
.period-btn.active, .period-btn:hover { background: #C5A059; color: #fff; border-color: #C5A059; }
.filter-select, .search-input {
  padding: 5px 10px; border: 1px solid #d4c89a; border-radius: 8px;
  font-size: 0.83rem; background: #fff; height: 32px; color: #1a1209;
}
.search-input { width: 170px; }
.btn-refresh {
  padding: 5px 14px; background: #fff; border: 1px solid #d4c89a;
  border-radius: 8px; cursor: pointer; font-size: 0.83rem; margin-left: auto;
  color: #0B3D2E; font-weight: 600;
}
.btn-refresh:hover { background: #faf6ef; border-color: #C5A059; }

/* ── Stats row ────────────────────────────────────────────────────────────── */
.stats-row {
  display: grid; grid-template-columns: repeat(6, 1fr);
  gap: 0.75rem; margin-bottom: 1.25rem;
}
.stat-card { background:#fff;border:1px solid #e8dcc8;border-radius:10px;padding:1rem 1.1rem; }
.stat-label { font-size:0.68rem;color:#9a8870;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:.3rem; }
.stat-value { font-size:1.2rem;font-weight:800;color:#0B3D2E; }
.stat-value.gold { color:#C5A059; }
.stat-value.muted { color:#9a8870; }

/* ── Orders table ─────────────────────────────────────────────────────────── */
.table-wrap { background:#fff;border:1px solid #e0d5c5;border-radius:10px;overflow:hidden;margin-bottom:1rem; }
.orders-table { width:100%;border-collapse:collapse; }
.orders-table th {
  background:#F9F7F2;padding:0.65rem 1rem;font-size:0.68rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.5px;color:#7a5c30;
  text-align:left;border-bottom:2px solid #C5A059;
}
.orders-table td { padding:.7rem 1rem;font-size:.875rem;border-bottom:1px solid #f0ece4;vertical-align:middle; }
.order-row { cursor:pointer;transition:background .1s; }
.order-row:hover td { background:#faf6ef; }
.items-cell { max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.pay-badge { padding:2px 8px;border-radius:20px;font-size:.7rem;font-weight:700; }
.pay-cash { background:#f0fdf4;color:#15803d; }
.pay-card { background:#eff6ff;color:#1d4ed8; }
.btn-detail {
  padding:3px 9px;font-size:.75rem;border:1px solid #d4c89a;
  border-radius:6px;background:#fff;cursor:pointer;color:#C5A059;font-weight:600;
}
.btn-detail:hover { background:#faf6ef; }
.pagination { display:flex;align-items:center;justify-content:center;gap:1rem;margin-top:1rem; }
.pagination button { padding:5px 14px;border:1px solid #d4c89a;border-radius:8px;background:#fff;cursor:pointer;font-size:.83rem; }
.pagination button:disabled { opacity:.4;cursor:default; }
.page-info { font-size:.83rem;color:#9a8870; }

/* ── Inventaire ───────────────────────────────────────────────────────────── */
.kpi-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem; }
.kpi-card { background:#fff;border:1px solid #e0d5c5;border-radius:10px;padding:1.25rem 1.5rem; }
.kpi-card.kpi-vert  { border-left:4px solid #22c55e; }
.kpi-card.kpi-rouge { border-left:4px solid #ef4444; }
.kpi-card.kpi-orange{ border-left:4px solid #f97316; }
.kpi-label { font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#9a8870;margin-bottom:.35rem; }
.kpi-value { font-size:1.55rem;font-weight:800;color:#0B3D2E;line-height:1.1; }
.kpi-sub   { font-size:.7rem;color:#9a8870;margin-top:.2rem; }

.filter-bar { display:flex;gap:.75rem;align-items:center;margin-bottom:1rem;background:#faf6ef;padding:.75rem 1rem;border-radius:8px;border:1px solid #e8dcc8; }
.filter-count { font-size:.78rem;color:#9a8870;font-weight:600;white-space:nowrap; }

.produit-nom { font-weight:600;color:#0B3D2E;font-size:.9rem; }
.produit-cat { font-size:.72rem;color:#9a8870;margin-top:2px; }
.sku-tag { font-size:.72rem;font-family:monospace;background:#f5f0e8;border:1px solid #e0d5c5;padding:.1rem .45rem;border-radius:4px;color:#6b5e4e; }
.stock-qty {
  display:inline-block;min-width:36px;text-align:center;font-weight:700;font-size:1rem;color:#0B3D2E;
  cursor:pointer;padding:.2rem .5rem;border-radius:6px;border:1.5px solid transparent;transition:all .12s;
}
.stock-qty:hover { border-color:#C5A059;background:#fef9ec; }
.stock-qty.stock-zero { color:#ef4444; }
.stock-edit-zone { display:flex;align-items:center;gap:.25rem;justify-content:center; }
.stock-input { width:60px;text-align:center;font-weight:700;font-size:.9rem;padding:.25rem .35rem; }
.btn-save-xs { width:26px;height:26px;background:#22c55e;color:#fff;border:none;border-radius:5px;font-size:.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0; }
.btn-save-xs:hover:not(:disabled) { background:#16a34a; }
.btn-save-xs:disabled { opacity:.5;cursor:wait; }
.btn-cancel-xs { width:26px;height:26px;background:#f5f0e8;color:#6b5e4e;border:1px solid #e0d5c5;border-radius:5px;font-size:.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0; }
.btn-cancel-xs:hover { background:#fef2f2;color:#ef4444;border-color:#fecaca; }
.btn-edit-xs { width:28px;height:28px;background:transparent;color:#C5A059;border:1px solid #e8dcc8;border-radius:6px;font-size:.8rem;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all .12s; }
.btn-edit-xs:hover { background:#fef9ec;border-color:#C5A059; }
.badge-statut { display:inline-block;padding:.15rem .55rem;border-radius:20px;font-size:.7rem;font-weight:700;letter-spacing:.3px; }
.badge-ok     { background:#dcfce7;color:#15803d; }
.badge-warn   { background:#fff7ed;color:#c2410c; }
.badge-danger { background:#fef2f2;color:#b91c1c; }
.badge-info   { background:#f1f5f9;color:#64748b; }
.muted-text { color:#9a8870;font-size:.85rem; }
.table-footer { padding:.5rem 0 1.5rem;font-size:.75rem; }

/* ── Rapport ──────────────────────────────────────────────────────────────── */
.rapport-header { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;padding:1.25rem 1.5rem;background:#fff;border:1px solid #e0d5c5;border-radius:10px; }
.rapport-titre { font-size:1.05rem;font-weight:800;color:#0B3D2E; }
.rapport-date  { font-size:.78rem;color:#9a8870;margin-top:.25rem; }
.rapport-kpi-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem; }
.rapport-kpi { background:#fff;border:1px solid #e0d5c5;border-radius:10px;padding:1.1rem 1.25rem; }
.rapport-kpi--vert  { border-left:4px solid #22c55e; }
.rapport-kpi--rouge { border-left:4px solid #ef4444; }
.rapport-kpi-titre { font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#9a8870;margin-bottom:.35rem; }
.rapport-kpi-val   { font-size:1.3rem;font-weight:800;color:#0B3D2E; }
.pct-badge { background:#f5f0e8;color:#6b5e4e;padding:.15rem .5rem;border-radius:20px;font-size:.78rem;font-weight:600; }
.total-row td { background:#faf6ef;border-top:2px solid #C5A059 !important;font-size:.9rem;color:#0B3D2E; }
.rapport-note { background:#fef9ec;border:1px solid #fde68a;border-radius:8px;padding:.875rem 1.1rem;font-size:.82rem;color:#78350f;line-height:1.65;margin-bottom:1.5rem; }

/* ── Config form ──────────────────────────────────────────────────────────── */
.config-form-grid { display:grid;grid-template-columns:1fr 1fr;gap:1rem; }
.form-field { display:flex;flex-direction:column;gap:.35rem; }
.form-field.full { grid-column:span 2; }
.form-label { font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b5e4e; }
.form-hint  { font-size:.75rem;color:#9a8870; }
.guide-list { padding-left:1.25rem;margin:0 0 1rem;font-size:.88rem;line-height:2;color:#4b5563; }
.guide-list strong { color:#0B3D2E; }
.info-note { background:#fef9ec;border:1px solid #fde68a;border-radius:8px;padding:.75rem 1rem;font-size:.83rem;color:#78350f;line-height:1.6; }

/* ── Vide ─────────────────────────────────────────────────────────────────── */
.vide-msg { text-align:center;padding:4rem 2rem;color:#9a8870;display:flex;flex-direction:column;align-items:center;gap:1rem; }
.vide-icon { font-size:3rem; }
.vide-msg p { font-size:.95rem;margin:0; }

/* ── Modal ────────────────────────────────────────────────────────────────── */
.modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999; }
.modal-box { background:#fff;border-radius:14px;padding:24px 28px;width:380px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25); }
.receipt-header { text-align:center;margin-bottom:10px; }
.receipt-shop { font-size:1rem;font-weight:800;letter-spacing:.8px; }
.receipt-sub  { font-size:.78rem;color:#9a8870;line-height:1.6; }
.receipt-meta { display:flex;justify-content:space-between;align-items:center;margin:6px 0; }
.divider { height:1px;background:#e8dcc8;margin:8px 0; }
.line-items { display:flex;flex-direction:column;gap:6px;margin:6px 0; }
.line-item-top { display:flex;justify-content:space-between;font-size:.9rem; }
.line-item-name { font-weight:600;flex:1;padding-right:8px; }
.line-item-total { font-weight:700;white-space:nowrap; }
.line-item-sub { margin-top:1px;font-size:.75rem;color:#9a8870; }
.totals { display:flex;flex-direction:column;gap:4px;margin:6px 0; }
.total-row { display:flex;justify-content:space-between;font-size:.875rem; }
.total-row.grand { font-size:1.05rem;font-weight:800;border-top:1px solid #e8dcc8;margin-top:4px;padding-top:5px; }
.total-row.green { color:#15803d; }
.receipt-footer { text-align:center;margin-top:6px; }
.modal-actions { display:flex;gap:8px;margin-top:18px; }
.btn-close { flex:1;padding:10px;border-radius:10px;border:1px solid #d4c89a;background:#fff;cursor:pointer;font-size:.88rem;color:#9a8870; }
.btn-print { flex:2;padding:10px;border-radius:10px;background:#0B3D2E;color:#fff;border:none;cursor:pointer;font-size:.88rem;font-weight:700; }

/* ── Utilitaires ──────────────────────────────────────────────────────────── */
.gold  { color:#C5A059; }
.muted { color:#9a8870; }
.small { font-size:.78rem; }
.mono  { font-family:monospace; }
.bold  { font-weight:700; }
.right { text-align:right; }
.center { text-align:center;padding:1.5rem; }

/* ── Print ────────────────────────────────────────────────────────────────── */
@media print {
  .no-print, .woo-tabs, .filter-bar, .topbar, .stats-row,
  .btn-secondary, .btn-edit-xs, .alerte-erreur, .alerte-succes { display:none !important; }
  .modal-box { width:72mm;margin:0;padding:4mm;border-radius:0;box-shadow:none; }
  body > *:not(.modal-overlay) { display:none !important; }
}
</style>
