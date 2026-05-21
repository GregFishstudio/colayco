<script setup>
import { ref } from 'vue'

const props = defineProps({
  clients: Array
})

const emit = defineEmits(['add-client'])
const nouveauClient = ref({ nom: '', email: '', telephone: '', adresse: '' })

const soumettreClient = () => {
  if (!nouveauClient.value.nom) return
  emit('add-client', { ...nouveauClient.value })
  nouveauClient.value = { nom: '', email: '', telephone: '', adresse: '' }
}
</script>

<template>
  <div>
    <h2>Base Clients Colayco</h2>
    
    <section class="card">
      <h3>Ajouter un nouveau client</h3>
      <div class="client-form-grid">
        <input v-model="nouveauClient.nom" type="text" placeholder="Nom de l'entreprise / Client" />
        <input v-model="nouveauClient.email" type="email" placeholder="Email" />
        <input v-model="nouveauClient.telephone" type="text" placeholder="Téléphone" />
        <input v-model="nouveauClient.adresse" type="text" placeholder="Adresse complète (Rue, NPA, Ville)" />
        <button @click="soumettreClient" class="btn-success" style="grid-column: span 2;">Enregistrer le Client</button>
      </div>
    </section>

    <section class="card">
      <h3>Liste des clients enregistrés</h3>
      <table class="standard-table">
        <thead>
          <tr><th>Nom</th><th>Email</th><th>Téléphone</th><th>Adresse</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in clients" :key="c.id">
            <td><strong>{{ c.nom }}</strong></td>
            <td>{{ c.email }}</td>
            <td>{{ c.telephone }}</td>
            <td>{{ c.adresse }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>