<script setup>
import { ref } from "vue";

const emit = defineEmits(["add-task", "open-modal"]);
const newTask = ref("");

function submitForm() {
  if (newTask.value.trim()) {
    emit("add-task", {
      title: newTask.value.trim(),
      category: "Pribadi / Umum",
      priority: "medium",
      deadline: "",
      notes: "",
    });
    newTask.value = "";
  }
}
</script>

<template>
  <div class="quick-form-card">
    <form @submit.prevent="submitForm" class="quick-form">
      <div class="input-container">
        <span class="input-icon">✏️</span>
        <input
          v-model="newTask"
          placeholder="Tulis tugas baru dengan cepat & tekan Enter..."
          class="task-input"
        />
      </div>

      <div class="action-buttons">
        <button
          type="button"
          class="btn-detail"
          @click="$emit('open-modal')"
          title="Tambah tugas lengkap dengan deadline & prioritas"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span class="btn-text">Detail & Deadline</span>
        </button>

        <button type="submit" class="btn-submit" :disabled="!newTask.trim()">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span class="btn-text">Tambah</span>
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.quick-form-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 0.65rem 0.85rem;
  box-shadow: var(--card-shadow);
  margin-bottom: 1.5rem;
  transition: all 0.2s ease;
}

.quick-form-card:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-ring);
}

.quick-form {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.input-container {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 200px;
  gap: 0.5rem;
}

.input-icon {
  font-size: 1.1rem;
}

.task-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.task-input::placeholder {
  color: var(--text-muted);
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-detail {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-subtle);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.45rem 0.85rem;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-detail:hover {
  background: var(--primary-light);
  color: var(--primary);
  border-color: var(--primary);
}

.btn-submit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  padding: 0.45rem 1rem;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-submit:hover:not(:disabled) {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

.btn-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .btn-text {
    display: none;
  }
}
</style>
