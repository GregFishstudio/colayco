<script setup>
import { ref } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, mkdir } from '@tauri-apps/plugin-fs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const props = defineProps({
  devisListe: Array,
  boutique: Object,
  config: Object
})

const emit = defineEmits(['charger-devis'])

const devisApercu = ref(null)
const exportEnCours = ref(false)

const htFromDevis = (devis) =>
  devis.articles.reduce((sum, art) => sum + art.quantite * art.prixUnitaire, 0)
const tvaFromDevis = (devis) => htFromDevis(devis) * 0.081

const ouvrirApercu = (devis) => { devisApercu.value = devis }
const fermerApercu = () => { devisApercu.value = null }

const supprimerDevis = (index) => {
  if (confirm('Supprimer définitivement ce devis de l\'historique local ?')) {
    if (devisApercu.value?.numero === props.devisListe[index]?.numero) fermerApercu()
    props.devisListe.splice(index, 1)
  }
}

const dupliquerDevis = (devis) => {
  const newNumero = `DEV-${new Date().getFullYear()}-${String(props.devisListe.length + 1).padStart(4, '0')}`
  const copie = {
    ...JSON.parse(JSON.stringify(devis)),
    numero: newNumero,
    date: new Date().toISOString().split('T')[0],
    statut: 'Brouillon'
  }
  fermerApercu()
  emit('charger-devis', copie)
}

const sanitiserNom = (nom) => (nom || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'Client'

const exporterPDF = async (devis) => {
  devisApercu.value = devis
  exportEnCours.value = true

  try {
    const dossierBase = props.config?.dossierPDF
    const nomClient = sanitiserNom(devis.client?.nom || 'Sans_Nom')
    const nomFichier = `${devis.numero}_${nomClient}.pdf`

    let cheminFichier
    if (dossierBase) {
      const dossierClient = `${dossierBase}/${nomClient}`
      await mkdir(dossierClient, { recursive: true })
      cheminFichier = `${dossierClient}/${nomFichier}`
    } else {
      cheminFichier = await save({
        filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
        defaultPath: nomFichier
      })
      if (!cheminFichier) { exportEnCours.value = false; return }
    }

    await new Promise(resolve => setTimeout(resolve, 150))

    const element = document.getElementById('devis-liste-imprimable')
    const canvas = await html2canvas(element, { scale: 2, useCORS: true })
    const pdf = new jsPDF('p', 'mm', 'a4')
    const imgWidth = 210
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    pdf.addImage(canvas.toDataURL('image/jpeg', 1.0), 'JPEG', 0, 0, imgWidth, imgHeight)

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
        <h2>Historique des Devis & Factures</h2>
        <p class="subtitle" style="margin-bottom: 0;">
          {{ devisListe.length }} document{{ devisListe.length !== 1 ? 's' : '' }} archivé{{ devisListe.length !== 1 ? 's' : '' }}
          &nbsp;·&nbsp;{{ devisListe.filter(d => d.typeDocument === 'facture').length }} facture{{ devisListe.filter(d => d.typeDocument === 'facture').length !== 1 ? 's' : '' }}
        </p>
      </div>
    </div>

    <section class="card">
      <div v-if="devisListe.length === 0" class="empty-state">
        <div class="empty-icon">🗂️</div>
        <p>Aucun devis enregistré.<br>Créez un devis depuis l'éditeur et sauvegardez-le.</p>
      </div>

      <table v-else class="standard-table">
        <thead>
          <tr>
            <th>N° Document</th>
            <th>Date</th>
            <th>Client</th>
            <th class="text-right">Montant TTC</th>
            <th width="160" class="text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(devis, index) in devisListe" :key="devis.numero">
            <td class="numero-cell">
              <span :class="['badge-number', devis.typeDocument === 'facture' ? 'badge-number-facture' : '']">{{ devis.numero }}</span>
              <span :class="['badge-statut',
                devis.statut === 'Facture'  ? 'badge-facture' :
                devis.statut === 'Validé'   ? 'badge-valide'  : 'badge-brouillon']">
                {{ devis.statut || 'Brouillon' }}
              </span>
            </td>
            <td class="date-cell">{{ devis.date }}</td>
            <td class="client-name">{{ devis.client?.nom || 'Client inconnu' }}</td>
            <td class="text-right price-tag">{{ devis.totalTTC.toFixed(2) }} CHF</td>
            <td class="text-center actions-cell">
              <button @click="ouvrirApercu(devis)" class="btn-icon" title="Coup d'œil">👁️</button>
              <button @click="emit('charger-devis', devis)" class="btn-icon" title="Ouvrir dans l'éditeur">🖋️</button>
              <button @click="dupliquerDevis(devis)" class="btn-icon" title="Dupliquer (nouveau N°)">📋</button>
              <button @click="exporterPDF(devis)" class="btn-icon" title="Exporter PDF">📁</button>
              <button @click="supprimerDevis(index)" class="btn-icon btn-icon-danger" title="Supprimer">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ===== MODAL APERÇU ===== -->
    <Teleport to="body">
      <div v-if="devisApercu" class="modal-overlay" @click.self="fermerApercu">
        <div class="modal-container">

          <!-- Barre d'actions (masquée pendant la capture PDF) -->
          <div class="modal-toolbar" v-show="!exportEnCours">
            <div class="modal-meta">
              <span class="badge-number">{{ devisApercu.numero }}</span>
              <span class="modal-client-name">{{ devisApercu.client?.nom }}</span>
              <span class="modal-date">{{ devisApercu.date }}</span>
            </div>
            <div class="modal-actions">
              <button @click="emit('charger-devis', devisApercu); fermerApercu()" class="btn-secondary" style="margin-top:0;">🖋️ Ouvrir &amp; Éditer</button>
              <button @click="dupliquerDevis(devisApercu)" class="btn-secondary" style="margin-top:0;">📋 Dupliquer</button>
              <button @click="exporterPDF(devisApercu)" class="btn-success">📁 Exporter PDF</button>
              <button @click="fermerApercu" class="btn-close">✕</button>
            </div>
          </div>

          <!-- Zone d'impression — capturée par html2canvas -->
          <div class="modal-body">
            <div id="devis-liste-imprimable" class="print-container">

              <div class="invoice-header">
                <div class="company-details">
                  <img v-if="boutique?.logo" :src="boutique.logo"
                    :style="{ height: boutique.logoTaille, display: 'block', marginBottom: '0.5rem' }" alt="Logo" />
                  <div v-else style="font-size: 1.15rem; font-weight: 800; color: #0f172a; margin-bottom: 0.35rem;">
                    {{ boutique?.nom }}
                  </div>
                  <p style="margin:0;font-size:0.875rem;color:#475569;">{{ boutique?.adresse }}</p>
                  <p style="margin:0;font-size:0.875rem;color:#475569;">{{ boutique?.localite }}</p>
                  <p style="margin:0;font-size:0.875rem;color:#475569;">{{ boutique?.telephone }}</p>
                  <p style="margin:0;font-size:0.875rem;color:#475569;">{{ boutique?.email }}</p>
                </div>
                <div style="text-align:right;">
                  <div class="devis-ref-box">
                    <div class="ref-label">{{ devisApercu.typeDocument === 'facture' ? 'N° Facture' : 'N° Devis' }}</div>
                    <div class="ref-numero">{{ devisApercu.numero }}</div>
                    <div class="ref-date">{{ devisApercu.date }}</div>
                  </div>
                  <div style="margin-top:1rem;">
                    <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;margin-bottom:0.3rem;">Facturé à</div>
                    <div style="font-size:1rem;font-weight:700;color:#0f172a;">{{ devisApercu.client?.nom }}</div>
                    <div style="font-size:0.875rem;color:#475569;margin-top:0.2rem;">{{ devisApercu.client?.adresse }}</div>
                    <div style="font-size:0.875rem;color:#475569;">{{ devisApercu.client?.email }}</div>
                  </div>
                </div>
              </div>

              <table class="invoice-table" style="margin-top:1.5rem;">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th width="80" class="text-center">Qté</th>
                    <th width="140" class="text-right">Prix Unitaire</th>
                    <th width="140" class="text-right">Total CHF</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="art in devisApercu.articles" :key="art.description + art.prixUnitaire">
                    <td>{{ art.description }}</td>
                    <td class="text-center">{{ art.quantite }}</td>
                    <td class="text-right">{{ Number(art.prixUnitaire).toFixed(2) }}</td>
                    <td class="text-right bold-text">{{ (art.quantite * art.prixUnitaire).toFixed(2) }}</td>
                  </tr>
                </tbody>
              </table>

              <div class="apercu-footer">
                <div class="apercu-legal">
                  <div v-if="boutique?.conditions" class="legal-block">
                    <span class="legal-label">Conditions de l'offre</span>
                    <p class="legal-text">{{ boutique.conditions }}</p>
                  </div>
                  <div v-if="boutique?.iban" class="legal-line">
                    <span class="legal-label">IBAN :</span> {{ boutique.iban }}
                  </div>
                  <div v-if="boutique?.tvaNumero" class="legal-line">
                    <span class="legal-label">N° d'entreprise :</span> {{ boutique.tvaNumero }}
                  </div>
                </div>
                <div class="apercu-totals">
                  <span class="totals-label">Total HT</span>
                  <span class="totals-value">{{ htFromDevis(devisApercu).toFixed(2) }} CHF</span>
                  <span class="totals-label">TVA 8.1%</span>
                  <span class="totals-value">{{ tvaFromDevis(devisApercu).toFixed(2) }} CHF</span>
                  <span class="grand-total">Total TTC</span>
                  <span class="grand-total">{{ devisApercu.totalTTC.toFixed(2) }} CHF</span>
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
/* --- TABLE --- */
.empty-state { text-align: center; padding: 3.5rem 1rem; color: #94a3b8; }
.empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; opacity: 0.4; }
.empty-state p { margin: 0; font-size: 0.9rem; line-height: 1.6; }

.badge-number {
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  padding: 0.25rem 0.55rem;
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-weight: 700;
  color: #4f46e5;
  font-size: 0.8rem;
}
.date-cell { color: #94a3b8; font-size: 0.875rem; }
.client-name { font-weight: 600; color: #1e293b; }
.price-tag { font-weight: 600; color: #10b981 !important; font-family: ui-monospace, monospace; }

.actions-cell { display: flex; justify-content: center; gap: 0.3rem; align-items: center; }
.btn-icon {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  width: 30px; height: 30px;
  border-radius: 6px;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s;
  padding: 0;
}
.btn-icon:hover { background: #eef2ff; border-color: #a5b4fc; }
.btn-icon-danger:hover { background: #fef2f2; border-color: #fca5a5; color: #ef4444; }

.numero-cell { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }

.badge-statut {
  font-size: 0.63rem; font-weight: 700; padding: 0.15rem 0.55rem;
  border-radius: 20px; letter-spacing: 0.3px; white-space: nowrap;
}
.badge-brouillon { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
.badge-valide    { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
.badge-facture   { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }

.badge-number-facture { background: #fef3c7; border-color: #fde68a; color: #92400e; }

/* --- MODAL --- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.modal-container {
  background: #f1f5f9;
  border-radius: 16px;
  width: 100%;
  max-width: 860px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 60px rgba(15,23,42,0.3);
  overflow: hidden;
}
.modal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.25rem;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  gap: 1rem;
}
.modal-meta { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.modal-client-name { font-weight: 600; color: #1e293b; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.modal-date { color: #94a3b8; font-size: 0.82rem; white-space: nowrap; }
.modal-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
.btn-close {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  color: #64748b;
  width: 32px; height: 32px;
  border-radius: 8px;
  font-size: 0.8rem;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  margin-left: 0.25rem;
}
.btn-close:hover { background: #fef2f2; border-color: #fca5a5; color: #ef4444; }

.modal-body { overflow-y: auto; padding: 1.5rem; flex: 1; }

/* --- INVOICE DANS LE MODAL --- */
.devis-ref-box {
  display: inline-block;
  text-align: right;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.6rem 1rem;
}
.ref-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; font-weight: 700; }
.ref-numero { font-size: 1.1rem; font-weight: 800; color: #4f46e5; font-family: ui-monospace, monospace; margin: 0.15rem 0; }
.ref-date { font-size: 0.82rem; color: #64748b; }

.apercu-footer {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-top: 2.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid #f1f5f9;
  gap: 2rem;
}
.apercu-legal { max-width: 55%; font-size: 0.8rem; color: #64748b; line-height: 1.6; }
.legal-block { margin-bottom: 0.6rem; }
.legal-label { font-weight: 600; color: #334155; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.4px; }
.legal-text { margin: 0.15rem 0 0; font-style: italic; }
.legal-line { margin-bottom: 0.2rem; }

.apercu-totals {
  display: grid;
  grid-template-columns: 120px 150px;
  gap: 0.4rem;
  text-align: right;
  font-size: 0.9rem;
  flex-shrink: 0;
}
.totals-label { color: #64748b; display: flex; align-items: center; justify-content: flex-end; }
.totals-value { font-weight: 600; color: #1e293b; }
.grand-total {
  font-size: 1.05rem;
  font-weight: 800;
  color: #0f172a;
  border-top: 2px solid #0f172a;
  padding-top: 0.5rem;
  margin-top: 0.15rem;
}
</style>
