<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, mkdir } from '@tauri-apps/plugin-fs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const props = defineProps({
  config: Object,
  clients: Array,
  boutique: Object,
  devisListe: Array,
  prochainNumero: { type: Number, default: 1 }
})

const emit = defineEmits(['numero-utilise'])

// --- PARAMÈTRES DE SUIVI UNIQUE ---
const genererNumero = (n) => `DEV-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`
const numeroDevis = ref(genererNumero(props.prochainNumero))
const dateDevis = ref(new Date().toISOString().split('T')[0])

const clientSelectionne = ref('')
const devisArticles = ref([
  { description: 'Création artisanale sur-mesure', quantite: 1, prixUnitaire: 0 }
])

// Mode Aperçu "Coup d'œil"
const modeApercu = ref(false)

// Ajustements
const remise = ref({ active: false, mode: 'pourcent', valeur: 0 })
const arrondi = ref(false)
const acompte = ref({ montant: 0, date: '' })

// ── Auto-sauvegarde brouillon ─────────────────────────────
const dvReady = ref(false)          // évite de sauvegarder pendant le chargement
const sauvegardeTimer = ref(null)
const notifValidation = ref(false)  // toast non-bloquant après validation

const statutCourant = computed(() =>
  props.devisListe.find(d => d.numero === numeroDevis.value)?.statut ?? null
)

const construireObjetDevis = (statut) => ({
  numero: numeroDevis.value,
  date: dateDevis.value,
  client: clientSelectionne.value ? { ...clientSelectionne.value } : null,
  articles: JSON.parse(JSON.stringify(devisArticles.value)),
  remise: JSON.parse(JSON.stringify(remise.value)),
  arrondi: arrondi.value,
  acompte: JSON.parse(JSON.stringify(acompte.value)),
  totalTTC: totalFinal.value,
  statut
})

const sauvegardeAutomatique = () => {
  if (!dvReady.value) return
  clearTimeout(sauvegardeTimer.value)
  sauvegardeTimer.value = setTimeout(() => {
    const obj = construireObjetDevis('Brouillon')
    const idx = props.devisListe.findIndex(d => d.numero === numeroDevis.value)
    if (idx !== -1) {
      props.devisListe[idx] = obj
    } else {
      props.devisListe.push(obj)
      emit('numero-utilise')
    }
  }, 1500)
}

watch(
  [devisArticles, numeroDevis, dateDevis, clientSelectionne, remise, arrondi, acompte],
  sauvegardeAutomatique,
  { deep: true }
)

onMounted(() => setTimeout(() => { dvReady.value = true }, 400))
onUnmounted(() => clearTimeout(sauvegardeTimer.value))

// Calculs financiers automatisés
const totalHT = computed(() => devisArticles.value.reduce((sum, art) => sum + (art.quantite * art.prixUnitaire), 0))
const tvaTaux = computed(() => props.config.tvaTaux ?? 8.1)
const tvaIncluse = computed(() => (props.config.tvaMode ?? 'incluse') === 'incluse')
// Mode incluse : la TVA est extraite du total (totalHT = montant TTC saisi)
// Mode en sus  : la TVA s'ajoute au montant HT
const tva = computed(() =>
  tvaIncluse.value
    ? totalHT.value * tvaTaux.value / (100 + tvaTaux.value)
    : totalHT.value * tvaTaux.value / 100
)
const totalTTC = computed(() => tvaIncluse.value ? totalHT.value : totalHT.value + tva.value)

// Ajustements post-TVA
const montantRemise = computed(() => {
  if (!remise.value.active || !remise.value.valeur) return 0
  const v = remise.value.mode === 'pourcent'
    ? totalTTC.value * remise.value.valeur / 100
    : remise.value.valeur
  return Math.round(Math.min(v, totalTTC.value) * 100) / 100
})
const totalApresRemise = computed(() => Math.max(0, totalTTC.value - montantRemise.value))
const arrondiDiff = computed(() => {
  if (!arrondi.value) return 0
  return Math.round(totalApresRemise.value * 20) / 20 - totalApresRemise.value
})
const totalFinal = computed(() => Math.round((totalApresRemise.value + arrondiDiff.value) * 100) / 100)
const solde = computed(() => Math.max(0, totalFinal.value - (parseFloat(acompte.value.montant) || 0)))

// --- FONCTIONS ACTIONS DE L'ÉDITEUR ---
const ajouterLigneDevis = (desc = '', prix = 0) => {
  devisArticles.value.push({ description: desc, quantite: 1, prixUnitaire: prix })
}

const supprimerArticle = (index) => devisArticles.value.splice(index, 1)

const injecterConfigAuDevis = (type) => {
  if (type === 'cire') ajouterLigneDevis('Forfait Fonte Cire Perdue', props.config.cirePerdue)
  if (type === '3d') ajouterLigneDevis('Impression 3D Altmann (Résine)', props.config.impression3d)
}

const injecterMetalAuPoids = (metal) => {
  const perteMetal = props.config.perteMetal ?? 0
  const saisiePoids = prompt(`${metal.nom} — ${metal.prixGramme} CHF/g${perteMetal > 0 ? ` (+ ${perteMetal}% fripouille)` : ''}\nPoids net en grammes :`, '0.00')
  if (saisiePoids === null) return
  const poids = parseFloat(saisiePoids.replace(',', '.'))
  if (isNaN(poids) || poids <= 0) { alert('Valeur invalide.'); return }
  const facteur = 1 + perteMetal / 100
  const desc = perteMetal > 0
    ? `${metal.nom} (${poids.toFixed(2)} g + ${perteMetal}% perte à ${metal.prixGramme.toFixed(2)} CHF/g)`
    : `${metal.nom} (${poids.toFixed(2)} g × ${metal.prixGramme.toFixed(2)} CHF/g)`
  devisArticles.value.push({
    description: desc,
    quantite: 1,
    prixUnitaire: poids * metal.prixGramme * facteur
  })
}

const injecterMainOeuvre = () => {
  const tauxHoraire = props.config.tauxHoraire ?? 90
  const saisieHeures = prompt(`Main-d'œuvre — ${tauxHoraire} CHF/h\nNombre d'heures :`, '1.00')
  if (saisieHeures === null) return
  const heures = parseFloat(saisieHeures.replace(',', '.'))
  if (isNaN(heures) || heures <= 0) { alert('Valeur invalide.'); return }
  devisArticles.value.push({
    description: `Main d'œuvre : ${heures.toFixed(2)} h à ${tauxHoraire.toFixed(2)} CHF/h`,
    quantite: 1,
    prixUnitaire: heures * tauxHoraire
  })
}

const injecterDiamantAuDevis = (dia) => {
  const saisieQte = prompt(`Sertissage Diamant (${dia.taille})\nEntrez la quantité de pierres :`, "1")
  
  if (saisieQte === null) return 
  const qte = parseInt(saisieQte, 10)
  
  if (isNaN(qte) || qte <= 0) {
    alert("Veuillez entrer une quantité valide.")
    return
  }

  devisArticles.value.push({
    description: `${dia.nom || 'Diamant'} (${dia.taille})`,
    quantite: qte,
    prixUnitaire: dia.prix
  })
}

// --- VALIDATION MANUELLE ---
const validerDevis = () => {
  if (!clientSelectionne.value) {
    alert("Sélectionnez d'abord un client pour valider ce devis.")
    return
  }
  clearTimeout(sauvegardeTimer.value)
  const obj = construireObjetDevis('Validé')
  const idx = props.devisListe.findIndex(d => d.numero === numeroDevis.value)
  if (idx !== -1) {
    props.devisListe[idx] = obj
  } else {
    props.devisListe.push(obj)
    emit('numero-utilise')
  }
  notifValidation.value = true
  setTimeout(() => { notifValidation.value = false }, 3000)
}

// --- RÉINITIALISATION (RESET) ---
const réinitialiserEditeur = () => {
  if (confirm("Voulez-vous effacer la table de travail actuelle ?")) {
    dvReady.value = false
    clearTimeout(sauvegardeTimer.value)
    numeroDevis.value = genererNumero(props.prochainNumero)
    dateDevis.value = new Date().toISOString().split('T')[0]
    clientSelectionne.value = ''
    devisArticles.value = [{ description: 'Création artisanale sur-mesure', quantite: 1, prixUnitaire: 0 }]
    remise.value = { active: false, mode: 'pourcent', valeur: 0 }
    arrondi.value = false
    acompte.value = { montant: 0, date: '' }
    modeApercu.value = false
    setTimeout(() => { dvReady.value = true }, 400)
  }
}

const chargerDevisExistant = (devis) => {
  dvReady.value = false
  clearTimeout(sauvegardeTimer.value)
  numeroDevis.value = devis.numero
  dateDevis.value = devis.date
  devisArticles.value = JSON.parse(JSON.stringify(devis.articles))
  remise.value = devis.remise ? JSON.parse(JSON.stringify(devis.remise)) : { active: false, mode: 'pourcent', valeur: 0 }
  arrondi.value = devis.arrondi || false
  acompte.value = devis.acompte ? JSON.parse(JSON.stringify(devis.acompte)) : { montant: 0, date: '' }
  const clientTrouve = props.clients.find(c => c.id === devis.client?.id)
  clientSelectionne.value = clientTrouve || devis.client
  setTimeout(() => { dvReady.value = true }, 400)
}

defineExpose({ chargerDevisExistant })

// --- BOÎTE DE DIALOGUE INTERACTIVE ET EXPORT PDF ---
const sanitiserNom = (nom) => (nom || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'Client'

const exporterPDF = async () => {
  try {
    const dossierBase = props.config.dossierPDF
    const nomClient = sanitiserNom(clientSelectionne.value?.nom || 'Sans_Nom')
    const nomFichier = `${numeroDevis.value}_${nomClient}.pdf`

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
      if (!cheminFichier) return
    }

    const cacherRaccourcis = modeApercu.value
    modeApercu.value = true
    await new Promise(resolve => setTimeout(resolve, 100))

    const element = document.getElementById('devis-imprimable')
    const canvas = await html2canvas(element, { scale: 2, useCORS: true })
    const imgData = canvas.toDataURL('image/jpeg', 1.0)
    const pdf = new jsPDF('p', 'mm', 'a4')
    const imgWidth = 210
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight)

    await writeFile(cheminFichier, new Uint8Array(pdf.output('arraybuffer')))
    modeApercu.value = cacherRaccourcis
    alert(`PDF enregistré !\n${cheminFichier}`)
  } catch (error) {
    console.error("Échec de l'export PDF :", error)
    alert("Erreur lors de la génération du fichier PDF.")
  }
}
</script>

<template>
  <div :class="{ 'apercu-on': modeApercu }">
    <!-- Toast validation -->
    <Transition name="toast">
      <div v-if="notifValidation" class="toast-valide">✓ Devis validé et enregistré !</div>
    </Transition>

    <header class="header no-print">
      <div>
        <h2>Éditeur de Devis</h2>
        <div style="display:flex;align-items:center;gap:0.6rem;margin-top:0.2rem;">
          <p class="subtitle" style="margin:0;">Créez et exportez un devis professionnel au format PDF.</p>
          <span v-if="statutCourant === 'Validé'" class="statut-pill statut-valide">✓ Validé</span>
          <span v-else-if="statutCourant === 'Brouillon'" class="statut-pill statut-brouillon">● Brouillon</span>
          <span v-else class="statut-pill statut-nouveau">◎ Nouveau</span>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <button @click="réinitialiserEditeur" class="btn-secondary" style="margin-top: 0;">✨ Nouveau</button>
        <button @click="modeApercu = !modeApercu" class="btn-secondary" :class="{ 'btn-active-toggle': modeApercu }" style="margin-top: 0;">
          {{ modeApercu ? '🖋️ Mode Édition' : '👁️ Coup d\'œil PDF' }}
        </button>
        <button @click="validerDevis" class="btn-valider">✓ Valider le Devis</button>
        <button @click="exporterPDF" class="btn-success">📁 Exporter PDF</button>
      </div>
    </header>

    <section class="card no-print" v-if="!modeApercu">
      <h3>Paramètres & Client</h3>
      <div class="client-meta-grid" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
        <div>
          <label style="font-size: 0.85rem; font-weight: 600; color: #475569; display: block; margin-bottom: 0.2rem;">N° de Devis :</label>
          <input v-model="numeroDevis" type="text" />
        </div>
        <div>
          <label style="font-size: 0.85rem; font-weight: 600; color: #475569; display: block; margin-bottom: 0.2rem;">Date d'Émission :</label>
          <input v-model="dateDevis" type="date" />
        </div>
        <div>
          <label style="font-size: 0.85rem; font-weight: 600; color: #475569; display: block; margin-bottom: 0.2rem;">Client Destinataire :</label>
          <select v-model="clientSelectionne" class="select-client" style="padding: 0.53rem;">
            <option value="">— Sélectionner un client —</option>
            <option v-for="c in clients" :key="c.id" :value="c">{{ c.nom }}</option>
          </select>
        </div>
      </div>
    </section>

    <button v-if="modeApercu" @click="modeApercu = false" class="btn-floating-quit no-print">
      🖋️ Quitter le Coup d'œil (Mode Édition)
    </button>

    <div id="devis-imprimable" class="print-container">
      
      <div class="invoice-meta-row" style="display: flex; justify-content: space-between; font-size: 0.9rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.8rem; margin-bottom: 1.5rem;">
        <div><strong>{{ numeroDevis }}</strong></div>
        <div>Date : {{ dateDevis }}</div>
      </div>
      
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

      <div class="quick-actions no-print" v-if="!modeApercu">
        <h4>Raccourcis Tarifs</h4>
        
        <div class="quick-section">
          <span class="quick-label">Atelier :</span>
          <div class="btn-group">
            <button @click="injecterConfigAuDevis('cire')">＋ Cire Perdue ({{ config.cirePerdue }}.-)</button>
            <button @click="injecterConfigAuDevis('3d')">＋ Impression 3D Altmann ({{ config.impression3d }}.-)</button>
            <button @click="injecterMainOeuvre">🛠️ Main-d'œuvre ({{ config.tauxHoraire }} CHF/h)</button>
          </div>
        </div>

        <div class="quick-section" style="margin-top: 0.6rem;">
          <span class="quick-label">Matières au poids (clic → saisie grammes)</span>
          <div class="btn-group">
            <button v-for="m in config.metaux" :key="m.id" @click="injecterMetalAuPoids(m)">
              ⚖️ {{ m.nom }} · {{ m.prixGramme }} CHF/g
            </button>
          </div>
        </div>

        <div class="quick-section" style="margin-top: 0.6rem;">
          <span class="quick-label">Pierres (clic → quantité) :</span>
          <div class="btn-group-diamonds">
            <button v-for="d in config.diamants" :key="d.id" @click="injecterDiamantAuDevis(d)">
              {{ d.nom }} {{ d.taille }}
            </button>
          </div>
        </div>
      </div>

      <table class="invoice-table">
        <thead>
          <tr>
            <th>Description</th>
            <th width="80" class="text-center">Qté</th>
            <th width="140" class="text-right">Prix Unitaire</th>
            <th width="140" class="text-right">Total (CHF)</th>
            <th width="40" class="no-print" v-if="!modeApercu"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(article, index) in devisArticles" :key="index">
            <td>
              <input v-model="article.description" type="text" class="table-input" :disabled="modeApercu" />
            </td>
            <td>
              <input v-model.number="article.quantite" type="number" class="table-input text-center" :disabled="modeApercu" />
            </td>
            <td>
              <input v-model.number="article.prixUnitaire" type="number" step="0.01" class="table-input text-right" :disabled="modeApercu" />
            </td>
            <td class="text-right bold-text" style="padding-right: 0.5rem; color: #0f172a;">{{ (article.quantite * article.prixUnitaire).toFixed(2) }}</td>
            <td class="no-print text-center" v-if="!modeApercu">
              <button @click="supprimerArticle(index)" class="btn-danger-xs">✕</button>
            </td>
          </tr>
        </tbody>
      </table>

      <button @click="ajouterLigneDevis('Nouvelle prestation...', 0)" class="btn-secondary no-print" v-if="!modeApercu">＋ Ajouter une ligne</button>

      <!-- ── Ajustements (no-print) ──────────────────── -->
      <div class="adjustments-panel no-print" v-if="!modeApercu">
        <span class="adj-title">Ajustements</span>
        <div class="adj-row">
          <label class="adj-toggle">
            <input type="checkbox" v-model="remise.active" />
            <span>Remise</span>
          </label>
          <template v-if="remise.active">
            <div class="adj-mode-toggle">
              <button :class="['adj-mode-btn', remise.mode === 'pourcent' ? 'active' : '']" @click="remise.mode = 'pourcent'">%</button>
              <button :class="['adj-mode-btn', remise.mode === 'fixe' ? 'active' : '']" @click="remise.mode = 'fixe'">CHF</button>
            </div>
            <input v-model.number="remise.valeur" type="number" step="0.5" min="0" class="adj-input" :placeholder="remise.mode === 'pourcent' ? 'ex: 10' : 'ex: 50'" />
            <span class="adj-unit">{{ remise.mode === 'pourcent' ? '%' : 'CHF' }}</span>
            <span class="adj-preview" v-if="remise.valeur > 0">= −{{ montantRemise.toFixed(2) }} CHF</span>
          </template>
        </div>
        <div class="adj-row">
          <label class="adj-toggle">
            <input type="checkbox" v-model="arrondi" />
            <span>Arrondi 0.05 CHF</span>
          </label>
          <span class="adj-preview" v-if="arrondi && arrondiDiff !== 0">{{ arrondiDiff > 0 ? '+' : '' }}{{ arrondiDiff.toFixed(2) }} CHF</span>
        </div>
        <div class="adj-row">
          <label class="adj-toggle">
            <input type="checkbox" :checked="acompte.montant > 0" @change="e => { if (!e.target.checked) { acompte.montant = 0; acompte.date = '' } }" />
            <span>Acompte reçu</span>
          </label>
          <template v-if="acompte.montant > 0 || acompte.date">
            <input v-model.number="acompte.montant" type="number" step="10" min="0" class="adj-input" placeholder="Montant CHF" />
            <span class="adj-unit">CHF le</span>
            <input v-model="acompte.date" type="date" class="adj-input adj-input--date" />
          </template>
          <button v-else class="adj-add-btn" @click="acompte.montant = 1; acompte.date = new Date().toISOString().split('T')[0]">＋ Saisir</button>
        </div>
      </div>

      <div class="invoice-footer">
        <div class="invoice-legal">
          <div v-if="boutique.conditions" class="legal-block">
            <span class="legal-label">Conditions de l'offre</span>
            <p class="legal-text">{{ boutique.conditions }}</p>
          </div>
          <div v-if="boutique.iban" class="legal-line">
            <span class="legal-label">IBAN :</span> {{ boutique.iban }}
          </div>
          <div v-if="boutique.tvaNumero" class="legal-line">
            <span class="legal-label">N° d'entreprise :</span> {{ boutique.tvaNumero }}
          </div>
        </div>

        <div class="totals-board">
          <!-- Base TVA -->
          <template v-if="tvaIncluse">
            <span class="totals-label">dont TVA {{ tvaTaux }}% incluse</span>
            <span class="totals-value">{{ tva.toFixed(2) }} CHF</span>
          </template>
          <template v-else>
            <span class="totals-label">Total HT</span>
            <span class="totals-value">{{ totalHT.toFixed(2) }} CHF</span>
            <span class="totals-label">TVA {{ tvaTaux }}%</span>
            <span class="totals-value">{{ tva.toFixed(2) }} CHF</span>
          </template>

          <!-- Remise -->
          <template v-if="remise.active && montantRemise > 0">
            <span class="totals-label totals-discount">
              Remise {{ remise.mode === 'pourcent' ? remise.valeur + '%' : '' }}
            </span>
            <span class="totals-value totals-discount">−{{ montantRemise.toFixed(2) }} CHF</span>
          </template>

          <!-- Arrondi -->
          <template v-if="arrondi && arrondiDiff !== 0">
            <span class="totals-label">Arrondi</span>
            <span class="totals-value">{{ arrondiDiff > 0 ? '+' : '' }}{{ arrondiDiff.toFixed(2) }} CHF</span>
          </template>

          <!-- Total final -->
          <span class="grand-total">{{ tvaIncluse ? 'Total (TVA ' + tvaTaux + '% incluse)' : 'Total TTC' }}</span>
          <span class="grand-total">{{ totalFinal.toFixed(2) }} CHF</span>

          <!-- Acompte + Solde -->
          <template v-if="acompte.montant > 0">
            <span class="totals-label totals-discount">
              Acompte reçu{{ acompte.date ? ' le ' + new Date(acompte.date).toLocaleDateString('fr-CH') : '' }}
            </span>
            <span class="totals-value totals-discount">−{{ parseFloat(acompte.montant).toFixed(2) }} CHF</span>
            <span class="grand-total grand-total--solde">Solde dû</span>
            <span class="grand-total grand-total--solde">{{ solde.toFixed(2) }} CHF</span>
          </template>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.btn-blue { background: #3b82f6; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; font-weight: 600; cursor: pointer; }
.btn-blue:hover { background: #2563eb; }
.btn-active-toggle { background: #e0e7ff !important; color: #4338ca !important; border-color: #6366f1 !important; }

/* ── Valider + statut ─────────────────────── */
.btn-valider {
  background: #16a34a; color: #fff; border: none;
  padding: 0.6rem 1.2rem; border-radius: 6px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.btn-valider:hover { background: #15803d; }

.statut-pill {
  font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.6rem;
  border-radius: 20px; letter-spacing: 0.4px; white-space: nowrap;
}
.statut-brouillon { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
.statut-valide    { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
.statut-nouveau   { background: #f8fafc; color: #94a3b8; border: 1px solid #e2e8f0; }

/* ── Toast ───────────────────────────────── */
.toast-valide {
  position: fixed; top: 1.2rem; right: 1.5rem; z-index: 9999;
  background: #166534; color: #fff;
  padding: 0.7rem 1.4rem; border-radius: 10px;
  font-weight: 600; font-size: 0.9rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  pointer-events: none;
}
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from { opacity: 0; transform: translateY(-12px); }
.toast-leave-to   { opacity: 0; transform: translateY(-12px); }

.quick-section { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.75rem; }
.quick-section:last-child { margin-bottom: 0; }
.quick-label { font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; }

/* ── Adjustments panel ─────────────────────── */
.adjustments-panel {
  margin: 0.75rem 0;
  background: #fafafa;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.adj-title {
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.7px; color: #9ca3af; margin-bottom: 0.1rem;
}
.adj-row {
  display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
}
.adj-toggle {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.85rem; font-weight: 600; color: #374151; cursor: pointer;
  min-width: 130px;
}
.adj-toggle input[type="checkbox"] { cursor: pointer; }
.adj-mode-toggle { display: flex; gap: 0; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; }
.adj-mode-btn {
  padding: 0.25rem 0.6rem; font-size: 0.78rem; font-weight: 600;
  border: none; background: #fff; color: #6b7280; cursor: pointer;
}
.adj-mode-btn.active { background: #166534; color: #fff; }
.adj-input {
  width: 90px; padding: 0.3rem 0.5rem; border: 1px solid #d1d5db;
  border-radius: 6px; font-size: 0.85rem; text-align: right;
}
.adj-input--date { width: 140px; text-align: left; }
.adj-unit { font-size: 0.78rem; font-weight: 700; color: #9ca3af; }
.adj-preview { font-size: 0.82rem; font-weight: 700; color: #dc2626; }
.adj-add-btn {
  font-size: 0.78rem; padding: 0.25rem 0.65rem; border: 1px dashed #d1d5db;
  border-radius: 6px; background: #fff; color: #6b7280; cursor: pointer;
}
.adj-add-btn:hover { border-color: #16a34a; color: #16a34a; }

/* ── Totals adjustments ─────────────────────── */
.totals-discount { color: #dc2626 !important; }
.grand-total--solde { color: #1d4ed8 !important; border-top: 2px solid #bfdbfe !important; }

.btn-floating-quit {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: #0f172a;
  color: white;
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: 0 10px 25px rgba(0,0,0,0.15);
  padding: 0.75rem 1.25rem;
  font-weight: 600;
  z-index: 999;
}
.btn-floating-quit:hover { background: #1e293b; }

/* --- COMPORTEMENT SPECIAL COUP D'ŒIL --- */
.apercu-on .table-input {
  border: none !important;
  background: transparent !important;
  pointer-events: none;
  color: #0f172a !important;
}

.invoice-footer {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid #f1f5f9;
  gap: 2rem;
}
.invoice-legal { max-width: 55%; font-size: 0.8rem; color: #64748b; line-height: 1.6; }
.legal-block { margin-bottom: 0.75rem; }
.legal-label { font-weight: 600; color: #334155; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.4px; }
.legal-text { margin: 0.2rem 0 0; font-style: italic; color: #64748b; }
.legal-line { margin-bottom: 0.2rem; }
.legal-line .legal-label { font-style: normal; }

.totals-board { display: grid; grid-template-columns: 120px 155px; gap: 0.4rem; text-align: right; font-size: 0.9rem; flex-shrink: 0; }
.totals-label { color: #64748b; display: flex; align-items: center; justify-content: flex-end; }
.totals-value { font-weight: 600; color: #1e293b; }
.grand-total {
  font-size: 1.05rem;
  font-weight: 800;
  color: #0f172a;
  border-top: 2px solid #0f172a;
  padding-top: 0.5rem;
  margin-top: 0.2rem;
}
</style>