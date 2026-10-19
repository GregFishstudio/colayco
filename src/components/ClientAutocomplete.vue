<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [Object, String], default: '' },
  clients: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Rechercher un client (nom, email, téléphone)…' }
})
const emit = defineEmits(['update:modelValue'])

const nomComplet = (c) => {
  if (!c) return ''
  return [c.civilite, c.prenom, c.nom].filter(Boolean).join(' ') || c.nom || ''
}

const recherche = ref(props.modelValue ? nomComplet(props.modelValue) : '')
const ouvert = ref(false)

watch(() => props.modelValue, (v) => {
  recherche.value = v ? nomComplet(v) : ''
})

const filtres = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  if (!q) return props.clients
  return props.clients.filter(c => {
    const hay = [nomComplet(c), c.email, c.telephone, c.lieu].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
})

const choisir = (c) => {
  emit('update:modelValue', c)
  recherche.value = nomComplet(c)
  ouvert.value = false
}

const effacer = () => {
  emit('update:modelValue', '')
  recherche.value = ''
  ouvert.value = false
}

const onFocus = () => { ouvert.value = true }
const onInput = () => {
  ouvert.value = true
  if (props.modelValue && recherche.value !== nomComplet(props.modelValue)) {
    emit('update:modelValue', '')
  }
}
const onBlur = () => {
  // Délai pour laisser le clic sur une option s'exécuter avant la fermeture
  setTimeout(() => {
    ouvert.value = false
    recherche.value = props.modelValue ? nomComplet(props.modelValue) : ''
  }, 150)
}
</script>

<template>
  <div class="client-ac">
    <div class="client-ac-input-wrap">
      <input
        type="text"
        v-model="recherche"
        :placeholder="placeholder"
        @focus="onFocus"
        @input="onInput"
        @blur="onBlur"
        class="client-ac-input"
        autocomplete="off"
      />
      <button v-if="modelValue" type="button" class="client-ac-clear" @mousedown.prevent="effacer">✕</button>
    </div>
    <div v-if="ouvert && filtres.length > 0" class="client-ac-dropdown">
      <div v-for="c in filtres" :key="c.id" class="client-ac-option" @mousedown.prevent="choisir(c)">
        <div class="client-ac-option-nom">{{ nomComplet(c) }}</div>
        <div class="client-ac-option-sub" v-if="c.email || c.telephone">{{ [c.email, c.telephone].filter(Boolean).join(' · ') }}</div>
      </div>
    </div>
    <div v-else-if="ouvert && recherche.trim()" class="client-ac-dropdown">
      <div class="client-ac-empty">Aucun client trouvé.</div>
    </div>
  </div>
</template>

<style scoped>
.client-ac { position: relative; }
.client-ac-input-wrap { position: relative; }
.client-ac-input { width: 100%; padding: 0.53rem; padding-right: 2rem; box-sizing: border-box; }
.client-ac-clear { position: absolute; right: 0.4rem; top: 50%; transform: translateY(-50%); background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 0.8rem; padding: 0.2rem; line-height: 1; }
.client-ac-clear:hover { color: #ef4444; }
.client-ac-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: #fff; border: 1px solid #d4c9b8; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.14); max-height: 260px; overflow-y: auto; z-index: 50; }
.client-ac-option { padding: 0.55rem 0.75rem; cursor: pointer; border-bottom: 1px solid #f0e8da; }
.client-ac-option:last-child { border-bottom: none; }
.client-ac-option:hover { background: #faf6ef; }
.client-ac-option-nom { font-weight: 600; color: #1a1209; font-size: 0.88rem; }
.client-ac-option-sub { font-size: 0.76rem; color: #8a7055; margin-top: 0.1rem; }
.client-ac-empty { padding: 0.6rem 0.75rem; font-size: 0.82rem; color: #94a3b8; }
</style>
