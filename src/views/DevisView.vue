<script setup>
import { ref, computed } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { writeBinaryFile } from '@tauri-apps/plugin-fs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const props = defineProps({
  config: Object,
  clients: Array,
  boutique: Object
})

const clientSelectionne = ref('')
const devisArticles = ref([
  { description: 'Fonte Cire Perdue (Or 18K)', quantite: 1, prixUnitaire: props.config.or18k * 5 + props.config.cirePerdue }
])

// Calculs financiers automatisés
const totalHT = computed(() => devisArticles.value.reduce((sum, art) => sum + (art.quantite * art.prixUnitaire), 0))
const tva = computed(() => totalHT.value * 0.081) // TVA Suisse 8.1%
const totalTTC = computed(() => totalHT.value + tva.value)

const ajouterLigneDevis = (desc = '', prix = 0) => {
  devisArticles.value.push({ description: desc, quantite: 1, prixUnitaire: prix })
}

const injecterConfigAuDevis = (type) => {
  if (type === 'cire') ajouterLigneDevis('Forfait Fonte Cire Perdue', props.config.cirePerdue)
  if (type === '3d') ajouterLigneDevis('Impression 3D Altmann (Résine)', props.config.impression3d)
}

const injecterDiamantAuDevis = (dia) => {
  ajouterLigneDevis(`Diamant brillant (${dia.taille})`, dia.prix)
}

const supprimerArticle = (index) => devisArticles.value.splice(index, 1)

// --- BOÎTE DE DIALOGUE INTERACTIVE ET EXPORT PDF ---
const exporterPDF = async () => {
  try {
    // 1. Déclenchement de la fenêtre système d'enregistrement
    const cheminFichier = await save({
      filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
      defaultPath: `Devis_Colayco_${clientSelectionne.value?.nom || 'Sans_Nom'}.pdf`
    })

    if (!cheminFichier) return // L'utilisateur a fermé la fenêtre de dialogue

    // 2. Capture photographique haute définition de la div du devis
    const element = document.getElementById('devis-imprimable')
    const canvas = await html2canvas(element, {
      scale: 2, // Double la densité de pixels pour un rendu vectoriel propre sur le papier
      useCORS: true
    })
    
    const imgData = canvas.toDataURL('image/jpeg', 1.0)
    const pdf = new jsPDF('p', 'mm', 'a4')
    const imgWidth = 210 // Format largeur A4 en mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight)
    
    // 3. Conversion brute et écriture sur le stockage local de l'ordinateur via Tauri
    const pdfOutput = pdf.output('arraybuffer')
    const uint8Array = new Uint8Array(pdfOutput)

    await writeBinaryFile(cheminFichier, uint8Array)
    alert(`Devis enregistré avec succès !\nEmplacement : ${cheminFichier}`)
  } catch (error) {
    console.error("Échec de l'export PDF :", error)
    alert("Erreur lors de la génération du fichier PDF.")
  }
}
</script>

<template>
  <div>
    <header class="header">
      <h2>Nouveau Devis</h2>
      <button @click="exporterPDF" class="btn-success no-print">📁 Exporter le PDF</button>
    </header>

    <!-- Zone de sélection client (masquée au rendu physique) -->
    <section class="card no-print">
      <h3>1. Sélectionner un Client</h3>
      <select v-model="clientSelectionne" class="select-client">
        <option value="">-- Choisir un client de la base --</option>
        <option v-for="c in clients" :key="c.id" :value="c">{{ c.nom }} ({{ c.adresse }})</option>
      </select>
    </section>

    <!-- Conteneur ciblé pour l'export -->
    <div id="devis-imprimable" class="print-container">
      
      <!-- En-tête de la facture avec Logo dynamique -->
      <div class="invoice-header">
        <div class="company-details">
          <img v-if="boutique.logo" :src="boutique.logo" alt="Logo" :style="{ height: boutique.logoTaille, marginBottom: '0.5rem', display: 'block' }" />
          <h3 v-else style="margin: 0 0 0.5rem 0;">{{ boutique.nom }}</h3>
          
          <p style="margin: 0; font-size: 0.9rem; color: #475569;">{{ boutique.adresse }}</p>
          <p style="margin: 0; font-size: 0.9rem; color: #475569;">{{ boutique.localite }}</p>
          <p style="margin: 0; font-size: 0.9rem; color: #475569;">{{ boutique.telephone }}</p>
          <p style="margin: 0; font-size: 0.9rem; color: #475569;">{{ boutique.email }}</p>
        </div>
        
        <div class="client-details" v-if="clientSelectionne" style="text-align: right;">
          <strong style="font-size: 0.9rem; text-transform: uppercase; color: #64748b;">Facturé à :</strong>
          <h4 style="margin: 0.3rem 0; font-size: 1.1rem; color: #0f172a;">{{ clientSelectionne.nom }}</h4>
          <p style="margin: 0; font-size: 0.9rem; color: #475569; white-space: pre-line;">{{ clientSelectionne.adresse }}</p>
          <p style="margin: 0; font-size: 0.9rem; color: #475569;">{{ clientSelectionne.email }}</p>
        </div>
      </div>

      <!-- Injection Rapide (Boutons masqués automatiquement sur le PDF) -->
      <div class="quick-actions no-print">
        <h4>⚡ Raccourcis Tarifs Configurés :</h4>
        <div class="btn-group">
          <button @click="injecterConfigAuDevis('cire')">＋ Cire Perdue ({{ config.cirePerdue }}.-)</button>
          <button @click="injecterConfigAuDevis('3d')">＋ Impression 3D Altmann ({{ config.impression3d }}.-)</button>
        </div>
        <h5 style="margin: 0.8rem 0 0.3rem 0;">Injecter Diamants :</h5>
        <div class="btn-group-diamonds">
          <button v-for="d in config.diamants" :key="d.taille" @click="injecterDiamantAuDevis(d)">
            {{ d.taille }} ({{ d.prix }}.-)
          </button>
        </div>
      </div>

      <!-- Tableau d'édition des lignes du devis -->
      <table class="invoice-table">
        <thead>
          <tr>
            <th>Description</th>
            <th width="80" class="text-center">Qté</th>
            <th width="140" class="text-right">Prix Unitaire</th>
            <th width="140" class="text-right">Total (CHF)</th>
            <th width="40" class="no-print"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(article, index) in devisArticles" :key="index">
            <td><input v-model="article.description" type="text" class="table-input" /></td>
            <td><input v-model.number="article.quantite" type="number" class="table-input text-center" /></td>
            <td><input v-model.number="article.prixUnitaire" type="number" step="0.01" class="table-input text-right" /></td>
            <td class="text-right bold-text" style="padding-right: 0.5rem;">{{ (article.quantite * article.prixUnitaire).toFixed(2) }}</td>
            <td class="no-print text-center"><button @click="supprimerArticle(index)" class="btn-danger-xs">✕</button></td>
          </tr>
        </tbody>
      </table>

      <button @click="ajouterLigneDevis('Nouvelle prestation...', 0)" class="btn-secondary no-print">＋ Ajouter une ligne personnalisée</button>

      <!-- Pied de Facture : Mentions Légales + Totaux Calculés -->
      <div class="invoice-footer-layout" style="display: flex; justify-content: space-between; margin-top: 4rem; align-items: flex-end;">
        
        <div class="invoice-legal-notes" style="max-width: 55%; font-size: 0.8rem; color: #475569; line-height: 1.5; padding-right: 1rem;">
          <div v-if="boutique.conditions" style="margin-bottom: 0.8rem;">
            <strong style="color: #1e293b;">Conditions de l'offre :</strong>
            <p style="margin: 0.1rem 0 0 0; font-style: italic;">{{ boutique.conditions }}</p>
          </div>
          <div v-if="boutique.iban"><strong>Coordonnées bancaires (IBAN) :</strong> {{ boutique.iban }}</div>
          <div v-if="boutique.tvaNumero" style="margin-top: 0.1rem;"><strong>Numéro d'entreprise :</strong> {{ boutique.tvaNumero }}</div>
        </div>

        <div class="totals-board" style="min-width: 260px;">
          <div>Total HT:</div><div class="bold-text">{{ totalHT.toFixed(2) }} CHF</div>
          <div>TVA (8.1%):</div><div class="bold-text">{{ tva.toFixed(2) }} CHF</div>
          <div class="grand-total">Total TTC:</div><div class="grand-total">{{ totalTTC.toFixed(2) }} CHF</div>
        </div>
      </div>

    </div>
  </div>
</template>