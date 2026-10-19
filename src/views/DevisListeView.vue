<script setup>
import { ref, computed } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, mkdir } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { trouverPointsDeCoupeSurs, trouverHautsDesBlocs, paginerCanvas, extraireBandeCanvas } from '../composables/pdfPagination'

const props = defineProps({
  devisListe: Array,
  boutique: Object,
  config: Object
})

const emit = defineEmits(['charger-devis', 'convertir-en-facture'])

const devisApercu = ref(null)
const exportEnCours = ref(false)

// ── Recherche & filtres ──────────────────────────────────
const recherche = ref('')
const filtreStatut = ref('Tous')

const devisFiltres = computed(() => {
  let liste = [...props.devisListe].reverse()
  if (filtreStatut.value !== 'Tous') {
    liste = liste.filter(d => (d.statut || 'Brouillon') === filtreStatut.value)
  }
  if (recherche.value.trim()) {
    const q = recherche.value.trim().toLowerCase()
    liste = liste.filter(d =>
      d.numero?.toLowerCase().includes(q) ||
      nomCompletClient(d.client).toLowerCase().includes(q)
    )
  }
  return liste
})

const tvaFromDevis = (devis) => {
  const rate = props.config?.tvaTaux ?? 8.1
  const m = props.config?.tvaMode ?? 'incluse'
  const total = devis.totalTTC ?? 0
  return m === 'incluse' ? total * rate / (100 + rate) : total * rate / 100
}
const htFromDevis = (devis) => {
  const m = props.config?.tvaMode ?? 'incluse'
  return m === 'incluse' ? (devis.totalTTC ?? 0) - tvaFromDevis(devis) : devis.totalTTC ?? 0
}

const sectionsDeDevis = (devis) => {
  const arts = devis.articles || []
  const noms = []
  for (const a of arts) {
    const nom = a.groupe || ''
    if (!noms.includes(nom)) noms.push(nom)
  }
  const rate = props.config?.tvaTaux ?? 8.1
  const incluse = (props.config?.tvaMode ?? 'incluse') === 'incluse'
  const remisesGroupes = devis.remisesGroupes || {}
  const optionsGroupes = devis.optionsGroupes || {}
  const calc = (nom, list) => {
    const ht = list.reduce((s, a) => s + a.quantite * a.prixUnitaire, 0)
    const tva = incluse ? ht * rate / (100 + rate) : ht * rate / 100
    const ttcBrut = incluse ? ht : ht + tva
    const r = remisesGroupes[nom] || { active: false, mode: 'pourcent', valeur: 0 }
    let remiseMontant = 0
    if (r.active && r.valeur) {
      const v = r.mode === 'pourcent' ? ttcBrut * r.valeur / 100 : r.valeur
      remiseMontant = Math.round(Math.min(v, ttcBrut) * 100) / 100
    }
    return { ht, tva, ttcBrut, remiseMontant, remise: r, ttc: Math.max(0, ttcBrut - remiseMontant) }
  }
  return noms.map(nom => {
    const items = arts.filter(a => (a.groupe || '') === nom)
    return { nom, items, exclu: !!optionsGroupes[nom], ...calc(nom, items) }
  })
}
const modeGroupeDevis = (devis) => {
  const s = sectionsDeDevis(devis)
  return s.length > 1 || (s.length === 1 && s[0].nom !== '')
}

const ouvrirApercu = (devis) => { devisApercu.value = devis }
const fermerApercu = () => { devisApercu.value = null }

const supprimerDevis = (index) => {
  const realIdx = props.devisListe.findIndex(d => d.numero === devisFiltres.value[index]?.numero)
  if (!confirm('Supprimer définitivement ce devis ?')) return
  if (devisApercu.value?.numero === devisFiltres.value[index]?.numero) fermerApercu()
  if (realIdx !== -1) props.devisListe.splice(realIdx, 1)
}

const dupliquerDevis = (devis) => {
  const n = `DEV-${new Date().getFullYear()}-${String(props.devisListe.length + 1).padStart(4, '0')}`
  const copie = { ...JSON.parse(JSON.stringify(devis)), numero: n, date: new Date().toISOString().split('T')[0], statut: 'Brouillon' }
  fermerApercu()
  emit('charger-devis', copie)
}

const imprimerApercu = async () => {
  window.print()
}

const imprimerDirectement = async (devis) => {
  devisApercu.value = devis
  await new Promise(r => setTimeout(r, 300))
  window.addEventListener('afterprint', () => {
    devisApercu.value = null
  }, { once: true })
  window.print()
}

// ── Convertir en Facture ─────────────────────────────────
const convertirEnFacture = (devis) => {
  if (!confirm(`Créer une facture à partir du devis ${devis.numero} ?`)) return
  fermerApercu()
  emit('convertir-en-facture', devis)
}

const nomCompletClient = (c) => {
  if (!c) return ''
  return [c.civilite, c.prenom, c.nom].filter(Boolean).join(' ') || c.nom || ''
}

const sanitiserNom = (nom) => (nom || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'Client'

const exporterPDF = async (devis) => {
  devisApercu.value = devis
  exportEnCours.value = true

  try {
    const dossierBase = props.config?.dossierPDF
    const nomClient = sanitiserNom(nomCompletClient(devis.client) || 'Sans_Nom')
    const nomFichier = `${devis.numero}_${nomClient}.pdf`

    let cheminFichier
    if (dossierBase) {
      const dossierClient = `${dossierBase}/${nomClient}`
      await mkdir(dossierClient, { recursive: true })
      cheminFichier = `${dossierClient}/${nomFichier}`
    } else {
      cheminFichier = await save({ filters: [{ name: 'Document PDF', extensions: ['pdf'] }], defaultPath: nomFichier })
      if (!cheminFichier) { exportEnCours.value = false; return }
    }

    await new Promise(r => setTimeout(r, 150))
    const element = document.getElementById('devis-liste-imprimable')
    element.classList.add('pdf-bw')
    await new Promise(r => setTimeout(r, 50))

    const scaleCapture = 2
    const pointsDeCoupe = trouverPointsDeCoupeSurs(element, scaleCapture)
    const sautsPageGroupes = devis.sautsPageGroupes || {}
    const hautsGroupes = trouverHautsDesBlocs(element, scaleCapture, '.groupe-bloc')
    const sautsPageForces = sectionsDeDevis(devis)
      .map((s, i) => (i > 0 && sautsPageGroupes[s.nom]) ? hautsGroupes[i] : null)
      .filter(v => v !== null && v !== undefined)
    const canvas = await html2canvas(element, { scale: scaleCapture, useCORS: true, allowTaint: true, logging: false, height: element.scrollHeight, windowHeight: element.scrollHeight, scrollY: 0 })
    element.classList.remove('pdf-bw')

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pages = paginerCanvas(canvas, pointsDeCoupe, { margeHautMm: 13, sautsPageForces })
    const pxParMm = canvas.width / 210
    pages.forEach((p, i) => {
      if (i > 0) pdf.addPage()
      const dataUrl = extraireBandeCanvas(canvas, p.from, p.to)
      pdf.addImage(dataUrl, 'PNG', 0, p.margeHaut, 210, (p.to - p.from) / pxParMm)
    })

    await writeFile(cheminFichier, new Uint8Array(pdf.output('arraybuffer')))
    try { await openPath(cheminFichier) } catch (_) {}
  } catch (err) {
    console.error('Erreur export PDF:', err)
    alert('Erreur lors de la génération du PDF.')
  }
  exportEnCours.value = false
}
</script>

<template>
  <div>
    <div class="header">
      <div>
        <h2>Historique des Devis</h2>
        <p class="subtitle" style="margin-bottom:0;">{{ devisListe.length }} devis archivé{{ devisListe.length !== 1 ? 's' : '' }}</p>
      </div>
    </div>

    <section class="card">
      <!-- Barre recherche + filtres -->
      <div class="liste-toolbar">
        <div class="search-wrap">
          <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input v-model="recherche" type="text" class="search-input" placeholder="Rechercher par N°, client…" />
          <button v-if="recherche" @click="recherche = ''" class="search-clear">✕</button>
        </div>
        <div class="filtre-chips">
          <button v-for="f in ['Tous','Brouillon','Envoyée','Validée']" :key="f" :class="['chip', filtreStatut === f ? 'chip-active' : '']" @click="filtreStatut = f">{{ f }}</button>
        </div>
      </div>

      <div v-if="devisListe.length === 0" class="empty-state">
        <div class="empty-icon">🗂️</div>
        <p>Aucun devis enregistré.<br>Créez un devis depuis l'éditeur et sauvegardez-le.</p>
      </div>
      <div v-else-if="devisFiltres.length === 0" class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>Aucun résultat pour cette recherche.</p>
      </div>

      <table v-else class="standard-table">
        <thead>
          <tr>
            <th>N° Devis</th>
            <th>Date</th>
            <th>Client</th>
            <th class="text-right">Montant TTC</th>
            <th width="200" class="text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(devis, index) in devisFiltres" :key="devis.numero">
            <td class="numero-cell">
              <span class="badge-number">{{ devis.numero }}</span>
              <span :class="['badge-statut', devis.statut === 'Validée' ? 'badge-valide' : devis.statut === 'Envoyée' ? 'badge-envoyee' : 'badge-brouillon']">{{ devis.statut || 'Brouillon' }}</span>
            </td>
            <td class="date-cell">{{ devis.date }}</td>
            <td class="client-name">{{ nomCompletClient(devis.client) || '—' }}</td>
            <td class="text-right price-tag">{{ devis.totalTTC?.toFixed(2) }} CHF</td>
            <td class="text-center actions-cell">
              <button @click="ouvrirApercu(devis)" class="btn-icon" title="Aperçu">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button @click="emit('charger-devis', devis)" class="btn-icon" title="Éditer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <!-- TODO: bouton Imprimer action rapide
              <button @click="imprimerDirectement(devis)" class="btn-icon" title="Imprimer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              </button>
              -->
              <button @click="dupliquerDevis(devis)" class="btn-icon" title="Dupliquer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button @click="convertirEnFacture(devis)" class="btn-icon" title="Convertir en Facture">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              </button>
              <button @click="exporterPDF(devis)" class="btn-icon" title="Exporter PDF">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <button @click="supprimerDevis(index)" class="btn-icon btn-icon-danger" title="Supprimer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ===== MODAL APERÇU ===== -->
    <Teleport to="body">
      <div v-if="devisApercu" class="modal-overlay" @click.self="fermerApercu">
        <div class="modal-container">

          <div class="modal-toolbar no-print" v-show="!exportEnCours">
            <div class="modal-meta">
              <span class="badge-number">{{ devisApercu.numero }}</span>
              <span class="modal-client-name">{{ nomCompletClient(devisApercu.client) }}</span>
              <span class="modal-date">{{ devisApercu.date }}</span>
            </div>
            <div class="modal-actions">
              <button @click="emit('charger-devis', devisApercu); fermerApercu()" class="btn-secondary" style="margin-top:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Éditer
              </button>
              <button @click="dupliquerDevis(devisApercu)" class="btn-secondary" style="margin-top:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Dupliquer
              </button>
              <button @click="convertirEnFacture(devisApercu)" class="btn-secondary" style="margin-top:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                → Facture
              </button>
              <button @click="imprimerApercu" class="btn-secondary" style="margin-top:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Imprimer
              </button>
              <button @click="exporterPDF(devisApercu)" class="btn-success">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Exporter PDF
              </button>
              <button @click="fermerApercu" class="btn-close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div class="modal-body">
            <div id="devis-liste-imprimable" class="print-container">

              <div class="invoice-header">
                <div class="company-details">
                  <img v-if="boutique?.logo" :src="boutique.logo" :style="{ height: boutique.logoTaille, display: 'block', marginBottom: '0.5rem' }" alt="Logo" />
                  <div v-else style="font-size:1.15rem;font-weight:800;color:#0f172a;margin-bottom:0.35rem;">{{ boutique?.nom }}</div>
                  <p style="margin:0;font-size:0.875rem;color:#475569;">{{ boutique?.adresse }}</p>
                  <p style="margin:0;font-size:0.875rem;color:#475569;">{{ boutique?.localite }}</p>
                  <p style="margin:0;font-size:0.875rem;color:#475569;">{{ boutique?.telephone }}</p>
                  <p style="margin:0;font-size:0.875rem;color:#475569;">{{ boutique?.email }}</p>
                </div>
                <div style="text-align:right;">
                  <div class="devis-ref-box">
                    <div class="ref-label">N° Devis</div>
                    <div class="ref-numero">{{ devisApercu.numero }}</div>
                    <div class="ref-date">{{ devisApercu.date }}</div>
                  </div>
                  <div v-if="devisApercu.client" style="margin-top:1rem;">
                    <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;margin-bottom:0.3rem;">Offre pour</div>
                    <div style="font-size:1rem;font-weight:700;color:#0f172a;">{{ devisApercu.client.nom }}</div>
                    <div style="font-size:0.875rem;color:#475569;margin-top:0.2rem;">{{ devisApercu.client.adresse }}</div>
                    <div style="font-size:0.875rem;color:#475569;">{{ devisApercu.client.email }}</div>
                  </div>
                </div>
              </div>

              <div v-if="devisApercu.titreProjet" class="doc-project-title">{{ devisApercu.titreProjet }}</div>

              <div
                v-for="(section, sIndex) in sectionsDeDevis(devisApercu)" :key="section.nom" class="groupe-bloc"
                :style="sIndex > 0 && (devisApercu.sautsPageGroupes || {})[section.nom] ? { breakBefore: 'page', pageBreakBefore: 'always' } : {}"
              >
                <div v-if="modeGroupeDevis(devisApercu) && section.nom" class="groupe-titre-apercu">
                  {{ section.nom }}
                  <span v-if="section.exclu" class="groupe-option-badge">Option — non incluse dans le total</span>
                </div>
                <div v-else-if="modeGroupeDevis(devisApercu)" class="groupe-titre-apercu">Commun</div>

                <table class="invoice-table" style="margin-top:1rem;">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th width="80" class="text-center">Qté</th>
                      <th width="130" class="text-right">P.U. CHF</th>
                      <th width="130" class="text-right">Total CHF</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="art in section.items" :key="art.description + art.prixUnitaire">
                      <td style="white-space:pre-line;">{{ art.description }}</td>
                      <td class="text-center">{{ art.quantite }}</td>
                      <td class="text-right">{{ Number(art.prixUnitaire).toFixed(2) }}</td>
                      <td class="text-right bold-text">{{ (art.quantite * art.prixUnitaire).toFixed(2) }}</td>
                    </tr>
                  </tbody>
                </table>

                <div v-if="modeGroupeDevis(devisApercu)" class="groupe-total-box">
                  <template v-if="(config?.tvaMode ?? 'incluse') === 'incluse'">
                    <div class="groupe-total-row"><span>dont TVA {{ config?.tvaTaux ?? 8.1 }}%</span><span>{{ section.tva.toFixed(2) }} CHF</span></div>
                  </template>
                  <template v-else>
                    <div class="groupe-total-row"><span>Total HT</span><span>{{ section.ht.toFixed(2) }} CHF</span></div>
                    <div class="groupe-total-row"><span>TVA {{ config?.tvaTaux ?? 8.1 }}%</span><span>{{ section.tva.toFixed(2) }} CHF</span></div>
                  </template>
                  <div v-if="section.remiseMontant > 0" class="groupe-total-row" style="color:#dc2626;">
                    <span>Remise{{ section.remise.mode === 'pourcent' ? ' ' + section.remise.valeur + '%' : '' }}</span>
                    <span>−{{ section.remiseMontant.toFixed(2) }} CHF</span>
                  </div>
                  <div class="groupe-total-ttc"><span>Total{{ section.exclu ? ' (option)' : '' }}</span><span>{{ section.ttc.toFixed(2) }} CHF</span></div>
                  <div v-if="section.exclu" class="groupe-option-note">Non inclus dans le total général</div>
                </div>
              </div>

              <div class="apercu-footer" style="margin-top:2.5rem;">
                <div class="apercu-legal">
                  <div v-if="boutique?.conditions" class="legal-block">
                    <span class="legal-label">Conditions de l'offre</span>
                    <p class="legal-text">{{ boutique.conditions }}</p>
                  </div>
                  <div v-if="boutique?.iban" class="legal-line">
                    <span class="legal-label">IBAN :</span> {{ boutique.iban }}<span v-if="boutique?.banque"> · {{ boutique.banque }}</span>
                  </div>
                  <div v-if="boutique?.tvaNumero" class="legal-line">
                    <span class="legal-label">N° d'entreprise :</span> {{ boutique.tvaNumero }}
                  </div>
                </div>
                <div v-if="devisApercu.afficherTotalGeneral !== false" class="apercu-totals">
                  <template v-if="(config?.tvaMode ?? 'incluse') === 'incluse'">
                    <span class="totals-label">dont TVA {{ config?.tvaTaux ?? 8.1 }}% incluse</span>
                    <span class="totals-value">{{ tvaFromDevis(devisApercu).toFixed(2) }} CHF</span>
                  </template>
                  <template v-else>
                    <span class="totals-label">Total HT</span>
                    <span class="totals-value">{{ htFromDevis(devisApercu).toFixed(2) }} CHF</span>
                    <span class="totals-label">TVA {{ config?.tvaTaux ?? 8.1 }}%</span>
                    <span class="totals-value">{{ tvaFromDevis(devisApercu).toFixed(2) }} CHF</span>
                  </template>
                  <span class="grand-total">Total TTC</span>
                  <span class="grand-total">{{ devisApercu.totalTTC?.toFixed(2) }} CHF</span>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>


<style scoped>
/* ── Toolbar liste ───────────────────── */
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
.filtre-chips { display: flex; gap: 0.35rem; flex-shrink: 0; }
.chip { padding: 0.3rem 0.85rem; border-radius: 20px; font-size: 0.78rem; font-weight: 600; cursor: pointer; border: 1.5px solid #d4c9b8; background: #fff; color: #6b5030; transition: all 0.12s; }
.chip:hover { border-color: #C5A059; color: #3d2200; background: #fdf3e3; }
.chip-active { background: #C5A059; color: #0B3D2E; border-color: #C5A059; }

/* ── Table ───────────────────────────── */
.empty-state { text-align: center; padding: 3.5rem 1rem; color: #94a3b8; }
.empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; opacity: 0.4; }
.empty-state p { margin: 0; font-size: 0.9rem; line-height: 1.6; }
.badge-number { background: #eef2ff; border: 1px solid #c7d2fe; padding: 0.25rem 0.55rem; border-radius: 6px; font-family: ui-monospace, monospace; font-weight: 700; color: #4f46e5; font-size: 0.8rem; }
.date-cell { color: #94a3b8; font-size: 0.875rem; }
.client-name { font-weight: 600; color: #1e293b; }
.price-tag { font-weight: 600; color: #10b981 !important; font-family: ui-monospace, monospace; }
.actions-cell { display: flex; justify-content: center; gap: 0.3rem; align-items: center; }
.btn-icon { background: #fff; border: 1.5px solid #d4c9b8; width: 34px; height: 34px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.12s; padding: 0; color: #6b5030; flex-shrink: 0; }
.btn-icon:hover { background: #fdf3e3; border-color: #C5A059; color: #0B3D2E; box-shadow: 0 1px 4px rgba(197,160,89,0.2); }
.btn-icon-danger:hover { background: #fef2f2; border-color: #fca5a5; color: #dc2626; box-shadow: none; }
.numero-cell { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
.badge-statut { font-size: 0.63rem; font-weight: 700; padding: 0.15rem 0.55rem; border-radius: 20px; letter-spacing: 0.3px; white-space: nowrap; }
.badge-brouillon { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
.badge-envoyee   { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.badge-valide    { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }

/* ── Modal ───────────────────────────── */
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

/* ── Document dans modal ─────────────── */
.devis-ref-box { display: inline-block; text-align: right; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem 1rem; }
.ref-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; font-weight: 700; }
.ref-numero { font-size: 1.1rem; font-weight: 800; color: #4f46e5; font-family: ui-monospace, monospace; margin: 0.15rem 0; }
.ref-date { font-size: 0.82rem; color: #64748b; }

.apercu-footer { display: flex; justify-content: space-between; align-items: flex-end; padding-top: 1.5rem; border-top: 1px solid #f1f5f9; gap: 2rem; }
.apercu-legal { max-width: 55%; font-size: 0.8rem; color: #64748b; line-height: 1.6; }
.legal-block { margin-bottom: 0.6rem; }
.legal-label { font-weight: 600; color: #334155; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.4px; }
.legal-text { margin: 0.15rem 0 0; font-style: italic; }
.legal-line { margin-bottom: 0.2rem; }
.apercu-totals { display: grid; grid-template-columns: 120px 150px; gap: 0.4rem; text-align: right; font-size: 0.9rem; flex-shrink: 0; }
.totals-label { color: #64748b; display: flex; align-items: center; justify-content: flex-end; }
.totals-value { font-weight: 600; color: #1e293b; }
.grand-total { font-size: 1.05rem; font-weight: 800; color: #0f172a; border-top: 2px solid #0f172a; padding-top: 0.5rem; margin-top: 0.15rem; }

.doc-project-title { font-size: 0.95rem; font-weight: 700; color: #0f172a; margin: 1rem 0 0.75rem; padding-bottom: 0.6rem; border-bottom: 1px solid #e2e8f0; }

/* ── Sections par groupe (Alliance Marie / Alliance Marco / etc.) ── */
.groupe-bloc { margin-bottom: 1.5rem; }
.groupe-bloc:last-of-type { margin-bottom: 0; }
.groupe-titre-apercu { font-size: 0.95rem; font-weight: 800; color: #0f172a; padding-bottom: 0.4rem; border-bottom: 1.5px solid #0f172a; }
.groupe-option-badge { display: inline-block; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #b45309; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 20px; padding: 0.1rem 0.55rem; margin-left: 0.6rem; vertical-align: middle; }
.groupe-option-note { font-size: 0.7rem; font-style: italic; color: #b45309; margin-top: 0.15rem; }
.groupe-total-box { display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; margin-top: 0.5rem; }
.groupe-total-row { display: flex; justify-content: space-between; width: 220px; font-size: 0.78rem; color: #64748b; padding: 0.1rem 0; }
.groupe-total-ttc { display: flex; justify-content: space-between; width: 220px; font-weight: 800; font-size: 0.85rem; padding-top: 0.3rem; margin-top: 0.15rem; border-top: 1px solid #e2e8f0; color: #0f172a; }

/* ── Print depuis modal ──────────────── */
@media print {
  .modal-overlay { background: none !important; position: static !important; padding: 0 !important; display: block !important; }
  .modal-container { box-shadow: none !important; border-radius: 0 !important; max-height: none !important; overflow: visible !important; }
  .modal-toolbar { display: none !important; }
  .modal-body { padding: 0 !important; overflow: visible !important; }
}
</style>
