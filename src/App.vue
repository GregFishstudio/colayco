<script setup>
import { ref, onMounted, watch } from 'vue'
import { writeTextFile, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import { save, open } from '@tauri-apps/plugin-dialog'
import DevisView from './views/DevisView.vue'
import ClientsView from './views/ClientsView.vue'
import ConfigView from './views/ConfigView.vue'
import BoutiqueView from './views/BoutiqueView.vue'
import DevisListeView from './views/DevisListeView.vue'

// L'onglet actif au démarrage
const ongletActif = ref('devis')
const ready = ref(false)
const devisViewRef = ref(null)

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
    { id: 110, nom: 'Diamant', taille: '5.0 mm', prix: 480.00 },
  ]
})

// --- DONNÉES PAR DÉFAUT DES CLIENTS ---
const clients = ref([
  { id: 1, nom: 'Atelier Bijouterie Lausanne', email: 'contact@lausanne-bijoux.ch', telephone: '021 311 00 00', adresse: 'Rue de Bourg 12, 1003 Lausanne' },
  { id: 2, nom: 'Galerie Neuchâtel', email: 'info@galeriene.ch', telephone: '032 721 00 00', adresse: 'Place Pury 4, 2000 Neuchâtel' }
])

// --- LISTE DE STOCKAGE DE L'HISTORIQUE ---
const devisListe = ref([])
const prochainNumeroDevis = ref(1)
const derniereSauvegarde = ref(null)

// --- CHARGEMENT AUTOMATIQUE INITIAL ---
onMounted(async () => {
  try {
    const contenu = await readTextFile('colayco_data.json', { baseDir: BaseDirectory.Document })
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
    if (data.clients) clients.value = data.clients
    if (data.devisListe) {
      // Migration : ajouter statut 'Validé' aux anciens devis sans statut
      devisListe.value = data.devisListe.map(d => ({ ...d, statut: d.statut ?? 'Validé' }))
    }
    if (data.prochainNumeroDevis) prochainNumeroDevis.value = data.prochainNumeroDevis
    console.log("Données Colayco chargées avec succès.")
  } catch (e) {
    console.log("Aucun fichier colayco_data.json trouvé. Utilisation des valeurs par défaut.")
  } finally {
    ready.value = true
  }
})

// --- SAUVEGARDE AUTOMATIQUE LOCAL FILE ---
watch([boutique, config, clients, devisListe, prochainNumeroDevis], async () => {
  if (!ready.value) return
  try {
    const dataAEnregistrer = {
      boutique: boutique.value,
      config: config.value,
      clients: clients.value,
      devisListe: devisListe.value,
      prochainNumeroDevis: prochainNumeroDevis.value
    }
    await writeTextFile('colayco_data.json', JSON.stringify(dataAEnregistrer, null, 2), {
      baseDir: BaseDirectory.Document
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
      devisListe: devisListe.value
    }, null, 2)
    await writeTextFile(cheminFichier, contenu)
    alert('Sauvegarde exportée avec succès !')
  } catch (err) {
    console.error('Erreur backup :', err)
    alert('Impossible d\'exporter la sauvegarde.')
  }
}

// Action de chargement d'un ancien devis depuis la liste vers l'éditeur
const chargerDevisDansEditeur = (devisCopie) => {
  ongletActif.value = 'devis'
  setTimeout(() => {
    if (devisViewRef.value) {
      devisViewRef.value.chargerDevisExistant(devisCopie)
    }
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
      <DevisView ref="devisViewRef" v-if="ongletActif === 'devis'" :config="config" :clients="clients" :boutique="boutique" :devisListe="devisListe" :prochainNumero="prochainNumeroDevis" @numero-utilise="incrementerNumeroDevis" />
      <DevisListeView v-if="ongletActif === 'liste-devis'" :devisListe="devisListe" :boutique="boutique" :config="config" @charger-devis="chargerDevisDansEditeur" />
      <ClientsView v-if="ongletActif === 'clients'" :clients="clients" @add-client="gererAjoutClient" />
      <ConfigView v-if="ongletActif === 'config'" :config="config" :derniereSauvegarde="derniereSauvegarde" @backup-data="exporterBackup" />
      <BoutiqueView v-if="ongletActif === 'boutique'" :boutique="boutique" :config="config" :derniereSauvegarde="derniereSauvegarde" @update-logo="gererMiseAJourLogo" @select-pdf-folder="selectionnerDossierPDF" />
    </main>
  </div>
</template>

<style>
/* === COLAYCO — THÈME VERT MINIMALISTE === */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; }

/* Layout */
.app-layout {
  display: flex; min-height: 100vh;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: #f0fdf4; color: #0f172a; font-size: 15px;
}

/* ── SIDEBAR ─────────────────────────── */
.sidebar {
  width: 220px; min-width: 220px;
  background: #052e16;
  padding: 1.5rem 0.75rem;
  display: flex; flex-direction: column;
  position: sticky; top: 0; height: 100vh; overflow-y: auto;
}
.brand {
  display: flex; flex-direction: column; gap: 0;
  padding: 0 0.5rem 1.25rem; margin-bottom: 1.25rem;
  border-bottom: 1px solid rgba(74,222,128,0.12);
}
.brand-logo {
  color: #4d8c64; margin-bottom: 0.5rem;
  display: flex; align-items: center;
}
.brand-name { font-size: 1.2rem; font-weight: 800; color: #ecfdf5; letter-spacing: -0.3px; line-height: 1; }
.brand-sub  { font-size: 0.66rem; font-weight: 600; color: #2d6a42; letter-spacing: 0.9px; text-transform: uppercase; margin-top: 4px; }

nav { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; }
nav button {
  background: transparent; border: none; color: #4b6e56;
  padding: 0.6rem 0.875rem; text-align: left; font-size: 0.85rem;
  border-radius: 8px; cursor: pointer; width: 100%; transition: all 0.15s;
  display: flex; align-items: center; gap: 0.65rem; font-weight: 500;
}
nav button:hover  { background: rgba(255,255,255,0.05); color: #a7c9b4; }
nav button.active { background: #0f3d20; color: #d1fae5; font-weight: 600; }
.nav-icon {
  width: 28px; height: 28px; border-radius: 7px;
  background: rgba(255,255,255,0.04);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 0.15s;
}
nav button.active .nav-icon { background: rgba(255,255,255,0.08); }
nav button:hover  .nav-icon { background: rgba(255,255,255,0.06); }
.nav-badge {
  margin-left: auto; background: rgba(255,255,255,0.07); color: #6b9e7e;
  font-size: 0.68rem; font-weight: 700; padding: 0.1rem 0.45rem;
  border-radius: 20px; border: 1px solid rgba(255,255,255,0.08);
}
.sidebar-footer { padding: 0.875rem 0.5rem 0; border-top: 1px solid rgba(255,255,255,0.05); font-size: 0.68rem; color: #2d6a42; text-align: center; margin-top: auto; }

/* ── CONTENT ─────────────────────────── */
.content { flex: 1; padding: 2rem 2.5rem; overflow-y: auto; min-width: 0; }

.header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #bbf7d0;
}
h2     { margin: 0; color: #14532d; font-size: 1.35rem; font-weight: 700; }
.subtitle { color: #4b5563; margin: 0.25rem 0 1.5rem; font-size: 0.875rem; line-height: 1.5; }

/* ── CARDS ───────────────────────────── */
.card {
  background: #fff; padding: 1.5rem; border-radius: 14px;
  box-shadow: 0 1px 4px rgba(15,23,42,0.05);
  margin-bottom: 1.25rem; border: 1px solid #dcfce7;
}
h3 {
  margin: 0 0 1.1rem; color: #15803d;
  font-size: 0.7rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.9px;
  padding-bottom: 0.65rem; border-bottom: 1px solid #f0fdf4;
}
h4 { margin: 0 0 0.6rem; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #4b7c59; }

/* ── INPUTS ──────────────────────────── */
input[type="text"], input[type="email"], input[type="number"], input[type="date"], select, textarea {
  padding: 0.55rem 0.75rem; border: 1px solid #d1fae5;
  border-radius: 8px; font-size: 0.9rem; font-family: inherit;
  color: #0f172a; background: #fff; transition: border-color 0.15s, box-shadow 0.15s; width: 100%;
}
input:focus, select:focus, textarea:focus {
  outline: none; border-color: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.12);
}
.select-client {
  width: 100%; padding: 0.65rem 0.875rem; border-radius: 8px;
  border: 1px solid #d1fae5; font-size: 0.9rem; background: #fff; cursor: pointer; color: #0f172a;
}
.select-client:focus { outline: none; border-color: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.12); }

/* ── BUTTONS ─────────────────────────── */
button { font-weight: 600; cursor: pointer; transition: all 0.15s; font-family: inherit; border-radius: 8px; line-height: 1.4; }
.btn-success { background: #16a34a; color: #fff; border: none; padding: 0.6rem 1.25rem; font-size: 0.9rem; }
.btn-success:hover { background: #15803d; box-shadow: 0 2px 8px rgba(22,163,74,0.25); }
.btn-blue { background: #0284c7; color: #fff; border: none; padding: 0.6rem 1.25rem; font-size: 0.9rem; }
.btn-blue:hover { background: #0369a1; }
.btn-secondary {
  background: #fff; color: #166534; border: 1px solid #bbf7d0;
  padding: 0.5rem 1rem; font-size: 0.875rem; margin-top: 0.75rem;
  display: inline-flex; align-items: center; gap: 0.4rem;
}
.btn-secondary:hover { background: #f0fdf4; border-color: #4ade80; }
.btn-danger-xs {
  background: transparent; color: #94a3b8; border: 1px solid transparent;
  width: 28px; height: 28px; border-radius: 6px; padding: 0;
  line-height: 28px; text-align: center; font-size: 0.8rem; flex-shrink: 0;
}
.btn-danger-xs:hover { background: #fef2f2; color: #ef4444; border-color: #fecaca; }

/* ── GRIDS ───────────────────────────── */
.client-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.config-grid      { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
.full-width       { grid-column: span 2; }

/* ── CONFIG ──────────────────────────── */
.config-row { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0; border-bottom: 1px solid #f0fdf4; }
.config-row:last-child { border-bottom: none; }
.config-row input { width: 110px; text-align: right; flex-shrink: 0; }
.diamonds-config-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
.diamond-item { display: flex; justify-content: space-between; align-items: center; background: #f0fdf4; padding: 0.55rem 0.875rem; border-radius: 8px; border: 1px solid #dcfce7; }
.input-wrapper { display: flex; align-items: center; gap: 0.35rem; }
.input-wrapper input { width: 75px; text-align: right; flex-shrink: 0; }
.currency { font-size: 0.78rem; color: #86efac; font-weight: 700; }

/* ── QUICK ACTIONS ───────────────────── */
.quick-actions {
  background: #f0fdf4; padding: 1rem 1.25rem;
  border-radius: 10px; margin-bottom: 1.25rem; border: 1px solid #bbf7d0;
}
.btn-group         { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.btn-group-diamonds { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.btn-group button, .btn-group-diamonds button {
  background: #fff; border: 1px solid #bbf7d0; padding: 0.35rem 0.75rem;
  border-radius: 6px; font-size: 0.82rem; cursor: pointer; font-weight: 600;
  color: #15803d; transition: all 0.12s; width: auto;
}
.btn-group button:hover, .btn-group-diamonds button:hover {
  background: #dcfce7; border-color: #4ade80; color: #14532d;
}

/* ── TABLES ──────────────────────────── */
.invoice-table, .standard-table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
.invoice-table th, .standard-table th {
  background: #f0fdf4; padding: 0.65rem 0.875rem; text-align: left;
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px;
  color: #4b7c59; border-bottom: 2px solid #dcfce7;
}
.invoice-table td, .standard-table td {
  padding: 0.5rem 0.875rem; border-bottom: 1px solid #f0fdf4;
  vertical-align: middle; color: #1e293b;
}
.invoice-table tbody tr:last-child td, .standard-table tbody tr:last-child td { border-bottom: none; }
.invoice-table tbody tr:hover td, .standard-table tbody tr:hover td { background: #f0fdf4; }

.table-input {
  width: 100%; border: 1px solid transparent; padding: 0.3rem 0.4rem;
  font-size: 0.9rem; background: transparent; box-sizing: border-box; border-radius: 6px; color: #0f172a;
}
.table-input:hover { border-color: #bbf7d0; }
.table-input:focus { border-color: #22c55e; background: #fff; outline: none; box-shadow: 0 0 0 2px rgba(34,197,94,0.12); }

.text-right  { text-align: right !important; }
.text-center { text-align: center !important; }
.bold-text   { font-weight: 600; }

/* ── INVOICE ─────────────────────────── */
.print-container {
  background: #fff; padding: 2rem 2.5rem;
  border-radius: 14px; border: 1px solid #dcfce7;
}
.invoice-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 2.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid #f0fdf4;
}
.grand-total {
  font-size: 1.05rem; font-weight: 800; color: #14532d;
  border-top: 2px solid #14532d; padding-top: 0.5rem; margin-top: 0.2rem;
}

/* ── PRINT ───────────────────────────── */
@media print {
  .no-print, .sidebar, button { display: none !important; }
  .app-layout { background: #fff; }
  .content { padding: 0; overflow: visible; max-width: 100%; }
  .print-container { border: none; padding: 0; border-radius: 0; }
  .table-input { border: none !important; padding: 0; background: transparent !important; color: #000; }
  body { background: #fff; color: #000; }
}
</style>