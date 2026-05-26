<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, mkdir } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import QRCode from 'qrcode'

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

// Type de document et QR paiement
const typeDocument = ref('devis') // 'devis' | 'facture'
const qrDataUrl = ref('')
const afficherQR = ref(false)

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
  statut,
  typeDocument: typeDocument.value
})

const sauvegardeAutomatique = () => {
  if (!dvReady.value) return
  clearTimeout(sauvegardeTimer.value)
  sauvegardeTimer.value = setTimeout(() => {
    const statutAuto = typeDocument.value === 'facture' ? 'Facture' : 'Brouillon'
    const obj = construireObjetDevis(statutAuto)
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
    typeDocument.value = 'devis'
    qrDataUrl.value = ''
    afficherQR.value = false
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
  typeDocument.value = devis.typeDocument || 'devis'
  qrDataUrl.value = ''
  afficherQR.value = false
  setTimeout(() => { dvReady.value = true }, 400)
}

// --- CONVERSION EN FACTURE ---
const convertirEnFacture = () => {
  if (!clientSelectionne.value) {
    alert("Sélectionnez d'abord un client avant de convertir en facture.")
    return
  }
  if (!confirm(`Convertir ce devis en facture ?\nLe numéro passera de ${numeroDevis.value} à ${numeroDevis.value.replace(/^DEV-/, 'FAC-')}.`)) return

  const ancienNumero = numeroDevis.value
  const nouveauNumero = ancienNumero.replace(/^DEV-/, 'FAC-')

  typeDocument.value = 'facture'
  numeroDevis.value = nouveauNumero

  const idxAncien = props.devisListe.findIndex(d => d.numero === ancienNumero)
  const nouvelObj = construireObjetDevis('Facture')
  if (idxAncien !== -1) {
    props.devisListe.splice(idxAncien, 1, nouvelObj)
  } else {
    props.devisListe.push(nouvelObj)
    emit('numero-utilise')
  }
  notifValidation.value = true
  setTimeout(() => { notifValidation.value = false }, 3000)
}

// --- QR PAIEMENT SUISSE (format SPC) ---
const genererContenuQR = () => {
  const iban = (props.boutique.iban || '').replace(/\s/g, '')
  const montantDu = acompte.value.montant > 0 ? solde.value : totalFinal.value
  const lignes = [
    'SPC', '0200', '1',
    iban,
    'K',
    props.boutique.nom || '',
    props.boutique.adresse || '',
    props.boutique.localite || '',
    '', '', 'CH',
    '', '', '', '', '', '', '',   // Ultimate creditor (7 champs vides)
    montantDu.toFixed(2),
    'CHF',
    '', '', '', '', '', '', '',   // Debtor (7 champs vides)
    'NON', '',
    `Facture ${numeroDevis.value}`,
    'EPD', ''
  ]
  return lignes.join('\n')
}

const genererQR = async () => {
  const contenu = genererContenuQR()
  const size = 166

  // Générer QR de base
  const qrBase = await QRCode.toDataURL(contenu, {
    errorCorrectionLevel: 'M',
    width: size,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' }
  })

  // Superposer la croix suisse rouge au centre
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const img = new Image()
  img.src = qrBase
  await new Promise(resolve => { img.onload = resolve })
  ctx.drawImage(img, 0, 0, size, size)

  const outer = size * 0.148
  const cx = (size - outer) / 2
  const cy = (size - outer) / 2
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(cx, cy, outer, outer)
  ctx.fillStyle = '#000000'
  const long = outer * 0.72, short = outer * 0.29
  const mx = cx + outer / 2, my = cy + outer / 2
  ctx.fillRect(mx - short / 2, my - long / 2, short, long)
  ctx.fillRect(mx - long / 2, my - short / 2, long, short)

  qrDataUrl.value = canvas.toDataURL('image/png')
}

const toggleQR = async () => {
  afficherQR.value = !afficherQR.value
  if (afficherQR.value && !qrDataUrl.value) await genererQR()
}

// Régénérer le QR si le montant change et que le QR est affiché
watch([totalFinal, solde], async () => {
  if (afficherQR.value) {
    qrDataUrl.value = ''
    await genererQR()
  }
})

defineExpose({ chargerDevisExistant })

// --- BOÎTE DE DIALOGUE INTERACTIVE ET EXPORT PDF ---
const sanitiserNom = (nom) => (nom || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'Client'

const pdfEnCours = ref(false)

// Capture un élément DOM et retourne un canvas exactement A4 (ou N pages A4)
const capturerA4 = async (el, scale = 3) => {
  // Largeur A4 à 96 dpi = 794px ; on force cette largeur pour l'échantillonnage
  const A4_W_PX = 794
  const A4_H_PX = Math.round(A4_W_PX * 297 / 210) // ≈ 1123px

  const raw = await html2canvas(el, {
    scale,
    width: A4_W_PX,           // viewport de rendu = 210mm à 96dpi
    windowWidth: A4_W_PX,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false
  })

  // Hauteur d'une page A4 dans l'espace du canvas capturé
  const pageH = Math.round(raw.width * 297 / 210)
  const nbPages = Math.ceil(raw.height / pageH)
  const pages = []

  for (let p = 0; p < nbPages; p++) {
    const c = document.createElement('canvas')
    c.width = raw.width
    c.height = pageH                        // exactement une page A4
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    const srcY = p * pageH
    const srcH = Math.min(pageH, raw.height - srcY)
    ctx.drawImage(raw, 0, srcY, raw.width, srcH, 0, 0, raw.width, srcH)
    pages.push(c)
  }
  return pages
}

const exporterPDF = async () => {
  if (pdfEnCours.value) return
  pdfEnCours.value = true
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
      if (!cheminFichier) { pdfEnCours.value = false; return }
    }

    const ancienApercu = modeApercu.value
    modeApercu.value = true
    await nextTick()
    await new Promise(r => setTimeout(r, 200))

    const pdf = new jsPDF('p', 'mm', 'a4')
    let premierePage = true

    // ── Pages document ──────────────────────────────
    const el1 = document.getElementById('devis-imprimable')
    const pages1 = await capturerA4(el1)
    for (const page of pages1) {
      if (!premierePage) pdf.addPage()
      premierePage = false
      pdf.addImage(page.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297)
    }

    // ── Bulletin QR page 2 (factures uniquement) ────
    if (typeDocument.value === 'facture') {
      if (!qrDataUrl.value) await genererQR()
      await nextTick()
      await new Promise(r => setTimeout(r, 100))
      const el2 = document.getElementById('qr-page')
      if (el2) {
        const pages2 = await capturerA4(el2)
        for (const page of pages2) {
          pdf.addPage()
          pdf.addImage(page.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297)
        }
      }
    }

    await writeFile(cheminFichier, new Uint8Array(pdf.output('arraybuffer')))
    modeApercu.value = ancienApercu

    // Ouvrir le fichier dans le lecteur PDF par défaut
    await invoke('ouvrir_fichier', { chemin: cheminFichier })
  } catch (error) {
    console.error("Échec de l'export PDF :", error)
    alert("Erreur lors de la génération du fichier PDF.")
  } finally {
    pdfEnCours.value = false
  }
}
</script>

<template>
  <div :class="{ 'apercu-on': modeApercu }" class="editor-root">

    <!-- ── Toast ────────────────────────────────────── -->
    <Transition name="toast">
      <div v-if="notifValidation" class="toast-valide">
        {{ typeDocument === 'facture' ? '✦ Converti en facture' : '✓ Devis validé' }}
      </div>
    </Transition>

    <!-- ── En-tête minimal ──────────────────────────── -->
    <header class="header no-print">
      <div class="header-title-block">
        <h2>{{ typeDocument === 'facture' ? 'Facture' : 'Éditeur de Devis' }}</h2>
        <p class="subtitle" style="margin:0 0 0 0.5rem;">
          <span v-if="statutCourant === 'Facture'" class="statut-pill statut-facture">✦ Facture</span>
          <span v-else-if="statutCourant === 'Validé'" class="statut-pill statut-valide">✓ Validé</span>
          <span v-else-if="statutCourant === 'Brouillon'" class="statut-pill statut-brouillon">● Brouillon</span>
          <span v-else class="statut-pill statut-nouveau">◎ Nouveau</span>
        </p>
      </div>
      <div class="header-actions">
        <button @click="réinitialiserEditeur" class="btn-ghost">+ Nouveau document</button>
        <button @click="modeApercu = !modeApercu" class="btn-ghost" :class="{ 'btn-ghost-active': modeApercu }">
          {{ modeApercu ? 'Fermer aperçu' : 'Aperçu PDF' }}
        </button>
      </div>
    </header>

    <!-- ── Panneau de saisie ─────────────────────────── -->
    <section class="editor-panel no-print" v-if="!modeApercu">
      <div class="editor-fields">
        <div class="field-group">
          <label class="field-label">N° Document</label>
          <input v-model="numeroDevis" type="text" />
        </div>
        <div class="field-group">
          <label class="field-label">Date d'émission</label>
          <input v-model="dateDevis" type="date" />
        </div>
        <div class="field-group">
          <label class="field-label">Client destinataire</label>
          <select v-model="clientSelectionne" class="select-client">
            <option value="">— Sélectionner un client —</option>
            <option v-for="c in clients" :key="c.id" :value="c">{{ c.nom }}</option>
          </select>
        </div>
      </div>
    </section>

    <!-- ── Bouton quitter aperçu (flottant) ─────────── -->
    <button v-if="modeApercu" @click="modeApercu = false" class="btn-floating-quit no-print">
      ← Retour édition
    </button>

    <!-- ══════════════════════════════════════════════════
         DOCUMENT IMPRIMABLE — Page 1
    ══════════════════════════════════════════════════ -->
    <div id="devis-imprimable" class="pdoc">

      <!-- Bloc haut : expéditeur gauche + destinataire droit -->
      <div class="pdoc-top">
        <div class="pdoc-sender">
          <img v-if="boutique.logo" :src="boutique.logo" alt="Logo" class="pdoc-logo" />
          <div class="pdoc-sender-name" v-if="boutique.logo">{{ boutique.nom }}</div>
          <div class="pdoc-sender-name" v-else>{{ boutique.nom }}</div>
          <div class="pdoc-sender-addr">{{ boutique.adresse }}</div>
          <div class="pdoc-sender-addr">{{ boutique.localite }}</div>
        </div>
        <div class="pdoc-recipient" v-if="clientSelectionne">
          <div class="pdoc-recipient-name">{{ clientSelectionne.nom }}</div>
          <div class="pdoc-recipient-addr" v-if="clientSelectionne.adresse">{{ clientSelectionne.adresse }}</div>
          <div class="pdoc-recipient-addr" v-if="clientSelectionne.telephone">{{ clientSelectionne.telephone }}</div>
          <div class="pdoc-recipient-addr" v-if="clientSelectionne.email">{{ clientSelectionne.email }}</div>
        </div>
      </div>

      <!-- Titre du document -->
      <div class="pdoc-doc-title">
        <span class="pdoc-doc-type-word">{{ typeDocument === 'facture' ? 'facture' : 'devis' }}</span>
        <span class="pdoc-doc-num">{{ numeroDevis }}</span>
      </div>
      <div class="pdoc-sep"></div>
      <div class="pdoc-meta-row">
        <span class="pdoc-meta-key">date :</span>
        <span class="pdoc-meta-val">{{ new Date(dateDevis + 'T12:00:00').toLocaleDateString('fr-CH') }}</span>
      </div>
      <div class="pdoc-sep pdoc-sep-bold"></div>

      <!-- Raccourcis tarifs (éditeur uniquement) -->
      <div class="quick-actions no-print" v-if="!modeApercu">
        <div class="quick-section">
          <span class="quick-label">Atelier</span>
          <div class="btn-group">
            <button @click="injecterConfigAuDevis('cire')">+ Cire Perdue ({{ config.cirePerdue }}.-)</button>
            <button @click="injecterConfigAuDevis('3d')">+ Impression 3D ({{ config.impression3d }}.-)</button>
            <button @click="injecterMainOeuvre">Travail à l'établi ({{ config.tauxHoraire }} /h)</button>
          </div>
        </div>
        <div class="quick-section">
          <span class="quick-label">Matières au poids</span>
          <div class="btn-group">
            <button v-for="m in config.metaux" :key="m.id" @click="injecterMetalAuPoids(m)">
              {{ m.nom }} · {{ m.prixGramme }}/g
            </button>
          </div>
        </div>
        <div class="quick-section">
          <span class="quick-label">Pierres</span>
          <div class="btn-group-diamonds">
            <button v-for="d in config.diamants" :key="d.id" @click="injecterDiamantAuDevis(d)">
              {{ d.nom }} {{ d.taille }}
            </button>
          </div>
        </div>
      </div>

      <!-- Tableau des articles -->
      <table class="pdoc-table">
        <thead>
          <tr>
            <th class="th-pos">pos.</th>
            <th>description</th>
            <th class="text-right" width="72">quantité</th>
            <th class="text-right" width="120">prix de la pièce</th>
            <th class="text-right" width="110">prix net CHF</th>
            <th class="no-print" width="34" v-if="!modeApercu"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(article, index) in devisArticles" :key="index">
            <td class="td-pos">{{ index + 1 }}</td>
            <td><input v-model="article.description" type="text" class="table-input" :disabled="modeApercu" /></td>
            <td class="text-right"><input v-model.number="article.quantite" type="number" class="table-input text-right" :disabled="modeApercu" /></td>
            <td class="text-right"><input v-model.number="article.prixUnitaire" type="number" step="0.01" class="table-input text-right" :disabled="modeApercu" /></td>
            <td class="text-right pdoc-amount">{{ (article.quantite * article.prixUnitaire).toFixed(2) }}</td>
            <td class="no-print text-center" v-if="!modeApercu">
              <button @click="supprimerArticle(index)" class="btn-danger-xs">✕</button>
            </td>
          </tr>
        </tbody>
      </table>

      <button @click="ajouterLigneDevis('Nouvelle prestation...', 0)" class="btn-add-line no-print" v-if="!modeApercu">
        + Ajouter une ligne
      </button>

      <!-- Ajustements (éditeur uniquement) -->
      <div class="adjustments-panel no-print" v-if="!modeApercu">
        <span class="adj-title">Ajustements</span>
        <div class="adj-row">
          <label class="adj-toggle"><input type="checkbox" v-model="remise.active" /><span>Remise</span></label>
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
          <label class="adj-toggle"><input type="checkbox" v-model="arrondi" /><span>Arrondi 0.05 CHF</span></label>
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
          <button v-else class="adj-add-btn" @click="acompte.montant = 1; acompte.date = new Date().toISOString().split('T')[0]">+ Saisir</button>
        </div>
      </div>

      <!-- Ligne de total principale -->
      <div class="pdoc-total-line">
        <span class="pdoc-total-label">
          {{ typeDocument === 'facture' ? 'montant de la facture' : 'montant du devis' }}
          {{ tvaIncluse ? '(TVA ' + tvaTaux + '% incluse)' : 'HT' }}
        </span>
        <span class="pdoc-total-amount">{{ totalFinal.toFixed(2) }}</span>
      </div>

      <!-- Détail TVA + ajustements -->
      <div class="pdoc-subtotals">
        <template v-if="tvaIncluse">
          <div class="pdoc-subrow">
            <span>dont TVA {{ tvaTaux }}%</span>
            <span>{{ tva.toFixed(2) }} CHF</span>
          </div>
        </template>
        <template v-else>
          <div class="pdoc-subrow">
            <span>Total HT</span><span>{{ totalHT.toFixed(2) }} CHF</span>
          </div>
          <div class="pdoc-subrow">
            <span>TVA {{ tvaTaux }}%</span><span>{{ tva.toFixed(2) }} CHF</span>
          </div>
        </template>
        <template v-if="remise.active && montantRemise > 0">
          <div class="pdoc-subrow pdoc-subrow-minus">
            <span>Remise {{ remise.mode === 'pourcent' ? remise.valeur + '%' : '' }}</span>
            <span>−{{ montantRemise.toFixed(2) }} CHF</span>
          </div>
        </template>
        <template v-if="arrondi && arrondiDiff !== 0">
          <div class="pdoc-subrow">
            <span>Arrondi</span><span>{{ arrondiDiff > 0 ? '+' : '' }}{{ arrondiDiff.toFixed(2) }} CHF</span>
          </div>
        </template>
        <template v-if="acompte.montant > 0">
          <div class="pdoc-subrow pdoc-subrow-minus">
            <span>Acompte reçu{{ acompte.date ? ' le ' + new Date(acompte.date + 'T12:00:00').toLocaleDateString('fr-CH') : '' }}</span>
            <span>−{{ parseFloat(acompte.montant).toFixed(2) }} CHF</span>
          </div>
          <div class="pdoc-subrow pdoc-subrow-solde">
            <span>Solde dû</span><span>{{ solde.toFixed(2) }} CHF</span>
          </div>
        </template>
      </div>

      <!-- Message et signature -->
      <div class="pdoc-message" v-if="boutique.conditions">
        <p>{{ boutique.conditions }}</p>
        <div class="pdoc-sign">
          <p>Cordialement,</p>
          <p class="pdoc-sign-name">{{ boutique.nom }}</p>
        </div>
      </div>

      <!-- Barre info bas de page -->
      <div class="pdoc-info-bar">
        <span>{{ boutique.nom }}</span>
        <span v-if="boutique.adresse">{{ boutique.adresse }}, {{ boutique.localite }}</span>
        <span v-if="boutique.iban">IBAN : {{ boutique.iban }}</span>
        <span v-if="boutique.tvaNumero">{{ boutique.tvaNumero }}</span>
      </div>

    </div><!-- #devis-imprimable -->

    <!-- ══════════════════════════════════════════════════
         QR PAGE — Page 2 (hors-écran, capturé PDF)
         Format A4 : QR slip en bas, espace blanc au-dessus
    ══════════════════════════════════════════════════ -->
    <div v-if="typeDocument === 'facture' && qrDataUrl" id="qr-page" class="qr-page-offscreen">
      <!-- Espace blanc = reste de la page A4 -->
      <div class="qr-page-spacer"></div>

      <!-- Ligne de découpe -->
      <div class="qr-scissors-row">
        <span class="qr-scissors-icon">✂</span>
        <div class="qr-scissors-line"></div>
      </div>

      <!-- Bulletin QR standard suisse (106mm de haut) -->
      <div class="qr-bill">

        <!-- Récépissé gauche (62mm) -->
        <div class="qr-bill-receipt">
          <div class="qr-bill-head">Récépissé</div>
          <div class="qr-f">
            <div class="qr-fl">Compte / Payable à</div>
            <div class="qr-fv mono">{{ boutique.iban }}</div>
            <div class="qr-fv bold">{{ boutique.nom }}</div>
            <div class="qr-fv">{{ boutique.adresse }}</div>
            <div class="qr-fv">{{ boutique.localite }}</div>
          </div>
          <div class="qr-f">
            <div class="qr-fl">Référence</div>
            <div class="qr-fv">{{ numeroDevis }}</div>
          </div>
          <div class="qr-f" v-if="clientSelectionne">
            <div class="qr-fl">Payable par</div>
            <div class="qr-fv bold">{{ clientSelectionne.nom }}</div>
            <div class="qr-fv" v-if="clientSelectionne.adresse">{{ clientSelectionne.adresse }}</div>
          </div>
          <div class="qr-f">
            <div class="qr-fl">Monnaie &nbsp;&nbsp; Montant</div>
            <div class="qr-amounts-row">
              <span class="qr-fv">CHF</span>
              <span class="qr-fv">{{ (acompte.montant > 0 ? solde : totalFinal).toFixed(2) }}</span>
            </div>
          </div>
        </div>

        <!-- Séparateur vertical pointillé -->
        <div class="qr-bill-sep"></div>

        <!-- Section de paiement droite (148mm) -->
        <div class="qr-bill-payment">
          <div class="qr-bill-head">Section de paiement</div>
          <div class="qr-bill-payment-body">
            <img :src="qrDataUrl" class="qr-bill-qrimg" alt="QR" />
            <div class="qr-bill-payment-details">
              <div class="qr-f">
                <div class="qr-fl">Compte / Payable à</div>
                <div class="qr-fv mono">{{ boutique.iban }}</div>
                <div class="qr-fv bold">{{ boutique.nom }}</div>
                <div class="qr-fv">{{ boutique.adresse }}</div>
                <div class="qr-fv">{{ boutique.localite }}</div>
              </div>
              <div class="qr-f">
                <div class="qr-fl">Référence</div>
                <div class="qr-fv">{{ numeroDevis }}</div>
              </div>
              <div class="qr-f" v-if="clientSelectionne">
                <div class="qr-fl">Payable par</div>
                <div class="qr-fv bold">{{ clientSelectionne.nom }}</div>
                <div class="qr-fv" v-if="clientSelectionne.adresse">{{ clientSelectionne.adresse }}</div>
              </div>
              <div class="qr-f">
                <div class="qr-fl">Monnaie &nbsp;&nbsp; Montant</div>
                <div class="qr-amounts-row">
                  <span class="qr-fv">CHF</span>
                  <span class="qr-fv">{{ (acompte.montant > 0 ? solde : totalFinal).toFixed(2) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div><!-- .qr-bill -->
    </div><!-- #qr-page -->

    <!-- ══════════════════════════════════════════════════
         BARRE D'ACTIONS BAS DE PAGE
    ══════════════════════════════════════════════════ -->
    <div class="bottom-bar no-print">
      <div class="bottom-bar-left">
        <span v-if="statutCourant === 'Facture'" class="statut-pill statut-facture">✦ Facture</span>
        <span v-else-if="statutCourant === 'Validé'" class="statut-pill statut-valide">✓ Validé</span>
        <span v-else-if="statutCourant === 'Brouillon'" class="statut-pill statut-brouillon">● Brouillon</span>
        <span v-else class="statut-pill statut-nouveau">◎ Nouveau</span>
        <span class="bottom-bar-num">{{ numeroDevis }}</span>
        <span v-if="typeDocument === 'facture'" class="bottom-bar-hint">· QR page 2 inclus dans le PDF</span>
      </div>
      <div class="bottom-bar-right">
        <template v-if="typeDocument === 'devis'">
          <button @click="validerDevis" class="bab-btn bab-validate">✓ Valider</button>
          <button @click="convertirEnFacture" class="bab-btn bab-invoice">Passer en Facture</button>
        </template>
        <template v-else>
          <button @click="toggleQR" :class="['bab-btn', afficherQR ? 'bab-qr-on' : 'bab-qr']">
            {{ afficherQR ? 'Fermer aperçu QR' : 'Aperçu QR paiement' }}
          </button>
        </template>
        <button @click="exporterPDF" :disabled="pdfEnCours" class="bab-btn bab-export">
          {{ pdfEnCours ? 'Génération…' : '↓ Enregistrer PDF' }}
        </button>
      </div>
    </div>

    <!-- Aperçu QR inline (optionnel, screen uniquement) -->
    <div v-if="typeDocument === 'facture' && afficherQR && qrDataUrl" class="qr-preview-panel no-print">
      <div class="qr-preview-title">Aperçu bulletin QR (page 2)</div>
      <div class="qr-slip" style="max-width:680px;">
        <div class="qr-receipt">
          <div class="qr-section-head">Récépissé</div>
          <div class="qr-field">
            <div class="qr-field-lbl">Compte / Payable à</div>
            <div class="qr-field-val mono">{{ boutique.iban }}</div>
            <div class="qr-field-val bold">{{ boutique.nom }}</div>
          </div>
          <div class="qr-field">
            <div class="qr-field-lbl">Montant</div>
            <div class="qr-amount">CHF {{ (acompte.montant > 0 ? solde : totalFinal).toFixed(2) }}</div>
          </div>
        </div>
        <div class="qr-vertical-sep"></div>
        <div class="qr-payment" style="flex:1">
          <div class="qr-section-head">Section de paiement</div>
          <div style="display:flex;gap:1rem;align-items:flex-start;">
            <img :src="qrDataUrl" class="qr-code-img" alt="QR" />
            <div class="qr-field">
              <div class="qr-field-lbl">CHF &nbsp; {{ (acompte.montant > 0 ? solde : totalFinal).toFixed(2) }}</div>
              <div class="qr-field-lbl" style="margin-top:0.5rem;">Payable à</div>
              <div class="qr-field-val bold">{{ boutique.nom }}</div>
              <div class="qr-field-val mono">{{ boutique.iban }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════
   EDITOR ROOT
═══════════════════════════════════════════════════ */
.editor-root {
  display: flex; flex-direction: column; gap: 0; padding-bottom: 80px;
  background: #f1f1f1; /* fond gris pour faire ressortir la feuille */
}

/* ── En-tête de page ──────────────────────── */
.header-title-block { display: flex; align-items: center; gap: 0.75rem; }
.header-actions { display: flex; gap: 0.5rem; align-items: center; }

.btn-ghost {
  background: transparent; color: #4b6e56; border: 1px solid #bbf7d0;
  padding: 0.45rem 0.9rem; border-radius: 7px; font-size: 0.85rem;
  font-weight: 600; cursor: pointer; transition: all 0.15s; margin-top: 0;
}
.btn-ghost:hover { background: #f0fdf4; color: #14532d; }
.btn-ghost-active { background: #dcfce7 !important; border-color: #4ade80 !important; color: #14532d !important; }

/* ── Panneau de saisie ────────────────────── */
.editor-panel {
  background: #fff; border: 1px solid #dcfce7; border-radius: 12px;
  padding: 1.2rem 1.5rem; margin-bottom: 1.25rem;
}
.editor-fields { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; }
.field-group { display: flex; flex-direction: column; gap: 0.25rem; }
.field-label { font-size: 0.8rem; font-weight: 600; color: #475569; }

/* ── Bouton flottant aperçu ─────────────── */
.btn-floating-quit {
  position: fixed; bottom: 80px; right: 1.5rem;
  background: #0f172a; color: #e2e8f0; border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 8px 24px rgba(0,0,0,0.2); padding: 0.65rem 1.1rem;
  font-size: 0.85rem; font-weight: 600; z-index: 900; border-radius: 9px;
}
.btn-floating-quit:hover { background: #1e293b; }

/* ── Toast ───────────────────────────────── */
.toast-valide {
  position: fixed; top: 1.2rem; right: 1.5rem; z-index: 9999;
  background: #0f172a; color: #fff;
  padding: 0.7rem 1.4rem; border-radius: 10px;
  font-weight: 600; font-size: 0.875rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  pointer-events: none;
}
.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-10px); }

/* ── Statuts ─────────────────────────────── */
.statut-pill {
  font-size: 0.68rem; font-weight: 700; padding: 0.2rem 0.6rem;
  border-radius: 20px; letter-spacing: 0.4px; white-space: nowrap;
}
.statut-brouillon { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
.statut-valide    { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
.statut-nouveau   { background: #f8fafc; color: #94a3b8; border: 1px solid #e2e8f0; }
.statut-facture   { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }

/* ── Raccourcis tarifs ───────────────────── */
.quick-actions {
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 0.9rem 1.1rem; margin: 0 -2mm 4mm;
  font-size: 0.82rem;
}
.quick-section { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.65rem; }
.quick-section:last-child { margin-bottom: 0; }
.quick-label { font-size: 0.65rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.7px; }

/* ── Bouton ajouter ligne ────────────────── */
.btn-add-line {
  background: transparent; color: #16a34a; border: 1px dashed #86efac;
  padding: 0.4rem 1rem; border-radius: 7px; font-size: 0.85rem;
  font-weight: 600; cursor: pointer; margin: 0.6rem 0;
  transition: all 0.15s; display: inline-block;
}
.btn-add-line:hover { background: #f0fdf4; border-color: #4ade80; }

/* ── Ajustements ─────────────────────────── */
.adjustments-panel {
  background: #fafafa; border: 1px dashed #d1d5db; border-radius: 10px;
  padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.5rem;
  margin: 0 -2mm 0;
}
.adj-title { font-size: 0.63rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #9ca3af; }
.adj-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.adj-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 600; color: #374151; cursor: pointer; min-width: 130px; }
.adj-toggle input[type="checkbox"] { cursor: pointer; }
.adj-mode-toggle { display: flex; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; }
.adj-mode-btn { padding: 0.25rem 0.6rem; font-size: 0.78rem; font-weight: 600; border: none; background: #fff; color: #6b7280; cursor: pointer; }
.adj-mode-btn.active { background: #0f172a; color: #fff; }
.adj-input { width: 90px; padding: 0.3rem 0.5rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.85rem; text-align: right; }
.adj-input--date { width: 140px; text-align: left; }
.adj-unit { font-size: 0.78rem; font-weight: 700; color: #9ca3af; }
.adj-preview { font-size: 0.82rem; font-weight: 700; color: #dc2626; }
.adj-add-btn { font-size: 0.78rem; padding: 0.25rem 0.65rem; border: 1px dashed #d1d5db; border-radius: 6px; background: #fff; color: #6b7280; cursor: pointer; }
.adj-add-btn:hover { border-color: #0f172a; color: #0f172a; }

/* ── Mode aperçu : inputs transparents ───── */
.apercu-on .table-input { border: none !important; background: transparent !important; pointer-events: none; color: #000 !important; }

/* ═══════════════════════════════════════════════════
   DOCUMENT PDF — NOIR & BLANC PROFESSIONNEL
═══════════════════════════════════════════════════ */
.pdoc {
  background: #fff; color: #111;
  /* A4 exact : 210mm × 297mm */
  width: 210mm;
  min-height: 297mm;
  padding: 18mm 20mm 14mm;
  margin: 1.5rem auto;
  box-shadow: 0 6px 40px rgba(0,0,0,0.14);
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 9.5pt; line-height: 1.75;
  display: flex; flex-direction: column;
  box-sizing: border-box;
}

/* ── Logo ──────────────────────────────────────── */
.pdoc-logo {
  height: 28mm; width: auto; display: block; margin-bottom: 4mm; margin-left: -25px;
  object-fit: contain; object-position: left top;
}

/* ── Haut de page : expéditeur + destinataire ──── */
.pdoc-top {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 22mm;
}
.pdoc-sender { max-width: 55%; }
.pdoc-sender-name { font-size: 10.5pt; font-weight: 800; color: #111; margin-top: 1mm; }
.pdoc-sender-addr { font-size: 8.5pt; color: #777; line-height: 1.9; }
.pdoc-recipient { text-align: right; max-width: 42%; }
.pdoc-recipient-name { font-size: 10pt; font-weight: 700; color: #111; }
.pdoc-recipient-addr { font-size: 8.5pt; color: #777; line-height: 1.9; }

/* ── Titre du document ─────────────────────────── */
.pdoc-doc-title {
  display: flex; align-items: baseline; gap: 2mm; margin-bottom: 2mm;
}
.pdoc-doc-type-word { font-size: 9.5pt; font-weight: 700; color: #111; }
.pdoc-doc-num { font-size: 9.5pt; color: #aaa; font-family: ui-monospace, monospace; }

/* ── Séparateurs — très discrets ───────────────── */
.pdoc-sep { border: none; border-top: 0.3pt solid #e8e8e8; margin: 2.5mm 0; }
.pdoc-sep-bold { border-top-color: #ccc; }

/* ── Métadonnées (date, etc.) ───────────────────── */
.pdoc-meta-row {
  display: flex; align-items: baseline; gap: 2mm;
  padding: 2mm 0; font-size: 8.5pt;
}
.pdoc-meta-key { color: #bbb; font-weight: 400; }
.pdoc-meta-val { color: #111; font-weight: 600; }

/* ── Table articles ─────────────────────────────── */
.pdoc-table { width: 100%; border-collapse: collapse; margin: 5mm 0 2mm; }
.pdoc-table thead tr { background: transparent; }
.pdoc-table th {
  padding: 2.5mm 3mm; text-align: left;
  font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5pt;
  color: #111; border: none; border-bottom: 0.5pt solid #bbb;
}
.pdoc-table th.text-right { text-align: right; }
.th-pos { width: 12mm; text-align: center !important; }
.pdoc-table td {
  padding: 3mm 3mm; border-bottom: 0.3pt solid #f0f0f0;
  color: #111; vertical-align: middle; font-size: 9.5pt;
}
.pdoc-table tbody tr:last-child td { border-bottom: 0.5pt solid #ccc; }
.td-pos { text-align: center; color: #ccc; font-size: 8pt; }
.pdoc-amount { font-weight: 600; font-family: ui-monospace, monospace; }

/* ── Ligne totale principale ────────────────────── */
.pdoc-total-line {
  display: flex; justify-content: space-between; align-items: center;
  padding: 3.5mm 3mm; margin-top: 1mm;
  border-top: 0.5pt solid #bbb;
}
.pdoc-total-label { font-size: 9pt; font-weight: 600; color: #111; }
.pdoc-total-amount { font-size: 11pt; font-weight: 800; color: #111; font-family: ui-monospace, monospace; }

/* ── Sous-totaux (TVA, remise, acompte) ─────────── */
.pdoc-subtotals { display: flex; flex-direction: column; gap: 0; padding: 1mm 3mm 3mm; }
.pdoc-subrow {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 8pt; color: #999; padding: 1mm 0;
}
.pdoc-subrow-minus span:last-child { color: #c00; }
.pdoc-subrow-solde { font-weight: 700; border-top: 0.3pt solid #eee; padding-top: 2mm; margin-top: 1.5mm; }
.pdoc-subrow-solde span { color: #111 !important; }

/* ── Message & signature ────────────────────────── */
.pdoc-message {
  margin-top: 14mm; padding-top: 0;
  font-size: 8.5pt; color: #777; line-height: 1.85;
}
.pdoc-message p { margin: 0 0 2mm 0; font-style: italic; }
.pdoc-sign { margin-top: 8mm; }
.pdoc-sign p { margin: 0; color: #777; font-size: 8.5pt; }
.pdoc-sign-name { font-weight: 700; color: #111 !important; font-style: normal !important; }

/* ── Barre d'information basse — collée au bas ─── */
.pdoc-info-bar {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
  margin-top: auto; padding: 2.5mm 3mm;
  border-top: 0.5pt solid #ccc;
  font-size: 7pt; color: #aaa; gap: 3mm;
}
.pdoc-info-bar span { white-space: nowrap; }

/* ═══════════════════════════════════════════════════
   BARRE D'ACTIONS BAS — FIXE
═══════════════════════════════════════════════════ */
.bottom-bar {
  position: fixed; bottom: 0; left: 220px; right: 0; z-index: 100;
  background: #fff; border-top: 1px solid #dcfce7;
  box-shadow: 0 -4px 20px rgba(0,0,0,0.07);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 2rem;
  gap: 1rem;
}
.bottom-bar-left { display: flex; align-items: center; gap: 0.65rem; min-width: 0; }
.bottom-bar-num { font-family: ui-monospace, monospace; font-size: 0.82rem; font-weight: 700; color: #334155; }
.bottom-bar-hint { font-size: 0.72rem; color: #94a3b8; white-space: nowrap; }
.bottom-bar-right { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }

/* Boutons de la barre du bas */
.bab-btn {
  padding: 0.6rem 1.2rem; border-radius: 8px; font-size: 0.875rem;
  font-weight: 600; cursor: pointer; border: none; transition: all 0.15s;
  white-space: nowrap;
}
.bab-validate { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
.bab-validate:hover { background: #dcfce7; border-color: #4ade80; }
.bab-invoice { background: #f8fafc; color: #334155; border: 1px solid #e2e8f0; }
.bab-invoice:hover { background: #0f172a; color: #e2e8f0; border-color: #0f172a; }
.bab-qr { background: #f8fafc; color: #334155; border: 1px solid #e2e8f0; }
.bab-qr:hover { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.bab-qr-on { background: #1d4ed8; color: #fff; border: 1px solid #1d4ed8; }
.bab-qr-on:hover { background: #1e40af; }
.bab-export {
  background: #0f172a; color: #e2e8f0; border: 1px solid #0f172a;
  padding: 0.65rem 1.5rem; font-size: 0.9rem;
}
.bab-export:hover { background: #1e293b; }
.bab-export:disabled { opacity: 0.6; cursor: not-allowed; }

/* ═══════════════════════════════════════════════════
   PAGE QR — HORS ÉCRAN (capturée page 2 PDF)
═══════════════════════════════════════════════════ */
.qr-page-offscreen {
  position: absolute; left: -2400px; top: 0;
  width: 794px;        /* A4 à 96dpi */
  min-height: 1122px;  /* A4 à 96dpi */
  background: #fff;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  display: flex; flex-direction: column;
}

/* Espace blanc — pousse le bulletin vers le bas */
.qr-page-spacer { flex: 1; }

/* Ligne de découpe */
.qr-scissors-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0 1rem; margin-bottom: 0.5rem;
  color: #aaa; font-size: 0.85rem;
}
.qr-scissors-line { flex: 1; border-top: 1px dashed #bbb; }
.qr-scissors-icon { flex-shrink: 0; }

/* ── Bulletin QR standard suisse (page 2 PDF) ── */
.qr-bill {
  display: flex;
  border-top: 1.5px solid #333;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 0.72rem; background: #fff;
}

/* Récépissé gauche ≈ 62mm → 236px @96dpi */
.qr-bill-receipt {
  width: 236px; min-width: 236px;
  padding: 12px 12px 12px 16px;
  display: flex; flex-direction: column; gap: 10px;
  border-right: 1.5px dashed #aaa;
}

/* Séparateur (rendu par border-right du récépissé) */
.qr-bill-sep { display: none; }

/* Section de paiement droite ≈ 148mm → flex:1 */
.qr-bill-payment {
  flex: 1; padding: 12px 16px 12px 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.qr-bill-payment-body {
  display: flex; gap: 16px; align-items: flex-start; flex: 1;
}
.qr-bill-payment-details { flex: 1; display: flex; flex-direction: column; gap: 10px; }

/* En-têtes de section */
.qr-bill-head {
  font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.8px; color: #111;
  border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 2px;
}

/* Image QR ≈ 46×46mm → 175px */
.qr-bill-qrimg { width: 175px; height: 175px; image-rendering: pixelated; flex-shrink: 0; }

/* Champs du bulletin */
.qr-f { display: flex; flex-direction: column; gap: 1px; }
.qr-fl { font-size: 0.55rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 1px; }
.qr-fv { font-size: 0.68rem; color: #111; line-height: 1.35; }
.qr-fv.bold { font-weight: 700; }
.qr-fv.mono { font-family: ui-monospace, monospace; letter-spacing: 0.3px; }
.qr-amounts-row { display: flex; gap: 1.5rem; align-items: baseline; }

/* ── Aperçu QR screen (partagé) ── */
.qr-slip {
  display: flex; border: 1.5px solid #333; font-size: 0.72rem;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #fff;
}
.qr-receipt {
  width: 175px; min-width: 175px; padding: 10px 8px;
  display: flex; flex-direction: column; gap: 6px;
  border-right: 1.5px solid #333;
}
.qr-vertical-sep { width: 1.5px; background: #333; flex-shrink: 0; }
.qr-payment { flex: 1; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.qr-section-head {
  font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.8px; color: #444; margin-bottom: 2px;
  border-bottom: 1px solid #ccc; padding-bottom: 3px;
}
.qr-field { display: flex; flex-direction: column; gap: 1px; }
.qr-field-lbl { font-size: 0.56rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #888; }
.qr-field-val { font-size: 0.7rem; color: #111; line-height: 1.35; }
.qr-field-val.bold { font-weight: 700; }
.qr-field-val.mono { font-family: ui-monospace, monospace; letter-spacing: 0.3px; }
.qr-amount { font-size: 0.88rem; font-weight: 700; color: #111; }
.qr-code-img { width: 110px; height: 110px; image-rendering: pixelated; flex-shrink: 0; }

/* ── Aperçu QR screen ──────────────────── */
.qr-preview-panel {
  margin-top: 1rem; background: #f8fafc; border: 1px solid #e2e8f0;
  border-radius: 10px; padding: 1rem 1.25rem;
}
.qr-preview-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 0.75rem; }
</style>