<script setup>
import { ref, onMounted, watch } from 'vue'
import { writeTextFile, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import { save, open } from '@tauri-apps/plugin-dialog'
import DevisView from './views/DevisView.vue'
import ClientsView from './views/ClientsView.vue'
import ConfigView from './views/ConfigView.vue'
import BoutiqueView from './views/BoutiqueView.vue'
import DevisListeView from './views/DevisListeView.vue'
import FactureView from './views/FactureView.vue'
import FactureListeView from './views/FactureListeView.vue'

// L'onglet actif au démarrage
const ongletActif = ref('devis')
const ready = ref(false)
const devisViewRef = ref(null)
const factureViewRef = ref(null)

// --- DONNÉES PAR DÉFAUT DE LA BOUTIQUE ---
const boutique = ref({
  nom: 'Colayco Sarl',
  telephone: '0788687423',
  email: 'contact@colayco.ch',
  adresse: 'Rue du Seyon 4',
  localite: '2000 Neuchâtel',
  logo: '',
  logoTaille: '90px',
  tvaNumero: 'CHE-000.000.000 TVA',
  iban: 'CH76 0000 0000 0000 0000 0',
  banque: '',
  conditions: 'Devis valable 30 jours. Les cours des métaux précieux sont sujets à fluctuation. Un acompte de 50% est requis pour lancer la fabrication.'
})

// --- DONNÉES PAR DÉFAUT DE LA CONFIG ---
const config = ref({
  metaux: [
    { id: 1, nom: 'Or Fin 24K',     prixGramme: 68.50, symboleAPI: 'gold'   },
    { id: 2, nom: 'Or 18K Alliage', prixGramme: 53.20, symboleAPI: null     },
    { id: 3, nom: 'Argent 925',     prixGramme: 0.95,  symboleAPI: 'silver' },
  ],
  cirePerdue: 45.00,
  impression3d: 35.00,
  perteMetal: 8.00,
  tauxHoraire: 90.00,
  tvaTaux: 8.1,
  tvaMode: 'incluse',
  dossierPDF: '',
  diamants: [
    { id: 101, nom: 'Diamant', taille: '1.0 mm', prix: 12.00 },
    { id: 102, nom: 'Diamant', taille: '1.25 mm', prix: 15.00 },
    { id: 103, nom: 'Diamant', taille: '1.5 mm', prix: 18.00 },
    { id: 104, nom: 'Diamant', taille: '2.0 mm', prix: 28.00 },
    { id: 105, nom: 'Diamant', taille: '2.5 mm', prix: 45.00 },
    { id: 106, nom: 'Diamant', taille: '3.0 mm', prix: 75.00 },
    { id: 107, nom: 'Diamant', taille: '3.5 mm', prix: 120.00 },
    { id: 108, nom: 'Diamant', taille: '4.0 mm', prix: 190.00 },
    { id: 109, nom: 'Diamant', taille: '4.5 mm', prix: 310.00 },
  ],
  prestations: []
})

// --- DONNÉES PAR DÉFAUT DES CLIENTS ---
const clients = ref([
  { id: 1, civilite: '', prenom: '', nom: 'Atelier Bijouterie Lausanne', rue: 'Rue de Bourg', numero: '12', npa: '1003', lieu: 'Lausanne', email: 'contact@lausanne-bijoux.ch', telephone: '021 311 00 00' },
  { id: 2, civilite: 'Madame', prenom: 'Sophie', nom: 'Martin', rue: 'Place Pury', numero: '4', npa: '2000', lieu: 'Neuchâtel', email: 'info@galeriene.ch', telephone: '032 721 00 00' }
])

// --- LISTE DE STOCKAGE DE L'HISTORIQUE ---
const devisListe = ref([])
const prochainNumeroDevis = ref(1)
const factureListe = ref([])
const prochainNumeroFacture = ref(1)
const derniereSauvegarde = ref(null)

// --- CHARGEMENT AUTOMATIQUE INITIAL ---
onMounted(async () => {
  try {
    const contenu = await readTextFile('colayco_data.json', { baseDir: BaseDirectory.AppLocalData })
    const data = JSON.parse(contenu)
    if (data.boutique) boutique.value = data.boutique
    if (data.config) {
      // Migration : ancien format orFin/or18k/argent925 → tableau metaux
      if (!data.config.metaux && data.config.orFin !== undefined) {
        data.config.metaux = [
          { id: 1, nom: 'Or Fin 24K',     prixGramme: data.config.orFin    ?? 68.50, symboleAPI: 'gold'   },
          { id: 2, nom: 'Or 18K Alliage', prixGramme: data.config.or18k    ?? 53.20, symboleAPI: null     },
          { id: 3, nom: 'Argent 925',     prixGramme: data.config.argent925 ?? 0.95,  symboleAPI: 'silver' },
        ]
        delete data.config.orFin; delete data.config.or18k; delete data.config.argent925
      }
      // Migration : assurer la présence des nouveaux champs
      if (data.config.perteMetal === undefined) data.config.perteMetal = 8.00
      if (data.config.tauxHoraire === undefined) data.config.tauxHoraire = 90.00
      if (data.config.tvaTaux === undefined) data.config.tvaTaux = 8.1
      if (data.config.tvaMode === undefined) data.config.tvaMode = 'incluse'
      if (data.config.dossierPDF === undefined) data.config.dossierPDF = ''
      if (data.boutique && data.boutique.banque === undefined) data.boutique.banque = ''
      if (data.config.prestations === undefined) data.config.prestations = []
      // Migration diamants : ajouter id et nom si manquants
      if (data.config.diamants) {
        data.config.diamants = data.config.diamants.map((d, i) => ({
          id: d.id ?? (200 + i),
          nom: d.nom ?? 'Diamant',
          taille: d.taille,
          prix: d.prix
        }))
      }
      config.value = data.config
    }
    if (data.clients) {
      clients.value = data.clients.map(c => {
        if (c.rue === undefined) {
          // Migration ancien format : nom + adresse → champs séparés
          return {
            id: c.id, civilite: c.civilite || '', prenom: c.prenom || '',
            nom: c.nom || '', rue: c.adresse || '', numero: '',
            npa: '', lieu: '', email: c.email || '', telephone: c.telephone || ''
          }
        }
        return c
      })
    }
    if (data.devisListe) {
      // Migration : ajouter statut 'Validé' aux anciens devis sans statut
      devisListe.value = data.devisListe.map(d => ({ ...d, statut: d.statut ?? 'Validé' }))
    }
    if (data.prochainNumeroDevis) prochainNumeroDevis.value = data.prochainNumeroDevis
    if (data.factureListe) {
      factureListe.value = data.factureListe.map(f => ({ ...f, statut: f.statut ?? 'Validé' }))
    }
    if (data.prochainNumeroFacture) prochainNumeroFacture.value = data.prochainNumeroFacture
    console.log("Données Colayco chargées avec succès.")
  } catch (e) {
    console.log("Aucun fichier colayco_data.json trouvé. Utilisation des valeurs par défaut.")
  } finally {
    ready.value = true
  }
})

// --- SAUVEGARDE AUTOMATIQUE LOCAL FILE ---
watch([boutique, config, clients, devisListe, prochainNumeroDevis, factureListe, prochainNumeroFacture], async () => {
  if (!ready.value) return
  try {
    const dataAEnregistrer = {
      boutique: boutique.value,
      config: config.value,
      clients: clients.value,
      devisListe: devisListe.value,
      prochainNumeroDevis: prochainNumeroDevis.value,
      factureListe: factureListe.value,
      prochainNumeroFacture: prochainNumeroFacture.value
    }
    await writeTextFile('colayco_data.json', JSON.stringify(dataAEnregistrer, null, 2), {
      baseDir: BaseDirectory.AppLocalData
    })
    derniereSauvegarde.value = new Date().toLocaleTimeString('fr-CH')
  } catch (err) {
    console.error("Erreur d'écriture dans le fichier local :", err)
  }
}, { deep: true })

// --- ACTIONS INTERFACES ---
const gererAjoutClient = (clientData) => {
  clients.value.push({ id: Date.now(), ...clientData })
}

const gererMiseAJourLogo = (logoBase64) => {
  boutique.value.logo = logoBase64
}

const incrementerNumeroDevis = () => { prochainNumeroDevis.value++ }
const incrementerNumeroFacture = () => { prochainNumeroFacture.value++ }

const sauvegarderManuellement = async () => {
  try {
    await writeTextFile('colayco_data.json', JSON.stringify({
      boutique: boutique.value,
      config: config.value,
      clients: clients.value,
      devisListe: devisListe.value,
      prochainNumeroDevis: prochainNumeroDevis.value,
      factureListe: factureListe.value,
      prochainNumeroFacture: prochainNumeroFacture.value
    }, null, 2), { baseDir: BaseDirectory.AppLocalData })
    derniereSauvegarde.value = new Date().toISOString()  // valeur unique à chaque appel
  } catch (err) {
    console.error('Erreur sauvegarde manuelle :', err)
  }
}

const selectionnerDossierPDF = async () => {
  const dossier = await open({ directory: true, title: 'Choisir le dossier d\'enregistrement des PDF' })
  if (dossier) config.value.dossierPDF = dossier
}

// --- BACKUP EXTERNE ---
const exporterBackup = async () => {
  try {
    const cheminFichier = await save({
      defaultPath: 'Backup_Colayco_Data.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!cheminFichier) return
    const contenu = JSON.stringify({
      boutique: boutique.value,
      config: config.value,
      clients: clients.value,
      devisListe: devisListe.value,
      factureListe: factureListe.value
    }, null, 2)
    await writeTextFile(cheminFichier, contenu)
    alert('Sauvegarde exportée avec succès !')
  } catch (err) {
    console.error('Erreur backup :', err)
    alert('Impossible d\'exporter la sauvegarde.')
  }
}

const chargerDevisDansEditeur = (devisCopie) => {
  ongletActif.value = 'devis'
  setTimeout(() => {
    if (devisViewRef.value) {
      devisViewRef.value.chargerDevisExistant(devisCopie)
    }
  }, 100)
}

const chargerFactureDansEditeur = (factureCopie) => {
  ongletActif.value = 'facture'
  setTimeout(() => {
    if (factureViewRef.value) {
      factureViewRef.value.chargerFactureExistant(factureCopie)
    }
  }, 100)
}

const chargerDevisCommeFacture = (devis) => {
  const nouvelleFacture = {
    numero: `FAC-${new Date().getFullYear()}-${String(prochainNumeroFacture.value).padStart(4, '0')}`,
    date: new Date().toISOString().split('T')[0],
    client: devis.client ? { ...devis.client } : null,
    articles: JSON.parse(JSON.stringify(devis.articles)),
    remise: devis.remise ? JSON.parse(JSON.stringify(devis.remise)) : { active: false, mode: 'pourcent', valeur: 0 },
    arrondi: devis.arrondi || false,
    acompte: devis.acompte ? JSON.parse(JSON.stringify(devis.acompte)) : { montant: 0, date: '' },
    delaiPaiement: 30,
    totalTTC: devis.totalTTC,
    statut: 'Brouillon'
  }
  ongletActif.value = 'facture'
  setTimeout(() => {
    if (factureViewRef.value) factureViewRef.value.chargerFactureExistant(nouvelleFacture)
  }, 100)
}
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar no-print">
      <div class="brand">
        <span class="brand-name" style="marginBottom:10px">Colayco</span>
        <span class="brand-sub">Gestion des Devis</span>
      </div>
      <nav>
        <div class="nav-section-label">Devis</div>
        <button :class="{ active: ongletActif === 'devis' }" @click="ongletActif = 'devis'">
          <span class="nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>
            </svg>
          </span>
          Éditeur Devis
        </button>
        <button :class="{ active: ongletActif === 'liste-devis' }" @click="ongletActif = 'liste-devis'">
          <span class="nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
            </svg>
          </span>
          Historique <span class="nav-badge">{{ devisListe.length }}</span>
        </button>

        <div class="nav-section-label" style="margin-top: 0.5rem;">Factures</div>
        <button :class="{ active: ongletActif === 'facture' }" @click="ongletActif = 'facture'">
          <span class="nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><line x1="7" y1="8" x2="15" y2="8"/><line x1="7" y1="12" x2="11" y2="12"/>
            </svg>
          </span>
          Éditeur Facture
        </button>
        <button :class="{ active: ongletActif === 'liste-factures' }" @click="ongletActif = 'liste-factures'">
          <span class="nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </span>
          Hist. Factures <span class="nav-badge">{{ factureListe.length }}</span>
        </button>

        <div class="nav-section-label" style="margin-top: 0.5rem;">Paramètres</div>
        <button :class="{ active: ongletActif === 'clients' }" @click="ongletActif = 'clients'">
          <span class="nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </span>
          Clients
        </button>
        <button :class="{ active: ongletActif === 'config' }" @click="ongletActif = 'config'">
          <span class="nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
            </svg>
          </span>
          Tarifs & Matières
        </button>
        <button :class="{ active: ongletActif === 'boutique' }" @click="ongletActif = 'boutique'">
          <span class="nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </span>
          Config. PDF
        </button>
      </nav>
      <div class="sidebar-footer">Colayco Sarl &copy; 2026</div>
    </aside>

    <main class="content">
      <DevisView ref="devisViewRef" v-if="ongletActif === 'devis'" :config="config" :clients="clients" :boutique="boutique" :devisListe="devisListe" :prochainNumero="prochainNumeroDevis" @numero-utilise="incrementerNumeroDevis" @convertir-en-facture="chargerDevisCommeFacture" />
      <DevisListeView v-if="ongletActif === 'liste-devis'" :devisListe="devisListe" :boutique="boutique" :config="config" @charger-devis="chargerDevisDansEditeur" @convertir-en-facture="chargerDevisCommeFacture" />
      <FactureView ref="factureViewRef" v-if="ongletActif === 'facture'" :config="config" :clients="clients" :boutique="boutique" :facturesListe="factureListe" :prochainNumeroFacture="prochainNumeroFacture" @facture-numero-utilise="incrementerNumeroFacture" />
      <FactureListeView v-if="ongletActif === 'liste-factures'" :factureListe="factureListe" :boutique="boutique" :config="config" @charger-facture="chargerFactureDansEditeur" />
      <ClientsView v-if="ongletActif === 'clients'" :clients="clients" @add-client="gererAjoutClient" />
      <ConfigView v-if="ongletActif === 'config'" :config="config" :derniereSauvegarde="derniereSauvegarde" @backup-data="exporterBackup" @sauvegarder="sauvegarderManuellement" />
      <BoutiqueView v-if="ongletActif === 'boutique'" :boutique="boutique" :config="config" :derniereSauvegarde="derniereSauvegarde" @update-logo="gererMiseAJourLogo" @select-pdf-folder="selectionnerDossierPDF" @sauvegarder="sauvegarderManuellement" />
    </main>
  </div>
</template>

<style>
/* === COLAYCO — THÈME RAFFINÉ === */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: #F9F7F2; }

.app-layout {
  display: flex; min-height: 100vh;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: #F9F7F2; color: #1a1209; font-size: 15px;
}

/* ── SIDEBAR ─────────────────────────── */
.sidebar {
  width: 220px; min-width: 220px;
  background: #0B3D2E;
  padding: 1.5rem 0.75rem;
  display: flex; flex-direction: column;
  position: sticky; top: 0; height: 100vh; overflow-y: auto;
}
.brand {
  display: flex; flex-direction: column; gap: 0;
  padding: 0 0.5rem 1.25rem; margin-bottom: 1.25rem;
  border-bottom: 1px solid rgba(197,160,89,0.2);
}
.brand-name { font-size: 1.2rem; font-weight: 800; color: #f5efe3; letter-spacing: -0.3px; line-height: 1; }
.brand-sub  { font-size: 0.66rem; font-weight: 600; color: rgba(197,160,89,0.55); letter-spacing: 0.9px; text-transform: uppercase; margin-top: 4px; }

nav { display: flex; flex-direction: column; gap: 0.1rem; flex: 1; }
nav button {
  background: transparent; border: none; color: rgba(255,255,255,0.42);
  padding: 0.58rem 0.875rem; text-align: left; font-size: 0.84rem;
  border-radius: 7px; cursor: pointer; width: 100%; transition: all 0.15s;
  display: flex; align-items: center; gap: 0.65rem; font-weight: 500;
}
nav button:hover  { background: rgba(197,160,89,0.08); color: #e8d4a0; }
nav button.active { background: rgba(197,160,89,0.14); color: #f5efe3; font-weight: 600; }
.nav-icon {
  width: 26px; height: 26px; border-radius: 6px;
  background: rgba(255,255,255,0.04);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 0.15s;
}
nav button.active .nav-icon { background: rgba(197,160,89,0.15); }
nav button:hover  .nav-icon { background: rgba(197,160,89,0.09); }
.nav-badge {
  margin-left: auto; background: rgba(197,160,89,0.1); color: #C5A059;
  font-size: 0.65rem; font-weight: 700; padding: 0.1rem 0.45rem;
  border-radius: 20px; border: 1px solid rgba(197,160,89,0.2);
}
.sidebar-footer { padding: 0.875rem 0.5rem 0; border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.68rem; color: rgba(197,160,89,0.4); text-align: center; margin-top: auto; }
.nav-section-label {
  font-size: 0.56rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 1px; color: rgba(197,160,89,0.45); padding: 0.45rem 0.875rem 0.1rem;
}

/* ── CONTENT ─────────────────────────── */
.content { flex: 1; padding: 2rem 2.5rem; overflow-y: auto; min-width: 0; }

.header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #e0d5c5;
}
h2 { margin: 0; color: #0B3D2E; font-size: 1.35rem; font-weight: 700; }
.subtitle { color: #6b5e4e; margin: 0.25rem 0 1.5rem; font-size: 0.875rem; line-height: 1.5; }

/* ── CARDS ───────────────────────────── */
.card {
  background: #fff; padding: 24px; border-radius: 8px;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.04);
  margin-bottom: 1.25rem; border: 1px solid #e0d5c5;
}
h3 {
  margin: 0 0 1.1rem; color: #0B3D2E;
  font-size: 0.68rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.9px;
  padding-bottom: 0.65rem; border-bottom: 1px solid #ede5d5;
}
h4 { margin: 0 0 0.6rem; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #7a5c30; }

/* ── INPUTS ──────────────────────────── */
/* Remove number input spinners */
input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
input[type=number] { -moz-appearance: textfield; appearance: textfield; }

input[type="text"], input[type="email"], input[type="number"], input[type="date"], select, textarea {
  padding: 0.55rem 0.75rem; border: 1px solid #d4c9b8;
  border-radius: 7px; font-size: 0.9rem; font-family: inherit;
  color: #1a1209; background: #fff; transition: border-color 0.15s, box-shadow 0.15s; width: 100%;
}
input:focus, select:focus, textarea:focus {
  outline: none; border-color: #C5A059; box-shadow: 0 0 0 3px rgba(197,160,89,0.12);
}
.select-client {
  width: 100%; padding: 0.65rem 0.875rem; border-radius: 7px;
  border: 1px solid #d4c9b8; font-size: 0.9rem; background: #fff; cursor: pointer; color: #1a1209;
}
.select-client:focus { outline: none; border-color: #C5A059; box-shadow: 0 0 0 3px rgba(197,160,89,0.12); }

/* ── BUTTONS ─────────────────────────── */
button { font-weight: 600; cursor: pointer; transition: all 0.15s; font-family: inherit; border-radius: 7px; line-height: 1.4; }
.btn-success {
  background: #C5A059; color: #0B3D2E; border: none;
  padding: 0.62rem 1.35rem; font-size: 0.9rem; font-weight: 700;
  display: inline-flex; align-items: center; gap: 0.45rem;
  box-shadow: 0 1px 4px rgba(197,160,89,0.35);
  letter-spacing: 0.2px;
}
.btn-success:hover { background: #b8923f; box-shadow: 0 4px 14px rgba(197,160,89,0.45); transform: translateY(-1px); }
.btn-blue { background: #0284c7; color: #fff; border: none; padding: 0.6rem 1.25rem; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.4rem; }
.btn-blue:hover { background: #0369a1; }
.btn-secondary {
  background: #fff; color: #0B3D2E; border: 1.5px solid #c8b89a;
  padding: 0.52rem 1.05rem; font-size: 0.875rem; margin-top: 0.75rem;
  display: inline-flex; align-items: center; gap: 0.45rem; font-weight: 600;
}
.btn-secondary:hover { background: #faf6ef; border-color: #C5A059; box-shadow: 0 1px 4px rgba(197,160,89,0.15); }
.btn-danger-xs {
  background: transparent; color: #bbb; border: 1px solid transparent;
  width: 28px; height: 28px; border-radius: 6px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.8rem; flex-shrink: 0;
}
.btn-danger-xs:hover { background: #fef2f2; color: #ef4444; border-color: #fecaca; }

/* ── GRIDS ───────────────────────────── */
.client-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.config-grid      { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
.full-width       { grid-column: span 2; }

/* ── CONFIG ──────────────────────────── */
.config-row { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0; border-bottom: 1px solid #f0e8da; }
.config-row:last-child { border-bottom: none; }
.config-row input { width: 110px; text-align: right; flex-shrink: 0; }
.diamonds-config-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
.diamond-item { display: flex; justify-content: space-between; align-items: center; background: #faf6ef; padding: 0.55rem 0.875rem; border-radius: 7px; border: 1px solid #e0d5c5; }
.input-wrapper { display: flex; align-items: center; gap: 0.35rem; }
.input-wrapper input { width: 75px; text-align: right; flex-shrink: 0; }
.currency { font-size: 0.78rem; color: #C5A059; font-weight: 700; }

/* ── QUICK ACTIONS — Chips ───────────── */
.quick-actions {
  background: #faf6ef; padding: 1rem 1.25rem;
  border-radius: 8px; margin-bottom: 1.25rem; border: 1px solid #e8dcc8;
}
.btn-group { display: flex; gap: 0.45rem; flex-wrap: wrap; }
.btn-group-diamonds { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.btn-group button, .btn-group-diamonds button {
  background: #fff; border: 1.5px solid #d4b896;
  border-radius: 20px; padding: 0.38rem 0.9rem;
  font-size: 0.8rem; cursor: pointer; font-weight: 600;
  color: #5c3d11; transition: all 0.15s; width: auto;
  white-space: nowrap;
}
.btn-group button:hover, .btn-group-diamonds button:hover {
  background: #fdf3e3; border-color: #C5A059; color: #3d2200;
  box-shadow: 0 2px 6px rgba(197,160,89,0.18);
}

/* ── TABLES ──────────────────────────── */
.invoice-table, .standard-table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
.invoice-table th, .standard-table th {
  background: #F9F7F2; padding: 0.75rem 1rem; text-align: left;
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px;
  color: #7a5c30; border-bottom: 2px solid #C5A059;
}
.invoice-table td, .standard-table td {
  padding: 0.65rem 1rem; border-bottom: 1px solid #ede8df;
  vertical-align: middle; color: #1a1209; line-height: 1.55;
}
.invoice-table tbody tr:last-child td, .standard-table tbody tr:last-child td { border-bottom: none; }
.invoice-table tbody tr:hover td, .standard-table tbody tr:hover td { background: #faf6ef; }

.table-input {
  width: 100%; border: 1px solid transparent; padding: 0.3rem 0.4rem;
  font-size: 0.9rem; background: transparent; box-sizing: border-box; border-radius: 6px; color: #1a1209;
  line-height: 1.5;
}
.table-input:hover { border-color: #d4b896; }
.table-input:focus { border-color: #C5A059; background: #fff; outline: none; box-shadow: 0 0 0 2px rgba(197,160,89,0.12); }

.text-right  { text-align: right !important; }
.text-center { text-align: center !important; }
.bold-text   { font-weight: 600; }

/* ── INVOICE ─────────────────────────── */
.print-container {
  background: #fff; padding: 2rem 2.5rem;
  border-radius: 8px; border: 1px solid #e0d5c5;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
}
.invoice-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 2.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid #e8dcc8;
}
.grand-total {
  font-size: 1.05rem; font-weight: 800; color: #0B3D2E;
  border-top: 2px solid #0B3D2E; padding-top: 0.5rem; margin-top: 0.2rem;
}

/* ── PRINT ───────────────────────────── */
@media print {
  .no-print, .sidebar, button { display: none !important; }
  .app-layout { background: #fff; }
  .content { padding: 0; overflow: visible; max-width: 100%; }
  .print-container { border: none; padding: 0; border-radius: 0; box-shadow: none; }
  .table-input { border: none !important; padding: 0; background: transparent !important; color: #000; }
  body { background: #fff; color: #000; }
}

/* ── PDF Capture B&W ──────────────────────────── */
.pdf-bw * { color: #000 !important; }
.pdf-bw .invoice-table th { background: #e8e8e8 !important; border-bottom: 2px solid #000 !important; }
.pdf-bw .invoice-table td { border-bottom: 1px solid #bbb !important; }
.pdf-bw .invoice-header { border-bottom-color: #000 !important; }
.pdf-bw .invoice-meta-row { border-bottom-color: #000 !important; }
.pdf-bw .apercu-footer, .pdf-bw .invoice-footer { border-top-color: #000 !important; }
.pdf-bw .grand-total, .pdf-bw .grand-total--solde { border-top-color: #000 !important; }
.pdf-bw .devis-ref-box { border-color: #000 !important; background: #f0f0f0 !important; }
</style>