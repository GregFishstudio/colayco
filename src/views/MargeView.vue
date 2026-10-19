<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  devisListe: Array,
  factureListe: Array,
  config: Object
})

const onglet = ref('projet') // 'projet' | 'periode'
const afficherBrouillons = ref(false)
const docOuvert = ref(null) // { type: 'Devis'|'Facture', ...doc }

const nomCompletClient = (c) => {
  if (!c) return ''
  return [c.civilite, c.prenom, c.nom].filter(Boolean).join(' ') || c.nom || ''
}

// ── HT (hors taxe) d'un document, déduit du total TTC déjà enregistré ──────
const htDocument = (doc) => {
  const rate = props.config?.tvaTaux ?? 8.1
  const incluse = (props.config?.tvaMode ?? 'incluse') === 'incluse'
  const total = doc.totalTTC ?? 0
  if (!incluse) return total
  const tva = total * rate / (100 + rate)
  return total - tva
}

const coutDocument = (doc) => (doc.articles || []).reduce((s, a) => s + (parseFloat(a.coutReel) || 0) * (a.quantite || 0), 0)
const margeDocument = (doc) => htDocument(doc) - coutDocument(doc)
const margePctDocument = (doc) => {
  const ht = htDocument(doc)
  return ht > 0 ? (margeDocument(doc) / ht) * 100 : 0
}

const estFinalise = (doc) => ['Validée', 'Envoyée', 'Payée'].includes(doc.statut)

// ── Liste combinée devis + factures ─────────────────────────────────────
const documents = computed(() => {
  const devis = (props.devisListe || []).map(d => ({ ...d, type: 'Devis' }))
  const factures = (props.factureListe || []).map(f => ({ ...f, type: 'Facture' }))
  let liste = [...devis, ...factures]
  if (!afficherBrouillons.value) liste = liste.filter(estFinalise)
  return liste.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
})

const recherche = ref('')
const documentsFiltres = computed(() => {
  if (!recherche.value.trim()) return documents.value
  const q = recherche.value.trim().toLowerCase()
  return documents.value.filter(d =>
    d.numero?.toLowerCase().includes(q) || nomCompletClient(d.client).toLowerCase().includes(q)
  )
})

// ── Totaux globaux (sur la liste filtrée par le statut, pas la recherche) ──
const totauxGlobaux = computed(() => {
  const liste = documents.value
  const vendu = liste.reduce((s, d) => s + htDocument(d), 0)
  const cout = liste.reduce((s, d) => s + coutDocument(d), 0)
  return { vendu, cout, marge: vendu - cout, margePct: vendu > 0 ? ((vendu - cout) / vendu) * 100 : 0 }
})

// ── Rapport par période (année-mois) ────────────────────────────────────
const anneeSelectionnee = ref(new Date().getFullYear())
const anneesDisponibles = computed(() => {
  const annees = new Set(documents.value.map(d => (d.date || '').slice(0, 4)).filter(Boolean))
  annees.add(String(new Date().getFullYear()))
  return Array.from(annees).sort().reverse()
})

const rapportParPeriode = computed(() => {
  const mois = {}
  for (const d of documents.value) {
    if (!d.date || !d.date.startsWith(String(anneeSelectionnee.value))) continue
    const cle = d.date.slice(0, 7) // YYYY-MM
    if (!mois[cle]) mois[cle] = { cle, vendu: 0, cout: 0 }
    mois[cle].vendu += htDocument(d)
    mois[cle].cout += coutDocument(d)
  }
  const noms = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
  return Object.values(mois)
    .map(m => ({ ...m, marge: m.vendu - m.cout, margePct: m.vendu > 0 ? ((m.vendu - m.cout) / m.vendu) * 100 : 0, label: noms[parseInt(m.cle.slice(5, 7), 10) - 1] }))
    .sort((a, b) => a.cle.localeCompare(b.cle))
})

const totauxPeriode = computed(() => {
  const vendu = rapportParPeriode.value.reduce((s, m) => s + m.vendu, 0)
  const cout = rapportParPeriode.value.reduce((s, m) => s + m.cout, 0)
  return { vendu, cout, marge: vendu - cout, margePct: vendu > 0 ? ((vendu - cout) / vendu) * 100 : 0 }
})

// ── Ouverture / édition d'un document ───────────────────────────────────
const ouvrirDocument = (doc) => {
  // On retrouve la référence réelle dans le tableau source pour que les
  // modifications de coût soient bien répercutées (et sauvegardées).
  const source = doc.type === 'Devis' ? props.devisListe : props.factureListe
  const reel = source.find(d => d.numero === doc.numero)
  if (reel) {
    if (!Array.isArray(reel.articles)) reel.articles = []
    reel.articles.forEach(a => { if (a.coutReel === undefined) a.coutReel = 0 })
  }
  docOuvert.value = reel ? { ...reel, type: doc.type, __ref: reel } : null
}
const fermerDocument = () => { docOuvert.value = null }

const chf = (v) => (v ?? 0).toFixed(2)
</script>

<template>
  <div>
    <div class="header">
      <div>
        <h2>Marge & Coûts</h2>
        <p class="subtitle" style="margin-bottom:0;">Coût réel vs prix vendu, par devis et facture.</p>
      </div>
    </div>

    <!-- KPI globaux -->
    <section class="card" style="margin-bottom:1.25rem;">
      <div class="marge-kpis">
        <div class="marge-kpi">
          <div class="marge-kpi-lbl">Total vendu (HT)</div>
          <div class="marge-kpi-val">CHF {{ chf(totauxGlobaux.vendu) }}</div>
        </div>
        <div class="marge-kpi">
          <div class="marge-kpi-lbl">Coût réel total</div>
          <div class="marge-kpi-val">CHF {{ chf(totauxGlobaux.cout) }}</div>
        </div>
        <div class="marge-kpi">
          <div class="marge-kpi-lbl">Marge</div>
          <div class="marge-kpi-val" :class="totauxGlobaux.marge >= 0 ? 'marge-positive' : 'marge-negative'">CHF {{ chf(totauxGlobaux.marge) }}</div>
        </div>
        <div class="marge-kpi">
          <div class="marge-kpi-lbl">Marge %</div>
          <div class="marge-kpi-val" :class="totauxGlobaux.marge >= 0 ? 'marge-positive' : 'marge-negative'">{{ totauxGlobaux.margePct.toFixed(1) }}%</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="liste-toolbar">
        <div class="woo-tabs" style="border-bottom:none;">
          <button :class="['woo-tab', onglet === 'projet' && 'active']" @click="onglet = 'projet'">Par projet</button>
          <button :class="['woo-tab', onglet === 'periode' && 'active']" @click="onglet = 'periode'">Par période</button>
        </div>
      </div>

      <!-- ═══ Par projet ═══ -->
      <div v-if="onglet === 'projet'">
        <div class="liste-toolbar">
          <div class="search-wrap">
            <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input v-model="recherche" type="text" class="search-input" placeholder="Rechercher par N°, client…" />
            <button v-if="recherche" @click="recherche = ''" class="search-clear">✕</button>
          </div>
          <label class="adj-toggle" style="min-width:auto;">
            <input type="checkbox" v-model="afficherBrouillons" />
            <span>Afficher aussi les brouillons</span>
          </label>
        </div>

        <div v-if="documentsFiltres.length === 0" class="empty-state">
          <div class="empty-icon">📊</div>
          <p>Aucun devis/facture {{ afficherBrouillons ? '' : 'validé' }} pour l'instant.</p>
        </div>

        <table v-else class="standard-table">
          <thead>
            <tr>
              <th>N°</th>
              <th>Type</th>
              <th>Client</th>
              <th>Date</th>
              <th class="text-right">Vendu HT</th>
              <th class="text-right">Coût réel</th>
              <th class="text-right">Marge</th>
              <th class="text-right">Marge %</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in documentsFiltres" :key="doc.type + doc.numero" class="marge-row" @click="ouvrirDocument(doc)">
              <td class="numero-cell"><span class="badge-number">{{ doc.numero }}</span></td>
              <td>{{ doc.type }}</td>
              <td class="client-name">{{ nomCompletClient(doc.client) || '—' }}</td>
              <td class="date-cell">{{ doc.date }}</td>
              <td class="text-right">{{ chf(htDocument(doc)) }}</td>
              <td class="text-right">{{ chf(coutDocument(doc)) }}</td>
              <td class="text-right" :class="margeDocument(doc) >= 0 ? 'marge-positive' : 'marge-negative'">{{ chf(margeDocument(doc)) }}</td>
              <td class="text-right" :class="margeDocument(doc) >= 0 ? 'marge-positive' : 'marge-negative'">{{ margePctDocument(doc).toFixed(1) }}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ═══ Par période ═══ -->
      <div v-else>
        <div class="liste-toolbar">
          <select v-model.number="anneeSelectionnee" class="select-client" style="max-width:140px;">
            <option v-for="a in anneesDisponibles" :key="a" :value="Number(a)">{{ a }}</option>
          </select>
        </div>

        <div v-if="rapportParPeriode.length === 0" class="empty-state">
          <div class="empty-icon">📆</div>
          <p>Aucune donnée pour {{ anneeSelectionnee }}.</p>
        </div>

        <table v-else class="standard-table">
          <thead>
            <tr>
              <th>Mois</th>
              <th class="text-right">Vendu HT</th>
              <th class="text-right">Coût réel</th>
              <th class="text-right">Marge</th>
              <th class="text-right">Marge %</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in rapportParPeriode" :key="m.cle">
              <td>{{ m.label }} {{ anneeSelectionnee }}</td>
              <td class="text-right">{{ chf(m.vendu) }}</td>
              <td class="text-right">{{ chf(m.cout) }}</td>
              <td class="text-right" :class="m.marge >= 0 ? 'marge-positive' : 'marge-negative'">{{ chf(m.marge) }}</td>
              <td class="text-right" :class="m.marge >= 0 ? 'marge-positive' : 'marge-negative'">{{ m.margePct.toFixed(1) }}%</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="marge-total-row">
              <td>Total {{ anneeSelectionnee }}</td>
              <td class="text-right">{{ chf(totauxPeriode.vendu) }}</td>
              <td class="text-right">{{ chf(totauxPeriode.cout) }}</td>
              <td class="text-right" :class="totauxPeriode.marge >= 0 ? 'marge-positive' : 'marge-negative'">{{ chf(totauxPeriode.marge) }}</td>
              <td class="text-right" :class="totauxPeriode.marge >= 0 ? 'marge-positive' : 'marge-negative'">{{ totauxPeriode.margePct.toFixed(1) }}%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <!-- ═══ Modal détail / saisie des coûts ═══ -->
    <Teleport to="body">
      <div v-if="docOuvert" class="modal-overlay" @click.self="fermerDocument">
        <div class="modal-container" style="max-width:760px;">
          <div class="modal-toolbar">
            <div class="modal-meta">
              <span class="badge-number">{{ docOuvert.numero }}</span>
              <span class="modal-client-name">{{ nomCompletClient(docOuvert.client) }} · {{ docOuvert.type }}</span>
              <span class="modal-date">{{ docOuvert.date }}</span>
            </div>
            <div class="modal-actions">
              <button @click="fermerDocument" class="btn-close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div class="modal-body">
            <table class="standard-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th class="text-center" style="width:70px;">Qté</th>
                  <th class="text-right" style="width:110px;">Prix vendu</th>
                  <th class="text-right" style="width:120px;">Coût réel / unité</th>
                  <th class="text-right" style="width:110px;">Marge ligne</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(art, i) in docOuvert.__ref.articles" :key="i">
                  <td style="white-space:pre-line;">{{ art.description }}</td>
                  <td class="text-center">{{ art.quantite }}</td>
                  <td class="text-right">{{ art.prixUnitaire.toFixed(2) }}</td>
                  <td class="text-right">
                    <input type="number" step="0.01" min="0" v-model.number="art.coutReel" class="marge-cout-input" />
                  </td>
                  <td class="text-right" :class="(art.prixUnitaire - (art.coutReel||0)) * art.quantite >= 0 ? 'marge-positive' : 'marge-negative'">
                    {{ (((art.prixUnitaire - (art.coutReel||0)) * art.quantite)).toFixed(2) }}
                  </td>
                </tr>
              </tbody>
            </table>

            <div class="marge-detail-totaux">
              <div><span>Total vendu HT</span><span>{{ chf(htDocument(docOuvert.__ref)) }} CHF</span></div>
              <div><span>Coût réel total</span><span>{{ chf(coutDocument(docOuvert.__ref)) }} CHF</span></div>
              <div class="marge-detail-grand" :class="margeDocument(docOuvert.__ref) >= 0 ? 'marge-positive' : 'marge-negative'">
                <span>Marge</span><span>{{ chf(margeDocument(docOuvert.__ref)) }} CHF · {{ margePctDocument(docOuvert.__ref).toFixed(1) }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.liste-toolbar {
  display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.1rem;
  padding-bottom: 1rem; border-bottom: 1px solid #f0e8da; flex-wrap: wrap;
}
.search-wrap { position: relative; flex: 1; min-width: 180px; max-width: 320px; }
.search-icon { position: absolute; left: 0.65rem; top: 50%; transform: translateY(-50%); color: #94a3b8; pointer-events: none; }
.search-input { padding: 0.5rem 2rem 0.5rem 2.1rem; border: 1px solid #d4c9b8; border-radius: 8px; font-size: 0.875rem; width: 100%; background: #faf6ef; }
.search-input:focus { border-color: #C5A059; background: #fff; box-shadow: 0 0 0 3px rgba(197,160,89,0.12); outline: none; }
.search-clear { position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 0.8rem; padding: 0.1rem 0.25rem; }
.search-clear:hover { color: #ef4444; }
.adj-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 600; color: #3d2a14; cursor: pointer; }
.adj-toggle input[type="checkbox"] { cursor: pointer; accent-color: #C5A059; }

.empty-state { text-align: center; padding: 3.5rem 1rem; color: #94a3b8; }
.empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; opacity: 0.4; }
.empty-state p { margin: 0; font-size: 0.9rem; line-height: 1.6; }
.badge-number { background: #eef2ff; border: 1px solid #c7d2fe; padding: 0.25rem 0.55rem; border-radius: 6px; font-family: ui-monospace, monospace; font-weight: 700; color: #4f46e5; font-size: 0.8rem; }
.date-cell { color: #94a3b8; font-size: 0.875rem; }
.client-name { font-weight: 600; color: #1e293b; }
.numero-cell { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }

.modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.55); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
.modal-container { background: #f1f5f9; border-radius: 16px; width: 100%; max-width: 860px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 25px 60px rgba(15,23,42,0.3); overflow: hidden; }
.modal-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 0.875rem 1.25rem; background: white; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; gap: 0.75rem; flex-wrap: wrap; }
.modal-meta { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.modal-client-name { font-weight: 600; color: #1e293b; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.modal-date { color: #94a3b8; font-size: 0.82rem; white-space: nowrap; }
.modal-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; flex-wrap: wrap; }
.btn-close { background: #f1f5f9; border: 1px solid #e2e8f0; color: #64748b; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.btn-close:hover { background: #fef2f2; border-color: #fca5a5; color: #ef4444; }
.modal-body { overflow-y: auto; padding: 1.5rem; flex: 1; }

.marge-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
.marge-kpi { background: #faf6ef; border: 1px solid #e8dcc8; border-radius: 8px; padding: 0.85rem 1rem; }
.marge-kpi-lbl { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a7a4a; margin-bottom: 0.35rem; }
.marge-kpi-val { font-size: 1.3rem; font-weight: 800; color: #1a1209; }
.marge-positive { color: #16a34a !important; }
.marge-negative { color: #dc2626 !important; }

.woo-tabs { display: flex; gap: 0.5rem; }
.woo-tab { padding: 0.5rem 1rem; border: 1.5px solid #d4c9b8; border-radius: 8px; background: #fff; color: #6b5030; font-weight: 600; font-size: 0.85rem; cursor: pointer; }
.woo-tab.active { background: #C5A059; color: #0B3D2E; border-color: #C5A059; }

.marge-row { cursor: pointer; }
.marge-row:hover td { background: #faf6ef; }

.marge-total-row td { font-weight: 800; border-top: 2px solid #0f172a; background: #faf6ef; }

.marge-cout-input { width: 100px; padding: 0.3rem 0.5rem; border: 1px solid #d4c9b8; border-radius: 6px; font-size: 0.85rem; text-align: right; }
.marge-cout-input:focus { border-color: #C5A059; outline: none; box-shadow: 0 0 0 2px rgba(197,160,89,0.12); }

.marge-detail-totaux { display: flex; flex-direction: column; align-items: flex-end; gap: 0.4rem; margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; font-size: 0.9rem; }
.marge-detail-totaux > div { display: flex; justify-content: space-between; width: 280px; color: #64748b; }
.marge-detail-grand { font-size: 1.05rem; font-weight: 800; padding-top: 0.5rem; border-top: 1.5px solid #0f172a; }
</style>
