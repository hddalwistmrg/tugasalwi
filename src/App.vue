<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from "vue";
import TaskForm from "./components/TaskForm.vue";
import TaskList from "./components/TaskList.vue";
import TaskModal from "./components/TaskModal.vue";
import FirebaseModal from "./components/FirebaseModal.vue";
import {
  initFirebase,
  getSavedConfig,
  loginWithGoogle,
  logoutUser,
  onAuthChange,
  subscribeToTasks,
  syncTaskToCloud,
  deleteTaskFromCloud,
} from "./services/firebase.js";

// Theme (Dark / Light)
const isDarkMode = ref(
  localStorage.getItem("taskflow_theme") === "dark" ||
    (!localStorage.getItem("taskflow_theme") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
);

function toggleTheme() {
  isDarkMode.value = !isDarkMode.value;
  localStorage.setItem("taskflow_theme", isDarkMode.value ? "dark" : "light");
  applyTheme();
}

function applyTheme() {
  if (isDarkMode.value) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

// Tasks state
const LOCAL_STORAGE_KEY = "tasks";
const rawSaved = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "[]");
const tasks = ref(rawSaved);

// Filters & Search
const searchQuery = ref("");
const statusFilter = ref("All"); // All, Active, Done
const selectedCategory = ref("All");
const sortBy = ref("deadline"); // deadline, priority, newest

// Modals
const isTaskModalOpen = ref(false);
const taskBeingEdited = ref(null);
const isFirebaseModalOpen = ref(false);

// Firebase & User state
const isCloudConnected = ref(false);
const currentUser = ref(null);
let unsubscribeTasks = null;
let unsubscribeAuth = null;

// Stats calculations
const totalCount = computed(() => tasks.value.length);
const doneCount = computed(() => tasks.value.filter((t) => t.done).length);
const activeCount = computed(() => tasks.value.filter((t) => !t.done).length);

const urgentCount = computed(() => {
  const now = Date.now();
  const twoDaysMs = 48 * 60 * 60 * 1000;
  return tasks.value.filter((t) => {
    if (t.done || !t.deadline) return false;
    const due = new Date(t.deadline).getTime();
    return due - now <= twoDaysMs;
  }).length;
});

const progressPercentage = computed(() => {
  if (totalCount.value === 0) return 0;
  return Math.round((doneCount.value / totalCount.value) * 100);
});

// Unique Categories for Filter
const availableCategories = computed(() => {
  const set = new Set();
  tasks.value.forEach((t) => {
    if (t.category) set.add(t.category);
  });
  return Array.from(set);
});

// Filtered & Sorted Tasks
const filteredTasks = computed(() => {
  return tasks.value
    .filter((task) => {
      // Status
      if (statusFilter.value === "Active" && task.done) return false;
      if (statusFilter.value === "Done" && !task.done) return false;

      // Category
      if (selectedCategory.value !== "All" && task.category !== selectedCategory.value) {
        return false;
      }

      // Search Query
      if (searchQuery.value.trim()) {
        const query = searchQuery.value.toLowerCase();
        const matchTitle = task.title?.toLowerCase().includes(query);
        const matchNotes = task.notes?.toLowerCase().includes(query);
        const matchCat = task.category?.toLowerCase().includes(query);
        if (!matchTitle && !matchNotes && !matchCat) return false;
      }

      return true;
    })
    .sort((a, b) => {
      // Done items always sink to bottom unless filtered by Done
      if (statusFilter.value !== "Done") {
        if (a.done !== b.done) return a.done ? 1 : -1;
      }

      if (sortBy.value === "deadline") {
        if (!a.deadline && !b.deadline) return (b.createdAt || 0) - (a.createdAt || 0);
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline) - new Date(b.deadline);
      }

      if (sortBy.value === "priority") {
        const priorityWeight = { high: 3, medium: 2, low: 1 };
        const weightA = priorityWeight[a.priority] || 2;
        const weightB = priorityWeight[b.priority] || 2;
        if (weightA !== weightB) return weightB - weightA;
      }

      // Default: newest
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
});

// Task Actions
async function handleAddTask(taskData) {
  const newTask = {
    id: crypto.randomUUID(),
    title: taskData.title,
    category: taskData.category || "Pribadi / Umum",
    priority: taskData.priority || "medium",
    deadline: taskData.deadline || "",
    notes: taskData.notes || "",
    done: false,
    createdAt: Date.now(),
  };

  tasks.value.unshift(newTask);

  if (isCloudConnected.value) {
    try {
      await syncTaskToCloud(newTask, currentUser.value?.uid);
    } catch (e) {
      console.warn("Gagal simpan ke cloud, tersimpan di local:", e);
    }
  }
}

function openCreateModal() {
  taskBeingEdited.value = null;
  isTaskModalOpen.value = true;
}

function openEditModal(task) {
  taskBeingEdited.value = { ...task };
  isTaskModalOpen.value = true;
}

async function handleSaveTask(payload) {
  if (taskBeingEdited.value) {
    // Edit existing
    const index = tasks.value.findIndex((t) => t.id === taskBeingEdited.value.id);
    if (index !== -1) {
      const updated = {
        ...tasks.value[index],
        ...payload,
        updatedAt: Date.now(),
      };
      tasks.value[index] = updated;

      if (isCloudConnected.value) {
        try {
          await syncTaskToCloud(updated, currentUser.value?.uid);
        } catch (e) {
          console.warn("Gagal update cloud:", e);
        }
      }
    }
  } else {
    // Add new
    await handleAddTask(payload);
  }
}

async function toggleTask(id) {
  const task = tasks.value.find((item) => item.id === id);
  if (task) {
    task.done = !task.done;
    if (isCloudConnected.value) {
      try {
        await syncTaskToCloud(task, currentUser.value?.uid);
      } catch (e) {
        console.warn("Gagal sync toggle:", e);
      }
    }
  }
}

async function removeTask(id) {
  const index = tasks.value.findIndex((item) => item.id === id);
  if (index !== -1) {
    tasks.value.splice(index, 1);
    if (isCloudConnected.value) {
      try {
        await deleteTaskFromCloud(id);
      } catch (e) {
        console.warn("Gagal hapus dari cloud:", e);
      }
    }
  }
}

// Sync all local tasks to Firebase Firestore
async function syncLocalToCloud() {
  if (!isCloudConnected.value) {
    alert("Harap hubungkan Firebase terlebih dahulu.");
    return;
  }
  let count = 0;
  for (const t of tasks.value) {
    await syncTaskToCloud(t, currentUser.value?.uid);
    count++;
  }
  alert(`Berhasil mengunggah ${count} catatan tugas ke Cloud Firestore!`);
}

// Watch tasks and save to localStorage
watch(
  tasks,
  (val) => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(val));
  },
  { deep: true }
);

// Firebase Initialization & Sync
async function setupFirebase() {
  if (unsubscribeTasks) unsubscribeTasks();
  if (unsubscribeAuth) unsubscribeAuth();

  const res = await initFirebase();
  if (res.initialized) {
    isCloudConnected.value = true;

    // Listen to Auth State
    unsubscribeAuth = onAuthChange((user) => {
      currentUser.value = user;
      attachTaskSubscription();
    });
  } else {
    isCloudConnected.value = false;
  }
}

function attachTaskSubscription() {
  if (unsubscribeTasks) unsubscribeTasks();

  const userId = currentUser.value ? currentUser.value.uid : null;
  unsubscribeTasks = subscribeToTasks(
    userId,
    (cloudTasks) => {
      if (cloudTasks && cloudTasks.length > 0) {
        tasks.value = cloudTasks;
      }
    },
    (err) => {
      console.warn("Realtime sync issue, keeping local cache:", err);
    }
  );
}

// Auth Handlers
async function handleLogin() {
  if (!isCloudConnected.value) {
    isFirebaseModalOpen.value = true;
    return;
  }
  try {
    const user = await loginWithGoogle();
    currentUser.value = user;
  } catch (e) {
    alert("Login gagal atau dibatalkan: " + e.message);
  }
}

async function handleLogout() {
  await logoutUser();
  currentUser.value = null;
}

onMounted(() => {
  applyTheme();
  setupFirebase();
});

onUnmounted(() => {
  if (unsubscribeTasks) unsubscribeTasks();
  if (unsubscribeAuth) unsubscribeAuth();
});
</script>

<template>
  <div class="app-layout">
    <!-- Navbar Header -->
    <header class="navbar">
      <div class="nav-container">
        <!-- Brand Logo -->
        <div class="brand">
          <div class="brand-icon">✨</div>
          <div class="brand-text">
            <span class="brand-name">TaskFlow</span>
            <span class="brand-tag">Catatan Tugas Pribadi</span>
          </div>
        </div>

        <!-- Right Controls -->
        <div class="nav-actions">
          <!-- Cloud Sync Badge / Button -->
          <button
            class="status-pill"
            :class="{ 'is-cloud': isCloudConnected }"
            @click="isFirebaseModalOpen = true"
            :title="isCloudConnected ? 'Terkoneksi ke Cloud Firestore' : 'Klik untuk hubungkan database online'"
          >
            <span class="pulse-dot"></span>
            <span class="status-label">
              {{ isCloudConnected ? "Cloud Sync" : "Local Storage" }}
            </span>
          </button>

          <!-- Dark / Light Theme Toggle -->
          <button
            class="icon-button"
            @click="toggleTheme"
            :title="isDarkMode ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'"
          >
            <span v-if="isDarkMode">☀️</span>
            <span v-else>🌙</span>
          </button>

          <!-- Google Auth User / Login Button -->
          <div v-if="currentUser" class="user-menu">
            <img
              v-if="currentUser.photoURL"
              :src="currentUser.photoURL"
              :alt="currentUser.displayName || 'User'"
              class="user-avatar"
            />
            <span class="user-name">{{ currentUser.displayName?.split(" ")[0] || "Saya" }}</span>
            <button class="btn-logout" @click="handleLogout" title="Keluar akun">
              🚪
            </button>
          </div>
          <button
            v-else
            class="btn-login-google"
            @click="handleLogin"
            title="Masuk dengan Google agar catatan tersinkron ke semua perangkat"
          >
            <svg class="google-icon" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span class="btn-login-text">Masuk</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Container -->
    <main class="main-content">
      <!-- Greeting & Header Banner -->
      <section class="hero-section">
        <div class="hero-text">
          <h1 class="hero-title">
            {{ currentUser ? `Halo, ${currentUser.displayName?.split(" ")[0]}! 👋` : "Halo, Alwi! 👋" }}
          </h1>
          <p class="hero-subtitle">
            Kelola tugas kuliah, catatan penting, dan deadline dengan rapi & produktif.
          </p>
        </div>

        <button class="btn-create-large" @click="openCreateModal">
          <span class="btn-icon">+</span>
          <span>Buat Tugas Baru</span>
        </button>
      </section>

      <!-- Stats Cards -->
      <section class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon-wrapper stat-indigo">📝</div>
          <div class="stat-details">
            <span class="stat-number">{{ totalCount }}</span>
            <span class="stat-name">Total Tugas</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon-wrapper stat-teal">⚡</div>
          <div class="stat-details">
            <span class="stat-number">{{ activeCount }}</span>
            <span class="stat-name">Dalam Pengerjaan</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon-wrapper stat-green">✅</div>
          <div class="stat-details">
            <div class="stat-number-row">
              <span class="stat-number">{{ doneCount }}</span>
              <span class="stat-percent">{{ progressPercentage }}%</span>
            </div>
            <span class="stat-name">Selesai</span>
          </div>
          <!-- Progress bar -->
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: progressPercentage + '%' }"></div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon-wrapper stat-red">🚨</div>
          <div class="stat-details">
            <span class="stat-number">{{ urgentCount }}</span>
            <span class="stat-name">Mendekati Deadline</span>
          </div>
        </div>
      </section>

      <!-- Quick Add Form -->
      <TaskForm @add-task="handleAddTask" @open-modal="openCreateModal" />

      <!-- Filters, Search & View Controls -->
      <section class="controls-bar">
        <!-- Search Input -->
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Cari tugas, catatan, atau mata kuliah..."
            class="search-input"
          />
          <button v-if="searchQuery" class="clear-search" @click="searchQuery = ''">
            &times;
          </button>
        </div>

        <!-- Filter Pills & Selects -->
        <div class="filter-group">
          <!-- Status Switcher -->
          <div class="status-tabs">
            <button
              :class="['tab-btn', { active: statusFilter === 'All' }]"
              @click="statusFilter = 'All'"
            >
              Semua
            </button>
            <button
              :class="['tab-btn', { active: statusFilter === 'Active' }]"
              @click="statusFilter = 'Active'"
            >
              Aktif ({{ activeCount }})
            </button>
            <button
              :class="['tab-btn', { active: statusFilter === 'Done' }]"
              @click="statusFilter = 'Done'"
            >
              Selesai ({{ doneCount }})
            </button>
          </div>

          <!-- Category Dropdown -->
          <select v-model="selectedCategory" class="select-filter">
            <option value="All">Semua Kategori</option>
            <option v-for="cat in availableCategories" :key="cat" :value="cat">
              {{ cat }}
            </option>
          </select>

          <!-- Sort Dropdown -->
          <select v-model="sortBy" class="select-filter">
            <option value="deadline">⏰ Deadline Terdekat</option>
            <option value="priority">🔥 Prioritas Tertinggi</option>
            <option value="newest">🆕 Terbaru Ditambahkan</option>
          </select>
        </div>
      </section>

      <!-- Task List Component -->
      <TaskList
        :tasks="filteredTasks"
        @toggle-task="toggleTask"
        @remove-task="removeTask"
        @edit-task="openEditModal"
      />
    </main>

    <!-- Modals -->
    <TaskModal
      :is-open="isTaskModalOpen"
      :task-to-edit="taskBeingEdited"
      @close="isTaskModalOpen = false"
      @save="handleSaveTask"
    />

    <FirebaseModal
      :is-open="isFirebaseModalOpen"
      :is-connected="isCloudConnected"
      @close="isFirebaseModalOpen = false"
      @reconnect="setupFirebase"
      @sync-local="syncLocalToCloud"
    />
  </div>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Navbar */
.navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.nav-container {
  max-width: 980px;
  margin: 0 auto;
  padding: 0.85rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.brand-icon {
  font-size: 1.5rem;
  background: var(--primary-light);
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-name {
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, var(--primary) 0%, #a855f7 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-tag {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 500;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Status Pill */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0.4rem 0.8rem;
  border-radius: 9999px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  transition: all 0.2s ease;
}

.status-pill:hover {
  border-color: var(--border-focus);
}

.status-pill.is-cloud {
  background: var(--success-bg);
  color: var(--success);
  border-color: rgba(16, 185, 129, 0.3);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning);
}

.status-pill.is-cloud .pulse-dot {
  background: var(--success);
}

/* Icon button */
.icon-button {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-button:hover {
  background: var(--primary-light);
  border-color: var(--border-focus);
}

/* Google Login / User */
.btn-login-google {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.4rem 0.75rem;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--text-primary);
  transition: all 0.2s ease;
}

.btn-login-google:hover {
  background: var(--bg-subtle);
  border-color: var(--border-focus);
}

.google-icon {
  width: 16px;
  height: 16px;
}

.user-menu {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  background: var(--bg-subtle);
  padding: 3px 6px 3px 3px;
  border-radius: 9999px;
  border: 1px solid var(--border);
}

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}

.user-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-primary);
  padding-right: 4px;
}

.btn-logout {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0 4px;
}

/* Main Content */
.main-content {
  max-width: 980px;
  width: 100%;
  margin: 0 auto;
  padding: 2rem 1.25rem 4rem;
  flex: 1;
}

/* Hero Section */
.hero-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2rem;
  gap: 1rem;
  flex-wrap: wrap;
}

.hero-title {
  font-size: 1.85rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--text-primary);
  margin-bottom: 0.35rem;
}

.hero-subtitle {
  font-size: 0.95rem;
  color: var(--text-muted);
}

.btn-create-large {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  padding: 0.75rem 1.4rem;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 14px var(--primary-ring);
  transition: all 0.25s ease;
}

.btn-create-large:hover {
  background: var(--primary-hover);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px var(--primary-ring);
}

.btn-icon {
  font-size: 1.25rem;
  line-height: 1;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.stat-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.15rem;
  box-shadow: var(--card-shadow);
  display: flex;
  align-items: center;
  gap: 1rem;
  position: relative;
  overflow: hidden;
  transition: all 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-focus);
}

.stat-icon-wrapper {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.35rem;
  flex-shrink: 0;
}

.stat-indigo { background: #e0e7ff; }
.stat-teal { background: #ccfbf1; }
.stat-green { background: #d1fae5; }
.stat-red { background: #fee2e2; }

[data-theme="dark"] .stat-indigo { background: rgba(99, 102, 241, 0.2); }
[data-theme="dark"] .stat-teal { background: rgba(20, 184, 166, 0.2); }
[data-theme="dark"] .stat-green { background: rgba(16, 185, 129, 0.2); }
[data-theme="dark"] .stat-red { background: rgba(239, 68, 68, 0.2); }

.stat-details {
  display: flex;
  flex-direction: column;
}

.stat-number-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stat-number {
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1.1;
  color: var(--text-primary);
}

.stat-percent {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--success);
}

.stat-name {
  font-size: 0.78rem;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 3px;
}

.progress-track {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--bg-subtle);
}

.progress-fill {
  height: 100%;
  background: var(--success);
  transition: width 0.4s ease;
}

/* Controls Bar */
.controls-bar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.search-box {
  display: flex;
  align-items: center;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.65rem 1rem;
  gap: 0.65rem;
  box-shadow: var(--card-shadow);
  transition: all 0.2s ease;
}

.search-box:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-ring);
}

.search-icon {
  font-size: 1rem;
  color: var(--text-muted);
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 0.92rem;
  color: var(--text-primary);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.clear-search {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  cursor: pointer;
  line-height: 1;
}

.filter-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.status-tabs {
  display: flex;
  background: var(--bg-subtle);
  padding: 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}

.tab-btn {
  background: transparent;
  border: none;
  padding: 0.45rem 0.9rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--bg-surface);
  color: var(--primary);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

.select-filter {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.5rem 0.85rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  outline: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.select-filter:focus {
  border-color: var(--border-focus);
}

@media (max-width: 640px) {
  .btn-login-text {
    display: none;
  }
  .filter-group {
    flex-direction: column;
    align-items: stretch;
  }
  .status-tabs {
    width: 100%;
    justify-content: space-between;
  }
  .tab-btn {
    flex: 1;
    text-align: center;
  }
}
</style>
