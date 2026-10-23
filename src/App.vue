<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import TaskForm from "./components/TaskForm.vue";
import TaskList from "./components/TaskList.vue";
import TaskModal from "./components/TaskModal.vue";
import FirebaseModal from "./components/FirebaseModal.vue";
import {
  initFirebase,
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

// Tasks state (strictly online when logged in)
const tasks = ref([]);
const isAuthLoading = ref(true);

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
  if (!currentUser.value) return;

  const newTask = {
    id: crypto.randomUUID(),
    title: taskData.title,
    category: taskData.category || "Pribadi / Umum",
    priority: taskData.priority || "medium",
    deadline: taskData.deadline || "",
    notes: taskData.notes || "",
    done: false,
    userId: currentUser.value.uid,
    createdAt: Date.now(),
  };

  tasks.value.unshift(newTask);

  if (isCloudConnected.value) {
    try {
      await syncTaskToCloud(newTask, currentUser.value.uid);
    } catch (e) {
      console.error("Gagal simpan ke Firebase:", e);
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
  if (!currentUser.value) return;

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
          await syncTaskToCloud(updated, currentUser.value.uid);
        } catch (e) {
          console.error("Gagal update cloud:", e);
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
    if (isCloudConnected.value && currentUser.value) {
      try {
        await syncTaskToCloud(task, currentUser.value.uid);
      } catch (e) {
        console.error("Gagal sync toggle:", e);
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
        console.error("Gagal hapus dari cloud:", e);
      }
    }
  }
}

// Firebase Initialization & Sync
async function setupFirebase() {
  isAuthLoading.value = true;
  if (unsubscribeTasks) unsubscribeTasks();
  if (unsubscribeAuth) unsubscribeAuth();

  const res = await initFirebase();
  if (res.initialized) {
    isCloudConnected.value = true;

    // Listen to Auth State
    unsubscribeAuth = onAuthChange((user) => {
      currentUser.value = user;
      isAuthLoading.value = false;
      if (user) {
        attachTaskSubscription();
      } else {
        tasks.value = [];
        if (unsubscribeTasks) unsubscribeTasks();
      }
    });
  } else {
    isCloudConnected.value = false;
    currentUser.value = null;
    isAuthLoading.value = false;
  }
}

function attachTaskSubscription() {
  if (unsubscribeTasks) unsubscribeTasks();
  if (!currentUser.value) return;

  const userId = currentUser.value.uid;
  unsubscribeTasks = subscribeToTasks(
    userId,
    (cloudTasks) => {
      tasks.value = cloudTasks || [];
    },
    (err) => {
      console.warn("Realtime sync issue:", err);
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
  tasks.value = [];
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
          <!-- Firebase Settings (Subtle Gear) -->
          <button
            class="icon-button"
            @click="isFirebaseModalOpen = true"
            title="Pengaturan Database Firebase"
          >
            ⚙️
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

          <!-- User Menu if Logged In -->
          <div v-if="currentUser" class="user-menu">
            <img
              v-if="currentUser.photoURL"
              :src="currentUser.photoURL"
              :alt="currentUser.displayName || 'User'"
              class="user-avatar"
            />
            <span class="user-name">{{ currentUser.displayName?.split(" ")[0] || "Saya" }}</span>
            <button class="btn-logout" @click="handleLogout" title="Keluar akun">
              Keluar 🚪
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Container -->
    <main class="main-content">
      <!-- 1. TAMPILAN JIKA BELUM LOGIN (LOGIN GATE) -->
      <section v-if="!currentUser" class="login-gate">
        <div class="login-card">
          <div class="login-badge">🔒 Akses Pribadi</div>
          <h2 class="login-title">Catatan Tugas Pribadi Anda</h2>
          <p class="login-description">
            Silakan masuk dengan akun Google Anda untuk mengakses, mencatat, mengatur prioritas tugas, dan menyinkronkan data secara otomatis ke cloud database.
          </p>

          <div class="feature-pills">
            <div class="pill-item">
              <span class="pill-icon">☁️</span>
              <span>Cloud Realtime (Firebase)</span>
            </div>
            <div class="pill-item">
              <span class="pill-icon">⏰</span>
              <span>Pengingat Deadline Warna</span>
            </div>
            <div class="pill-item">
              <span class="pill-icon">🛡️</span>
              <span>100% Privat & Aman</span>
            </div>
          </div>

          <!-- Big Login Button -->
          <button class="btn-login-big" @click="handleLogin">
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
            <span>Masuk dengan Google</span>
          </button>

          <p class="login-footer-hint">
            Belum menghubungkan database?
            <button class="btn-text-link" @click="isFirebaseModalOpen = true">
              Atur Koneksi Firebase
            </button>
          </p>
        </div>
      </section>

      <!-- 2. TAMPILAN JIKA SUDAH LOGIN (DASHBOARD LENGKAP) -->
      <section v-else class="dashboard">
        <!-- Greeting & Header Banner -->
        <section class="hero-section">
          <div class="hero-text">
            <h1 class="hero-title">
              Halo, {{ currentUser.displayName?.split(" ")[0] || "Alwi" }}! 👋
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
      </section>
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
      @sync-local="() => {}"
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

/* Icon button */
.icon-button {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-button:hover {
  background: var(--primary-light);
  border-color: var(--border-focus);
}

/* User Menu */
.user-menu {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--bg-subtle);
  padding: 4px 8px 4px 4px;
  border-radius: 9999px;
  border: 1px solid var(--border);
}

.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
}

.user-name {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-primary);
}

.btn-logout {
  background: var(--danger-bg);
  color: var(--danger);
  border: none;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 9999px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-logout:hover {
  filter: brightness(0.9);
}

/* Main Content */
.main-content {
  max-width: 980px;
  width: 100%;
  margin: 0 auto;
  padding: 2.5rem 1.25rem 4rem;
  flex: 1;
}

/* 1. Login Gate */
.login-gate {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem 0;
  min-height: 60vh;
}

.login-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 2.75rem 2rem;
  max-width: 480px;
  width: 100%;
  text-align: center;
  box-shadow: var(--card-shadow);
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: slideUp 0.3s ease-out;
}

.login-badge {
  background: var(--primary-light);
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 9999px;
  margin-bottom: 1rem;
}

.login-title {
  font-size: 1.65rem;
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 0.65rem;
  letter-spacing: -0.02em;
}

.login-description {
  font-size: 0.92rem;
  color: var(--text-muted);
  line-height: 1.6;
  margin-bottom: 1.75rem;
}

.feature-pills {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  width: 100%;
  margin-bottom: 2rem;
}

.pill-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  padding: 0.65rem 1rem;
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-align: left;
}

.pill-icon {
  font-size: 1.15rem;
}

.btn-login-big {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  background: #ffffff;
  color: #1f2937;
  border: 1px solid #d1d5db;
  border-radius: var(--radius-md);
  padding: 0.85rem 1.25rem;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.2s ease;
}

.btn-login-big:hover {
  background: #f9fafb;
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}

.google-icon {
  width: 20px;
  height: 20px;
}

.login-footer-hint {
  font-size: 0.82rem;
  color: var(--text-muted);
  margin-top: 1.5rem;
}

.btn-text-link {
  background: transparent;
  border: none;
  color: var(--primary);
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
  padding: 0 2px;
}

/* 2. Dashboard */
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
}

.select-filter:focus {
  border-color: var(--border-focus);
}

@keyframes slideUp {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (max-width: 640px) {
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
