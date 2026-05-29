<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  clients: Array
})

const emit = defineEmits(['add-client', 'delete-client'])
const nouveauClient = ref({ nom: '', email: '', telephone: '', adresse: '', localite: '' })

const soumettreClient = () => {
  if (!nouveauClient.value.nom) return
  emit('add-client', { ...nouveauClient.value })
  nouveauClient.value = { nom: '', email: '', telephone: '', adresse: '', localite: '' }
}

// --- SÉLECTION EN MASSE ---
const selection = ref(new Set())
const tousSelectionnes = computed(() => {
  const filtres = clientsFiltres()
  return filtres.length > 0 && filtres.every(c => selection.value.has(c.id))
})
const toggleTous = () => {
  const filtres = clientsFiltres()
  if (tousSelectionnes.value) {
    filtres.forEach(c => selection.value.delete(c.id))
  } else {
    filtres.forEach(c => selection.value.add(c.id))
  }
  selection.value = new Set(selection.value)
}
const toggleSelection = (id) => {
  if (selection.value.has(id)) selection.value.delete(id)
  else selection.value.add(id)
  selection.value = new Set(selection.value)
}
const supprimerSelection = () => {
  if (!selection.value.size) return
  if (!confirm(`Supprimer ${selection.value.size} contact(s) ?`)) return
  selection.value.forEach(id => emit('delete-client', id))
  selection.value = new Set()
}

// --- RECHERCHE DANS LA LISTE ---
const rechercheContacts = ref('')
const clientsFiltres = () => {
  const q = rechercheContacts.value.toLowerCase().trim()
  if (!q) return props.clients
  return props.clients.filter(c =>
    c.nom.toLowerCase().includes(q) ||
    (c.email && c.email.toLowerCase().includes(q)) ||
    (c.localite && c.localite.toLowerCase().includes(q))
  )
}

// --- IMPORTATION CSV AVEC MAPPING ---
const csvEtape = ref(null) // null | 'mapping'
const csvColonnes = ref([])
const csvApercu = ref([])
const csvLignesBrutes = ref([])
const csvMapping = ref({ nom: '', email: '', telephone: '', adresse: '', localite: '' })

const CHAMPS = [
  { key: 'nom',       label: 'Nom',            required: true  },
  { key: 'email',     label: 'Email',           required: false },
  { key: 'telephone', label: 'Téléphone',       required: false },
  { key: 'adresse',   label: 'Rue et numéro',   required: false },
  { key: 'localite',  label: 'NPA et localité', required: false },
]

const déclencherInputFichier = () => {
  document.getElementById('csv-file-input').click()
}

const gererImportCSV = (event) => {
  const fichier = event.target.files[0]
  if (!fichier) return

  const reader = new FileReader()
  reader.onload = (e) => {
    const texte = e.target.result
    const lignes = texte.split(/\r?\n/).filter(l => l.trim())
    if (lignes.length === 0) return

    const rows = lignes.map(l => l.split(/[,;]/).map(c => c.trim()))
    const firstRow = rows[0]

    // Détecte si la première ligne est un en-tête
    const hasHeader = firstRow.some(c => /nom|name|email|tel|phone|adresse|address|rue|npa|ville|city|localit/i.test(c))

    if (hasHeader) {
      csvColonnes.value = firstRow
      csvLignesBrutes.value = rows.slice(1).filter(r => r.some(c => c))
      csvApercu.value = csvLignesBrutes.value.slice(0, 3)
      // Auto-mapping basé sur les noms de colonnes
      const mapping = { nom: '', email: '', telephone: '', adresse: '', localite: '' }
      firstRow.forEach((col, i) => {
        const c = col.toLowerCase()
        if (/nom|name/i.test(c) && mapping.nom === '')              mapping.nom       = i
        else if (/email|mail/i.test(c) && mapping.email === '')     mapping.email     = i
        else if (/tel|phone|mob/i.test(c) && mapping.telephone === '') mapping.telephone = i
        else if (/rue|adresse|address|street/i.test(c) && mapping.adresse === '') mapping.adresse = i
        else if (/npa|ville|city|localit|zip/i.test(c) && mapping.localite === '') mapping.localite = i
      })
      csvMapping.value = mapping
    } else {
      csvColonnes.value = firstRow.map((_, i) => `Colonne ${i + 1}`)
      csvLignesBrutes.value = rows.filter(r => r.some(c => c))
      csvApercu.value = csvLignesBrutes.value.slice(0, 3)
      csvMapping.value = {
        nom:       firstRow.length > 0 ? 0 : '',
        email:     firstRow.length > 1 ? 1 : '',
        telephone: firstRow.length > 2 ? 2 : '',
        adresse:   firstRow.length > 3 ? 3 : '',
        localite:  firstRow.length > 4 ? 4 : '',
      }
    }

    csvEtape.value = 'mapping'
    event.target.value = ''
  }
  reader.readAsText(fichier, 'UTF-8')
}

const confirmerImport = () => {
  if (csvMapping.value.nom === '') {
    alert('Veuillez sélectionner la colonne pour le Nom.')
    return
  }
  let importes = 0
  csvLignesBrutes.value.forEach(row => {
    const nom = row[csvMapping.value.nom]?.trim()
    if (!nom) return
    emit('add-client', {
      nom,
      email:     csvMapping.value.email     !== '' ? row[csvMapping.value.email]?.trim()     || '' : '',
      telephone: csvMapping.value.telephone !== '' ? row[csvMapping.value.telephone]?.trim() || '' : '',
      adresse:   csvMapping.value.adresse   !== '' ? row[csvMapping.value.adresse]?.trim()   || '' : '',
      localite:  csvMapping.value.localite  !== '' ? row[csvMapping.value.localite]?.trim()  || '' : '',
    })
    importes++
  })
  alert(`Importation réussie : ${importes} contacts ajoutés !`)
  csvEtape.value = null
}

const annulerImport = () => {
  csvEtape.value = null
  csvColonnes.value = []
  csvLignesBrutes.value = []
  csvApercu.value = []
}
</script>

<template>
  <div>
    <h2>Base Clients Colayco</h2>
    <p class="subtitle">Gérez vos contacts et importez vos fichiers clients au format CSV.</p>

    <!-- ── Formulaire ajout manuel ── -->
    <section class="card">
      <h3>Ajouter un nouveau client</h3>
      <div class="client-form-grid" style="margin-bottom: 1.5rem;">
        <input v-model="nouveauClient.nom" type="text" placeholder="Nom de l'entreprise / Client" />
        <input v-model="nouveauClient.email" type="email" placeholder="Email" />
        <input v-model="nouveauClient.telephone" type="text" placeholder="Téléphone" />
        <input v-model="nouveauClient.adresse" type="text" placeholder="Rue et numéro" />
        <input v-model="nouveauClient.localite" type="text" placeholder="NPA et localité" />
        <button @click="soumettreClient" class="btn-blue" style="grid-column: span 2;">Enregistrer le Client</button>
      </div>

      <div class="csv-import-box">
        <div class="csv-instructions">
          <span class="csv-title">⚙️ Import groupé par CSV</span>
          <p>Colonnes auto-détectées. Tu pourras ajuster le mapping avant d'importer.</p>
        </div>
        <button @click="déclencherInputFichier" class="btn-secondary" style="margin-top: 0;">
          📥 Importer un fichier CSV
        </button>
        <input id="csv-file-input" type="file" accept=".csv" @change="gererImportCSV" style="display: none;" />
      </div>
    </section>

    <!-- ── Modal mapping CSV ── -->
    <div v-if="csvEtape === 'mapping'" class="csv-modal-overlay">
      <div class="csv-modal">
        <h3>Correspondance des colonnes</h3>
        <p class="csv-modal-sub">Associe chaque champ Colayco à la colonne de ton fichier CSV.</p>

        <div class="csv-mapping-grid">
          <template v-for="champ in CHAMPS" :key="champ.key">
            <label class="csv-map-label">
              {{ champ.label }}
              <span v-if="champ.required" class="csv-required">*</span>
            </label>
            <select v-model="csvMapping[champ.key]" class="csv-map-select">
              <option value="">— Ignorer —</option>
              <option v-for="(col, i) in csvColonnes" :key="i" :value="i">{{ col }}</option>
            </select>
          </template>
        </div>

        <!-- Aperçu des premières lignes -->
        <div class="csv-preview">
          <div class="csv-preview-title">Aperçu ({{ csvLignesBrutes.length }} lignes au total)</div>
          <table class="csv-preview-table">
            <thead>
              <tr>
                <th v-for="(col, i) in csvColonnes" :key="i">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in csvApercu" :key="ri">
                <td v-for="(cell, ci) in csvColonnes" :key="ci">{{ row[ci] || '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="csv-modal-actions">
          <button @click="annulerImport" class="btn-ghost">Annuler</button>
          <button @click="confirmerImport" class="btn-blue">Importer {{ csvLignesBrutes.length }} contacts</button>
        </div>
      </div>
    </div>

    <!-- ── Liste clients avec recherche ── -->
    <section class="card">
      <div class="clients-list-header">
        <h3>Liste des clients enregistrés ({{ clients.length }})</h3>
        <div style="display:flex; gap:0.5rem; align-items:center;">
          <button v-if="selection.size > 0" class="btn-delete-bulk" @click="supprimerSelection">
            Supprimer {{ selection.size }} sélectionné(s)
          </button>
          <input v-model="rechercheContacts" type="text" placeholder="Rechercher…" class="search-contacts" />
        </div>
      </div>
      <table class="standard-table">
        <thead>
          <tr>
            <th class="th-check"><input type="checkbox" :checked="tousSelectionnes" @change="toggleTous" /></th>
            <th>Nom</th>
            <th>Email</th>
            <th>Téléphone</th>
            <th>Rue</th>
            <th>NPA / Localité</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in clientsFiltres()" :key="c.id" :class="{ 'row-selected': selection.has(c.id) }">
            <td class="th-check"><input type="checkbox" :checked="selection.has(c.id)" @change="toggleSelection(c.id)" /></td>
            <td><strong>{{ c.nom }}</strong></td>
            <td>{{ c.email || '—' }}</td>
            <td>{{ c.telephone || '—' }}</td>
            <td>{{ c.adresse || '—' }}</td>
            <td>{{ c.localite || '—' }}</td>
            <td><button class="btn-delete" @click="emit('delete-client', c.id)" title="Supprimer">✕</button></td>
          </tr>
          <tr v-if="clientsFiltres().length === 0">
            <td colspan="7" style="text-align:center; color:#94a3b8; padding: 1.5rem;">Aucun résultat</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.clients-list-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
.clients-list-header h3 { margin: 0; }
.search-contacts { padding: 0.4rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.875rem; width: 220px; }
.search-contacts:focus { outline: none; border-color: #4ade80; }
.btn-delete { background: none; border: none; color: #cbd5e1; cursor: pointer; font-size: 0.85rem; padding: 0.2rem 0.4rem; border-radius: 4px; }
.btn-delete:hover { background: #fee2e2; color: #ef4444; }
.btn-delete-bulk { background: #fee2e2; color: #ef4444; border: 1px solid #fca5a5; border-radius: 8px; padding: 0.4rem 0.9rem; font-size: 0.82rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn-delete-bulk:hover { background: #fecaca; }
.th-check { width: 36px; text-align: center; }
.row-selected { background: #fef2f2; }

.csv-import-box { border-top: 1px dashed #e2e8f0; padding-top: 1.25rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.csv-title { font-size: 0.8rem; font-weight: 600; color: #475569; display: block; text-transform: uppercase; letter-spacing: 0.5px; }
.csv-instructions p { margin: 0.2rem 0 0; font-size: 0.82rem; color: #64748b; }

/* Modal mapping */
.csv-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.csv-modal { background: #fff; border-radius: 14px; padding: 2rem; width: 680px; max-width: 95vw; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
.csv-modal h3 { margin: 0 0 0.25rem; font-size: 1.1rem; }
.csv-modal-sub { margin: 0 0 1.5rem; font-size: 0.85rem; color: #64748b; }

.csv-mapping-grid { display: grid; grid-template-columns: 160px 1fr; gap: 0.6rem 1rem; align-items: center; margin-bottom: 1.5rem; }
.csv-map-label { font-size: 0.85rem; font-weight: 600; color: #334155; }
.csv-required { color: #ef4444; margin-left: 2px; }
.csv-map-select { width: 100%; padding: 0.4rem 0.6rem; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.875rem; }

.csv-preview { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem; margin-bottom: 1.5rem; overflow-x: auto; }
.csv-preview-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 0.5rem; }
.csv-preview-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
.csv-preview-table th { text-align: left; padding: 0.3rem 0.5rem; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
.csv-preview-table td { padding: 0.3rem 0.5rem; color: #111; border-bottom: 1px solid #f1f5f9; }

.csv-modal-actions { display: flex; justify-content: flex-end; gap: 0.75rem; }
</style>
