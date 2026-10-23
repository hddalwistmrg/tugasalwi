<script setup>
import { ref, watch } from "vue";
import { getSavedConfig, saveConfig } from "../services/firebase.js";

const props = defineProps({
  isOpen: Boolean,
  isConnected: Boolean,
});

const emit = defineEmits(["close", "reconnect", "sync-local"]);

const config = ref({
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
});

const jsonInput = ref("");
const statusMessage = ref("");

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      statusMessage.value = "";
      const saved = getSavedConfig();
      if (saved) {
        config.value = {
          apiKey: saved.apiKey || "",
          authDomain: saved.authDomain || "",
          projectId: saved.projectId || "",
          storageBucket: saved.storageBucket || "",
          messagingSenderId: saved.messagingSenderId || "",
          appId: saved.appId || "",
        };
      }
    }
  }
);

function handleJsonParse() {
  if (!jsonInput.value.trim()) return;
  try {
    let clean = jsonInput.value;
    // Replace JS object keys/declaration if user pasted `const firebaseConfig = { ... }`
    if (clean.includes("{") && clean.includes("}")) {
      clean = clean.substring(clean.indexOf("{"), clean.lastIndexOf("}") + 1);
      // Replace keys without quotes
      clean = clean.replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":');
      // Fix trailing commas
      clean = clean.replace(/,\s*}/g, "}");
    }
    const parsed = JSON.parse(clean);
    config.value = {
      apiKey: parsed.apiKey || "",
      authDomain: parsed.authDomain || "",
      projectId: parsed.projectId || "",
      storageBucket: parsed.storageBucket || "",
      messagingSenderId: parsed.messagingSenderId || "",
      appId: parsed.appId || "",
    };
    statusMessage.value = "Konfigurasi berhasil diekstrak! Klik Simpan di bawah.";
  } catch (e) {
    statusMessage.value = "Format tidak valid. Silakan isi form di bawah secara manual.";
  }
}

function handleSave() {
  if (!config.value.apiKey || !config.value.projectId) {
    alert("Harap isi minimal API Key dan Project ID.");
    return;
  }
  saveConfig(config.value);
  emit("reconnect");
  emit("close");
}

function handleClear() {
  if (confirm("Hapus konfigurasi Firebase?")) {
    saveConfig(null);
    config.value = {
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: "",
    };
    emit("reconnect");
    emit("close");
  }
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <h3 class="modal-title">Pengaturan Cloud Database (Firebase)</h3>
          <p class="modal-subtitle">
            Status:
            <span :class="['badge', isConnected ? 'badge-success' : 'badge-warning']">
              {{ isConnected ? "Terkoneksi ke Cloud" : "Belum Terhubung" }}
            </span>
          </p>
        </div>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <div class="info-box">
          <div class="info-title">Panduan Konfigurasi Firebase:</div>
          <ol class="info-steps">
            <li>Buka <b>console.firebase.google.com</b> (gratis dengan akun Google).</li>
            <li>Klik <b>Add Project</b>, lalu aktifkan <b>Firestore Database</b> & <b>Authentication (Google Provider)</b>.</li>
            <li>Di Project Settings -> Web App, salin nilai <b>firebaseConfig</b> dan tempel di bawah.</li>
          </ol>
        </div>

        <div class="paste-section">
          <label class="form-label">Tempel Cepat Cuplikan Kode Firebase:</label>
          <div class="paste-row">
            <input
              v-model="jsonInput"
              type="text"
              placeholder='Tempel { apiKey: "...", projectId: "..." } di sini...'
              class="form-control"
            />
            <button type="button" @click="handleJsonParse" class="btn btn-secondary">
              Ekstrak
            </button>
          </div>
          <p v-if="statusMessage" class="status-msg">{{ statusMessage }}</p>
        </div>

        <div class="divider"><span>Atau isi manual:</span></div>

        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">API Key</label>
            <input v-model="config.apiKey" type="text" class="form-control" placeholder="AIzaSy..." />
          </div>
          <div class="form-group">
            <label class="form-label">Project ID</label>
            <input v-model="config.projectId" type="text" class="form-control" placeholder="my-taskflow-app" />
          </div>
          <div class="form-group">
            <label class="form-label">Auth Domain</label>
            <input v-model="config.authDomain" type="text" class="form-control" placeholder="my-app.firebaseapp.com" />
          </div>
          <div class="form-group">
            <label class="form-label">App ID</label>
            <input v-model="config.appId" type="text" class="form-control" placeholder="1:12345:web:..." />
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button v-if="isConnected" type="button" @click="handleClear" class="btn btn-danger-ghost">
          Putuskan Koneksi
        </button>
        <button type="button" class="btn btn-secondary" @click="$emit('close')">
          Tutup
        </button>
        <button type="button" class="btn btn-primary" @click="handleSave">
          Simpan & Hubungkan
        </button>
      </div>
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
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.modal-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 580px;
  box-shadow: var(--modal-shadow);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.25s ease-out;
}

.modal-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.modal-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
}

.modal-subtitle {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 4px;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge-success {
  background: var(--success-bg);
  color: var(--success);
}
.badge-warning {
  background: var(--warning-bg);
  color: var(--warning);
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 1.75rem;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
}
.close-btn:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.25rem 1.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.info-box {
  background: var(--primary-light);
  border: 1px solid var(--border-focus);
  border-radius: var(--radius-md);
  padding: 0.85rem 1rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.info-title {
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 6px;
}

.info-steps {
  margin-left: 1.2rem;
  line-height: 1.5;
}

.paste-row {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.status-msg {
  font-size: 0.8rem;
  color: var(--success);
  margin-top: 4px;
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.8rem;
  margin: 0.25rem 0;
}
.divider::before,
.divider::after {
  content: "";
  flex: 1;
  border-bottom: 1px solid var(--border);
}
.divider span {
  padding: 0 10px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}

@media (max-width: 520px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.form-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.form-control {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.55rem 0.8rem;
  color: var(--text-primary);
  font-size: 0.85rem;
  outline: none;
  transition: all 0.2s ease;
}

.form-control:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-ring);
}

.sync-banner {
  background: var(--bg-subtle);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  padding: 0.85rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.85rem;
}

.sync-banner b {
  color: var(--text-primary);
}

.sync-banner p {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 2px;
}

.modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn {
  padding: 0.6rem 1.1rem;
  border-radius: var(--radius-md);
  font-size: 0.85rem;
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
}

.btn-primary-light {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}
.btn-primary-light:hover {
  filter: brightness(0.95);
}

.btn-danger-ghost {
  background: transparent;
  color: var(--danger);
  margin-right: auto;
}
.btn-danger-ghost:hover {
  text-decoration: underline;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slideUp {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>
