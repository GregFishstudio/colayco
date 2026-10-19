<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, mkdir } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import QRCode from 'qrcode'
import ClientAutocomplete from '../components/ClientAutocomplete.vue'
import { trouverPointsDeCoupeSurs, paginerCanvas, extraireBandeCanvas } from '../composables/pdfPagination'

const props = defineProps({
  config: Object,
  clients: Array,
  boutique: Object,
  facturesListe: Array,
  prochainNumeroFacture: { type: Number, default: 1 }
})

const emit = defineEmits(['facture-numero-utilise'])

const genererNumero = (n) => `FAC-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`
const numeroFacture = ref(genererNumero(props.prochainNumeroFacture))
const dateFacture = ref(new Date().toISOString().split('T')[0])
const clientSelectionne = ref('')
const factureArticles = ref([{ description: 'Création artisanale sur-mesure', quantite: 1, prixUnitaire: 0, groupe: '' }])
const titreProjet = ref('')
const modeApercu = ref(false)
const raccourcisOuvert = ref(false)
const delaiPaiement = ref(30)
const remise = ref({ active: false, mode: 'pourcent', valeur: 0 })
const arrondi = ref(false)
const acompte = ref({ montant: 0, date: '' })
const ftReady = ref(false)
const sauvegardeTimer = ref(null)
const notifValidation = ref(false)
const exportEnCours = ref(false)
const notifPdfExport = ref(null)

const statutCourant = computed(() =>
  props.facturesListe.find(f => f.numero === numeroFacture.value)?.statut ?? null
)

const construireObjetFacture = (statut) => ({
  numero: numeroFacture.value, date: dateFacture.value, titreProjet: titreProjet.value,
  client: clientSelectionne.value ? { ...clientSelectionne.value } : null,
  articles: JSON.parse(JSON.stringify(factureArticles.value)),
  remise: JSON.parse(JSON.stringify(remise.value)),
  remisesGroupes: JSON.parse(JSON.stringify(groupeRemises.value)),
  arrondi: arrondi.value,
  acompte: JSON.parse(JSON.stringify(acompte.value)),
  delaiPaiement: delaiPaiement.value,
  totalTTC: totalFinal.value, statut
})

const sauvegardeAutomatique = () => {
  if (!ftReady.value) return
  clearTimeout(sauvegardeTimer.value)
  sauvegardeTimer.value = setTimeout(() => {
    const obj = construireObjetFacture('Brouillon')
    const idx = props.facturesListe.findIndex(f => f.numero === numeroFacture.value)
    if (idx !== -1) { props.facturesListe[idx] = obj } else { props.facturesListe.push(obj); emit('facture-numero-utilise') }
  }, 1500)
}

onMounted(() => {
  setTimeout(() => { ftReady.value = true }, 400)
})
onUnmounted(() => {
  clearTimeout(sauvegardeTimer.value)
})

const totalHT = computed(() => factureArticles.value.reduce((s, a) => s + a.quantite * a.prixUnitaire, 0))
const tvaTaux = computed(() => props.config.tvaTaux ?? 8.1)
const tvaIncluse = computed(() => (props.config.tvaMode ?? 'incluse') === 'incluse')
const tva = computed(() => tvaIncluse.value ? totalHT.value * tvaTaux.value / (100 + tvaTaux.value) : totalHT.value * tvaTaux.value / 100)
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
  for (const a of factureArticles.value) {
    const nom = a.groupe || ''
    if (!noms.includes(nom)) noms.push(nom)
  }
  return noms.map(nom => {
    const items = []
    factureArticles.value.forEach((art, index) => { if ((art.groupe || '') === nom) items.push({ art, index }) })
    return { nom, items, ...calculerTotauxGroupe(nom, items.map(i => i.art)) }
  })
})
// Mode "sections nommées" affiché seulement si plusieurs groupes existent ou qu'un nom a été donné
const modeGroupe = computed(() => sections.value.length > 1 || (sections.value.length === 1 && sections.value[0].nom !== ''))

// Base du total général = somme des totaux de groupe, chacun déjà net de sa propre remise
const totalApresRemisesGroupes = computed(() => sections.value.reduce((s, sec) => s + sec.ttc, 0))
const montantRemise = computed(() => {
  if (!remise.value.active || !remise.value.valeur) return 0
  const v = remise.value.mode === 'pourcent' ? totalApresRemisesGroupes.value * remise.value.valeur / 100 : remise.value.valeur
  return Math.round(Math.min(v, totalApresRemisesGroupes.value) * 100) / 100
})
const totalApresRemise = computed(() => Math.max(0, totalApresRemisesGroupes.value - montantRemise.value))
const arrondiDiff = computed(() => arrondi.value ? Math.round(totalApresRemise.value * 20) / 20 - totalApresRemise.value : 0)
const totalFinal = computed(() => Math.round((totalApresRemise.value + arrondiDiff.value) * 100) / 100)
const solde = computed(() => Math.max(0, totalFinal.value - (parseFloat(acompte.value.montant) || 0)))

watch([factureArticles, numeroFacture, dateFacture, clientSelectionne, titreProjet, remise, groupeRemises, arrondi, acompte, delaiPaiement], sauvegardeAutomatique, { deep: true })

const ajouterLigne = (desc = '', prix = 0, groupe = groupeActif.value) => factureArticles.value.push({ description: desc, quantite: 1, prixUnitaire: prix, groupe })
const ajouterLigneDansGroupe = (nom) => ajouterLigne('', 0, nom)
const supprimerArticle = (index) => factureArticles.value.splice(index, 1)

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
  factureArticles.value.forEach(a => { if ((a.groupe || '') === ancien) a.groupe = trimmed })
  if (groupeActif.value === ancien) groupeActif.value = trimmed
  if (ancien !== trimmed && groupeRemises.value[ancien]) {
    groupeRemises.value[trimmed] = groupeRemises.value[ancien]
    delete groupeRemises.value[ancien]
  }
}
const supprimerGroupe = (nom) => {
  if (!confirm(`Supprimer le groupe "${nom || 'Commun'}" et ses lignes ?`)) return
  factureArticles.value = factureArticles.value.filter(a => (a.groupe || '') !== nom)
  if (factureArticles.value.length === 0) factureArticles.value.push({ description: '', quantite: 1, prixUnitaire: 0, groupe: '' })
  if (groupeActif.value === nom) groupeActif.value = ''
  delete groupeRemises.value[nom]
}

const injecterConfigAuDevis = (type) => {
  if (type === 'cire') ajouterLigne('Forfait Fonte Cire Perdue', props.config.cirePerdue)
  if (type === '3d') ajouterLigne('Impression 3D Altmann (Résine)', props.config.impression3d)
}
const injecterPrestation = (p) => ajouterLigne(p.nom, p.prix)

const injecterMetalAuPoids = (metal) => {
  const perteMetal = props.config.perteMetal ?? 0
  const s = prompt(`${metal.nom} — ${metal.prixGramme} CHF/g\nPoids net en grammes :`, '0.00')
  if (s === null) return
  const poids = parseFloat(s.replace(',', '.'))
  if (isNaN(poids) || poids <= 0) { alert('Valeur invalide.'); return }
  const facteur = 1 + perteMetal / 100
  const desc = perteMetal > 0 ? `${metal.nom} (${poids.toFixed(2)} g + ${perteMetal}% perte à ${metal.prixGramme.toFixed(2)} CHF/g)` : `${metal.nom} (${poids.toFixed(2)} g × ${metal.prixGramme.toFixed(2)} CHF/g)`
  ajouterLigne(desc, poids * metal.prixGramme * facteur)
}

const injecterMainOeuvre = () => {
  const t = props.config.tauxHoraire ?? 90
  const s = prompt(`Main-d'œuvre — ${t} CHF/h\nNombre d'heures :`, '1.00')
  if (s === null) return
  const h = parseFloat(s.replace(',', '.'))
  if (isNaN(h) || h <= 0) { alert('Valeur invalide.'); return }
  ajouterLigne(`Main d'œuvre : ${h.toFixed(2)} h à ${t.toFixed(2)} CHF/h`, h * t)
}

const injecterDiamantAuDevis = (dia) => {
  const s = prompt(`${dia.nom || 'Diamant'} (${dia.taille}) — quantité :`, '1')
  if (s === null) return
  const qte = parseInt(s, 10)
  if (isNaN(qte) || qte <= 0) { alert('Quantité invalide.'); return }
  factureArticles.value.push({ description: `${dia.nom || 'Diamant'} (${dia.taille})`, quantite: qte, prixUnitaire: dia.prix, groupe: groupeActif.value })
}

const marquerEnvoyee = () => {
  clearTimeout(sauvegardeTimer.value)
  const obj = construireObjetFacture('Envoyée')
  const idx = props.facturesListe.findIndex(f => f.numero === numeroFacture.value)
  if (idx !== -1) { props.facturesListe[idx] = obj } else { props.facturesListe.push(obj); emit('facture-numero-utilise') }
}

const validerFacture = () => {
  if (!clientSelectionne.value) { alert("Sélectionnez d'abord un client pour valider cette facture."); return }
  clearTimeout(sauvegardeTimer.value)
  const obj = construireObjetFacture('Payée')
  const idx = props.facturesListe.findIndex(f => f.numero === numeroFacture.value)
  if (idx !== -1) { props.facturesListe[idx] = obj } else { props.facturesListe.push(obj); emit('facture-numero-utilise') }
  notifValidation.value = true
  setTimeout(() => { notifValidation.value = false }, 3000)
}

const réinitialiserEditeur = () => {
  if (!confirm("Voulez-vous effacer la table de travail actuelle ?")) return
  ftReady.value = false; clearTimeout(sauvegardeTimer.value)
  numeroFacture.value = genererNumero(props.prochainNumeroFacture)
  dateFacture.value = new Date().toISOString().split('T')[0]
  clientSelectionne.value = ''
  factureArticles.value = [{ description: 'Création artisanale sur-mesure', quantite: 1, prixUnitaire: 0, groupe: '' }]
  titreProjet.value = ''
  remise.value = { active: false, mode: 'pourcent', valeur: 0 }
  groupeRemises.value = {}
  arrondi.value = false; acompte.value = { montant: 0, date: '' }; delaiPaiement.value = 30; modeApercu.value = false; groupeActif.value = ''
  setTimeout(() => { ftReady.value = true }, 400)
}

const chargerFactureExistant = (facture) => {
  ftReady.value = false; clearTimeout(sauvegardeTimer.value)
  numeroFacture.value = facture.numero; dateFacture.value = facture.date
  factureArticles.value = JSON.parse(JSON.stringify(facture.articles))
  groupeActif.value = ''
  groupeRemises.value = facture.remisesGroupes ? JSON.parse(JSON.stringify(facture.remisesGroupes)) : {}
  remise.value = facture.remise ? JSON.parse(JSON.stringify(facture.remise)) : { active: false, mode: 'pourcent', valeur: 0 }
  arrondi.value = facture.arrondi || false
  acompte.value = facture.acompte ? JSON.parse(JSON.stringify(facture.acompte)) : { montant: 0, date: '' }
  delaiPaiement.value = facture.delaiPaiement ?? 30
  titreProjet.value = facture.titreProjet || ''
  clientSelectionne.value = props.clients.find(c => c.id === facture.client?.id) || facture.client
  setTimeout(() => { ftReady.value = true }, 400)
}
defineExpose({ chargerFactureExistant })

// ── Imprimer ─────────────────────────────────────────────
// Impression directe (fenêtre d'impression du système), avec le bulletin QR
// suisse ajouté en page 2 (sauf en mode "paiement en magasin"). L'image QR
// est entièrement décodée (img.decode()) avant d'ouvrir la boîte de dialogue
// d'impression, pour éviter qu'elle apparaisse vide sur certains moteurs.
const qrPrintDataUrl = ref('')
const imprimer = async () => {
  const wasApercu = modeApercu.value
  modeApercu.value = true
  if (props.boutique?.iban && delaiPaiement.value !== 'magasin') {
    try { qrPrintDataUrl.value = await _genererQRData() } catch (_) {}
  }
  await nextTick()
  const imgEl = document.querySelector('.qr-code-img')
  if (imgEl) {
    try { await (imgEl.decode ? imgEl.decode() : new Promise(r => { imgEl.onload = r; imgEl.onerror = r })) } catch (_) {}
  }
  await new Promise(r => setTimeout(r, 150))
  window.addEventListener('afterprint', () => {
    qrPrintDataUrl.value = ''
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

const _genererQRData = async () => {
  const b = props.boutique
  const client = clientSelectionne.value
  const cleanIBAN = (b.iban || '').replace(/\s/g, '').toUpperCase()
  const localParts = (b.localite || '').split(' ')
  const postalCode = localParts[0] || ''
  const city = localParts.slice(1).join(' ') || ''
  const cNom = client ? nomCompletClient(client) : ''
  const cAdL1 = client ? adresseLigne1(client) : ''
  const cAdL2 = client ? adresseLigne2(client) : ''
  const qrLines = [
    'SPC', '0200', '1', cleanIBAN,
    'K', b.nom || '', b.adresse || '', `${postalCode} ${city}`.trim(), '', '', 'CH',
    '', '', '', '', '', '', '',
    solde.value.toFixed(2), 'CHF',
    client ? 'K' : '', cNom, cAdL1, cAdL2, '', '', client ? 'CH' : '',
    'NON', '', `Facture ${numeroFacture.value}`, 'EPD'
  ]
  return QRCode.toDataURL(qrLines.join('\n'), { width: 460, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
}

// ── QR-bill page (utilisée par exporterPDF) ───────────────
const _ajouterPageQR = async (pdf) => {
  const b = props.boutique
  const client = clientSelectionne.value
  const cleanIBAN = (b.iban || '').replace(/\s/g, '').toUpperCase()
  const cNom = client ? nomCompletClient(client) : ''
  const cAdL1 = client ? adresseLigne1(client) : ''
  const cAdL2 = client ? adresseLigne2(client) : ''
  const qrDataUrl = await _genererQRData()
  const pageW = 210, pageH = 297
  pdf.addPage()
  const slipY = 192
  pdf.setDrawColor(0, 0, 0)
  pdf.setLineDashPattern([1, 1], 0)
  pdf.line(5, slipY, pageW - 5, slipY); pdf.line(62, slipY, 62, pageH - 5)
  pdf.setLineDashPattern([], 0)
  pdf.setTextColor(150, 150, 150); pdf.setFontSize(8); pdf.text('✂', 2, slipY - 1)
  pdf.setTextColor(0, 0, 0)
  const ibanFmt = (b.iban || '').toUpperCase()
  const rx = 5, ry = slipY + 5
  pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.text('Récépissé', rx, ry + 4)
  pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Compte / Payable à', rx, ry + 11)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
  pdf.text(ibanFmt, rx, ry + 15); pdf.text(b.nom || '', rx, ry + 19)
  pdf.text(b.adresse || '', rx, ry + 23); pdf.text(b.localite || '', rx, ry + 27)
  pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Payable par', rx, ry + 36)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
  if (client) { pdf.text(cNom, rx, ry + 40); if (cAdL1) pdf.text(cAdL1, rx, ry + 44); if (cAdL2) pdf.text(cAdL2, rx, ry + 48) }
  pdf.setFontSize(6); pdf.setFont('helvetica', 'bold')
  pdf.text('Monnaie', rx, ry + 62); pdf.text('Montant', rx + 18, ry + 62)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
  pdf.text('CHF', rx, ry + 67); pdf.text(solde.value.toFixed(2), rx + 18, ry + 67)
  pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Point de dépôt', 60, slipY + 100, { align: 'right' })
  const px = 67, py = slipY + 5
  pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.text('Section paiement', px, py + 4)
  const qrX = px, qrY = py + 8
  pdf.addImage(qrDataUrl, 'PNG', qrX, qrY, 46, 46)
  const cx = qrX + 23 - 3.5, cy = qrY + 23 - 3.5
  pdf.setFillColor(255, 255, 255); pdf.rect(cx, cy, 7, 7, 'F')
  pdf.setFillColor(0, 0, 0); pdf.rect(cx + 2, cy + 0.5, 3, 6, 'F'); pdf.rect(cx + 0.5, cy + 2, 6, 3, 'F')
  pdf.setFontSize(6); pdf.setFont('helvetica', 'bold')
  pdf.text('Monnaie', px, qrY + 50); pdf.text('Montant', px + 25, qrY + 50)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
  pdf.text('CHF', px, qrY + 56); pdf.text(solde.value.toFixed(2), px + 25, qrY + 56)
  const dx = px + 50, dy = py + 8
  pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Compte / Payable à', dx, dy)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
  pdf.text(ibanFmt, dx, dy + 4); pdf.text(b.nom || '', dx, dy + 8)
  pdf.text(b.adresse || '', dx, dy + 12); pdf.text(b.localite || '', dx, dy + 16)
  pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Référence', dx, dy + 24)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.text(numeroFacture.value, dx, dy + 28)
  pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.text('Payable par', dx, dy + 36)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
  if (client) { pdf.text(cNom, dx, dy + 40); if (cAdL1) pdf.text(cAdL1, dx, dy + 44); if (cAdL2) pdf.text(cAdL2, dx, dy + 48) }
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

// ── Export PDF (page 1 html2canvas + page 2 QR-bill) ─────
const sanitiserNom = (nom) => (nom || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'Client'

const exporterPDF = async () => {
  exportEnCours.value = true
  notifPdfExport.value = null
  try {
    const dossierBase = props.config.dossierPDF
    const nomClient = sanitiserNom(nomCompletClient(clientSelectionne.value) || 'Sans_Nom')
    const nomFichier = `${numeroFacture.value}_${nomClient}.pdf`

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

    const element = document.getElementById('facture-imprimable')
    element.classList.add('pdf-bw')
    await new Promise(r => setTimeout(r, 50))

    const scaleCapture = 2
    const pointsDeCoupe = trouverPointsDeCoupeSurs(element, scaleCapture)
    const canvas = await html2canvas(element, { scale: scaleCapture, useCORS: true, allowTaint: true, logging: false, height: element.scrollHeight, windowHeight: element.scrollHeight, scrollY: 0 })
    element.classList.remove('pdf-bw')

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pages = paginerCanvas(canvas, pointsDeCoupe, { margeHautMm: 13 })
    const pxParMm = canvas.width / 210
    pages.forEach((p, i) => {
      if (i > 0) pdf.addPage()
      const dataUrl = extraireBandeCanvas(canvas, p.from, p.to)
      pdf.addImage(dataUrl, 'PNG', 0, p.margeHaut, 210, (p.to - p.from) / pxParMm)
    })

    // ── Page 2 : QR-bill suisse (pas de bulletin pour un paiement en magasin) ──
    if (delaiPaiement.value !== 'magasin') await _ajouterPageQR(pdf)

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
      <div v-if="notifValidation" class="toast-valide">✓ Facture validée et enregistrée !</div>
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
        <h2>Éditeur de Facture</h2>
        <div style="display:flex;align-items:center;gap:0.6rem;margin-top:0.2rem;">
          <p class="subtitle" style="margin:0;">Créez et exportez une facture professionnelle.</p>
          <span v-if="statutCourant === 'Payée'" class="statut-pill statut-valide">✓ Payée</span>
          <span v-else-if="statutCourant === 'Envoyée'" class="statut-pill statut-envoyee">➤ Envoyée</span>
          <span v-else-if="statutCourant === 'Brouillon'" class="statut-pill statut-brouillon">● Brouillon</span>
          <span v-else class="statut-pill statut-nouveau">◎ Nouvelle</span>
        </div>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <button @click="réinitialiserEditeur" class="btn-secondary" style="margin-top:0;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nouveau
        </button>
        <button @click="imprimer" class="btn-secondary" style="margin-top:0;" title="Ouvre la fenêtre d'impression du système (avec le bulletin QR en page 2, sauf paiement en magasin).">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Imprimer
        </button>
        <button @click="marquerEnvoyee" class="btn-secondary" style="margin-top:0;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Marquer envoyée
        </button>
        <button @click="validerFacture" class="btn-valider">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Marquer payée
        </button>
        <button @click="exporterPDF" class="btn-success" :disabled="exportEnCours" title="Génère le PDF complet (avec bulletin QR de paiement) et l'ouvre.">
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
          <label class="field-lbl">N° de Facture</label>
          <input v-model="numeroFacture" type="text" />
        </div>
        <div>
          <label class="field-lbl">Date d'Émission</label>
          <input v-model="dateFacture" type="date" />
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
      <div style="margin-top:0.875rem;display:flex;align-items:center;gap:0.75rem;">
        <label class="field-lbl" style="white-space:nowrap;margin:0;">Délai de paiement</label>
        <div class="delai-toggle">
          <button :class="['delai-btn', delaiPaiement === 10 ? 'active' : '']" @click="delaiPaiement = 10">10 jours</button>
          <button :class="['delai-btn', delaiPaiement === 30 ? 'active' : '']" @click="delaiPaiement = 30">30 jours</button>
          <button :class="['delai-btn', delaiPaiement === 'magasin' ? 'active' : '']" @click="delaiPaiement = 'magasin'">Paiement en magasin</button>
        </div>
      </div>
    </section>

    <!-- Bouton flottant quitter aperçu -->
    <button v-if="modeApercu" @click="modeApercu = false" class="btn-floating-quit no-print">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Mode Édition
    </button>

    <!-- ═══ DOCUMENT A4 ═══ -->
    <div id="facture-imprimable" class="a4-page">

      <!-- Raccourcis tarifs (éditeur seulement) -->
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
            <div><span class="a4-info-lbl">Facture N° :</span> {{ numeroFacture }}</div>
            <div><span class="a4-info-lbl">Date :</span> {{ dateFacture }}</div>
            <div v-if="delaiPaiement === 'magasin'"><span class="a4-info-lbl">Règlement :</span> en magasin</div>
            <div v-else><span class="a4-info-lbl">Échéance :</span> à {{ delaiPaiement }} jours</div>
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
          <div class="a4-section-lbl">Facturé à :</div>
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

      <!-- Bouton ajout ligne (no-print) -->
      <div class="no-print" v-if="!modeApercu" style="margin-bottom:0.5rem;display:flex;gap:0.5rem;">
        <button @click="ajouterLigne()" class="btn-secondary" style="font-size:0.82rem;">＋ Ajouter une ligne</button>
        <button @click="ajouterGroupe" class="btn-secondary" style="font-size:0.82rem;">＋ Ajouter un groupe (ex : Alliance Marie)</button>
      </div>

      <!-- Sections d'articles (une section = un groupe nommé, ou une seule section "commune") -->
      <div v-for="(section, sIndex) in sections" :key="sIndex" class="groupe-bloc">
        <div v-if="modeGroupe" class="groupe-header">
          <template v-if="!modeApercu">
            <input class="groupe-nom-input no-print" :value="section.nom" @input="renommerGroupe(section.nom, $event.target.value)" placeholder="Nom du groupe (ex: Alliance Marie)" />
            <div class="groupe-header-actions no-print">
              <button @click="ajouterLigneDansGroupe(section.nom)" class="btn-secondary btn-xs">＋ Ligne</button>
              <button @click="supprimerGroupe(section.nom)" class="btn-danger-xs" title="Supprimer ce groupe">✕</button>
            </div>
          </template>
          <div v-else class="groupe-titre-apercu">{{ section.nom || 'Commun' }}</div>
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
          <div class="groupe-total-ttc"><span>Total</span><span>{{ section.ttc.toFixed(2) }} CHF</span></div>
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
      </div>

      <!-- Totaux -->
      <div class="a4-totals">
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
          <span class="a4-total-lbl">Arrondi</span><span class="a4-total-val">{{ arrondiDiff > 0 ? '+' : '' }}{{ arrondiDiff.toFixed(2) }} CHF</span>
        </div>
        <div class="a4-grand-total-row">
          <span class="a4-grand-lbl">Total TTC</span>
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
      <div class="a4-footer">
        <div class="a4-footer-col" v-if="boutique.iban && delaiPaiement !== 'magasin'">
          <div class="a4-footer-lbl">Règlement :</div>
          <div class="a4-footer-sub">Par virement bancaire :</div>
          <div class="a4-footer-info" v-if="boutique.banque">Banque : {{ boutique.banque }}</div>
          <div class="a4-footer-info">IBAN : {{ boutique.iban }}</div>
          <div class="a4-footer-info" v-if="boutique.tvaNumero">{{ boutique.tvaNumero }}</div>
        </div>
        <div class="a4-footer-col">
          <div class="a4-footer-lbl">Conditions de paiement</div>
          <div class="a4-footer-info" v-if="delaiPaiement === 'magasin'">Payable directement en magasin (espèces ou carte).</div>
          <div class="a4-footer-info" v-else>Payable à {{ delaiPaiement }} jours dès réception de la présente facture.</div>
        </div>
      </div>

    </div>

    <!-- QR Bill — visible uniquement à l'impression -->
    <div v-if="qrPrintDataUrl" class="qr-bill-print-wrapper">
      <div class="qr-bill-cut-line">✂</div>
      <div class="qr-bill-body">
        <!-- Récépissé (gauche 62mm) -->
        <div class="qr-receipt">
          <div class="qr-section-title">Récépissé</div>
          <div class="qr-lbl">Compte / Payable à</div>
          <div class="qr-val">{{ boutique.iban }}</div>
          <div class="qr-val">{{ boutique.nom }}</div>
          <div class="qr-val">{{ boutique.adresse }}</div>
          <div class="qr-val">{{ boutique.localite }}</div>
          <template v-if="clientSelectionne">
            <div class="qr-lbl" style="margin-top:3mm;">Payable par</div>
            <div class="qr-val">{{ nomCompletClient(clientSelectionne) }}</div>
            <div class="qr-val">{{ adresseLigne1(clientSelectionne) }}</div>
            <div class="qr-val">{{ adresseLigne2(clientSelectionne) }}</div>
          </template>
          <div class="qr-currency-row">
            <div><div class="qr-lbl">Monnaie</div><div class="qr-val">CHF</div></div>
            <div><div class="qr-lbl">Montant</div><div class="qr-val">{{ solde.toFixed(2) }}</div></div>
          </div>
          <div class="qr-depot">Point de dépôt</div>
        </div>
        <!-- Séparateur vertical -->
        <div class="qr-vert-line"></div>
        <!-- Section paiement (droite) -->
        <div class="qr-payment">
          <div class="qr-section-title">Section paiement</div>
          <div class="qr-payment-top">
            <img :src="qrPrintDataUrl" class="qr-code-img" />
            <div>
              <div class="qr-currency-row">
                <div><div class="qr-lbl">Monnaie</div><div class="qr-val">CHF</div></div>
                <div><div class="qr-lbl">Montant</div><div class="qr-val">{{ solde.toFixed(2) }}</div></div>
              </div>
            </div>
          </div>
          <div class="qr-payment-info">
            <div>
              <div class="qr-lbl">Compte / Payable à</div>
              <div class="qr-val">{{ boutique.iban }}</div>
              <div class="qr-val">{{ boutique.nom }}</div>
              <div class="qr-val">{{ boutique.adresse }}</div>
              <div class="qr-val">{{ boutique.localite }}</div>
            </div>
            <div>
              <div class="qr-lbl">Référence</div>
              <div class="qr-val">{{ numeroFacture }}</div>
              <template v-if="clientSelectionne">
                <div class="qr-lbl" style="margin-top:3mm;">Payable par</div>
                <div class="qr-val">{{ nomCompletClient(clientSelectionne) }}</div>
                <div class="qr-val">{{ adresseLigne1(clientSelectionne) }}</div>
                <div class="qr-val">{{ adresseLigne2(clientSelectionne) }}</div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.field-lbl { font-size: 0.82rem; font-weight: 600; color: #7a5c30; display: block; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.4px; }

/* ── A4 Document ─────────────────────────────── */
.a4-page { background: #FFFFFF; width: 210mm; min-height: 297mm; margin: 0 auto; box-sizing: border-box; padding: 11mm 15mm; font-size: 11.5px; color: #0f172a; line-height: 1.32; }
.a4-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.3rem; }
.a4-logo-zone { flex: 0 0 auto; max-width: 45%; }
.a4-enseigne { font-size: 1.3rem; font-weight: 800; letter-spacing: -0.2px; }
.a4-title-zone { text-align: right; }
.a4-doc-type { font-size: 3.4rem; font-weight: 900; letter-spacing: 6px; line-height: 1; margin-bottom: 0.6rem; color: #0f172a; }
.a4-doc-infos { font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.8; }
.a4-info-lbl { color: #64748b; }
.a4-hr { border: none; border-top: 1.5px solid #0f172a; margin: 0 0 1.1rem; }
.a4-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5rem; margin-bottom: 1.3rem; }
.a4-section-lbl { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.9px; margin-bottom: 0.4rem; }
.a4-party-info { font-size: 0.84rem; line-height: 1.5; color: #334155; }
.a4-party-name { font-weight: 700; color: #0f172a; font-size: 0.92rem; }
.a4-table { width: 100%; border-collapse: collapse; margin-bottom: 0.3rem; }
.a4-table th { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; padding: 0.5rem 0.5rem 0.5rem 0; border-bottom: 1.5px solid #0f172a; text-align: left; }
.a4-table td { padding: 0.55rem 0.5rem 0.55rem 0; border-bottom: 1px solid #e0d5c5; font-size: 0.86rem; vertical-align: middle; }
.a4-table tbody tr:last-child td { border-bottom: none; }
.a4-table tr, .groupe-bloc, .a4-totals, .a4-footer { break-inside: avoid; page-break-inside: avoid; }
.groupe-actif-select { padding: 0.32rem 0.55rem; border: 1px solid #d4c9b8; border-radius: 6px; font-size: 0.84rem; background: #fff; color: #3d2a14; }
.groupe-bloc { margin-bottom: 1rem; }
.groupe-bloc:last-of-type { margin-bottom: 0; }
.groupe-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.35rem; }
.groupe-nom-input { flex: 1; font-size: 0.98rem; font-weight: 700; color: #0f172a; border: 1px dashed #d4c9b8; border-radius: 6px; padding: 0.4rem 0.65rem; background: #faf6ef; }
.groupe-header-actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
.btn-xs { font-size: 0.76rem; padding: 0.3rem 0.6rem; }
.groupe-titre-apercu { font-size: 1rem; font-weight: 800; color: #0f172a; padding-bottom: 0.3rem; border-bottom: 1.5px solid #0f172a; }
.groupe-remise-ctrl { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; background: #faf6ef; border: 1px dashed #d4b896; border-radius: 8px; padding: 0.5rem 0.75rem; margin-top: 0.35rem; font-size: 0.82rem; }
.groupe-total-box { display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; margin-top: 0.3rem; margin-bottom: 0.35rem; }
.groupe-total-box .a4-total-row { width: 290px; }
.groupe-total-ttc { display: flex; justify-content: space-between; width: 290px; font-weight: 800; font-size: 0.9rem; padding-top: 0.25rem; margin-top: 0.15rem; border-top: 1px solid #e0d5c5; }
.a4-totals { display: flex; flex-direction: column; align-items: flex-end; margin-top: 0.9rem; margin-bottom: 1.3rem; gap: 0.2rem; }
.a4-total-row { display: flex; width: 300px; justify-content: space-between; font-size: 0.82rem; padding: 0.15rem 0; }
.a4-total-lbl { font-weight: 700; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.5px; color: #475569; }
.a4-total-val { font-weight: 600; color: #0f172a; }
.a4-total-discount .a4-total-lbl, .a4-total-discount .a4-total-val { color: #dc2626; }
.a4-grand-total-row { display: flex; width: 300px; justify-content: space-between; padding: 0.35rem 0 0.15rem; border-top: 1.5px solid #0f172a; margin-top: 0.2rem; }
.a4-grand-lbl { font-size: 0.78rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
.a4-grand-val { font-weight: 800; font-size: 1rem; }
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
.btn-valider { background: #0284c7; color: #fff; border: none; padding: 0.62rem 1.35rem; border-radius: 7px; font-weight: 700; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; gap: 0.45rem; }
.btn-valider:hover { background: #0369a1; transform: translateY(-1px); }
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
.delai-toggle { display: flex; gap: 0; border: 1.5px solid #d4b896; border-radius: 7px; overflow: hidden; }
.delai-btn { padding: 0.35rem 0.9rem; font-size: 0.82rem; font-weight: 600; border: none; background: #fff; color: #8a7055; cursor: pointer; transition: all 0.15s; border-radius: 0; }
.delai-btn.active { background: #C5A059; color: #0B3D2E; }
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

/* ── QR Bill print page ─────────────────────── */
.qr-bill-print-wrapper { display: none; }
@media print {
  .qr-bill-print-wrapper {
    display: flex !important;
    flex-direction: column;
    justify-content: flex-end;
    height: 297mm;
    box-sizing: border-box;
    overflow: hidden;
    page-break-before: always;
    page-break-inside: avoid;
    font-family: Arial, sans-serif;
  }
  .qr-bill-cut-line {
    font-size: 9pt;
    color: #aaa;
    border-top: 1px dashed #aaa;
    padding-top: 1mm;
    margin-bottom: 2mm;
    line-height: 1;
  }
  .qr-bill-body {
    display: flex;
    height: 100mm;
    border: 0.5pt solid #ccc;
  }
  .qr-receipt {
    width: 62mm;
    padding: 3mm 4mm;
    border-right: 1px dashed #aaa;
    display: flex;
    flex-direction: column;
    font-size: 8pt;
    overflow: hidden;
    box-sizing: border-box;
  }
  .qr-vert-line { display: none; }
  .qr-payment {
    flex: 1;
    padding: 3mm 4mm;
    font-size: 8pt;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  }
  .qr-section-title { font-size: 11pt; font-weight: bold; margin-bottom: 3mm; }
  .qr-lbl { font-size: 6pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3pt; margin-top: 2mm; margin-bottom: 0.5mm; }
  .qr-val { font-size: 8pt; line-height: 1.3; }
  .qr-currency-row { display: flex; gap: 5mm; margin-top: auto; margin-bottom: 2mm; }
  .qr-depot { font-size: 6pt; font-weight: bold; text-align: right; margin-top: auto; }
  .qr-payment-top { display: flex; align-items: flex-end; gap: 4mm; margin-bottom: 3mm; }
  .qr-code-img { width: 46mm; height: 46mm; }
  .qr-payment-info { display: flex; gap: 5mm; flex: 1; }
}
</style>
