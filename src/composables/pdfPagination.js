// Pagination "intelligente" pour l'export PDF via html2canvas + jsPDF.
//
// Par défaut, découper une capture d'écran unique en tranches de hauteur fixe
// (une par page A4) coupe le texte n'importe où — au milieu d'une ligne de
// tableau, d'un paragraphe — et ne laisse aucune marge en haut des pages
// suivantes (seule la toute première "hérite" du padding CSS de l'élément
// capturé). Ces fonctions cherchent plutôt de vrais points de coupe (bas de
// ligne de tableau, bas de bloc) proches de chaque limite de page, et
// réservent une marge haute cohérente sur les pages 2, 3, etc.

// Sélecteurs des blocs qu'on ne veut jamais couper en deux : lignes de
// tableau et grands blocs de mise en page du document.
const SELECTEURS_BLOCS_INSECABLES =
  '.a4-table tr, .invoice-table tr, .groupe-bloc, .a4-top, .a4-parties, .a4-project-title, ' +
  '.adjustments-panel, .a4-totals, .a4-footer, .groupe-remise-ctrl, .groupe-total-box, ' +
  '.invoice-header, .doc-project-title, .apercu-footer'

// Repère, sur l'élément réellement affiché (avant capture), le bas de chaque
// bloc insécable — exprimé en pixels du canvas (donc déjà multiplié par le
// facteur d'échelle html2canvas), relativement au haut de l'élément capturé.
export function trouverPointsDeCoupeSurs(element, scale) {
  const zone = element.getBoundingClientRect()
  const points = []
  element.querySelectorAll(SELECTEURS_BLOCS_INSECABLES).forEach(el => {
    const r = el.getBoundingClientRect()
    points.push((r.bottom - zone.top) * scale)
  })
  return points.sort((a, b) => a - b)
}

// Position (en px canvas, relative au haut de l'élément capturé) du haut de
// chaque élément correspondant à `selecteur`, dans l'ordre du DOM. Sert à
// convertir un choix utilisateur ("saut de page avant le 3e groupe") en
// coordonnée exploitable par paginerCanvas().
export function trouverHautsDesBlocs(element, scale, selecteur) {
  const zone = element.getBoundingClientRect()
  const hauts = []
  element.querySelectorAll(selecteur).forEach(el => {
    const r = el.getBoundingClientRect()
    hauts.push((r.top - zone.top) * scale)
  })
  return hauts
}

// Découpe un canvas (déjà rendu) en pages, en essayant de faire coïncider
// chaque limite de page avec un point de coupe sûr plutôt qu'une hauteur
// brute. `margeHautMm` est réservée en haut de chaque page à partir de la 2e
// (la première a déjà son padding CSS d'origine intégré à l'image).
// `sautsPageForces` : positions (px canvas) où l'utilisateur a explicitement
// demandé un saut de page — appliquées même si la page courante avait encore
// de la place, pour garantir qu'un groupe démarre toujours en haut d'une page.
export function paginerCanvas(canvas, pointsDeCoupe, { pageWmm = 210, pageHmm = 297, margeHautMm = 13, sautsPageForces = [] } = {}) {
  const pxParMm = canvas.width / pageWmm
  const hauteurPagePleine = pageHmm * pxParMm
  const hauteurPageSuivante = (pageHmm - margeHautMm) * pxParMm
  const sauts = [...sautsPageForces].sort((a, b) => a - b)

  const pages = []
  let curseur = 0
  let premierePage = true
  while (curseur < canvas.height - 1) {
    const hauteurDispo = premierePage ? hauteurPagePleine : hauteurPageSuivante
    let limite = curseur + hauteurDispo

    const prochainSaut = sauts.find(s => s > curseur)
    const sautForce = prochainSaut !== undefined && prochainSaut < limite
    if (sautForce) limite = prochainSaut

    if (limite >= canvas.height) {
      pages.push({ from: curseur, to: canvas.height, margeHaut: premierePage ? 0 : margeHautMm })
      break
    }

    let coupe
    if (sautForce) {
      // Le saut demandé est déjà le haut d'un bloc : pas besoin de chercher
      // un point sûr, on coupe exactement là.
      coupe = limite
    } else {
      coupe = null
      for (const p of pointsDeCoupe) {
        if (p > curseur && p <= limite) coupe = p
      }
      // Aucun point sûr trouvé (bloc plus grand qu'une page) : on coupe brut,
      // en dernier recours, pour ne pas boucler indéfiniment.
      if (coupe === null) coupe = limite
    }

    pages.push({ from: curseur, to: coupe, margeHaut: premierePage ? 0 : margeHautMm })
    curseur = coupe
    premierePage = false
  }
  return pages
}

// Extrait une bande horizontale [from, to) du canvas source sous forme de
// data URL PNG, prête à être posée sur une page PDF.
export function extraireBandeCanvas(canvasSource, from, to) {
  const bande = document.createElement('canvas')
  bande.width = canvasSource.width
  bande.height = Math.max(1, Math.round(to - from))
  const ctx = bande.getContext('2d')
  ctx.drawImage(canvasSource, 0, from, canvasSource.width, bande.height, 0, 0, canvasSource.width, bande.height)
  return bande.toDataURL('image/png')
}

// Ajoute à un document jsPDF (déjà créé) le contenu paginé d'un canvas,
// une page par tranche calculée par paginerCanvas(). `nouvellePage` contrôle
// si une page vierge doit être créée avant la toute première tranche (mettre
// à false si le PDF a déjà une page vide prête à l'emploi).
export function ajouterCanvasPagine(pdf, canvas, element, { scale = 2, pageWmm = 210, pageHmm = 297, margeHautMm = 13, nouvellePage = false } = {}) {
  const pointsDeCoupe = trouverPointsDeCoupeSurs(element, scale)
  const pages = paginerCanvas(canvas, pointsDeCoupe, { pageWmm, pageHmm, margeHautMm })
  const pxParMm = canvas.width / pageWmm

  pages.forEach((p, i) => {
    if (i > 0 || nouvellePage) pdf.addPage()
    const dataUrl = extraireBandeCanvas(canvas, p.from, p.to)
    const hMm = (p.to - p.from) / pxParMm
    pdf.addImage(dataUrl, 'PNG', 0, p.margeHaut, pageWmm, hMm)
  })

  return pages.length
}
