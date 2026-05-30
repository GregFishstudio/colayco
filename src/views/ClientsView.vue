<script setup>
import { ref } from 'vue'

const props = defineProps({
  clients: Array
})

const emit = defineEmits(['add-client'])

const clientVide = () => ({ civilite: '', prenom: '', nom: '', rue: '', numero: '', npa: '', lieu: '', email: '', telephone: '' })
const nouveauClient = ref(clientVide())

const soumettreClient = () => {
  if (!nouveauClient.value.nom) return
  emit('add-client', { ...nouveauClient.value })
  nouveauClient.value = clientVide()
}

const nomComplet = (c) => [c.civilite, c.prenom, c.nom].filter(Boolean).join(' ') || c.nom || '—'
const adresseComplet = (c) => {
  if (c.rue !== undefined) {
    const l1 = [c.rue, c.numero].filter(Boolean).join(' ')
    const l2 = [c.npa, c.lieu].filter(Boolean).join(' ')
    return [l1, l2].filter(Boolean).join(', ') || '—'
  }
  return c.adresse || '—'
}

// --- LOGIQUE D'IMPORTATION CSV ---
const déclencherInputFichier = () => {
  document.getElementById('csv-file-input').click()
}

const gererImportCSV = (event) => {
  const fichier = event.target.files[0]
  if (!fichier) return

  const reader = new FileReader()
  reader.onload = (e) => {
    const texte = e.target.result
    const lignes = texte.split(/\r?\n/)
    let contactsImportes = 0

    lignes.forEach((ligne) => {
      const col = ligne.split(/[,;]/).map(c => c.trim())
      const nom = col[2] || col[0]
      if (!nom || nom.toLowerCase() === 'nom' || nom.toLowerCase() === 'name') return

      emit('add-client', {
        civilite: col[0] || '',
        prenom: col[1] || '',
        nom: col[2] || col[0] || '',
        rue: col[3] || '',
        numero: col[4] || '',
        npa: col[5] || '',
        lieu: col[6] || '',
        email: col[7] || col[1] || '',
        telephone: col[8] || col[2] || ''
      })
      contactsImportes++
    })

    alert(`Importation réussie : ${contactsImportes} contacts ajoutés !`)
    event.target.value = ''
  }

  reader.readAsText(fichier, 'UTF-8')
}
</script>

<template>
  <div>
    <h2>Base Clients Colayco</h2>
    <p class="subtitle">Gérez vos contacts et importez vos fichiers clients au format CSV.</p>

    <section class="card">
      <h3>Ajouter un nouveau client</h3>

      <div style="display:grid;grid-template-columns:140px 1fr 1fr;gap:0.75rem;margin-bottom:0.75rem;">
        <div>
          <label class="field-lbl">Civilité</label>
          <select v-model="nouveauClient.civilite">
            <option value="">—</option>
            <option value="Madame">Madame</option>
            <option value="Monsieur">Monsieur</option>
          </select>
        </div>
        <div>
          <label class="field-lbl">Prénom</label>
          <input v-model="nouveauClient.prenom" type="text" placeholder="Prénom" />
        </div>
        <div>
          <label class="field-lbl">Nom *</label>
          <input v-model="nouveauClient.nom" type="text" placeholder="Nom (obligatoire)" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 80px 100px 1fr;gap:0.75rem;margin-bottom:0.75rem;">
        <div>
          <label class="field-lbl">Rue</label>
          <input v-model="nouveauClient.rue" type="text" placeholder="Rue" />
        </div>
        <div>
          <label class="field-lbl">N°</label>
          <input v-model="nouveauClient.numero" type="text" placeholder="12" />
        </div>
        <div>
          <label class="field-lbl">NPA</label>
          <input v-model="nouveauClient.npa" type="text" placeholder="2000" />
        </div>
        <div>
          <label class="field-lbl">Localité</label>
          <input v-model="nouveauClient.lieu" type="text" placeholder="Neuchâtel" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
        <div>
          <label class="field-lbl">Email</label>
          <input v-model="nouveauClient.email" type="email" placeholder="email@exemple.ch" />
        </div>
        <div>
          <label class="field-lbl">Téléphone</label>
          <input v-model="nouveauClient.telephone" type="text" placeholder="032 000 00 00" />
        </div>
      </div>

      <button @click="soumettreClient" class="btn-blue">Enregistrer le Client</button>

      <div class="csv-import-box" style="border-top: 1px dashed #e2e8f0; padding-top: 1.25rem; margin-top: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
        <div class="csv-instructions">
          <span style="font-size: 0.8rem; font-weight: 600; color: #475569; display: block; text-transform: uppercase; letter-spacing: 0.5px;">⚙️ Import groupé par CSV</span>
          <p style="margin: 0.2rem 0 0; font-size: 0.82rem; color: #64748b;">Format attendu : <code style="background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 4px; font-family: monospace;">Civilité;Prénom;Nom;Rue;N°;NPA;Localité;Email;Téléphone</code></p>
        </div>
        <button @click="déclencherInputFichier" class="btn-secondary" style="margin-top: 0; flex-shrink:0;">
          📥 Importer un fichier CSV
        </button>
        <input id="csv-file-input" type="file" accept=".csv" @change="gererImportCSV" style="display: none;" />
      </div>
    </section>

    <section class="card">
      <h3>Liste des clients enregistrés ({{ clients.length }})</h3>
      <table class="standard-table">
        <thead>
          <tr>
            <th>Nom complet</th>
            <th>Adresse</th>
            <th>Email</th>
            <th>Téléphone</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in clients" :key="c.id">
            <td><strong>{{ nomComplet(c) }}</strong></td>
            <td>{{ adresseComplet(c) }}</td>
            <td>{{ c.email || '—' }}</td>
            <td>{{ c.telephone || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.field-lbl { font-size: 0.82rem; font-weight: 600; color: #7a5c30; display: block; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.4px; }
</style>
