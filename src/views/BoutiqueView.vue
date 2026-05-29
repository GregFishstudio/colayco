<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  boutique: Object,
  config: Object,
  derniereSauvegarde: String
})

const emit = defineEmits(['update-logo', 'select-pdf-folder', 'sauvegarder'])

const toastVisible = ref(false)
watch(() => props.derniereSauvegarde, (val) => {
  if (!val) return
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 1500)
})

const declencherInputFichier = () => {
  document.getElementById('logo-file-input').click()
}

const gererChangementLogo = (event) => {
  const file = event.target.files[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      emit('update-logo', e.target.result)
    }
    reader.readAsDataURL(file)
  }
}
</script>

<template>
  <div>
    <!-- Toast sauvegarde -->
    <Transition name="toast">
      <div v-if="toastVisible" class="toast-saved">✓ Sauvegardé !</div>
    </Transition>

    <div class="header">
      <div>
        <h2>Configuration PDF</h2>
        <p class="subtitle" style="margin-bottom:0;">En-tête, logo et mentions légales qui apparaissent sur vos devis.</p>
      </div>
      <button class="btn-save" @click="emit('sauvegarder')">💾 Sauvegarder</button>
    </div>

    <div class="config-grid">
      <section class="card">
        <h3>Informations de l'Entreprise</h3>
        <div class="field">
          <label>Nom de la Société</label>
          <input v-model="boutique.nom" type="text" placeholder="Colayco Sarl" />
        </div>
        <div class="field">
          <label>Téléphone</label>
          <input v-model="boutique.telephone" type="text" placeholder="+41 (0)32 000 00 00" />
        </div>
        <div class="field">
          <label>Email</label>
          <input v-model="boutique.email" type="email" placeholder="contact@colayco.ch" />
        </div>
        <div class="field">
          <label>Rue & Numéro</label>
          <input v-model="boutique.adresse" type="text" placeholder="Rue du Seyon 4" />
        </div>
        <div class="field">
          <label>NPA & Ville</label>
          <input v-model="boutique.localite" type="text" placeholder="2000 Neuchâtel" />
        </div>
      </section>

      <section class="card">
        <h3>Logo & Mise en Page</h3>
        <label class="field-label">Logo de l'entreprise</label>
        <div class="logo-preview-box" @click="declencherInputFichier">
          <img v-if="boutique.logo" :src="boutique.logo" alt="Logo" class="logo-img-preview" />
          <div v-else class="upload-placeholder">
            <div class="upload-icon">📷</div>
            <span>Cliquer pour charger un logo</span>
            <small>PNG · JPG · SVG</small>
          </div>
        </div>
        <input id="logo-file-input" type="file" accept="image/*" @change="gererChangementLogo" style="display: none;" />

        <div class="field" style="margin-top: 1.25rem;">
          <label>Taille du Logo</label>
          <select v-model="boutique.logoTaille">
            <option value="60px">Petit (60px)</option>
            <option value="90px">Moyen — Standard (90px)</option>
            <option value="120px">Grand (120px)</option>
          </select>
        </div>
      </section>

      <section class="card full-width" v-if="config">
        <h3>Dossier d'enregistrement PDF</h3>
        <div class="pdf-folder-row">
          <div class="pdf-folder-info">
            <div v-if="config.dossierPDF" class="dossier-chemin">
              <span class="dossier-path">📂 {{ config.dossierPDF }}</span>
              <button class="btn-clear-path" @click="config.dossierPDF = ''" title="Effacer">✕</button>
            </div>
            <p v-else class="dossier-muted">
              Aucun dossier sélectionné — une boîte de dialogue s'ouvrira à chaque export PDF.
            </p>
            <p class="dossier-hint">
              Si un dossier est défini, les PDF sont enregistrés automatiquement dans <code>Dossier / NomClient / DEV-XXXX.pdf</code>
            </p>
          </div>
          <button class="btn-pick-folder" @click="emit('select-pdf-folder')">📂 Choisir le dossier</button>
        </div>
      </section>

      <section class="card full-width">
        <h3>Pied de Page & Mentions Légales</h3>
        <div class="footer-grid">
          <div class="field">
            <label>Numéro IDE / TVA</label>
            <input v-model="boutique.tvaNumero" type="text" placeholder="CHE-123.456.789 TVA" />
          </div>
          <div class="field">
            <label>IBAN</label>
            <input v-model="boutique.iban" type="text" placeholder="CH76 0000 0000 0000 0000 0" />
          </div>
          <div class="field full-width">
            <label>Conditions du devis</label>
            <textarea v-model="boutique.conditions" rows="3" placeholder="Ex: Devis valable 30 jours. Acompte de 50% à la commande, solde à la livraison."></textarea>
          </div>
          <div class="field full-width">
            <label>Conditions de paiement (facture)</label>
            <input v-model="boutique.conditionsPaiement" type="text" placeholder="Ex: Paiement à 10 jours." />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.875rem; }
.field:last-child { margin-bottom: 0; }
.field label, .field-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  display: block;
  margin-bottom: 0.35rem;
}
.field input, .field select, .field textarea {
  padding: 0.55rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.9rem;
  font-family: inherit;
  color: #0f172a;
  background: white;
  transition: border-color 0.15s, box-shadow 0.15s;
  width: 100%;
}
.field input:focus, .field select:focus, .field textarea:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}
.field textarea { resize: vertical; line-height: 1.5; }

.logo-preview-box {
  border: 2px dashed #e2e8f0;
  border-radius: 10px;
  height: 130px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafafa;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;
}
.logo-preview-box:hover { border-color: #a5b4fc; background: #eef2ff; }
.upload-placeholder { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; color: #94a3b8; font-size: 0.82rem; }
.upload-icon { font-size: 1.5rem; }
.upload-placeholder small { font-size: 0.72rem; color: #cbd5e1; }
.logo-img-preview { max-height: 100%; max-width: 100%; object-fit: contain; }

.footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.875rem; }
.footer-grid .full-width { grid-column: span 2; }

.btn-save {
  background: #fff; border: 1px solid #bbf7d0; color: #166534;
  padding: 0.5rem 1rem; border-radius: 8px; font-weight: 600;
  font-size: 0.85rem; cursor: pointer; transition: all 0.15s; align-self: flex-start;
}
.btn-save:hover { background: #f0fdf4; border-color: #4ade80; }

.toast-saved {
  position: fixed; top: 1.2rem; left: 50%; transform: translateX(-50%);
  z-index: 9999; background: #166534; color: #fff;
  padding: 0.75rem 2rem; border-radius: 12px;
  font-weight: 700; font-size: 0.95rem;
  box-shadow: 0 8px 30px rgba(0,0,0,0.18);
  pointer-events: none;
}
.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-10px); }

.pdf-folder-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap; }
.pdf-folder-info { flex: 1; }
.dossier-chemin { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.dossier-path {
  font-size: 0.8rem; color: #166534; background: #dcfce7;
  padding: 0.3rem 0.7rem; border-radius: 6px; font-family: monospace;
  word-break: break-all;
}
.btn-clear-path {
  background: transparent; border: 1px solid #fca5a5; border-radius: 6px;
  color: #ef4444; width: 24px; height: 24px; font-size: 0.7rem;
  cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.btn-clear-path:hover { background: #fef2f2; }
.dossier-muted { margin: 0 0 0.4rem; font-size: 0.85rem; color: #9ca3af; }
.dossier-hint { margin: 0; font-size: 0.8rem; color: #6b7280; }
.dossier-hint code { background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 4px; font-size: 0.78rem; }
.btn-pick-folder {
  background: #166534; color: #fff; border: none; border-radius: 10px;
  padding: 0.6rem 1.2rem; font-size: 0.88rem; font-weight: 600;
  cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: background 0.15s;
}
.btn-pick-folder:hover { background: #14532d; }
</style>