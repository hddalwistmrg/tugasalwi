<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import TaskList from "./components/TaskList.vue";
import TaskModal from "./components/TaskModal.vue";
import LucideIcon from "./components/LucideIcon.vue";
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
      window.matchMedia("(prefers-color-scheme: dark)").matches),
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

// Firebase & User state
const isCloudConnected = ref(true);
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
      if (
        selectedCategory.value !== "All" &&
        task.category !== selectedCategory.value
      ) {
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
        if (!a.deadline && !b.deadline)
          return (b.createdAt || 0) - (a.createdAt || 0);
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
    const index = tasks.value.findIndex(
      (t) => t.id === taskBeingEdited.value.id,
    );
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
    },
  );
}

// Auth Handlers
async function handleLogin() {
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
    <!-- Main Container (Navbar has been removed) -->
    <main class="main-content">
      <!-- 1. TAMPILAN JIKA BELUM LOGIN (CLEAN CENTERED LANDING) -->
      <section v-if="!currentUser" class="login-landing">
        <!-- Landing Top Bar: Logo TaskFlow di atas paling kiri, Switcher Tema di kanan -->
        <header class="landing-topbar">
          <div class="brand">
            <div class="brand-icon">
              <LucideIcon name="check" size="18" stroke-width="3" />
            </div>
            <span class="brand-name">TaskFlow</span>
          </div>

          <button
            class="icon-button"
            @click="toggleTheme"
            :title="isDarkMode ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'"
          >
            <LucideIcon v-if="isDarkMode" name="sun" size="18" />
            <LucideIcon v-else name="moon" size="18" />
          </button>
        </header>

        <div class="landing-hero-center">
          <!-- Minimalist Badge -->
          <div class="hero-tag-badge">
            <span class="badge-status-dot"></span>
            <span>Manajemen Tugas Personal</span>
          </div>

          <!-- Main Heading -->
          <h1 class="hero-main-title">
            Fokus pada hal penting.<br />Selesaikan tugas tepat waktu.
          </h1>

          <!-- Subtitle -->
          <p class="hero-main-desc">
            Ruang kerja minimalis untuk mencatat tugas, mengatur prioritas, dan memantau tenggat waktu tanpa distraksi.
          </p>

          <!-- Clean Primary CTA -->
          <div class="hero-cta-group">
            <button class="btn-cta-primary" @click="handleLogin">
              <svg class="google-icon-btn" viewBox="0 0 24 24">
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
              <LucideIcon name="arrow-right" size="18" />
            </button>
          </div>
        </div>
      </section>

      <!-- 2. TAMPILAN JIKA SUDAH LOGIN (DASHBOARD LENGKAP) -->
      <section v-else class="dashboard">
        <!-- Top Executive Bar with Brand, Theme, User Profile & Actions -->
        <section class="dashboard-topbar">
          <div class="brand">
            <div class="brand-icon">
              <LucideIcon name="check" size="18" stroke-width="3" />
            </div>
            <span class="brand-name">TaskFlow</span>
          </div>

          <div class="dashboard-actions">
            <!-- Theme Toggle -->
            <button
              class="icon-button"
              @click="toggleTheme"
              :title="isDarkMode ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'"
            >
              <LucideIcon v-if="isDarkMode" name="sun" size="17" />
              <LucideIcon v-else name="moon" size="17" />
            </button>

            <!-- User Badge -->
            <div class="user-pill">
              <img
                v-if="currentUser.photoURL"
                :src="currentUser.photoURL"
                :alt="currentUser.displayName || 'User'"
                class="user-avatar"
              />
              <div v-else class="user-avatar-placeholder">
                <LucideIcon name="user" size="15" />
              </div>
              <span class="user-name">{{
                currentUser.displayName?.split(" ")[0] || "Saya"
              }}</span>
            </div>

            <!-- Logout Button -->
            <button
              class="btn-logout"
              @click="handleLogout"
              title="Keluar akun"
            >
              <LucideIcon name="log-out" size="14" />
              <span>Keluar</span>
            </button>

            <!-- Primary Create Button -->
            <button class="btn-create-task" @click="openCreateModal">
              <LucideIcon name="plus" size="18" />
              <span>Tambah Tugas</span>
            </button>
          </div>
        </section>

        <!-- Greeting & Subtitle Summary -->
        <section class="dashboard-intro">
          <h1 class="header-title">
            Halo, {{ currentUser.displayName?.split(" ")[0] || "Saya" }}
          </h1>
          <p class="header-subtitle">
            {{ activeCount > 0 ? `${activeCount} tugas aktif menunggu diselesaikan.` : 'Semua tugas telah selesai, kerja bagus!' }}
          </p>
        </section>

        <!-- Executive Minimalist Metric Ribbon -->
        <section class="stats-ribbon">
          <div class="ribbon-col">
            <span class="ribbon-label">Total Tugas</span>
            <span class="ribbon-value">{{ totalCount }}</span>
          </div>

          <div class="ribbon-divider"></div>

          <div class="ribbon-col">
            <div class="label-with-dot">
              <span class="active-pulse-dot"></span>
              <span class="ribbon-label">Dalam Pengerjaan</span>
            </div>
            <span class="ribbon-value text-teal">{{ activeCount }}</span>
          </div>

          <div class="ribbon-divider"></div>

          <div class="ribbon-col">
            <div class="label-with-percent">
              <span class="ribbon-label">Selesai</span>
              <span class="ribbon-percent">{{ progressPercentage }}%</span>
            </div>
            <div class="ribbon-progress-bar">
              <div
                class="ribbon-progress-fill"
                :style="{ width: progressPercentage + '%' }"
              ></div>
            </div>
          </div>

          <div class="ribbon-divider"></div>

          <div class="ribbon-col">
            <span class="ribbon-label">Mendekati Deadline</span>
            <span :class="['ribbon-value', urgentCount > 0 ? 'text-danger' : 'text-muted']">
              {{ urgentCount }}
            </span>
          </div>
        </section>

        <!-- Filters, Search & View Controls (Integrated Toolbar) -->
        <section class="toolbar-section">
          <!-- Search Input -->
          <div class="search-box">
            <LucideIcon name="search" size="17" class="search-icon" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Cari tugas atau catatan..."
              class="search-input"
            />
            <button
              v-if="searchQuery"
              class="clear-search"
              @click="searchQuery = ''"
              title="Hapus pencarian"
            >
              <LucideIcon name="x" size="15" />
            </button>
          </div>

          <!-- Filter Controls -->
          <div class="toolbar-filters">
            <!-- Segmented Status Tabs -->
            <div class="segmented-tabs">
              <button
                :class="['seg-btn', { active: statusFilter === 'All' }]"
                @click="statusFilter = 'All'"
              >
                Semua
              </button>
              <button
                :class="['seg-btn', { active: statusFilter === 'Active' }]"
                @click="statusFilter = 'Active'"
              >
                Aktif ({{ activeCount }})
              </button>
              <button
                :class="['seg-btn', { active: statusFilter === 'Done' }]"
                @click="statusFilter = 'Done'"
              >
                Selesai ({{ doneCount }})
              </button>
            </div>

            <!-- Category & Sort Dropdowns -->
            <div class="filter-selects">
              <select v-model="selectedCategory" class="select-pill">
                <option value="All">Semua Kategori</option>
                <option
                  v-for="cat in availableCategories"
                  :key="cat"
                  :value="cat"
                >
                  {{ cat }}
                </option>
              </select>

              <select v-model="sortBy" class="select-pill">
                <option value="deadline">Deadline Terdekat</option>
                <option value="priority">Prioritas Tertinggi</option>
                <option value="newest">Terbaru Ditambahkan</option>
              </select>
            </div>
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

    <!-- Footer (Hanya ditampilkan pada halaman login/landing, tidak di dashboard) -->
    <footer v-if="!currentUser" class="app-footer">
      <div class="footer-container">
        <div class="footer-content">
          <div class="footer-left">
            <div class="footer-brand">
              <div class="brand-icon-mini">
                <LucideIcon name="check" size="14" stroke-width="3" />
              </div>
              <span class="footer-brand-title">TaskFlow</span>
            </div>
            <p class="footer-description">
              Sistem manajemen tugas harian yang minimalis dan teratur untuk meningkatkan fokus, ketenangan kerja, dan produktivitas Anda.
            </p>
          </div>

          <div class="footer-right">
            <span class="footer-connect-label">Terhubung dengan kreator</span>
            <a
              href="https://instagram.com/hddalwistmrg"
              target="_blank"
              rel="noopener noreferrer"
              class="instagram-btn"
              title="Instagram @hddalwistmrg"
            >
              <LucideIcon name="instagram" size="18" />
              <span>@hddalwistmrg</span>
            </a>
          </div>
        </div>

        <div class="footer-bottom-bar">
          <p class="footer-copyright">
            &copy; {{ new Date().getFullYear() }} TaskFlow. Dibuat oleh <strong>Haddad Alwi Situmorang</strong>. All rights reserved.
          </p>
          <span class="footer-tagline">Fokus, tenang, dan selesaikan tepat waktu.</span>
        </div>
      </div>
    </footer>

    <!-- Modals -->
    <TaskModal
      :is-open="isTaskModalOpen"
      :task-to-edit="taskBeingEdited"
      @close="isTaskModalOpen = false"
      @save="handleSaveTask"
    />
  </div>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-page);
  background-image:
    radial-gradient(circle at 18% 18%, rgba(16, 185, 129, 0.12) 0%, transparent 45%),
    radial-gradient(circle at 82% 28%, rgba(6, 182, 212, 0.12) 0%, transparent 45%),
    radial-gradient(circle at 50% 85%, rgba(99, 102, 241, 0.08) 0%, transparent 55%);
  background-attachment: fixed;
}

/* Brand Component */
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
}

.brand-icon {
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  color: #ffffff;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.brand-name {
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.google-icon-btn {
  width: 19px;
  height: 19px;
  flex-shrink: 0;
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
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-button:hover {
  background: var(--primary-light);
  border-color: var(--border-focus);
}

/* User Pill & Info */
.user-pill {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--bg-surface);
  padding: 3px 10px 3px 4px;
  border-radius: 9999px;
  border: 1px solid var(--border);
}

.user-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
}

.user-avatar-placeholder {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--primary-light);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
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
  font-size: 0.72rem;
  font-weight: 700;
  padding: 6px 10px;
  border-radius: 9999px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s ease;
}

.btn-logout:hover {
  filter: brightness(0.9);
}

/* Main Content */
.main-content {
  max-width: 1140px;
  width: 100%;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
  flex: 1;
}

/* 1. Login Landing Clean Centered */
.login-landing {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  padding-bottom: 3.5rem;
}

.landing-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-bottom: 4rem;
}

.landing-hero-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 680px;
  margin: 0 auto;
  animation: slideUp 0.35s ease-out;
}

.hero-tag-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.28);
  color: #10b981;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 5px 14px;
  border-radius: 9999px;
  margin-bottom: 1.5rem;
  letter-spacing: 0.02em;
}

[data-theme="dark"] .hero-tag-badge {
  color: #34d399;
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.35);
}

.badge-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.hero-main-title {
  font-size: 3.4rem;
  font-weight: 850;
  letter-spacing: -0.04em;
  line-height: 1.15;
  color: var(--text-primary);
  margin-bottom: 1.25rem;
}

@media (max-width: 640px) {
  .hero-main-title {
    font-size: 2.35rem;
  }
}

.hero-main-desc {
  font-size: 1.1rem;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 2.25rem;
  max-width: 540px;
}

.hero-cta-group {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 2. Dashboard Top Bar & Intro */
.dashboard-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 1.25rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
  gap: 1rem;
}

.dashboard-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.dashboard-intro {
  margin-bottom: 1.75rem;
}

.btn-cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  color: #ffffff;
  border: none;
  font-size: 0.98rem;
  font-weight: 750;
  padding: 0.95rem 1.95rem;
  border-radius: 9999px;
  cursor: pointer;
  box-shadow: 0 8px 24px -4px rgba(16, 185, 129, 0.45);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-cta-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px -4px rgba(16, 185, 129, 0.6);
  filter: brightness(1.05);
}

/* 2. Dashboard */
.dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.75rem;
  gap: 1rem;
  flex-wrap: wrap;
}

.header-intro {
  display: flex;
  flex-direction: column;
}

.header-title {
  font-size: 1.75rem;
  font-weight: 850;
  letter-spacing: -0.035em;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.header-subtitle {
  font-size: 0.92rem;
  color: var(--text-secondary);
}

.btn-create-task {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-md);
  padding: 0.65rem 1.25rem;
  font-size: 0.9rem;
  font-weight: 750;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
  transition: all 0.25s ease;
}

.btn-create-task:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
  filter: brightness(1.05);
}

/* Executive Minimalist Stats Ribbon */
.stats-ribbon {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.1rem 1.6rem;
  box-shadow: var(--card-shadow);
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1.2fr auto 1fr;
  align-items: center;
  gap: 1.25rem;
  margin-bottom: 1.75rem;
}

@media (max-width: 820px) {
  .stats-ribbon {
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    padding: 1.25rem;
  }
  .ribbon-divider {
    display: none;
  }
}

.ribbon-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ribbon-divider {
  width: 1px;
  height: 38px;
  background: var(--border);
}

.ribbon-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ribbon-value {
  font-size: 1.55rem;
  font-weight: 850;
  line-height: 1;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.text-teal {
  color: #0d9488;
}

[data-theme="dark"] .text-teal {
  color: #2dd4bf;
}

.text-danger {
  color: #ef4444;
}

.text-muted {
  color: var(--text-muted);
}

.label-with-dot {
  display: flex;
  align-items: center;
  gap: 6px;
}

.active-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #0d9488;
  box-shadow: 0 0 6px #0d9488;
}

[data-theme="dark"] .active-pulse-dot {
  background: #2dd4bf;
  box-shadow: 0 0 8px #2dd4bf;
}

.label-with-percent {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ribbon-percent {
  font-size: 0.8rem;
  font-weight: 750;
  color: #10b981;
}

.ribbon-progress-bar {
  height: 6px;
  background: var(--bg-subtle);
  border-radius: 9999px;
  overflow: hidden;
  margin-top: 4px;
}

.ribbon-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981 0%, #06b6d4 100%);
  border-radius: 9999px;
  transition: width 0.4s ease;
}

/* Integrated Toolbar Section */
.toolbar-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.55rem 0.95rem;
  gap: 0.65rem;
  box-shadow: var(--card-shadow);
  flex: 1;
  min-width: 240px;
  max-width: 380px;
  transition: all 0.2s ease;
}

.search-box:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-ring);
}

.search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 0.88rem;
  color: var(--text-primary);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.clear-search {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.clear-search:hover {
  color: var(--text-primary);
}

.toolbar-filters {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.segmented-tabs {
  display: flex;
  background: var(--bg-subtle);
  padding: 3px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}

.seg-btn {
  background: transparent;
  border: none;
  padding: 0.4rem 0.85rem;
  font-size: 0.82rem;
  font-weight: 650;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.seg-btn:hover {
  color: var(--text-primary);
}

.seg-btn.active {
  background: var(--bg-surface);
  color: #10b981;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

[data-theme="dark"] .seg-btn.active {
  color: #34d399;
}

.filter-selects {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.select-pill {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.45rem 0.85rem;
  font-size: 0.82rem;
  font-weight: 650;
  color: var(--text-secondary);
  outline: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.select-pill:focus {
  border-color: var(--border-focus);
}

@keyframes slideUp {
  from {
    transform: translateY(14px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .toolbar-section {
    flex-direction: column;
    align-items: stretch;
  }
  .search-box {
    max-width: 100%;
  }
  .toolbar-filters {
    justify-content: space-between;
  }
}

/* Footer */
.app-footer {
  margin-top: auto;
  border-top: 1px solid var(--border);
  background: transparent;
  padding: 3rem 1.5rem 2.5rem;
}

.footer-container {
  max-width: 1140px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.footer-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 2rem;
  flex-wrap: wrap;
}

.footer-left {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-width: 460px;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.brand-icon-mini {
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  color: #ffffff;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.footer-brand-title {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  color: var(--text-primary);
}

.footer-description {
  font-size: 0.88rem;
  color: var(--text-muted);
  line-height: 1.6;
}

.footer-right {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.65rem;
}

.footer-connect-label {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.instagram-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 0.55rem 1.15rem;
  border-radius: 9999px;
  font-size: 0.88rem;
  font-weight: 700;
  text-decoration: none;
  box-shadow: var(--card-shadow);
  transition: all 0.25s ease;
}

.instagram-btn:hover {
  border-color: #e1306c;
  color: #e1306c;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(225, 48, 108, 0.2);
}

.footer-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  gap: 1rem;
  flex-wrap: wrap;
}

.footer-copyright {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.footer-copyright strong {
  color: var(--text-primary);
  font-weight: 700;
}

.footer-tagline {
  font-size: 0.78rem;
  color: var(--text-muted);
  font-style: italic;
}
</style>
