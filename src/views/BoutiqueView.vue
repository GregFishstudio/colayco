<script setup>
import { ref } from 'vue'

defineProps({
  boutique: Object
})

const declencherInputFichier = () => {
  document.getElementById('logo-file-input').click()
}

const gererChangementLogo = (event) => {
  const file = event.target.files[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      // On stocke l'image en Base64 dans l'état réactif
      emit('update-logo', e.target.result)
    }
    reader.readAsDataURL(file)
  }
}

const emit = defineEmits(['update-logo'])
</script>

<template>
  <div>
    <h2>Configuration de la Boutique & du PDF</h2>
    <p class="subtitle">Paramètre l'en-tête, le logo et les pieds de page légaux pour les devis Colayco.</p>

    <div class="config-grid">
      <!-- Infos Légales de la SARL -->
      <section class="card">
        <h3>Informations de l'Entreprise</h3>
        <div class="form-group">
          <label>Nom de la Société :</label>
          <input v-model="boutique.nom" type="text" />
        </div>
        <div class="form-group">
          <label>Téléphone :</label>
          <input v-model="boutique.telephone" type="text" />
        </div>
        <div class="form-group">
          <label>Email Contact :</label>
          <input v-model="boutique.email" type="email" />
        </div>
        <div class="form-group">
          <label>Adresse :</label>
          <input v-model="boutique.adresse" type="text" />
        </div>
        <div class="form-group">
          <label>Code Postal & Ville :</label>
          <input v-model="boutique.localite" type="text" placeholder="2000 Neuchâtel" />
        </div>
      </section>

      <!-- Identité Visuelle (Logo & Style) -->
      <section class="card">
        <h3>Design du PDF (Logo & Options)</h3>
        <div class="logo-uploader">
          <label>Logo de l'entreprise :</label>
          <div class="logo-preview-box" @click="declencherInputFichier">
            <img v-if="boutique.logo" :src="boutique.logo" alt="Logo Colayco" class="logo-img-preview" />
            <div v-else class="upload-placeholder">
              <span>📷 Cliquez pour charger un logo (PNG/JPG)</span>
            </div>
          </div>
          <input id="logo-file-input" type="file" accept="image/*" @change="gererChangementLogo" style="display: none;" />
        </div>

        <div class="form-group style-toggle" style="margin-top: 1.5rem;">
          <label>Taille du Logo sur le PDF :</label>
          <select v-model="boutique.logoTaille">
            <option value="60px">Petit</option>
            <option value="90px">Moyen (Standard)</option>
            <option value="120px">Grand</option>
          </select>
        </div>
      </section>

      <!-- Pied de page et Coordonnées Bancaires -->
      <section class="card full-width">
        <h3>Pied de Page & Mentions Légales (Bas du PDF)</h3>
        <div class="form-group">
          <label>Numéro IDE / TVA (Ex: CHE-123.456.789 TVA) :</label>
          <input v-model="boutique.tvaNumero" type="text" />
        </div>
        <div class="form-group">
          <label>Coordonnées Bancaires (IBAN / Compte pour paiement d'acompte) :</label>
          <input v-model="boutique.iban" type="text" placeholder="CH76 0000 0000 ..." />
        </div>
        <div class="form-group">
          <label>Conditions de validité du devis (Texte libre) :</label>
          <textarea v-model="boutique.conditions" rows="3" placeholder="Ex: Devis valable 30 jours. Acompte de 50% à la commande, solde à la livraison."></textarea>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.form-group { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 1rem; }
.form-group label { font-weight: 500; color: #475569; font-size: 0.95rem; }
.form-group input, .form-group select, .form-group textarea { padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.95rem; font-family: inherit; }
.logo-uploader { display: flex; flex-direction: column; gap: 0.5rem; }
.logo-preview-box { border: 2px dashed #cbd5e1; border-radius: 8px; height: 120px; display: flex; align-items: center; justify-content: center; background: #f8fafc; cursor: pointer; overflow: hidden; transition: border-color 0.2s; }
.logo-preview-box:hover { border-color: #3b82f6; }
.upload-placeholder { color: #64748b; font-size: 0.85rem; text-align: center; padding: 1rem; }
.logo-img-preview { max-height: 100%; max-width: 100%; object-fit: contain; }
</style>