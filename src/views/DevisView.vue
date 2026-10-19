<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, mkdir } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import ClientAutocomplete from '../components/ClientAutocomplete.vue'
import { trouverPointsDeCoupeSurs, trouverHautsDesBlocs, paginerCanvas, extraireBandeCanvas } from '../composables/pdfPagination'

const props = defineProps({
  config: Object,
  clients: Array,
  boutique: Object,
  devisListe: Array,
  prochainNumero: { type: Number, default: 1 }
})

const emit = defineEmits(['numero-utilise', 'convertir-en-facture'])

const genererNumero = (n) => `DEV-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`
const numeroDevis = ref(genererNumero(props.prochainNumero))
const dateDevis = ref(new Date().toISOString().split('T')[0])
const clientSelectionne = ref('')
const devisArticles = ref([{ description: 'Création artisanale sur-mesure', quantite: 1, prixUnitaire: 0, groupe: '' }])
const titreProjet = ref('')
const modeApercu = ref(false)
const raccourcisOuvert = ref(false)
const remise = ref({ active: false, mode: 'pourcent', valeur: 0 })
// Quand le devis propose plusieurs options distinctes (Homme/Femme, variante A/B...),
// additionner tout dans un total général n'a pas de sens : ce toggle permet de le
// masquer entièrement, pour ne laisser que le total propre à chaque groupe.
const afficherTotalGeneral = ref(true)
const arrondi = ref(false)
const acompte = ref({ montant: 0, date: '' })
const dvReady = ref(false)
const sauvegardeTimer = ref(null)
const notifValidation = ref(false)
const exportEnCours = ref(false)
const notifPdfExport = ref(null)

const statutCourant = computed(() =>
  props.devisListe.find(d => d.numero === numeroDevis.value)?.statut ?? null
)

const construireObjetDevis = (statut) => ({
  numero: numeroDevis.value, date: dateDevis.value, titreProjet: titreProjet.value,
  client: clientSelectionne.value ? { ...clientSelectionne.value } : null,
  articles: JSON.parse(JSON.stringify(devisArticles.value)),
  remise: JSON.parse(JSON.stringify(remise.value)),
  remisesGroupes: JSON.parse(JSON.stringify(groupeRemises.value)),
  optionsGroupes: JSON.parse(JSON.stringify(groupeOptions.value)),
  sautsPageGroupes: JSON.parse(JSON.stringify(groupeSautsPage.value)),
  afficherTotalGeneral: afficherTotalGeneral.value,
  arrondi: arrondi.value,
  acompte: JSON.parse(JSON.stringify(acompte.value)),
  totalTTC: totalFinal.value, statut
})

const sauvegardeAutomatique = () => {
  if (!dvReady.value) return
  clearTimeout(sauvegardeTimer.value)
  sauvegardeTimer.value = setTimeout(() => {
    const obj = construireObjetDevis('Brouillon')
    const idx = props.devisListe.findIndex(d => d.numero === numeroDevis.value)
    if (idx !== -1) { props.devisListe[idx] = obj }
    else { props.devisListe.push(obj); emit('numero-utilise') }
  }, 1500)
}

onMounted(() => {
  setTimeout(() => { dvReady.value = true }, 400)
})
onUnmounted(() => {
  clearTimeout(sauvegardeTimer.value)
})

const totalHT = computed(() => devisArticles.value.reduce((s, a) => s + a.quantite * a.prixUnitaire, 0))
const tvaTaux = computed(() => props.config.tvaTaux ?? 8.1)
const tvaIncluse = computed(() => (props.config.tvaMode ?? 'incluse') === 'incluse')
const tva = computed(() => tvaIncluse.value
  ? totalHT.value * tvaTaux.value / (100 + tvaTaux.value)
  : totalHT.value * tvaTaux.value / 100)
const totalTTC = computed(() => tvaIncluse.value ? totalHT.value : totalHT.value + tva.value)

// Groupe actif : détermine dans quelle section atterrissent les nouvelles lignes
// (raccourcis tarifs, bouton "+ Ajouter une ligne")
const groupeActif = ref('')
// Remise propre à chaque groupe (ex: 10% sur la main d'œuvre mais pas sur la matière,
// ou une remise seulement sur le groupe "Madame" et pas "Monsieur")
const groupeRemises = ref({})
const remiseDeGroupe = (nom) => groupeRemises.value[nom] || { active: false, mode: 'pourcent', valeur: 0 }
const assurerRemiseGroupe = (nom) => {
  if (!groupeRemises.value[nom]) groupeRemises.value[nom] = { active: false, mode: 'pourcent', valeur: 0 }
  return groupeRemises.value[nom]
}

// Option proposée au client (ex: choix Homme / Femme) : son total n'est pas
// additionné au total général, pour ne pas cumuler des variantes alternatives.
const groupeOptions = ref({})
const estOption = (nom) => !!groupeOptions.value[nom]

// Saut de page forcé juste avant ce groupe (impression native ET export PDF),
// pour qu'une option ne se retrouve jamais coupée entre deux pages.
const groupeSautsPage = ref({})
const sautAvant = (nom) => !!groupeSautsPage.value[nom]

const calculerTotauxGroupe = (nom, arts) => {
  const ht = arts.reduce((s, a) => s + a.quantite * a.prixUnitaire, 0)
  const tvaG = tvaIncluse.value ? ht * tvaTaux.value / (100 + tvaTaux.value) : ht * tvaTaux.value / 100
  const ttcBrut = tvaIncluse.value ? ht : ht + tvaG
  const r = remiseDeGroupe(nom)
  let remiseMontant = 0
  if (r.active && r.valeur) {
    const v = r.mode === 'pourcent' ? ttcBrut * r.valeur / 100 : r.valeur
    remiseMontant = Math.round(Math.min(v, ttcBrut) * 100) / 100
  }
  const ttc = Math.max(0, ttcBrut - remiseMontant)
  return { ht, tva: tvaG, ttcBrut, remiseMontant, ttc }
}
const sections = computed(() => {
  const noms = []
  for (const a of devisArticles.value) {
    const nom = a.groupe || ''
    if (!noms.includes(nom)) noms.push(nom)
  }
  return noms.map(nom => {
    const items = []
    devisArticles.value.forEach((art, index) => { if ((art.groupe || '') === nom) items.push({ art, index }) })
    return { nom, items, exclu: estOption(nom), ...calculerTotauxGroupe(nom, items.map(i => i.art)) }
  })
})
// Mode "sections nommées" affiché seulement si plusieurs groupes existent ou qu'un nom a été donné
const modeGroupe = computed(() => sections.value.length > 1 || (sections.value.length === 1 && sections.value[0].nom !== ''))

// Base du total général = somme des totaux de groupe (net de leur remise),
// à l'exception des groupes marqués "Option" (variantes non additionnées)
const totalApresRemisesGroupes = computed(() => sections.value.reduce((s, sec) => s + (sec.exclu ? 0 : sec.ttc), 0))
const montantRemise = computed(() => {
  if (!remise.value.active || !remise.value.valeur) return 0
  const v = remise.value.mode === 'pourcent' ? totalApresRemisesGroupes.value * remise.value.valeur / 100 : remise.value.valeur
  return Math.round(Math.min(v, totalApresRemisesGroupes.value) * 100) / 100
})
const totalApresRemise = computed(() => Math.max(0, totalApresRemisesGroupes.value - montantRemise.value))
const arrondiDiff = computed(() => arrondi.value ? Math.round(totalApresRemise.value * 20) / 20 - totalApresRemise.value : 0)
const totalFinal = computed(() => Math.round((totalApresRemise.value + arrondiDiff.value) * 100) / 100)
const solde = computed(() => Math.max(0, totalFinal.value - (parseFloat(acompte.value.montant) || 0)))

watch([devisArticles, numeroDevis, dateDevis, clientSelectionne, titreProjet, remise, groupeRemises, groupeOptions, groupeSautsPage, afficherTotalGeneral, arrondi, acompte], sauvegardeAutomatique, { deep: true })

const ajouterLigneDevis = (desc = '', prix = 0, groupe = groupeActif.value) => devisArticles.value.push({ description: desc, quantite: 1, prixUnitaire: prix, groupe })
const ajouterLigneDansGroupe = (nom) => ajouterLigneDevis('', 0, nom)
const supprimerArticle = (index) => devisArticles.value.splice(index, 1)

const ajouterGroupe = () => {
  const nom = prompt('Nom du groupe (ex: Alliance Marie) :', '')
  if (nom === null) return
  const trimmed = nom.trim()
  if (!trimmed) { alert('Nom invalide.'); return }
  groupeActif.value = trimmed
  assurerRemiseGroupe(trimmed)
  ajouterLigneDansGroupe(trimmed)
}
const renommerGroupe = (ancien, nouveau) => {
  const trimmed = nouveau.trim()
  devisArticles.value.forEach(a => { if ((a.groupe || '') === ancien) a.groupe = trimmed })
  if (groupeActif.value === ancien) groupeActif.value = trimmed
  if (ancien !== trimmed && groupeRemises.value[ancien]) {
    groupeRemises.value[trimmed] = groupeRemises.value[ancien]
    delete groupeRemises.value[ancien]
  }
  if (ancien !== trimmed && groupeOptions.value[ancien] !== undefined) {
    groupeOptions.value[trimmed] = groupeOptions.value[ancien]
    delete groupeOptions.value[ancien]
  }
  if (ancien !== trimmed && groupeSautsPage.value[ancien] !== undefined) {
    groupeSautsPage.value[trimmed] = groupeSautsPage.value[ancien]
    delete groupeSautsPage.value[ancien]
  }
}
const supprimerGroupe = (nom) => {
  if (!confirm(`Supprimer le groupe "${nom || 'Commun'}" et ses lignes ?`)) return
  devisArticles.value = devisArticles.value.filter(a => (a.groupe || '') !== nom)
  if (devisArticles.value.length === 0) devisArticles.value.push({ description: '', quantite: 1, prixUnitaire: 0, groupe: '' })
  if (groupeActif.value === nom) groupeActif.value = ''
  delete groupeRemises.value[nom]
  delete groupeOptions.value[nom]
  delete groupeSautsPage.value[nom]
}

const injecterConfigAuDevis = (type) => {
  if (type === 'cire') ajouterLigneDevis('Forfait Fonte Cire Perdue', props.config.cirePerdue)
  if (type === '3d') ajouterLigneDevis('Impression 3D Altmann (Résine)', props.config.impression3d)
}
const injecterPrestation = (p) => ajouterLigneDevis(p.nom, p.prix)

const injecterMetalAuPoids = (metal) => {
  const perteMetal = props.config.perteMetal ?? 0
  const s = prompt(`${metal.nom} — ${metal.prixGramme} CHF/g\nPoids net en grammes :`, '0.00')
  if (s === null) return
  const poids = parseFloat(s.replace(',', '.'))
  if (isNaN(poids) || poids <= 0) { alert('Valeur invalide.'); return }
  const facteur = 1 + perteMetal / 100
  const desc = perteMetal > 0
    ? `${metal.nom} (${poids.toFixed(2)} g + ${perteMetal}% perte à ${metal.prixGramme.toFixed(2)} CHF/g)`
    : `${metal.nom} (${poids.toFixed(2)} g × ${metal.prixGramme.toFixed(2)} CHF/g)`
  ajouterLigneDevis(desc, poids * metal.prixGramme * facteur)
}

const injecterMainOeuvre = () => {
  const t = props.config.tauxHoraire ?? 90
  const s = prompt(`Main-d'œuvre — ${t} CHF/h\nNombre d'heures :`, '1.00')
  if (s === null) return
  const h = parseFloat(s.replace(',', '.'))
  if (isNaN(h) || h <= 0) { alert('Valeur invalide.'); return }
  ajouterLigneDevis(`Main d'œuvre : ${h.toFixed(2)} h à ${t.toFixed(2)} CHF/h`, h * t)
}

const injecterDiamantAuDevis = (dia) => {
  const s = prompt(`${dia.nom || 'Diamant'} (${dia.taille}) — quantité :`, '1')
  if (s === null) return
  const qte = parseInt(s, 10)
  if (isNaN(qte) || qte <= 0) { alert('Quantité invalide.'); return }
  devisArticles.value.push({ description: `${dia.nom || 'Diamant'} (${dia.taille})`, quantite: qte, prixUnitaire: dia.prix, groupe: groupeActif.value })
}

const marquerEnvoyee = () => {
  clearTimeout(sauvegardeTimer.value)
  const obj = construireObjetDevis('Envoyée')
  const idx = props.devisListe.findIndex(d => d.numero === numeroDevis.value)
  if (idx !== -1) { props.devisListe[idx] = obj } else { props.devisListe.push(obj); emit('numero-utilise') }
}

const validerDevis = () => {
  if (!clientSelectionne.value) { alert("Sélectionnez d'abord un client pour valider ce devis."); return }
  clearTimeout(sauvegardeTimer.value)
  const obj = construireObjetDevis('Validée')
  const idx = props.devisListe.findIndex(d => d.numero === numeroDevis.value)
  if (idx !== -1) { props.devisListe[idx] = obj } else { props.devisListe.push(obj); emit('numero-utilise') }
  notifValidation.value = true
  setTimeout(() => { notifValidation.value = false }, 3000)
}

const réinitialiserEditeur = () => {
  if (!confirm("Voulez-vous effacer la table de travail actuelle ?")) return
  dvReady.value = false; clearTimeout(sauvegardeTimer.value)
  numeroDevis.value = genererNumero(props.prochainNumero)
  dateDevis.value = new Date().toISOString().split('T')[0]
  clientSelectionne.value = ''
  devisArticles.value = [{ description: 'Création artisanale sur-mesure', quantite: 1, prixUnitaire: 0, groupe: '' }]
  titreProjet.value = ''
  remise.value = { active: false, mode: 'pourcent', valeur: 0 }
  groupeRemises.value = {}
  groupeOptions.value = {}
  groupeSautsPage.value = {}
  afficherTotalGeneral.value = true
  arrondi.value = false; acompte.value = { montant: 0, date: '' }; modeApercu.value = false; groupeActif.value = ''
  setTimeout(() => { dvReady.value = true }, 400)
}

const chargerDevisExistant = (devis) => {
  dvReady.value = false; clearTimeout(sauvegardeTimer.value)
  numeroDevis.value = devis.numero; dateDevis.value = devis.date
  devisArticles.value = JSON.parse(JSON.stringify(devis.articles))
  groupeActif.value = ''
  groupeRemises.value = devis.remisesGroupes ? JSON.parse(JSON.stringify(devis.remisesGroupes)) : {}
  groupeOptions.value = devis.optionsGroupes ? JSON.parse(JSON.stringify(devis.optionsGroupes)) : {}
  groupeSautsPage.value = devis.sautsPageGroupes ? JSON.parse(JSON.stringify(devis.sautsPageGroupes)) : {}
  afficherTotalGeneral.value = devis.afficherTotalGeneral !== false
  remise.value = devis.remise ? JSON.parse(JSON.stringify(devis.remise)) : { active: false, mode: 'pourcent', valeur: 0 }
  arrondi.value = devis.arrondi || false
  acompte.value = devis.acompte ? JSON.parse(JSON.stringify(devis.acompte)) : { montant: 0, date: '' }
  titreProjet.value = devis.titreProjet || ''
  clientSelectionne.value = props.clients.find(c => c.id === devis.client?.id) || devis.client
  setTimeout(() => { dvReady.value = true }, 400)
}
defineExpose({ chargerDevisExistant })

const convertirEnFacture = () => {
  if (!confirm(`Créer une facture à partir du devis ${numeroDevis.value} ?`)) return
  emit('convertir-en-facture', construireObjetDevis(statutCourant.value || 'Validée'))
}

// ── Imprimer ─────────────────────────────────────────────
const imprimer = async () => {
  const wasApercu = modeApercu.value
  modeApercu.value = true
  await new Promise(r => setTimeout(r, 200))
  window.addEventListener('afterprint', () => {
    if (!wasApercu) modeApercu.value = false
  }, { once: true })
  window.print()
}

const ouvrirDernierPdf = async () => {
  if (!notifPdfExport.value?.chemin) return
  try {
    await openPath(notifPdfExport.value.chemin)
  } catch (err) {
    console.error(err)
    alert("Impossible d'ouvrir le PDF automatiquement. Chemin du fichier :\n" + notifPdfExport.value.chemin)
  }
}

// ── Export PDF (devis = 1 page, pas de QR) ───────────────
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

const exporterPDF = async () => {
  exportEnCours.value = true
  notifPdfExport.value = null
  try {
    const dossierBase = props.config.dossierPDF
    const nomClient = sanitiserNom(nomCompletClient(clientSelectionne.value) || 'Sans_Nom')
    const nomFichier = `${numeroDevis.value}_${nomClient}.pdf`

    let cheminFichier
    if (dossierBase) {
      await mkdir(`${dossierBase}/${nomClient}`, { recursive: true })
      cheminFichier = `${dossierBase}/${nomClient}/${nomFichier}`
    } else {
      cheminFichier = await save({ filters: [{ name: 'Document PDF', extensions: ['pdf'] }], defaultPath: nomFichier })
      if (!cheminFichier) { exportEnCours.value = false; return }
    }

    const wasApercu = modeApercu.value
    modeApercu.value = true
    await new Promise(r => setTimeout(r, 150))

    const element = document.getElementById('devis-imprimable')
    element.classList.add('pdf-bw')
    await new Promise(r => setTimeout(r, 50))

    const scaleCapture = 2
    const pointsDeCoupe = trouverPointsDeCoupeSurs(element, scaleCapture)
    const hautsGroupes = trouverHautsDesBlocs(element, scaleCapture, '.groupe-bloc')
    const sautsPageForces = sections.value
      .map((s, i) => (i > 0 && sautAvant(s.nom)) ? hautsGroupes[i] : null)
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
    modeApercu.value = wasApercu
    notifPdfExport.value = { chemin: cheminFichier }
    setTimeout(() => { if (notifPdfExport.value?.chemin === cheminFichier) notifPdfExport.value = null }, 8000)
    try { await openPath(cheminFichier) } catch (_) {}
  } catch (err) {
    console.error(err)
    alert("Erreur lors de la génération du PDF.")
  }
  exportEnCours.value = false
}
</script>

<template>
  <div :class="{ 'apercu-on': modeApercu }">
    <Transition name="toast">
      <div v-if="notifValidation" class="toast-valide">✓ Devis validé et enregistré !</div>
    </Transition>
    <Transition name="pdf-modal">
      <div v-if="notifPdfExport" class="pdf-export-banner no-print">
        <div class="pdf-export-icon">✓</div>
        <div class="pdf-export-text">
          <div class="pdf-export-title">PDF exporté avec succès</div>
          <div class="pdf-export-sub">{{ notifPdfExport.chemin }}</div>
        </div>
        <div class="pdf-export-actions">
          <button type="button" class="btn-success" style="margin-top:0;" @click="ouvrirDernierPdf">Ouvrir le PDF</button>
          <button type="button" class="pdf-export-close" @click="notifPdfExport = null">✕</button>
        </div>
      </div>
    </Transition>

    <!-- Header masqué en aperçu -->
    <header class="header no-print" v-if="!modeApercu">
      <div>
        <h2>Éditeur de Devis</h2>
        <div style="display:flex;align-items:center;gap:0.6rem;margin-top:0.2rem;">
          <p class="subtitle" style="margin:0;">Créez et exportez un devis professionnel.</p>
          <span v-if="statutCourant === 'Validée'" class="statut-pill statut-valide">✓ Validée</span>
          <span v-else-if="statutCourant === 'Envoyée'" class="statut-pill statut-envoyee">➤ Envoyée</span>
          <span v-else-if="statutCourant === 'Brouillon'" class="statut-pill statut-brouillon">● Brouillon</span>
          <span v-else class="statut-pill statut-nouveau">◎ Nouveau</span>
        </div>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <button @click="réinitialiserEditeur" class="btn-secondary" style="margin-top:0;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nouveau
        </button>
        <button @click="convertirEnFacture" class="btn-secondary" style="margin-top:0;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          → Facture
        </button>
        <button @click="imprimer" class="btn-secondary" style="margin-top:0;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Imprimer
        </button>
        <button @click="marquerEnvoyee" class="btn-secondary" style="margin-top:0;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Marquer envoyée
        </button>
        <button @click="validerDevis" class="btn-valider">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Valider
        </button>
        <button @click="exporterPDF" class="btn-success" :disabled="exportEnCours">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {{ exportEnCours ? 'Export en cours…' : 'Exporter PDF' }}
        </button>
      </div>
    </header>

    <!-- Paramètres client (masqués en aperçu) -->
    <section class="card no-print" v-if="!modeApercu">
      <h3>Paramètres & Client</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
        <div>
          <label class="field-lbl">N° de Devis</label>
          <input v-model="numeroDevis" type="text" />
        </div>
        <div>
          <label class="field-lbl">Date d'Émission</label>
          <input v-model="dateDevis" type="date" />
        </div>
        <div>
          <label class="field-lbl">Client Destinataire</label>
          <ClientAutocomplete v-model="clientSelectionne" :clients="clients" />
        </div>
      </div>
      <div style="margin-top:0.875rem;">
        <label class="field-lbl">Titre du Projet / Objet</label>
        <input v-model="titreProjet" type="text" placeholder="Ex: Bague solitaire or 18K — Mme Dupont" />
      </div>
    </section>

    <!-- Bouton flottant quitter aperçu -->
    <button v-if="modeApercu" @click="modeApercu = false" class="btn-floating-quit no-print">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Mode Édition
    </button>

    <!-- ═══ DOCUMENT A4 ═══ -->
    <div id="devis-imprimable" class="a4-page">

      <!-- Raccourcis tarifs (éditeur seulement, repliable) -->
      <div class="quick-actions no-print" v-if="!modeApercu">
        <button type="button" class="quick-actions-toggle" @click="raccourcisOuvert = !raccourcisOuvert">
          <svg :class="['chevron-icon', raccourcisOuvert ? 'chevron-open' : '']" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <h4>Raccourcis Tarifs</h4>
        </button>
        <div v-if="raccourcisOuvert" class="quick-actions-body">
          <div class="quick-section">
            <span class="quick-label">Atelier :</span>
            <div class="btn-group">
              <button @click="injecterConfigAuDevis('cire')">Cire perdue · {{ config.cirePerdue }}.-</button>
              <button @click="injecterConfigAuDevis('3d')">Impression 3D · {{ config.impression3d }}.-</button>
              <button @click="injecterMainOeuvre">Main-d'œuvre · {{ config.tauxHoraire }} CHF/h</button>
            </div>
          </div>
          <div class="quick-section" v-if="config.prestations?.length > 0">
            <span class="quick-label">Prestations :</span>
            <div class="btn-group">
              <button v-for="p in config.prestations" :key="p.id" @click="injecterPrestation(p)">{{ p.nom }} · {{ p.prix }}.-</button>
            </div>
          </div>
          <div class="quick-section">
            <span class="quick-label">Matières :</span>
            <div class="btn-group">
              <button v-for="m in config.metaux" :key="m.id" @click="injecterMetalAuPoids(m)">{{ m.nom }} · {{ m.prixGramme }} CHF/g</button>
            </div>
          </div>
          <div class="quick-section" v-if="config.diamants?.length > 0">
            <span class="quick-label">Pierres :</span>
            <div class="btn-group-diamonds">
              <button v-for="d in config.diamants" :key="d.id" @click="injecterDiamantAuDevis(d)">{{ d.nom }} {{ d.taille }}</button>
            </div>
          </div>
          <div class="quick-section">
            <span class="quick-label">Ajouter dans :</span>
            <div class="btn-group" style="align-items:center;">
              <select v-model="groupeActif" class="groupe-actif-select">
                <option value="">Commun (sans groupe)</option>
                <template v-for="s in sections" :key="s.nom">
                  <option v-if="s.nom" :value="s.nom">{{ s.nom }}</option>
                </template>
              </select>
              <button @click="ajouterGroupe">＋ Nouveau groupe</button>
            </div>
          </div>
        </div>
      </div>

      <!-- En-tête document -->
      <div class="a4-top">
        <div class="a4-logo-zone">
          <img v-if="boutique.logo" :src="boutique.logo" alt="Logo" :style="{ height: boutique.logoTaille, display: 'block', marginBottom: '0.5rem' }" />
          <div v-else class="a4-enseigne">{{ boutique.nom }}</div>
        </div>
        <div class="a4-title-zone">
          <div class="a4-doc-infos">
            <div><span class="a4-info-lbl">Devis N° :</span> {{ numeroDevis }}</div>
            <div><span class="a4-info-lbl">Date :</span> {{ dateDevis }}</div>
          </div>
        </div>
      </div>

      <hr class="a4-hr" />

      <!-- Émetteur / Destinataire -->
      <div class="a4-parties">
        <div class="a4-party">
          <div class="a4-section-lbl">Émetteur :</div>
          <div class="a4-party-info">
            <div class="a4-party-name">{{ boutique.nom }}</div>
            <div>{{ boutique.telephone }}</div>
            <div>{{ boutique.email }}</div>
            <div>{{ boutique.adresse }}</div>
            <div>{{ boutique.localite }}</div>
          </div>
        </div>
        <div class="a4-party">
          <div class="a4-section-lbl">Destinataire :</div>
          <div class="a4-party-info" v-if="clientSelectionne">
            <div class="a4-party-name">{{ nomCompletClient(clientSelectionne) }}</div>
            <div v-if="adresseLigne1(clientSelectionne)">{{ adresseLigne1(clientSelectionne) }}</div>
            <div v-if="adresseLigne2(clientSelectionne)">{{ adresseLigne2(clientSelectionne) }}</div>
            <div v-if="clientSelectionne.email">{{ clientSelectionne.email }}</div>
            <div v-if="clientSelectionne.telephone">{{ clientSelectionne.telephone }}</div>
          </div>
        </div>
      </div>

      <!-- Titre du projet -->
      <div v-if="titreProjet" class="a4-project-title">{{ titreProjet }}</div>

      <!-- Raccourcis inline pour ajout ligne (no-print) -->
      <div class="no-print" v-if="!modeApercu" style="margin-bottom:0.5rem;display:flex;gap:0.5rem;">
        <button @click="ajouterLigneDevis()" class="btn-secondary" style="font-size:0.82rem;">＋ Ajouter une ligne</button>
        <button @click="ajouterGroupe" class="btn-secondary" style="font-size:0.82rem;">＋ Ajouter un groupe (ex : Alliance Marie)</button>
      </div>

      <!-- Sections d'articles (une section = un groupe nommé, ou une seule section "commune") -->
      <div
        v-for="(section, sIndex) in sections" :key="sIndex" class="groupe-bloc"
        :style="sIndex > 0 && sautAvant(section.nom) ? { breakBefore: 'page', pageBreakBefore: 'always' } : {}"
      >
        <div v-if="modeGroupe" class="groupe-header">
          <template v-if="!modeApercu">
            <input class="groupe-nom-input no-print" :value="section.nom" @input="renommerGroupe(section.nom, $event.target.value)" placeholder="Nom du groupe (ex: Alliance Marie)" />
            <label class="groupe-option-toggle no-print" title="Cette section est une option proposée au client : son montant n'est pas additionné au total général.">
              <input type="checkbox" :checked="estOption(section.nom)" @change="groupeOptions[section.nom] = $event.target.checked" />
              <span>Option (hors total)</span>
            </label>
            <label v-if="sIndex > 0" class="groupe-option-toggle no-print" title="Force une nouvelle page juste avant ce groupe, pour ne pas le couper en deux.">
              <input type="checkbox" :checked="sautAvant(section.nom)" @change="groupeSautsPage[section.nom] = $event.target.checked" />
              <span>Saut de page avant</span>
            </label>
            <div class="groupe-header-actions no-print">
              <button @click="ajouterLigneDansGroupe(section.nom)" class="btn-secondary btn-xs">＋ Ligne</button>
              <button @click="supprimerGroupe(section.nom)" class="btn-danger-xs" title="Supprimer ce groupe">✕</button>
            </div>
          </template>
          <div v-else class="groupe-titre-apercu">
            {{ section.nom || 'Commun' }}
            <span v-if="section.exclu" class="groupe-option-badge">Option — non incluse dans le total</span>
          </div>
        </div>

        <table class="a4-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style="width:70px;text-align:center;">Qté</th>
              <th style="width:130px;text-align:right;">P.U. CHF</th>
              <th style="width:130px;text-align:right;">Total CHF</th>
              <th style="width:32px;" class="no-print" v-if="!modeApercu"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in section.items" :key="item.index">
              <td>
                <span v-if="modeApercu" class="description-texte">{{ item.art.description }}</span>
                <textarea v-else v-model="item.art.description" rows="1" class="table-input table-textarea"></textarea>
              </td>
              <td style="text-align:center;">
                <span v-if="modeApercu">{{ item.art.quantite }}</span>
                <input v-else v-model.number="item.art.quantite" type="number" class="table-input" style="text-align:center;" />
              </td>
              <td style="text-align:right;">
                <span v-if="modeApercu">{{ Number(item.art.prixUnitaire).toFixed(2) }}</span>
                <input v-else v-model.number="item.art.prixUnitaire" type="number" step="0.01" class="table-input" style="text-align:right;" />
              </td>
              <td style="text-align:right;font-weight:600;">{{ (item.art.quantite * item.art.prixUnitaire).toFixed(2) }}</td>
              <td class="no-print" v-if="!modeApercu">
                <button @click="supprimerArticle(item.index)" class="btn-danger-xs">✕</button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="modeGroupe && !modeApercu" class="groupe-remise-ctrl no-print">
          <label class="adj-toggle" style="min-width:auto;">
            <input type="checkbox" v-model="assurerRemiseGroupe(section.nom).active" />
            <span>Remise sur ce groupe</span>
          </label>
          <template v-if="remiseDeGroupe(section.nom).active">
            <div class="adj-mode-toggle">
              <button type="button" :class="['adj-mode-btn', remiseDeGroupe(section.nom).mode === 'pourcent' ? 'active' : '']" @click="assurerRemiseGroupe(section.nom).mode = 'pourcent'">%</button>
              <button type="button" :class="['adj-mode-btn', remiseDeGroupe(section.nom).mode === 'fixe' ? 'active' : '']" @click="assurerRemiseGroupe(section.nom).mode = 'fixe'">CHF</button>
            </div>
            <input v-model.number="assurerRemiseGroupe(section.nom).valeur" type="number" step="0.5" min="0" class="adj-input" />
            <span class="adj-unit">{{ remiseDeGroupe(section.nom).mode === 'pourcent' ? '%' : 'CHF' }}</span>
          </template>
        </div>

        <div v-if="modeGroupe" class="groupe-total-box">
          <div class="a4-total-row" v-if="tvaIncluse"><span class="a4-total-lbl">dont TVA {{ tvaTaux }}%</span><span class="a4-total-val">{{ section.tva.toFixed(2) }} CHF</span></div>
          <template v-else>
            <div class="a4-total-row"><span class="a4-total-lbl">Total HT</span><span class="a4-total-val">{{ section.ht.toFixed(2) }} CHF</span></div>
            <div class="a4-total-row"><span class="a4-total-lbl">TVA {{ tvaTaux }}%</span><span class="a4-total-val">{{ section.tva.toFixed(2) }} CHF</span></div>
          </template>
          <div v-if="section.remiseMontant > 0" class="a4-total-row a4-total-discount">
            <span class="a4-total-lbl">Remise{{ remiseDeGroupe(section.nom).mode === 'pourcent' ? ' ' + remiseDeGroupe(section.nom).valeur + '%' : '' }}</span>
            <span class="a4-total-val">−{{ section.remiseMontant.toFixed(2) }} CHF</span>
          </div>
          <div class="groupe-total-ttc"><span>Total{{ section.exclu ? ' (option)' : '' }}</span><span>{{ section.ttc.toFixed(2) }} CHF</span></div>
          <div v-if="section.exclu" class="groupe-option-note">Non inclus dans le total général</div>
        </div>
      </div>

      <!-- Ajustements (no-print) -->
      <div class="adjustments-panel no-print" v-if="!modeApercu">
        <span class="adj-title">Ajustements</span>
        <div class="adj-row">
          <label class="adj-toggle"><input type="checkbox" v-model="remise.active" /><span>{{ modeGroupe ? 'Remise globale' : 'Remise' }}</span></label>
          <template v-if="remise.active">
            <div class="adj-mode-toggle">
              <button :class="['adj-mode-btn', remise.mode === 'pourcent' ? 'active' : '']" @click="remise.mode = 'pourcent'">%</button>
              <button :class="['adj-mode-btn', remise.mode === 'fixe' ? 'active' : '']" @click="remise.mode = 'fixe'">CHF</button>
            </div>
            <input v-model.number="remise.valeur" type="number" step="0.5" min="0" class="adj-input" />
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
          <button v-else class="adj-add-btn" @click="acompte.montant = 1; acompte.date = new Date().toISOString().split('T')[0]">＋ Saisir</button>
        </div>
        <div v-if="modeGroupe" class="adj-row">
          <label class="adj-toggle"><input type="checkbox" v-model="afficherTotalGeneral" /><span>Afficher le total général</span></label>
          <span class="adj-preview" v-if="!afficherTotalGeneral" style="color:#8a7055;">Masqué : seuls les totaux par groupe apparaîtront (utile pour proposer des options séparées).</span>
        </div>
      </div>

      <!-- Totaux -->
      <div v-if="afficherTotalGeneral" class="a4-totals">
        <template v-if="tvaIncluse">
          <div class="a4-total-row"><span class="a4-total-lbl">dont TVA {{ tvaTaux }}% incluse</span><span class="a4-total-val">{{ tva.toFixed(2) }} CHF</span></div>
        </template>
        <template v-else>
          <div class="a4-total-row"><span class="a4-total-lbl">Total HT</span><span class="a4-total-val">{{ totalHT.toFixed(2) }} CHF</span></div>
          <div class="a4-total-row"><span class="a4-total-lbl">TVA {{ tvaTaux }}%</span><span class="a4-total-val">{{ tva.toFixed(2) }} CHF</span></div>
        </template>
        <div v-if="remise.active && montantRemise > 0" class="a4-total-row a4-total-discount">
          <span class="a4-total-lbl">Remise{{ remise.mode === 'pourcent' ? ' ' + remise.valeur + '%' : '' }}</span>
          <span class="a4-total-val">−{{ montantRemise.toFixed(2) }} CHF</span>
        </div>
        <div v-if="arrondi && arrondiDiff !== 0" class="a4-total-row">
          <span class="a4-total-lbl">Arrondi</span>
          <span class="a4-total-val">{{ arrondiDiff > 0 ? '+' : '' }}{{ arrondiDiff.toFixed(2) }} CHF</span>
        </div>
        <div class="a4-grand-total-row">
          <span class="a4-grand-lbl">{{ tvaIncluse ? 'Total TTC' : 'Total TTC' }}</span>
          <span class="a4-grand-val">{{ totalFinal.toFixed(2) }} CHF</span>
        </div>
        <template v-if="acompte.montant > 0">
          <div class="a4-total-row a4-total-discount">
            <span class="a4-total-lbl">Acompte{{ acompte.date ? ' du ' + new Date(acompte.date).toLocaleDateString('fr-CH') : '' }}</span>
            <span class="a4-total-val">−{{ parseFloat(acompte.montant).toFixed(2) }} CHF</span>
          </div>
          <div class="a4-grand-total-row">
            <span class="a4-grand-lbl">Solde dû</span>
            <span class="a4-grand-val" style="color:#1d4ed8;">{{ solde.toFixed(2) }} CHF</span>
          </div>
        </template>
      </div>

      <!-- Footer document -->
      <div class="a4-footer" style="grid-template-columns:1fr;" v-if="boutique.conditions">
        <div class="a4-footer-col">
          <div class="a4-footer-lbl">Termes &amp; Conditions</div>
          <div class="a4-footer-info">{{ boutique.conditions }}</div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.field-lbl { font-size: 0.82rem; font-weight: 600; color: #7a5c30; display: block; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.4px; }

/* ── A4 Document ──────────────────────────────── */
.a4-page {
  background: #FFFFFF;
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  box-sizing: border-box;
  padding: 11mm 15mm;
  font-size: 11.5px;
  color: #0f172a;
  line-height: 1.32;
}

.a4-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.3rem;
}
.a4-logo-zone { flex: 0 0 auto; max-width: 45%; }
.a4-enseigne { font-size: 1.3rem; font-weight: 800; letter-spacing: -0.2px; }
.a4-title-zone { text-align: right; }
.a4-doc-infos { font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.8; }
.a4-info-lbl { color: #64748b; }
.a4-hr { border: none; border-top: 1.5px solid #0f172a; margin: 0 0 1.1rem; }
.a4-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5rem; margin-bottom: 1.3rem; }
.a4-section-lbl { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.9px; margin-bottom: 0.4rem; }
.a4-party-info { font-size: 0.84rem; line-height: 1.5; color: #334155; }
.a4-party-name { font-weight: 700; color: #0f172a; font-size: 0.92rem; }

/* ── Table ──────────────────────────────────── */
.a4-table { width: 100%; border-collapse: collapse; margin-bottom: 0.3rem; }
.a4-table th { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; padding: 0.5rem 0.5rem 0.5rem 0; border-bottom: 1.5px solid #0f172a; text-align: left; }
.a4-table td { padding: 0.55rem 0.5rem 0.55rem 0; border-bottom: 1px solid #e0d5c5; font-size: 0.86rem; vertical-align: middle; }
.a4-table tbody tr:last-child td { border-bottom: none; }
.a4-table tr, .groupe-bloc, .a4-totals, .a4-footer { break-inside: avoid; page-break-inside: avoid; }

/* ── Sections par groupe (Alliance Marie / Alliance Marco / etc.) ── */
.groupe-actif-select { padding: 0.32rem 0.55rem; border: 1px solid #d4c9b8; border-radius: 6px; font-size: 0.84rem; background: #fff; color: #3d2a14; }
.groupe-bloc { margin-bottom: 1rem; }
.groupe-bloc:last-of-type { margin-bottom: 0; }
.groupe-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.35rem; flex-wrap: wrap; }
.groupe-nom-input { flex: 1; font-size: 0.98rem; font-weight: 700; color: #0f172a; border: 1px dashed #d4c9b8; border-radius: 6px; padding: 0.4rem 0.65rem; background: #faf6ef; }
.groupe-header-actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
.groupe-option-toggle { display: flex; align-items: center; gap: 0.35rem; font-size: 0.78rem; font-weight: 600; color: #7a5c30; white-space: nowrap; cursor: pointer; flex-shrink: 0; }
.groupe-option-toggle input[type="checkbox"] { cursor: pointer; accent-color: #C5A059; }
.btn-xs { font-size: 0.76rem; padding: 0.3rem 0.6rem; }
.groupe-titre-apercu { font-size: 1rem; font-weight: 800; color: #0f172a; padding-bottom: 0.3rem; border-bottom: 1.5px solid #0f172a; }
.groupe-option-badge { display: inline-block; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #b45309; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 20px; padding: 0.1rem 0.55rem; margin-left: 0.6rem; vertical-align: middle; }
.groupe-option-note { font-size: 0.7rem; font-style: italic; color: #b45309; margin-top: 0.1rem; }
.groupe-remise-ctrl { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; background: #faf6ef; border: 1px dashed #d4b896; border-radius: 8px; padding: 0.5rem 0.75rem; margin-top: 0.35rem; font-size: 0.82rem; }
.groupe-total-box { display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; margin-top: 0.3rem; margin-bottom: 0.35rem; }
.groupe-total-box .a4-total-row { width: 290px; }
.groupe-total-ttc { display: flex; justify-content: space-between; width: 290px; font-weight: 800; font-size: 0.9rem; padding-top: 0.25rem; margin-top: 0.15rem; border-top: 1px solid #e0d5c5; }

/* ── Totaux ─────────────────────────────────── */
.a4-totals { display: flex; flex-direction: column; align-items: flex-end; margin-top: 0.9rem; margin-bottom: 1.3rem; gap: 0.2rem; }
.a4-total-row { display: flex; width: 300px; justify-content: space-between; font-size: 0.82rem; padding: 0.15rem 0; }
.a4-total-lbl { font-weight: 700; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.5px; color: #475569; }
.a4-total-val { font-weight: 600; color: #0f172a; }
.a4-total-discount .a4-total-lbl, .a4-total-discount .a4-total-val { color: #dc2626; }
.a4-grand-total-row { display: flex; width: 300px; justify-content: space-between; padding: 0.35rem 0 0.15rem; border-top: 1.5px solid #0f172a; margin-top: 0.2rem; }
.a4-grand-lbl { font-size: 0.78rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
.a4-grand-val { font-weight: 800; font-size: 1rem; }

/* ── Footer ─────────────────────────────────── */
.a4-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5rem; padding-top: 1rem; border-top: 1.5px solid #0f172a; font-size: 0.8rem; margin-top: auto; }
.a4-footer-lbl { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 0.35rem; }
.a4-footer-sub { font-weight: 600; font-size: 0.78rem; margin-bottom: 0.2rem; }
.a4-footer-info { color: #475569; line-height: 1.45; }

.a4-project-title {
  font-size: 1.02rem; font-weight: 700; color: #0f172a;
  margin-bottom: 0.8rem; padding-bottom: 0.45rem;
  border-bottom: 1px solid #e0d5c5;
  letter-spacing: 0.2px;
}

/* ── Buttons ─────────────────────────────────── */
.btn-valider { background: #16a34a; color: #fff; border: none; padding: 0.62rem 1.35rem; border-radius: 7px; font-weight: 700; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; gap: 0.45rem; }
.btn-valider:hover { background: #15803d; transform: translateY(-1px); }
.statut-pill { font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 20px; letter-spacing: 0.4px; white-space: nowrap; }
.statut-brouillon { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
.statut-envoyee   { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.statut-valide    { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
.statut-nouveau   { background: #faf6ef; color: #9a7a4a; border: 1px solid #e8dcc8; }
.toast-valide { position: fixed; top: 1.2rem; right: 1.5rem; z-index: 9999; background: #0B3D2E; color: #f5efe3; padding: 0.7rem 1.4rem; border-radius: 10px; font-weight: 600; font-size: 0.9rem; box-shadow: 0 4px 20px rgba(0,0,0,0.18); pointer-events: none; }
.pdf-export-banner {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 10000; background: #fff; color: #0f172a;
  border-radius: 14px; box-shadow: 0 25px 60px rgba(0,0,0,0.35);
  padding: 1.5rem 1.75rem; display: flex; align-items: center; gap: 1.25rem;
  min-width: 440px; max-width: 90vw; border: 1px solid #e0d5c5;
}
.pdf-export-icon { width: 44px; height: 44px; border-radius: 50%; background: #16a34a; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: 800; flex-shrink: 0; }
.pdf-export-text { flex: 1; min-width: 0; }
.pdf-export-title { font-weight: 800; font-size: 1.05rem; color: #0f172a; }
.pdf-export-sub { font-size: 0.78rem; color: #8a7055; margin-top: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pdf-export-actions { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
.pdf-export-close { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 1.1rem; padding: 0.3rem; line-height: 1; }
.pdf-export-close:hover { color: #ef4444; }
.pdf-modal-enter-active, .pdf-modal-leave-active { transition: opacity 0.2s ease; }
.pdf-modal-enter-from, .pdf-modal-leave-to { opacity: 0; }
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-12px); }
.btn-floating-quit { position: fixed; bottom: 20px; right: 20px; background: #0B3D2E; color: #f5efe3; border: 1px solid rgba(197,160,89,0.2); box-shadow: 0 10px 25px rgba(0,0,0,0.2); padding: 0.75rem 1.25rem; font-weight: 600; z-index: 999; border-radius: 7px; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; }
.btn-floating-quit:hover { background: #0a3226; }
.quick-section { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.75rem; }
.quick-section:last-child { margin-bottom: 0; }
.quick-label { font-size: 0.68rem; font-weight: 700; color: #b09070; text-transform: uppercase; letter-spacing: 0.6px; }
.adjustments-panel { margin: 0.75rem 0; background: #faf6ef; border: 1px dashed #d4b896; border-radius: 8px; padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
.adj-title { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #b09070; margin-bottom: 0.1rem; }
.adj-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.adj-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 600; color: #3d2a14; cursor: pointer; min-width: 130px; }
.adj-toggle input[type="checkbox"] { cursor: pointer; accent-color: #C5A059; }
.adj-mode-toggle { display: flex; gap: 0; border: 1px solid #d4c9b8; border-radius: 6px; overflow: hidden; }
.adj-mode-btn { padding: 0.25rem 0.6rem; font-size: 0.78rem; font-weight: 600; border: none; background: #fff; color: #8a7055; cursor: pointer; }
.adj-mode-btn.active { background: #C5A059; color: #0B3D2E; }
.adj-input { width: 90px; padding: 0.3rem 0.5rem; border: 1px solid #d4c9b8; border-radius: 6px; font-size: 0.85rem; text-align: right; }
.adj-input--date { width: 140px; text-align: left; }
.adj-unit { font-size: 0.78rem; font-weight: 700; color: #b09070; }
.adj-preview { font-size: 0.82rem; font-weight: 700; color: #dc2626; }
.adj-add-btn { font-size: 0.78rem; padding: 0.25rem 0.65rem; border: 1px dashed #d4c9b8; border-radius: 6px; background: #fff; color: #8a7055; cursor: pointer; }

/* ── PDF export ─────────────────────────────── */
.pdf-bw * { color: #000 !important; }
.pdf-bw .a4-table th { border-bottom-color: #000 !important; }
.pdf-bw .a4-table td { border-bottom-color: #ccc !important; }
.pdf-bw .a4-hr { border-top-color: #000 !important; }
.pdf-bw .a4-grand-total-row { border-top-color: #000 !important; }
.pdf-bw .a4-footer { border-top-color: #000 !important; }
</style>
