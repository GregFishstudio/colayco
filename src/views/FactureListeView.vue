<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, mkdir } from '@tauri-apps/plugin-fs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import QRCode from 'qrcode'

const props = defineProps({
  factureListe: Array,
  boutique: Object,
  config: Object
})

const emit = defineEmits(['charger-facture'])

const factureApercu = ref(null)
const exportEnCours = ref(false)

// ── Recherche & filtres ──────────────────────────────────
const recherche = ref('')
const filtreStatut = ref('Tous')

const facturesFiltrees = computed(() => {
  let liste = [...props.factureListe].reverse()
  if (filtreStatut.value !== 'Tous') {
    liste = liste.filter(f => (f.statut || 'Brouillon') === filtreStatut.value)
  }
  if (recherche.value.trim()) {
    const q = recherche.value.trim().toLowerCase()
    liste = liste.filter(f =>
      f.numero?.toLowerCase().includes(q) ||
      nomCompletClient(f.client).toLowerCase().includes(q)
    )
  }
  return liste
})

const tvaFromFacture = (facture) => {
  const rate = props.config?.tvaTaux ?? 8.1
  const m = props.config?.tvaMode ?? 'incluse'
  const total = facture.totalTTC ?? 0
  return m === 'incluse' ? total * rate / (100 + rate) : total * rate / 100
}
const htFromFacture = (facture) => {
  const m = props.config?.tvaMode ?? 'incluse'
  return m === 'incluse' ? (facture.totalTTC ?? 0) - tvaFromFacture(facture) : facture.totalTTC ?? 0
}

const ouvrirApercu = (facture) => { factureApercu.value = facture }
const fermerApercu = () => { factureApercu.value = null }

const supprimerFacture = (index) => {
  const realIdx = props.factureListe.findIndex(f => f.numero === facturesFiltrees.value[index]?.numero)
  if (!confirm('Supprimer définitivement cette facture ?')) return
  if (factureApercu.value?.numero === facturesFiltrees.value[index]?.numero) fermerApercu()
  if (realIdx !== -1) props.factureListe.splice(realIdx, 1)
}

const dupliquerFacture = (facture) => {
  const n = `FAC-${new Date().getFullYear()}-${String(props.factureListe.length + 1).padStart(4, '0')}`
  const copie = { ...JSON.parse(JSON.stringify(facture)), numero: n, date: new Date().toISOString().split('T')[0], statut: 'Brouillon' }
  fermerApercu()
  emit('charger-facture', copie)
}

let _printGuard = false
let _unlistenClose = null
onMounted(async () => {
  try {
    _unlistenClose = await getCurrentWindow().onCloseRequested((event) => {
      if (_printGuard) event.preventDefault()
    })
  } catch (_) {}
})
onUnmounted(() => { if (_unlistenClose) _unlistenClose() })

const imprimerApercu = async () => {
  _printGuard = true
  window.addEventListener('afterprint', () => { _printGuard = false }, { once: true })
  window.print()
}

const nomCompletClient = (c) => {
  if (!c) return ''
  return [c.civilite, c.prenom, c.nom].filter(Boolean).join(' ') || c.nom || ''
}
const adresseLigne1 = (c) => {
  if (!c) return ''
  if (c.rue !== undefined) return [c.rue, c.numero].filter(Boolean).join(' ')
  return c.adresse || ''
}
const adresseLigne2 = (c) => {
  if (!c || c.rue === undefined) return ''
  return [c.npa, c.lieu].filter(Boolean).join(' ')
}

const sanitiserNom = (nom) => (nom || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'Client'

const exporterPDF = async (facture) => {
  factureApercu.value = facture
  exportEnCours.value = true

  try {
    const dossierBase = props.config?.dossierPDF
    const nomClient = sanitiserNom(nomCompletClient(facture.client) || 'Sans_Nom')
    const nomFichier = `${facture.numero}_${nomClient}.pdf`

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
    const element = document.getElementById('facture-liste-imprimable')
    element.classList.add('pdf-bw')
    await new Promise(r => setTimeout(r, 50))

    const canvas = await html2canvas(element, { scale: 2, useCORS: true, allowTaint: true, logging: false, height: element.scrollHeight, windowHeight: element.scrollHeight, scrollY: 0 })
    element.classList.remove('pdf-bw')

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageW = 210, pageH = 297
    const imgH = (canvas.height * pageW) / canvas.width

    pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH)
    let remaining = imgH - pageH, yOffset = -pageH
    while (remaining > 0) {
      pdf.addPage(); pdf.addImage(imgData, 'PNG', 0, yOffset, pageW, imgH)
      yOffset -= pageH; remaining -= pageH
    }

    // Page 2 : QR-bill suisse
    const b = props.boutique
    const client = facture.client
    const cleanIBAN = (b?.iban || '').replace(/\s/g, '').toUpperCase()
    const localParts = (b?.localite || '').split(' ')
    const postalCode = localParts[0] || ''
    const city = localParts.slice(1).join(' ') || ''
    const qrLines = [
      'SPC', '0200', '1', cleanIBAN,
      'K', b?.nom || '', b?.adresse || '', `${postalCode} ${city}`.trim(), '', '', 'CH',
      '', '', '', '', '', '',
      (facture.totalTTC ?? 0).toFixed(2), 'CHF',
      client ? 'K' : '', nomCompletClient(client), adresseLigne1(client), adresseLigne2(client), '', '', client ? 'CH' : '',
      'NON', '', `Facture ${facture.numero}`, 'EPD'
    ]
    const qrDataUrl = await QRCode.toDataURL(qrLines.join('\n'), { width: 460, margin: 1, color: { dark: '#000000', light: '#ffffff' } })

    pdf.addPage()
    const slipY = 192
    pdf.setDrawColor(0, 0, 0)
    pdf.setLineDashPattern([1, 1], 0)
    pdf.line(5, slipY, 205, slipY)
    pdf.line(62, slipY, 62, 292)
    pdf.setLineDashPattern([], 0)
    pdf.setTextColor(150, 150, 150); pdf.setFontSize(8); pdf.text('✂', 2, slipY - 1)
    pdf.setTextColor(0, 0, 0)

    const rx = 5, ry = slipY + 5
    pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.text('Empfangsschein', rx, ry + 4)
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Konto / Zahlbar an', rx, ry + 11)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    pdf.text((b?.iban || '').toUpperCase(), rx, ry + 15)
    pdf.text(b?.nom || '', rx, ry + 19)
    pdf.text(b?.adresse || '', rx, ry + 23)
    pdf.text(b?.localite || '', rx, ry + 27)
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Zahlbar durch', rx, ry + 36)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    if (client) { const cN=nomCompletClient(client); const cA1=adresseLigne1(client); const cA2=adresseLigne2(client); pdf.text(cN, rx, ry + 40); if (cA1) pdf.text(cA1, rx, ry + 44); if (cA2) pdf.text(cA2, rx, ry + 48) }
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold')
    pdf.text('Währung', rx, ry + 62); pdf.text('Betrag', rx + 18, ry + 62)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    pdf.text('CHF', rx, ry + 67); pdf.text((facture.totalTTC ?? 0).toFixed(2), rx + 18, ry + 67)
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Annahmestelle', 60, slipY + 100, { align: 'right' })

    const px = 67, py = slipY + 5
    pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.text('Zahlteil', px, py + 4)
    const qrX = px, qrY = py + 8
    pdf.addImage(qrDataUrl, 'PNG', qrX, qrY, 46, 46)
    const cx = qrX + 23 - 3.5, cy = qrY + 23 - 3.5
    pdf.setFillColor(255, 255, 255); pdf.rect(cx, cy, 7, 7, 'F')
    pdf.setFillColor(0, 0, 0); pdf.rect(cx + 2, cy + 0.5, 3, 6, 'F'); pdf.rect(cx + 0.5, cy + 2, 6, 3, 'F')
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold')
    pdf.text('Währung', px, qrY + 50); pdf.text('Betrag', px + 25, qrY + 50)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
    pdf.text('CHF', px, qrY + 56); pdf.text((facture.totalTTC ?? 0).toFixed(2), px + 25, qrY + 56)
    const dx = px + 50, dy = py + 8
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Konto / Zahlbar an', dx, dy)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    pdf.text((b?.iban || '').toUpperCase(), dx, dy + 4); pdf.text(b?.nom || '', dx, dy + 8)
    pdf.text(b?.adresse || '', dx, dy + 12); pdf.text(b?.localite || '', dx, dy + 16)
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Référence', dx, dy + 24)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.text(facture.numero, dx, dy + 28)
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Zahlbar durch', dx, dy + 36)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    if (client) { const cN=nomCompletClient(client); const cA1=adresseLigne1(client); const cA2=adresseLigne2(client); pdf.text(cN, dx, dy + 40); if (cA1) pdf.text(cA1, dx, dy + 44); if (cA2) pdf.text(cA2, dx, dy + 48) }

    await writeFile(cheminFichier, new Uint8Array(pdf.output('arraybuffer')))
    alert(`PDF exporté !\n${cheminFichier}`)
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
        <h2>Historique des Factures</h2>
        <p class="subtitle" style="margin-bottom:0;">{{ factureListe.length }} facture{{ factureListe.length !== 1 ? 's' : '' }} archivée{{ factureListe.length !== 1 ? 's' : '' }}</p>
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
          <button v-for="f in ['Tous','Validé','Brouillon']" :key="f" :class="['chip', filtreStatut === f ? 'chip-active' : '']" @click="filtreStatut = f">{{ f }}</button>
        </div>
      </div>

      <div v-if="factureListe.length === 0" class="empty-state">
        <div class="empty-icon">🧾</div>
        <p>Aucune facture enregistrée.<br>Créez une facture depuis l'éditeur de factures.</p>
      </div>
      <div v-else-if="facturesFiltrees.length === 0" class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>Aucun résultat pour cette recherche.</p>
      </div>

      <table v-else class="standard-table">
        <thead>
          <tr>
            <th>N° Facture</th>
            <th>Date</th>
            <th>Client</th>
            <th class="text-right">Montant TTC</th>
            <th width="160" class="text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(facture, index) in facturesFiltrees" :key="facture.numero">
            <td class="numero-cell">
              <span class="badge-number badge-facture">{{ facture.numero }}</span>
              <span :class="['badge-statut', facture.statut === 'Validé' ? 'badge-valide' : 'badge-brouillon']">{{ facture.statut || 'Brouillon' }}</span>
            </td>
            <td class="date-cell">{{ facture.date }}</td>
            <td class="client-name">{{ nomCompletClient(facture.client) || '—' }}</td>
            <td class="text-right price-tag">{{ facture.totalTTC?.toFixed(2) }} CHF</td>
            <td class="text-center actions-cell">
              <button @click="ouvrirApercu(facture)" class="btn-icon" title="Aperçu">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button @click="emit('charger-facture', facture)" class="btn-icon" title="Éditer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button @click="dupliquerFacture(facture)" class="btn-icon" title="Dupliquer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button @click="exporterPDF(facture)" class="btn-icon" title="Exporter PDF">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <button @click="supprimerFacture(index)" class="btn-icon btn-icon-danger" title="Supprimer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <Teleport to="body">
      <div v-if="factureApercu" class="modal-overlay" @click.self="fermerApercu">
        <div class="modal-container">

          <div class="modal-toolbar no-print" v-show="!exportEnCours">
            <div class="modal-meta">
              <span class="badge-number badge-facture">{{ factureApercu.numero }}</span>
              <span class="modal-client-name">{{ nomCompletClient(factureApercu.client) }}</span>
              <span class="modal-date">{{ factureApercu.date }}</span>
            </div>
            <div class="modal-actions">
              <button @click="emit('charger-facture', factureApercu); fermerApercu()" class="btn-secondary" style="margin-top:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Éditer
              </button>
              <button @click="dupliquerFacture(factureApercu)" class="btn-secondary" style="margin-top:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Dupliquer
              </button>
              <button @click="imprimerApercu" class="btn-secondary" style="margin-top:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Imprimer
              </button>
              <button @click="exporterPDF(factureApercu)" class="btn-success">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Exporter PDF
              </button>
              <button @click="fermerApercu" class="btn-close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div class="modal-body">
            <div id="facture-liste-imprimable" class="print-container">

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
                    <div class="ref-label">N° Facture</div>
                    <div class="ref-numero ref-numero-facture">{{ factureApercu.numero }}</div>
                    <div class="ref-date">{{ factureApercu.date }}</div>
                  </div>
                  <div v-if="factureApercu.client" style="margin-top:1rem;">
                    <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;margin-bottom:0.3rem;">Facturé à</div>
                    <div style="font-size:1rem;font-weight:700;color:#0f172a;">{{ factureApercu.client.nom }}</div>
                    <div style="font-size:0.875rem;color:#475569;margin-top:0.2rem;">{{ factureApercu.client.adresse }}</div>
                    <div style="font-size:0.875rem;color:#475569;">{{ factureApercu.client.email }}</div>
                  </div>
                </div>
              </div>

              <div v-if="factureApercu.titreProjet" class="doc-project-title">{{ factureApercu.titreProjet }}</div>

              <table class="invoice-table" style="margin-top:1.5rem;">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th width="80" class="text-center">Qté</th>
                    <th width="130" class="text-right">P.U. CHF</th>
                    <th width="130" class="text-right">Total CHF</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="art in factureApercu.articles" :key="art.description + art.prixUnitaire">
                    <td>{{ art.description }}</td>
                    <td class="text-center">{{ art.quantite }}</td>
                    <td class="text-right">{{ Number(art.prixUnitaire).toFixed(2) }}</td>
                    <td class="text-right bold-text">{{ (art.quantite * art.prixUnitaire).toFixed(2) }}</td>
                  </tr>
                </tbody>
              </table>

              <div class="apercu-footer" style="margin-top:2.5rem;">
                <div class="apercu-legal">
                  <div class="legal-block">
                    <span class="legal-label">Conditions de paiement</span>
                    <p class="legal-text">Payable à {{ factureApercu.delaiPaiement ?? 30 }} jours dès réception de la présente facture.</p>
                  </div>
                  <div v-if="boutique?.iban" class="legal-line">
                    <span class="legal-label">IBAN :</span> {{ boutique.iban }}<span v-if="boutique?.banque"> · {{ boutique.banque }}</span>
                  </div>
                  <div v-if="boutique?.tvaNumero" class="legal-line">
                    <span class="legal-label">N° d'entreprise :</span> {{ boutique.tvaNumero }}
                  </div>
                </div>
                <div class="apercu-totals">
                  <template v-if="(config?.tvaMode ?? 'incluse') === 'incluse'">
                    <span class="totals-label">dont TVA {{ config?.tvaTaux ?? 8.1 }}% incluse</span>
                    <span class="totals-value">{{ tvaFromFacture(factureApercu).toFixed(2) }} CHF</span>
                  </template>
                  <template v-else>
                    <span class="totals-label">Total HT</span>
                    <span class="totals-value">{{ htFromFacture(factureApercu).toFixed(2) }} CHF</span>
                    <span class="totals-label">TVA {{ config?.tvaTaux ?? 8.1 }}%</span>
                    <span class="totals-value">{{ tvaFromFacture(factureApercu).toFixed(2) }} CHF</span>
                  </template>
                  <span class="grand-total">Total TTC</span>
                  <span class="grand-total">{{ factureApercu.totalTTC?.toFixed(2) }} CHF</span>
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
.liste-toolbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.1rem; padding-bottom: 1rem; border-bottom: 1px solid #f0e8da; flex-wrap: wrap; }
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

.empty-state { text-align: center; padding: 3.5rem 1rem; color: #94a3b8; }
.empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; opacity: 0.4; }
.empty-state p { margin: 0; font-size: 0.9rem; line-height: 1.6; }
.badge-number { background: #eef2ff; border: 1px solid #c7d2fe; padding: 0.25rem 0.55rem; border-radius: 6px; font-family: ui-monospace, monospace; font-weight: 700; color: #4f46e5; font-size: 0.8rem; }
.badge-facture { background: #eff6ff !important; border-color: #bfdbfe !important; color: #1d4ed8 !important; }
.date-cell { color: #94a3b8; font-size: 0.875rem; }
.client-name { font-weight: 600; color: #1e293b; }
.price-tag { font-weight: 600; color: #10b981 !important; font-family: ui-monospace, monospace; }
.actions-cell { display: flex; justify-content: center; gap: 0.3rem; align-items: center; }
.btn-icon { background: #fff; border: 1.5px solid #d4c9b8; width: 34px; height: 34px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.12s; padding: 0; color: #6b5030; }
.btn-icon:hover { background: #fdf3e3; border-color: #C5A059; color: #0B3D2E; box-shadow: 0 1px 4px rgba(197,160,89,0.2); }
.btn-icon-danger:hover { background: #fef2f2; border-color: #fca5a5; color: #dc2626; box-shadow: none; }
.numero-cell { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
.badge-statut { font-size: 0.63rem; font-weight: 700; padding: 0.15rem 0.55rem; border-radius: 20px; letter-spacing: 0.3px; white-space: nowrap; }
.badge-brouillon { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
.badge-valide    { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }

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

.devis-ref-box { display: inline-block; text-align: right; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem 1rem; }
.ref-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; font-weight: 700; }
.ref-numero { font-size: 1.1rem; font-weight: 800; color: #4f46e5; font-family: ui-monospace, monospace; margin: 0.15rem 0; }
.ref-numero-facture { color: #1d4ed8; }
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

@media print {
  .modal-overlay { background: none !important; position: static !important; padding: 0 !important; display: block !important; }
  .modal-container { box-shadow: none !important; border-radius: 0 !important; max-height: none !important; overflow: visible !important; }
  .modal-toolbar { display: none !important; }
  .modal-body { padding: 0 !important; overflow: visible !important; }
}
</style>
