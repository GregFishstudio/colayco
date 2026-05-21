<script setup>
import { ref, onMounted, watch } from 'vue'
import { writeTextFile, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import DevisView from './views/DevisView.vue'
import ClientsView from './views/ClientsView.vue'
import ConfigView from './views/ConfigView.vue'
import BoutiqueView from './views/BoutiqueView.vue'

const ongletActif = ref('devis')
const ready = ref(false)

// --- DONNÉES PAR DÉFAUT DE LA BOUTIQUE ---
const boutique = ref({
  nom: 'Colayco Sarl',
  telephone: '+41 (0)32 000 00 00',
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
  orFin: 68.50,
  or18k: 53.20,
  argent925: 0.95,
  cirePerdue: 45.00,
  impression3d: 35.00,
  diamants: [
    { taille: '1.0 mm', prix: 12.00 },
    { taille: '1.5 mm', prix: 18.00 },
    { taille: '2.0 mm', prix: 28.00 },
    { taille: '2.5 mm', prix: 45.00 },
    { taille: '3.0 mm', prix: 75.00 },
    { taille: '3.5 mm', prix: 120.00 },
    { taille: '4.0 mm', prix: 190.00 },
    { taille: '4.5 mm', prix: 310.00 },
    { taille: '5.0 mm', prix: 480.00 },
  ]
})

// --- DONNÉES PAR DÉFAUT DES CLIENTS ---
const clients = ref([
  { id: 1, nom: 'Atelier Bijouterie Lausanne', email: 'contact@lausanne-bijoux.ch', telephone: '021 311 00 00', adresse: 'Rue de Bourg 12, 1003 Lausanne' },
  { id: 2, nom: 'Galerie Neuchâtel', email: 'info@galeriene.ch', telephone: '032 721 00 00', adresse: 'Place Pury 4, 2000 Neuchâtel' }
])

// --- CHARGEMENT AUTOMATIQUE INITIAL ---
onMounted(async () => {
  try {
    const contenu = await readTextFile('colayco_data.json', { baseDir: BaseDirectory.Document })
    const data = JSON.parse(contenu)
    if (data.boutique) boutique.value = data.boutique
    if (data.config) config.value = data.config
    if (data.clients) clients.value = data.clients
    console.log("Données Colayco chargées avec succès.")
  } catch (e) {
    console.log("Aucun fichier colayco_data.json trouvé. Utilisation des valeurs par défaut.")
  } finally {
    ready.value = true
  }
})

// --- SAUVEGARDE AUTOMATIQUE LOCAL FILE ---
watch([boutique, config, clients], async () => {
  if (!ready.value) return
  try {
    const dataAEnregistrer = {
      boutique: boutique.value,
      config: config.value,
      clients: clients.value
    }
    await writeTextFile('colayco_data.json', JSON.stringify(dataAEnregistrer, null, 2), {
      baseDir: BaseDirectory.Document
    })
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
</script>

<template>
  <div class="app-layout">
    <!-- Barre Latérale de Navigation Globale (Cachée à l'impression) -->
    <aside class="sidebar no-print">
      <div class="brand">Colayco Sarl</div>
      <nav>
        <button :class="{ active: ongletActif === 'devis' }" @click="ongletActif = 'devis'">📄 Éditeur Devis</button>
        <button :class="{ active: ongletActif === 'clients' }" @click="ongletActif = 'clients'">👥 Base Clients</button>
        <button :class="{ active: ongletActif === 'config' }" @click="ongletActif = 'config'">⚙️ Tarifs Métier</button>
        <button :class="{ active: ongletActif === 'boutique' }" @click="ongletActif = 'boutique'">🏪 Configuration PDF</button>
      </nav>
    </aside>

    <!-- Affichage de la vue demandée -->
    <main class="content">
      <DevisView v-if="ongletActif === 'devis'" :config="config" :clients="clients" :boutique="boutique" />
      <ClientsView v-if="ongletActif === 'clients'" :clients="clients" @add-client="gererAjoutClient" />
      <ConfigView v-if="ongletActif === 'config'" :config="config" />
      <BoutiqueView v-if="ongletActif === 'boutique'" :boutique="boutique" @update-logo="gererMiseAJourLogo" />
    </main>
  </div>
</template>

<style>
/* --- STYLES DESKTOP GLOBAUX --- */
.app-layout { display: flex; min-height: 100vh; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f6f8; }
.sidebar { width: 240px; background: #1e293b; color: white; padding: 1.5rem 1rem; box-sizing: border-box; }
.brand { font-size: 1.4rem; font-weight: 800; letter-spacing: 1px; margin-bottom: 2rem; border-bottom: 1px solid #334155; padding-bottom: 1rem; text-align: center; color: #f8fafc; }
nav { display: flex; flex-direction: column; gap: 0.5rem; }
nav button { background: none; border: none; color: #cbd5e1; padding: 0.8rem 1rem; text-align: left; font-size: 1rem; border-radius: 6px; cursor: pointer; width: 100%; transition: all 0.2s; }
nav button:hover, nav button.active { background: #334155; color: white; font-weight: bold; }

.content { flex: 1; padding: 2rem; box-sizing: border-box; overflow-y: auto; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
h2 { margin: 0; color: #0f172a; }
.subtitle { color: #64748b; margin-top: -1rem; margin-bottom: 1.5rem; }

.card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 1.5rem; border: 1px solid #e2e8f0; }
h3 { margin-top: 0; margin-bottom: 1.2rem; color: #334155; font-size: 1.1rem; border-bottom: 2px solid #f1f5f9; padding-bottom: 0.5rem; }
.select-client { width: 100%; padding: 0.7rem; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 1rem; background: #fff; }

.quick-actions { background: #f8fafc; padding: 1rem; border-radius: 6px; margin-bottom: 1.5rem; border: 1px dashed #cbd5e1; }
.btn-group { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
.btn-group-diamonds { display: grid; grid-template-columns: repeat(9, 1fr); gap: 0.4rem; }
.btn-group button, .btn-group-diamonds button { background: white; border: 1px solid #cbd5e1; padding: 0.4rem 0.6rem; border-radius: 4px; font-size: 0.85rem; cursor: pointer; font-weight: 500; }
.btn-group button:hover, .btn-group-diamonds button:hover { background: #e2e8f0; border-color: #94a3b8; }

.client-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
.full-width { grid-column: span 2; }
.config-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; }
.config-row label { font-weight: 500; color: #475569; }
.config-row input { width: 120px; padding: 0.4rem; border: 1px solid #cbd5e1; border-radius: 4px; text-align: right; }

.diamonds-config-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.diamond-item { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 0.5rem 0.8rem; border-radius: 4px; border: 1px solid #e2e8f0; }
.input-wrapper { display: flex; align-items: center; gap: 0.2rem; }
.input-wrapper input { width: 80px; text-align: right; padding: 0.3rem; border: 1px solid #cbd5e1; border-radius: 4px; }

.invoice-table, .standard-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
.invoice-table th, .standard-table th { background: #f8fafc; padding: 0.75rem; text-align: left; font-size: 0.85rem; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; }
.invoice-table td, .standard-table td { padding: 0.5rem; border-bottom: 1px solid #e2e8f0; }
.table-input { width: 100%; border: 1px solid transparent; padding: 0.4rem; font-size: 0.95rem; background: transparent; box-sizing: border-box; }
.table-input:focus { border-color: #3b82f6; background: white; outline: none; border-radius: 4px; }
.text-right { text-align: right; }
.text-center { text-align: center; }
.bold-text { font-weight: 600; }

button { font-weight: 600; cursor: pointer; transition: background 0.2s; }
.btn-success { background: #10b981; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; }
.btn-success:hover { background: #059669; }
.btn-secondary { background: #e2e8f0; color: #334155; border: none; padding: 0.5rem 1rem; border-radius: 6px; margin-top: 1rem; }
.btn-secondary:hover { background: #cbd5e1; }
.btn-danger-xs { background: #ef4444; color: white; border: none; width: 24px; height: 24px; border-radius: 4px; padding: 0; line-height: 24px; text-align: center; }

.print-container { background: white; padding: 2rem; border-radius: 8px; border: 1px solid #e2e8f0; }
.invoice-header { display: flex; justify-content: space-between; margin-bottom: 2rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 1.5rem; }
.invoice-totals { display: flex; justify-content: flex-end; }
.totals-board { display: grid; grid-template-columns: 120px 140px; gap: 0.6rem; text-align: right; font-size: 0.95rem; }
.grand-total { font-size: 1.2rem; font-weight: 800; color: #1e293b; border-top: 2px solid #1e293b; padding-top: 0.5rem; }

@media print {
  .no-print, .sidebar, button { display: none !important; }
  .app-layout { background: white; }
  .content { padding: 0; overflow: visible; }
  .print-container { border: none; padding: 0; }
  .table-input { border: none !important; padding: 0; background: transparent !important; color: black; }
  body { background: white; color: black; }
}
</style>