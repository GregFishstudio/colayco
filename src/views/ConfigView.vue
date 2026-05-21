<script setup>
defineProps({
  config: Object
})
</script>

<template>
  <div>
    <h2>Configuration des Tarifs & Matières</h2>
    <p class="subtitle">Modifie ici les valeurs de référence. Elles mettront à jour instantanément les raccourcis de l'éditeur.</p>

    <div class="config-grid">
      <section class="card">
        <h3>Cours des Métaux (CHF / g)</h3>
        <div class="config-row">
          <label>Or Fin (24K) :</label>
          <input v-model.number="config.orFin" type="number" step="0.01" />
        </div>
        <div class="config-row">
          <label>Or 18K Alliage :</label>
          <input v-model.number="config.or18k" type="number" step="0.01" />
        </div>
        <div class="config-row">
          <label>Argent 925 :</label>
          <input v-model.number="config.argent925" type="number" step="0.01" />
        </div>
      </section>

      <section class="card">
        <h3>Prestations Ateliers (Forfaits)</h3>
        <div class="config-row">
          <label>Fonte Cire Perdue :</label>
          <input v-model.number="config.cirePerdue" type="number" step="0.50" />
        </div>
        <div class="config-row">
          <label>Impression 3D (Altmann) :</label>
          <input v-model.number="config.impression3d" type="number" step="0.50" />
        </div>
      </section>

      <section class="card full-width">
        <h3>Grille des Diamants (Tarif unitaire indicatif)</h3>
        <div class="diamonds-config-grid">
          <div v-for="dia in config.diamants" :key="dia.taille" class="diamond-item">
            <span class="diamond-label">💎 Taille {{ dia.taille }}</span>
            <div class="input-wrapper">
              <input v-model.number="dia.prix" type="number" step="1" />
              <span class="currency">CHF</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>