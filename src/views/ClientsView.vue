<script setup>
import { ref } from 'vue'

const props = defineProps({
  clients: Array
})

const emit = defineEmits(['add-client'])
const nouveauClient = ref({ nom: '', email: '', telephone: '', adresse: '' })

// Soumettre un client manuellement
const soumettreClient = () => {
  if (!nouveauClient.value.nom) return
  emit('add-client', { ...nouveauClient.value })
  nouveauClient.value = { nom: '', email: '', telephone: '', adresse: '' }
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
    // Découpage par ligne
    const lignes = texte.split(/\r?\n/)
    
    let contactsImportes = 0

    // On boucle sur chaque ligne (on commence à 1 si tu as des en-têtes Nom, Email, etc., ou 0 sinon)
    // Ici on commence à 0 pour accepter les fichiers bruts, mais on vérifie s'il y a du contenu
    lignes.forEach((ligne, index) => {
      // Nettoyage et séparation par virgule ou point-virgule (courant sur Excel en Suisse)
      const colonnes = ligne.split(/[,;]/)
      
      // On s'assure qu'il y a au moins un Nom dans la première colonne
      const nom = colonnes[0]?.trim()
      
      // Ignorer la ligne d'en-tête générique si elle existe
      if (!nom || nom.toLowerCase() === 'nom' || nom.toLowerCase() === 'name') return

      const email = colonnes[1]?.trim() || ''
      const telephone = colonnes[2]?.trim() || ''
      const adresse = colonnes[3]?.trim() || ''

      // Envoi du contact à l'état global de App.vue
      emit('add-client', {
        nom,
        email,
        telephone,
        adresse
      })
      contactsImportes++
    })

    alert(`Importation réussie : ${contactsImportes} contacts ajoutés à la base Colayco !`)
    event.target.value = '' // Reset l'input pour pouvoir ré-importer le même fichier
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
      <div class="client-form-grid" style="margin-bottom: 1.5rem;">
        <input v-model="nouveauClient.nom" type="text" placeholder="Nom de l'entreprise / Client" />
        <input v-model="nouveauClient.email" type="email" placeholder="Email" />
        <input v-model="nouveauClient.telephone" type="text" placeholder="Téléphone" />
        <input v-model="nouveauClient.adresse" type="text" placeholder="Adresse complète (Rue, NPA, Ville)" />
        <button @click="soumettreClient" class="btn-blue" style="grid-column: span 2;">Enregistrer le Client</button>
      </div>

      <div class="csv-import-box" style="border-top: 1px dashed #e2e8f0; padding-top: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
        <div class="csv-instructions">
          <span style="font-size: 0.8rem; font-weight: 600; color: #475569; display: block; text-transform: uppercase; letter-spacing: 0.5px;">⚙️ Import groupé par CSV</span>
          <p style="margin: 0.2rem 0 0; font-size: 0.82rem; color: #64748b;">Format attendu : <code style="background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 4px; font-family: monospace;">Nom, Email, Téléphone, Adresse</code> (Séparateur virgule ou point-virgule).</p>
        </div>
        <button @click="déclencherInputFichier" class="btn-secondary" style="margin-top: 0;">
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
            <th>Nom</th>
            <th>Email</th>
            <th>Téléphone</th>
            <th>Adresse</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in clients" :key="c.id">
            <td><strong>{{ c.nom }}</strong></td>
            <td>{{ c.email || '—' }}</td>
            <td>{{ c.telephone || '—' }}</td>
            <td>{{ c.adresse || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>