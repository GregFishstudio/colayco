<script setup>
import { ref, watch } from 'vue'

const props = defineProps({ config: Object, derniereSauvegarde: String })
const emit = defineEmits(['backup-data', 'sauvegarder'])

const toastVisible = ref(false)
watch(() => props.derniereSauvegarde, (val) => {
  if (!val) return
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 1500)
})

// Icônes par symbole API
const iconeParAPI = { gold: '🥇', silver: '🪙', platinum: '💎', palladium: '⚙️' }
const icone = (m) => iconeParAPI[m.symboleAPI] || '🔩'

// ── Nouveau matériau ─────────────────────────────────────
const nouveauMetal = ref({ nom: '', prixGramme: 0, symboleAPI: null })
const ajouterMetal = () => {
  if (!nouveauMetal.value.nom) return
  props.config.metaux.push({
    id: Date.now(),
    nom: nouveauMetal.value.nom,
    prixGramme: parseFloat(nouveauMetal.value.prixGramme) || 0,
    symboleAPI: nouveauMetal.value.symboleAPI || null
  })
  nouveauMetal.value = { nom: '', prixGramme: 0, symboleAPI: null }
}
const supprimerMetal = (index) => props.config.metaux.splice(index, 1)

// ── Prix live via web ────────────────────────────────────
const fetchEnCours = ref({})
const derniereMAJ = ref(null)

const fetchPrixLive = async (metal) => {
  if (!metal.symboleAPI) return
  fetchEnCours.value[metal.id] = true
  try {
    // 1. Prix spot USD / troy once
    const metalRes  = await fetch('https://api.metals.live/v1/spot')
    const metalData = await metalRes.json()
    const entry     = metalData.find(o => o[metal.symboleAPI] !== undefined)
    if (!entry) throw new Error('Métal non trouvé dans l\'API')

    // 2. Taux de change USD → CHF
    const rateRes  = await fetch('https://open.er-api.com/v6/latest/USD')
    const rateData = await rateRes.json()
    const usdToChf = rateData.rates?.CHF ?? 0.9

    // 3. Conversion : USD/troy oz → CHF/g  (1 troy oz = 31.1035 g)
    const prixChfG = (entry[metal.symboleAPI] / 31.1035) * usdToChf
    metal.prixGramme = Math.round(prixChfG * 100) / 100
    derniereMAJ.value = new Date().toLocaleTimeString('fr-CH')
  } catch (err) {
    console.error('Erreur prix live :', err)
    alert(`Impossible de récupérer le prix pour « ${metal.nom} ».\nVérifiez votre connexion.`)
  }
  fetchEnCours.value[metal.id] = false
}

const fetchTousLesPrix = async () => {
  const metauxAvecAPI = props.config.metaux.filter(m => m.symboleAPI)
  for (const m of metauxAvecAPI) await fetchPrixLive(m)
}

// ── Prestations personnalisées ────────────────────────────
const nouvellePrestation = ref({ nom: '', prix: 0 })
const ajouterPrestation = () => {
  if (!nouvellePrestation.value.nom) return
  props.config.prestations.push({
    id: Date.now(),
    nom: nouvellePrestation.value.nom,
    prix: parseFloat(nouvellePrestation.value.prix) || 0
  })
  nouvellePrestation.value = { nom: '', prix: 0 }
}
const supprimerPrestation = (index) => props.config.prestations.splice(index, 1)

// ── Pierres & Diamants ───────────────────────────────────
const nouvellePierre = ref({ nom: 'Diamant', taille: '', prix: 0 })
const ajouterPierre = () => {
  if (!nouvellePierre.value.taille) return
  props.config.diamants.push({
    id: Date.now(),
    nom: nouvellePierre.value.nom || 'Diamant',
    taille: nouvellePierre.value.taille,
    prix: parseFloat(nouvellePierre.value.prix) || 0
  })
  nouvellePierre.value = { nom: 'Diamant', taille: '', prix: 0 }
}
const supprimerPierre = (index) => props.config.diamants.splice(index, 1)

// Symboles API disponibles
const symboles = [
  { val: 'gold',      label: 'Or (XAU)' },
  { val: 'silver',    label: 'Argent (XAG)' },
  { val: 'platinum',  label: 'Platine (XPT)' },
  { val: 'palladium', label: 'Palladium (XPD)' },
]
</script>

<template>
  <div>
    <!-- Toast sauvegarde -->
    <Transition name="toast">
      <div v-if="toastVisible" class="toast-saved">✓ Sauvegardé !</div>
    </Transition>

    <div class="header">
      <div>
        <h2>Matériaux & Tarifs</h2>
        <p class="subtitle" style="margin-bottom:0;">Gérez vos matières premières et mettez à jour les cours en temps réel.</p>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <button class="btn-save" @click="emit('sauvegarder')">💾 Sauvegarder</button>
        <button class="btn-success" @click="fetchTousLesPrix">🌐 Actualiser tous les cours</button>
      </div>
    </div>

    <!-- ── Métaux précieux ─────────────────────────── -->
    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.1rem;padding-bottom:0.65rem;border-bottom:1px solid #f0fdf4;">
        <span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;color:#15803d;">
          Matières Premières · CHF / g
        </span>
        <span v-if="derniereMAJ" class="badge-update">⏱ Mis à jour à {{ derniereMAJ }}</span>
      </div>

      <div class="metal-list">
        <div v-for="(metal, index) in config.metaux" :key="metal.id" class="metal-row">
          <!-- Icône + nom -->
          <div class="metal-identity">
            <div class="metal-icon-zone">{{ icone(metal) }}</div>
            <div>
              <input v-model="metal.nom" type="text" class="metal-name-input" placeholder="Nom du matériau" />
              <div class="metal-api-label" v-if="metal.symboleAPI">
                {{ symboles.find(s => s.val === metal.symboleAPI)?.label || metal.symboleAPI }}
              </div>
              <div class="metal-api-label muted" v-else>Cours manuel</div>
            </div>
          </div>

          <!-- Prix + symbole API + actions -->
          <div class="metal-controls">
            <div class="prix-input-group">
              <input v-model.number="metal.prixGramme" type="number" step="0.01" class="prix-input" />
              <span class="prix-unit">CHF/g</span>
            </div>

            <select v-model="metal.symboleAPI" class="api-select" title="Lier à un cours en temps réel">
              <option :value="null">Manuel</option>
              <option v-for="s in symboles" :key="s.val" :value="s.val">{{ s.label }}</option>
            </select>

            <button
              v-if="metal.symboleAPI"
              @click="fetchPrixLive(metal)"
              class="btn-live"
              :disabled="fetchEnCours[metal.id]"
              title="Récupérer le cours en temps réel"
            >
              {{ fetchEnCours[metal.id] ? '⏳' : '🌐' }}
            </button>

            <button @click="supprimerMetal(index)" class="btn-del" title="Supprimer">✕</button>
          </div>
        </div>
      </div>

      <!-- Ajouter un nouveau métal -->
      <div class="add-metal-form">
        <div class="add-metal-title">＋ Ajouter un matériau</div>
        <div class="add-metal-grid">
          <input v-model="nouveauMetal.nom" type="text" placeholder="Ex: Platine, Titane, Palladium…" />
          <input v-model.number="nouveauMetal.prixGramme" type="number" step="0.01" placeholder="CHF/g" style="width:100px;" />
          <select v-model="nouveauMetal.symboleAPI">
            <option :value="null">Manuel</option>
            <option v-for="s in symboles" :key="s.val" :value="s.val">{{ s.label }}</option>
          </select>
          <button @click="ajouterMetal" class="btn-success" style="padding:0.5rem 1rem;">Ajouter</button>
        </div>
      </div>
    </section>

    <!-- ── Prestations atelier ─────────────────────── -->
    <div class="config-grid">
      <section class="card">
        <h3>Prestations Atelier (Forfaits)</h3>
        <div class="config-row">
          <label><span class="row-icon">🔥</span> Fonte Cire Perdue</label>
          <div class="row-input-group">
            <input v-model.number="config.cirePerdue" type="number" step="0.50" />
            <span class="unit-tag">CHF</span>
          </div>
        </div>
        <div class="config-row">
          <label><span class="row-icon">🖨️</span> Impression 3D Altmann</label>
          <div class="row-input-group">
            <input v-model.number="config.impression3d" type="number" step="0.50" />
            <span class="unit-tag">CHF</span>
          </div>
        </div>
        <div class="config-row">
          <label><span class="row-icon">⚗️</span> Perte métal (fripouille)</label>
          <div class="row-input-group">
            <input v-model.number="config.perteMetal" type="number" step="0.5" min="0" max="50" />
            <span class="unit-tag">%</span>
          </div>
        </div>
        <div class="config-row">
          <label><span class="row-icon">🛠️</span> Taux horaire Façon</label>
          <div class="row-input-group">
            <input v-model.number="config.tauxHoraire" type="number" step="1" min="0" />
            <span class="unit-tag">CHF/h</span>
          </div>
        </div>

        <!-- Prestations personnalisées -->
        <div v-if="config.prestations && config.prestations.length > 0" style="margin-top:0.75rem;">
          <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#4b7c59;margin-bottom:0.5rem;padding-top:0.5rem;border-top:1px solid #f0e8da;">
            Prestations personnalisées
          </div>
          <div v-for="(p, index) in config.prestations" :key="p.id" class="prestation-row">
            <input v-model="p.nom" type="text" class="prestation-name-input" placeholder="Nom de la prestation" />
            <div class="prix-input-group">
              <input v-model.number="p.prix" type="number" step="0.50" class="prix-input" />
              <span class="prix-unit">CHF</span>
            </div>
            <button @click="supprimerPrestation(index)" class="btn-del" title="Supprimer">✕</button>
          </div>
        </div>

        <div class="add-metal-form" style="margin-top:0.75rem;">
          <div class="add-metal-title">＋ Ajouter une prestation</div>
          <div class="add-metal-grid">
            <input v-model="nouvellePrestation.nom" type="text" placeholder="Ex: Rhodiage, Polissage…" />
            <input v-model.number="nouvellePrestation.prix" type="number" step="0.50" placeholder="CHF" style="width:100px;" />
            <button @click="ajouterPrestation" class="btn-success" style="padding:0.5rem 1rem;">Ajouter</button>
          </div>
        </div>
      </section>

      <section class="card">
        <h3>TVA</h3>
        <div class="config-row">
          <label>Mode TVA</label>
          <div class="tva-toggle">
            <button
              :class="['tva-btn', config.tvaMode === 'incluse' ? 'tva-btn--active' : '']"
              @click="config.tvaMode = 'incluse'"
            >TVA incluse</button>
            <button
              :class="['tva-btn', config.tvaMode === 'sus' ? 'tva-btn--active' : '']"
              @click="config.tvaMode = 'sus'"
            >TVA en sus</button>
          </div>
        </div>
        <div class="config-row">
          <label><span class="row-icon">%</span> Taux TVA</label>
          <div class="row-input-group">
            <input v-model.number="config.tvaTaux" type="number" step="0.1" min="0" max="30" />
            <span class="unit-tag">%</span>
          </div>
        </div>
        <p class="tva-hint" v-if="config.tvaMode === 'incluse'">
          Les prix saisis incluent déjà la TVA. Le devis affichera <em>«&nbsp;TVA {{ config.tvaTaux }}% incluse&nbsp;»</em> et le montant extrait.
        </p>
        <p class="tva-hint" v-else>
          La TVA sera calculée <strong>en sus</strong> du montant HT. Le devis affichera le détail HT + TVA + TTC.
        </p>
      </section>

      <section class="card" style="grid-column:span 1;">
        <h3>Info</h3>
        <div class="info-card">
          <div class="info-icon">🌐</div>
          <p>Sélectionnez un cours (XAU, XAG…) sur chaque matière pour activer le bouton <strong>🌐 Actualiser</strong> qui récupère le cours spot en temps réel et convertit en CHF/g.</p>
          <p style="margin:0;font-size:0.8rem;color:#6b7280;">Source : metals.live · open.er-api.com</p>
        </div>
      </section>
    </div>

    <!-- ── Sécurité & Backup ─────────────────────── -->
    <section class="card">
      <div class="backup-section">
        <div class="backup-info">
          <div class="backup-icon">🔒</div>
          <div>
            <h3 style="margin:0 0 0.3rem;">Sécurité des données</h3>
            <p style="margin:0;font-size:0.85rem;color:#4b5563;line-height:1.5;">
              Exportez une copie complète de vos devis, clients et tarifs vers un fichier JSON externe.
              Recommandé avant toute mise à jour ou en fin de semaine.
            </p>
          </div>
        </div>
        <button class="btn-backup" @click="emit('backup-data')">
          💾 Exporter la sauvegarde
        </button>
      </div>
    </section>

    <!-- ── Pierres & Diamants ────────────────────── -->
    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.1rem;padding-bottom:0.65rem;border-bottom:1px solid #f0fdf4;">
        <span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;color:#15803d;">
          Pierres &amp; Diamants · Prix unitaire indicatif (CHF)
        </span>
      </div>

      <div class="pierre-list">
        <div class="pierre-header-row">
          <span>Type / Nom</span>
          <span>Taille</span>
          <span>Prix unitaire</span>
          <span></span>
        </div>
        <div v-for="(dia, index) in config.diamants" :key="dia.id" class="pierre-row">
          <input v-model="dia.nom" type="text" placeholder="Ex: Diamant, Rubis…" class="pierre-input" />
          <input v-model="dia.taille" type="text" placeholder="Ex: 1.5 mm" class="pierre-input" />
          <div class="prix-input-group">
            <input v-model.number="dia.prix" type="number" step="0.50" class="prix-input" />
            <span class="prix-unit">CHF</span>
          </div>
          <button @click="supprimerPierre(index)" class="btn-del" title="Supprimer">✕</button>
        </div>
      </div>

      <!-- Ajouter une nouvelle pierre -->
      <div class="add-metal-form" style="margin-top:0.75rem;">
        <div class="add-metal-title">＋ Ajouter une pierre</div>
        <div class="add-metal-grid">
          <input v-model="nouvellePierre.nom" type="text" placeholder="Type (Diamant, Rubis…)" />
          <input v-model="nouvellePierre.taille" type="text" placeholder="Taille (ex: 1.25 mm)" />
          <input v-model.number="nouvellePierre.prix" type="number" step="0.50" placeholder="CHF" style="width:90px;" />
          <button @click="ajouterPierre" class="btn-success" style="padding:0.5rem 1rem;">Ajouter</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ── Save button + toast ────────────── */
.btn-save {
  background: #fff; border: 1px solid #bbf7d0; color: #166534;
  padding: 0.5rem 1rem; border-radius: 8px; font-weight: 600;
  font-size: 0.85rem; cursor: pointer; transition: all 0.15s;
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

/* ── Metal list ─────────────────────── */
.metal-list { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1.25rem; }

.metal-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  background: #f0fdf4;
  border: 1px solid #dcfce7;
  border-radius: 10px;
  padding: 0.75rem 1rem;
  transition: border-color 0.15s;
}
.metal-row:hover { border-color: #86efac; }

.metal-identity { display: flex; align-items: center; gap: 0.75rem; min-width: 0; flex: 1; }
.metal-icon-zone {
  width: 40px; height: 40px; border-radius: 10px;
  background: #fff; border: 1px solid #dcfce7;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.3rem; flex-shrink: 0;
}
.metal-name-input {
  border: none; background: transparent; font-size: 0.95rem; font-weight: 600;
  color: #14532d; padding: 0; width: 100%; outline: none;
}
.metal-name-input:focus { border-bottom: 1px solid #22c55e; }
.metal-api-label { font-size: 0.72rem; color: #4b7c59; margin-top: 2px; font-weight: 500; }
.metal-api-label.muted { color: #9ca3af; }

.metal-controls { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
.prix-input-group { display: flex; align-items: center; gap: 0.3rem; }
.prix-input { width: 90px; text-align: right; flex-shrink: 0; font-weight: 700; font-size: 0.95rem; }
.prix-unit { font-size: 0.75rem; font-weight: 700; color: #4ade80; white-space: nowrap; }

.api-select { font-size: 0.78rem; padding: 0.35rem 0.5rem; height: 34px; border-radius: 6px; color: #166534; border: 1px solid #bbf7d0; background: #fff; }

.btn-live {
  background: #fff; border: 1px solid #bbf7d0; border-radius: 8px;
  width: 34px; height: 34px; font-size: 1rem; cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: all 0.12s;
}
.btn-live:hover:not(:disabled) { background: #dcfce7; border-color: #4ade80; }
.btn-live:disabled { opacity: 0.5; cursor: wait; }
.btn-del {
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  width: 30px; height: 30px; color: #94a3b8; cursor: pointer; font-size: 0.8rem;
  display: flex; align-items: center; justify-content: center; transition: all 0.12s;
}
.btn-del:hover { background: #fef2f2; border-color: #fca5a5; color: #ef4444; }

/* ── Add form ───────────────────────── */
.add-metal-form { background: #fafafa; border: 1px dashed #bbf7d0; border-radius: 10px; padding: 1rem; }
.add-metal-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #4b7c59; margin-bottom: 0.75rem; }
.add-metal-grid { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
.add-metal-grid input, .add-metal-grid select { flex: 1; min-width: 120px; }

/* ── Badge & misc ───────────────────── */
.badge-update { font-size: 0.72rem; color: #4b7c59; background: #dcfce7; border: 1px solid #bbf7d0; padding: 0.2rem 0.6rem; border-radius: 20px; }
.row-icon { margin-right: 0.4rem; }
.row-input-group { display: flex; align-items: center; gap: 0.4rem; }
.row-input-group input { width: 100px; text-align: right; }
.unit-tag { font-size: 0.75rem; font-weight: 700; color: #4ade80; }

/* ── Pierres list ────────────────────── */
.pierre-list { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.5rem; }
.pierre-header-row {
  display: grid; grid-template-columns: 1fr 1fr 130px 32px;
  gap: 0.5rem; padding: 0 0.5rem;
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.5px; color: #9ca3af;
}
.pierre-row {
  display: grid; grid-template-columns: 1fr 1fr 130px 32px;
  gap: 0.5rem; align-items: center;
  background: #f0fdf4; border: 1px solid #dcfce7;
  border-radius: 8px; padding: 0.5rem 0.5rem;
  transition: border-color 0.15s;
}
.pierre-row:hover { border-color: #86efac; }
.pierre-input {
  border: none; background: transparent; font-size: 0.88rem;
  color: #14532d; padding: 0; width: 100%; outline: none; font-weight: 500;
}
.pierre-input:focus { border-bottom: 1px solid #22c55e; }

/* ── Prestations list ────────────────── */
.prestation-row {
  display: flex; align-items: center; gap: 0.5rem;
  background: #f0fdf4; border: 1px solid #dcfce7;
  border-radius: 8px; padding: 0.4rem 0.6rem; margin-bottom: 0.35rem;
  transition: border-color 0.15s;
}
.prestation-row:hover { border-color: #86efac; }
.prestation-name-input {
  border: none; background: transparent; font-size: 0.9rem; font-weight: 600;
  color: #14532d; padding: 0; flex: 1; outline: none;
}
.prestation-name-input:focus { border-bottom: 1px solid #22c55e; }

.info-card { display: flex; flex-direction: column; gap: 0.6rem; }
.info-icon { font-size: 1.8rem; }
.info-card p { margin: 0; font-size: 0.86rem; color: #4b5563; line-height: 1.6; }

/* ── TVA toggle ─────────────────────── */
.tva-toggle { display: flex; gap: 0.4rem; }
.tva-btn {
  padding: 0.35rem 0.85rem; border-radius: 20px; font-size: 0.82rem; font-weight: 600;
  cursor: pointer; border: 1px solid #bbf7d0; background: #fff; color: #166534;
  transition: all 0.12s;
}
.tva-btn--active { background: #166534; color: #fff; border-color: #166534; }
.tva-btn:hover:not(.tva-btn--active) { background: #dcfce7; }
.tva-hint { margin: 0.5rem 0 0; font-size: 0.8rem; color: #4b7c59; background: #f0fdf4; border-radius: 8px; padding: 0.5rem 0.75rem; }

/* ── Backup ─────────────────────────── */
.backup-section { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap; }
.backup-info { display: flex; align-items: flex-start; gap: 1rem; flex: 1; }
.backup-icon { font-size: 2rem; flex-shrink: 0; }
.btn-backup {
  background: #166534; color: #fff; border: none; border-radius: 10px;
  padding: 0.65rem 1.4rem; font-size: 0.88rem; font-weight: 600; cursor: pointer;
  white-space: nowrap; transition: background 0.15s;
}
.btn-backup:hover { background: #14532d; }
</style>
