<script setup>
import { ref, watch } from "vue";

const props = defineProps({
  isOpen: Boolean,
  taskToEdit: Object, // If null, mode is create
});

const emit = defineEmits(["close", "save"]);

const DEFAULT_CATEGORIES = [
  "Jaringan Syaraf Tiruan",
  "Kerja Praktik",
  "Komunikasi Data",
  "Metode Numerik",
  "Metodologi Penelitian",
  "Pemodelan dan Simulasi",
  "Pemrograman Berorientasi Objek",
  "Pemrograman WEB",
  "Sains dan Teknologi Lingkungan",
];

const form = ref({
  title: "",
  category: "Jaringan Syaraf Tiruan",
  customCategory: "",
  priority: "medium", // high, medium, low
  deadline: "",
  notes: "",
});

const isCustomCategory = ref(false);

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      if (props.taskToEdit) {
        const cat = props.taskToEdit.category || "Pribadi / Umum";
        const isPreset = DEFAULT_CATEGORIES.includes(cat);
        form.value = {
          title: props.taskToEdit.title || "",
          category: isPreset ? cat : "custom",
          customCategory: isPreset ? "" : cat,
          priority: props.taskToEdit.priority || "medium",
          deadline: props.taskToEdit.deadline || "",
          notes: props.taskToEdit.notes || "",
        };
        isCustomCategory.value = !isPreset;
      } else {
        // Default new task
        form.value = {
          title: "",
          category: DEFAULT_CATEGORIES[0],
          customCategory: "",
          priority: "medium",
          deadline: "",
          notes: "",
        };
        isCustomCategory.value = false;
      }
    }
  },
);

function onCategoryChange(e) {
  if (e.target.value === "custom") {
    isCustomCategory.value = true;
  } else {
    isCustomCategory.value = false;
  }
}

function handleSubmit() {
  if (!form.value.title.trim()) return;

  const finalCategory =
    isCustomCategory.value && form.value.customCategory.trim()
      ? form.value.customCategory.trim()
      : form.value.category === "custom"
        ? "Lainnya"
        : form.value.category;

  emit("save", {
    title: form.value.title.trim(),
    category: finalCategory,
    priority: form.value.priority,
    deadline: form.value.deadline,
    notes: form.value.notes.trim(),
  });
  emit("close");
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h3 class="modal-title">
          {{ taskToEdit ? "Edit Catatan Tugas" : "Tambah Tugas Baru" }}
        </h3>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <form @submit.prevent="handleSubmit" class="modal-body">
        <div class="form-group">
          <label class="form-label"
            >Judul Tugas <span class="required">*</span></label
          >
          <input
            v-model="form.title"
            type="text"
            required
            placeholder="Contoh: Publish Artikel Jurnal JST"
            class="form-control"
            autofocus
          />
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Mata Kuliah / Kategori</label>
            <select
              v-model="form.category"
              @change="onCategoryChange"
              class="form-control"
            >
              <option v-for="cat in DEFAULT_CATEGORIES" :key="cat" :value="cat">
                {{ cat }}
              </option>
              <option value="custom">+ Kategori Lainnya...</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Prioritas</label>
            <select v-model="form.priority" class="form-control">
              <option value="high">Tinggi (Mendesak)</option>
              <option value="medium">Sedang (Normal)</option>
              <option value="low">Rendah (Santai)</option>
            </select>
          </div>
        </div>

        <div v-if="isCustomCategory" class="form-group">
          <label class="form-label">Nama Kategori Baru</label>
          <input
            v-model="form.customCategory"
            type="text"
            placeholder="Ketik kategori / nama mata kuliah..."
            class="form-control"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Batas Waktu (Deadline)</label>
          <input
            v-model="form.deadline"
            type="datetime-local"
            class="form-control"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Catatan Tambahan / Link</label>
          <textarea
            v-model="form.notes"
            rows="3"
            placeholder="Tulis instruksi dosen, link referensi, atau checklist..."
            class="form-control"
          ></textarea>
        </div>

        <div class="modal-footer">
          <button
            type="button"
            class="btn btn-secondary"
            @click="$emit('close')"
          >
            Batal
          </button>
          <button type="submit" class="btn btn-primary">
            {{ taskToEdit ? "Simpan Perubahan" : "Tambahkan Tugas" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  z-index: 999;
  animation: fadeIn 0.2s ease-out;
}

.modal-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 520px;
  box-shadow: var(--modal-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.25s ease-out;
}

.modal-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 1.75rem;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
}
.close-btn:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (max-width: 520px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.required {
  color: var(--danger);
}

.form-control {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.65rem 0.9rem;
  color: var(--text-primary);
  font-size: 0.95rem;
  outline: none;
  transition: all 0.2s ease;
}

.form-control:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-ring);
  background: var(--bg-surface);
}

textarea.form-control {
  resize: vertical;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.btn {
  padding: 0.65rem 1.25rem;
  border-radius: var(--radius-md);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
}

.btn-secondary {
  background: var(--bg-subtle);
  color: var(--text-secondary);
}
.btn-secondary:hover {
  background: var(--border);
  color: var(--text-primary);
}

.btn-primary {
  background: var(--primary);
  color: #fff;
}
.btn-primary:hover {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    transform: translateY(16px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>
