<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import TaskList from "./components/TaskList.vue";
import TaskModal from "./components/TaskModal.vue";
import LucideIcon from "./components/LucideIcon.vue";
import ThemeToggle from "./components/ThemeToggle.vue";
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
    document.body.setAttribute("data-dark-mode", "true");
  } else {
    document.documentElement.removeAttribute("data-theme");
    document.body.setAttribute("data-dark-mode", "false");
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

// Modals & Menus
const isTaskModalOpen = ref(false);
const taskBeingEdited = ref(null);
const isMobileMenuOpen = ref(false);

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

// Desktop Profile Dropdown State
const isProfileDropdownOpen = ref(false);

function toggleProfileDropdown() {
  isProfileDropdownOpen.value = !isProfileDropdownOpen.value;
}

function closeProfileDropdown() {
  isProfileDropdownOpen.value = false;
}

function handleWindowClick(e) {
  if (isProfileDropdownOpen.value) {
    const dropdown = document.querySelector(".user-dropdown-container");
    if (dropdown && !dropdown.contains(e.target)) {
      isProfileDropdownOpen.value = false;
    }
  }
}

async function handleLogout() {
  isProfileDropdownOpen.value = false;
  isMobileMenuOpen.value = false;
  await logoutUser();
  currentUser.value = null;
  tasks.value = [];
}

onMounted(() => {
  window.addEventListener("click", handleWindowClick);
  applyTheme();
  setupFirebase();
});

onUnmounted(() => {
  window.removeEventListener("click", handleWindowClick);
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

          <!-- Pilot Bear Theme Switcher -->
          <ThemeToggle
            :model-value="isDarkMode"
            @toggle="toggleTheme"
            width="80px"
          />
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
            Ruang kerja minimalis untuk mencatat tugas, mengatur prioritas, dan
            memantau tenggat waktu tanpa distraksi.
          </p>

          <!-- CTA Buttons -->
          <div class="hero-cta-group">
            <button
              class="btn-cta-primary"
              @click="handleLogin"
              title="Masuk dengan akun Google"
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
              <span>Masuk dengan Google</span>
            </button>
          </div>
        </div>
      </section>

      <!-- 2. TAMPILAN JIKA SUDAH LOGIN (DASHBOARD LENGKAP) -->
      <section v-else class="dashboard">
        <!-- Backdrop Mobile Drawer -->
        <div
          v-if="isMobileMenuOpen"
          class="drawer-backdrop"
          @click="isMobileMenuOpen = false"
        ></div>

        <!-- Mobile Drawer Navigation (Aside Menu yang slide dari kanan) -->
        <nav class="mobile-drawer" :class="{ 'nav-active': isMobileMenuOpen }">
          <div class="drawer-header">
            <div class="drawer-user-info">
              <img
                v-if="currentUser.photoURL"
                :src="currentUser.photoURL"
                :alt="currentUser.displayName || 'User'"
                class="drawer-avatar"
              />
              <div v-else class="drawer-avatar-placeholder">
                <LucideIcon name="user" size="20" />
              </div>
              <div class="drawer-user-details">
                <span class="drawer-user-name">{{
                  currentUser.displayName || "Pengguna"
                }}</span>
                <span class="drawer-user-email">{{
                  currentUser.email || "Akun Terhubung"
                }}</span>
              </div>
            </div>
          </div>

          <div class="drawer-divider"></div>

          <div class="drawer-content">
            <div class="drawer-nav-group">
              <div class="drawer-item" @click="toggleTheme">
                <div class="drawer-item-left">
                  <span>{{ isDarkMode ? "Mode Gelap" : "Mode Terang" }}</span>
                </div>
                <div @click.stop>
                  <ThemeToggle
                    :model-value="isDarkMode"
                    @toggle="toggleTheme"
                    width="70px"
                  />
                </div>
              </div>

              <div class="drawer-item text-danger" @click="handleLogout">
                <div class="drawer-item-left">
                  <div class="drawer-item-icon icon-danger">
                    <LucideIcon name="log-out" size="18" />
                  </div>
                  <span>Keluar Akun</span>
                </div>
              </div>
            </div>
          </div>

          <div class="drawer-footer">
            <div class="drawer-brand-mini">
              <div class="brand-icon-mini">
                <LucideIcon name="check" size="13" stroke-width="3" />
              </div>
              <span class="drawer-brand-name">TaskFlow</span>
            </div>
            <p class="drawer-credit">
              Dibuat oleh <strong>Haddad Alwi Situmorang</strong>
            </p>
            <a
              href="https://instagram.com/hddalwistmrg"
              target="_blank"
              rel="noopener noreferrer"
              class="drawer-ig-link"
            >
              <LucideIcon name="instagram" size="15" />
              <span>@hddalwistmrg</span>
            </a>
          </div>
        </nav>

        <!-- Top Executive Bar with Brand, Desktop Navigation, & Mobile Burger -->
        <section class="dashboard-topbar">
          <div class="brand">
            <div class="brand-icon">
              <LucideIcon name="check" size="18" stroke-width="3" />
            </div>
            <span class="brand-name">TaskFlow</span>
          </div>

          <!-- Desktop Navigation Actions (Otomatis disembunyikan di HP) -->
          <div class="dashboard-actions desktop-nav">
            <!-- Pilot Bear Theme Toggle -->
            <ThemeToggle
              :model-value="isDarkMode"
              @toggle="toggleTheme"
              width="76px"
            />

            <!-- User Profile Dropdown (Hanya profil & nama yang tampil, klik untuk memunculkan tombol keluar) -->
            <div class="user-dropdown-container">
              <button
                class="user-pill-btn"
                :class="{ 'user-pill-active': isProfileDropdownOpen }"
                @click.stop="toggleProfileDropdown"
                type="button"
                title="Menu Profil"
              >
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
                <LucideIcon
                  name="chevron-down"
                  size="14"
                  class="dropdown-chevron"
                  :class="{ 'chevron-rotated': isProfileDropdownOpen }"
                />
              </button>

              <!-- Floating Dropdown Menu -->
              <Transition name="dropdown-pop">
                <div
                  v-if="isProfileDropdownOpen"
                  class="profile-dropdown-menu"
                  @click.stop
                >
                  <div class="dropdown-user-header">
                    <span class="dropdown-user-fullname">{{
                      currentUser.displayName || "Pengguna"
                    }}</span>
                    <span class="dropdown-user-email">{{
                      currentUser.email || ""
                    }}</span>
                  </div>
                  <div class="dropdown-divider"></div>
                  <button
                    class="dropdown-logout-item"
                    @click="
                      handleLogout();
                      closeProfileDropdown();
                    "
                  >
                    <LucideIcon name="log-out" size="16" />
                    <span>Keluar</span>
                  </button>
                </div>
              </Transition>
            </div>
          </div>

          <!-- Mobile Animated Burger (Hanya tampil di HP / tablet <= 825px) -->
          <button
            class="burger"
            :class="{ 'toggle-burger': isMobileMenuOpen }"
            @click="isMobileMenuOpen = !isMobileMenuOpen"
            type="button"
            aria-label="Menu navigasi"
            :title="isMobileMenuOpen ? 'Tutup menu' : 'Buka menu'"
          >
            <span class="line line-1"></span>
            <span class="line line-2"></span>
            <span class="line line-3"></span>
          </button>
        </section>

        <!-- Greeting & Subtitle Summary (Desktop: Button Tambah Tugas sejajar dengan Halo, Haddad) -->
        <section class="dashboard-intro">
          <div class="intro-left">
            <h1 class="header-title">
              Halo, {{ currentUser.displayName?.split(" ")[0] || "Saya" }}
            </h1>
            <p class="header-subtitle">
              {{
                activeCount > 0
                  ? `${activeCount} tugas aktif menunggu diselesaikan.`
                  : "Semua tugas telah selesai, kerja bagus!"
              }}
            </p>
          </div>

          <!-- Button Tambah Tugas Desktop (Sejajar dengan Halo, Haddad) -->
          <button
            class="btn-create-task desktop-create-btn"
            @click="openCreateModal"
          >
            <LucideIcon name="plus" size="18" />
            <span>Tambah Tugas</span>
          </button>
        </section>

        <!-- Modern Dashboard Metric & Progress Card -->
        <section class="dashboard-highlight-section">
          <div class="card dashboard-stats-card">
            <div class="card-body">
              <!-- Metric Tiles -->
              <div class="stats-mini-summary">
                <div class="summary-stat-tag">
                  <span class="stat-tag-num">{{ totalCount }}</span>
                  <span class="stat-tag-lbl">Total Tugas</span>
                </div>
                <div class="summary-stat-tag">
                  <div class="stat-dot-num">
                    <span class="active-pulse-dot"></span>
                    <span class="stat-tag-num text-cyan">{{
                      activeCount
                    }}</span>
                  </div>
                  <span class="stat-tag-lbl">Dalam Pengerjaan</span>
                </div>
                <div class="summary-stat-tag">
                  <span class="stat-tag-num text-emerald">{{ doneCount }}</span>
                  <span class="stat-tag-lbl">Selesai</span>
                </div>
                <div class="summary-stat-tag">
                  <span
                    :class="[
                      'stat-tag-num',
                      urgentCount > 0 ? 'text-amber' : 'text-muted',
                    ]"
                  >
                    {{ urgentCount }}
                  </span>
                  <span class="stat-tag-lbl">Mendekati Deadline</span>
                </div>
              </div>

              <!-- Progress Bar -->
              <div class="progress">
                <div class="progress-labels">
                  <span>Progress Keseluruhan</span>
                  <span class="progress-percent-val"
                    >{{ progressPercentage }}%</span
                  >
                </div>
                <div class="progress-bar">
                  <div
                    class="progress-bar-fill"
                    :style="{ width: progressPercentage + '%' }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Mobile Create Task Button (Hanya tampil di HP, di bawah bagian jumlah tugas / di atas kolom pencarian) -->
        <div class="mobile-action-bar">
          <button
            class="btn-create-task mobile-create-btn"
            @click="openCreateModal"
          >
            <LucideIcon name="plus" size="18" />
            <span>Tambah Tugas Baru</span>
          </button>
        </div>

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
              Sistem manajemen tugas harian yang minimalis dan teratur untuk
              meningkatkan fokus, ketenangan kerja, dan produktivitas Anda.
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
            &copy; {{ new Date().getFullYear() }} TaskFlow. Dibuat oleh
            <strong>Haddad Alwi Situmorang</strong>. All rights reserved.
          </p>
          <span class="footer-tagline"
            >Fokus, tenang, dan selesaikan tepat waktu.</span
          >
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
  position: relative;
}

.app-layout::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    radial-gradient(
      circle at 18% 18%,
      rgba(16, 185, 129, 0.08) 0%,
      transparent 45%
    ),
    radial-gradient(
      circle at 82% 28%,
      rgba(6, 182, 212, 0.08) 0%,
      transparent 45%
    ),
    radial-gradient(
      circle at 50% 85%,
      rgba(99, 102, 241, 0.06) 0%,
      transparent 55%
    );
}

[data-theme="dark"] .app-layout::before {
  background-image:
    radial-gradient(
      circle at 18% 18%,
      rgba(16, 185, 129, 0.13) 0%,
      transparent 45%
    ),
    radial-gradient(
      circle at 82% 28%,
      rgba(6, 182, 212, 0.13) 0%,
      transparent 45%
    ),
    radial-gradient(
      circle at 50% 85%,
      rgba(99, 102, 241, 0.09) 0%,
      transparent 55%
    );
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

/* User Profile Dropdown Container (Hanya profil & nama yang tampil secara default) */
.user-dropdown-container {
  position: relative;
  z-index: 100;
}

.user-pill-btn {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  background: var(--bg-surface);
  padding: 3px 12px 3px 4px;
  border-radius: 9999px;
  border: 1px solid var(--border);
  cursor: pointer;
  box-shadow: var(--card-shadow);
  transition: all 0.2s ease;
}

.user-pill-btn:hover,
.user-pill-btn.user-pill-active {
  border-color: var(--border-focus);
  background: var(--bg-subtle);
  transform: translateY(-1px);
}

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}

.user-avatar-placeholder {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary-light);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.user-name {
  font-size: 0.86rem;
  font-weight: 750;
  color: var(--text-primary);
}

.dropdown-chevron {
  color: var(--text-muted);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  margin-left: 2px;
}

.dropdown-chevron.chevron-rotated {
  transform: rotate(180deg);
  color: var(--primary);
}

/* Floating Dropdown Menu (Muncul saat profil diklik) */
.profile-dropdown-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 210px;
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow:
    0 12px 32px -4px rgba(0, 0, 0, 0.25),
    0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 0.65rem;
  z-index: 1050;
  display: flex;
  flex-direction: column;
}

[data-theme="dark"] .profile-dropdown-menu {
  background: #141419;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.65);
}

.dropdown-user-header {
  padding: 0.35rem 0.5rem 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dropdown-user-fullname {
  font-size: 0.88rem;
  font-weight: 750;
  color: var(--text-primary);
  word-break: break-word;
}

.dropdown-user-email {
  font-size: 0.75rem;
  color: var(--text-muted);
  word-break: break-all;
}

.dropdown-divider {
  height: 1px;
  background: var(--border);
  margin: 0.3rem 0;
}

.dropdown-logout-item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: #f43f5e;
  font-size: 0.86rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100%;
  text-align: left;
}

.dropdown-logout-item:hover {
  background: rgba(244, 63, 94, 0.12);
  color: #f43f5e;
}

/* Dropdown Animation */
.dropdown-pop-enter-active,
.dropdown-pop-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-pop-enter-from,
.dropdown-pop-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}

/* Main Content */
.main-content {
  max-width: 1140px;
  width: 100%;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
  flex: 1;
  position: relative;
  z-index: 1;
}

@media (max-width: 640px) {
  .main-content {
    padding: 1.25rem 1rem 3rem;
  }
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

@media (max-width: 640px) {
  .landing-topbar {
    margin-bottom: 2.5rem;
  }
}

.landing-hero-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 680px;
  margin: 0 auto;
  width: 100%;
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
  font-size: clamp(2rem, 5.5vw, 3.4rem);
  font-weight: 850;
  letter-spacing: -0.04em;
  line-height: 1.15;
  color: var(--text-primary);
  margin-bottom: 1.25rem;
  word-break: break-word;
}

@media (max-width: 480px) {
  .hero-main-title {
    font-size: 1.95rem;
    line-height: 1.2;
    margin-bottom: 0.85rem;
  }
}

.hero-main-desc {
  font-size: 1.05rem;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 2.25rem;
  max-width: 540px;
}

@media (max-width: 480px) {
  .hero-main-desc {
    font-size: 0.92rem;
    line-height: 1.6;
    margin-bottom: 1.75rem;
    padding: 0 0.5rem;
  }
}

/* CTA Buttons on Landing Hero */
.hero-cta-group {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.btn-cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  color: #ffffff;
  border: none;
  font-size: 1rem;
  font-weight: 750;
  padding: 0.95rem 2rem;
  border-radius: 9999px;
  cursor: pointer;
  box-shadow: 0 8px 25px -4px rgba(16, 185, 129, 0.45);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-cta-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 32px -4px rgba(16, 185, 129, 0.65);
  filter: brightness(1.05);
}

.google-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  background: #ffffff;
  padding: 2px;
  border-radius: 50%;
}

@media (max-width: 480px) {
  .btn-cta-primary {
    width: 100%;
    max-width: 320px;
    justify-content: center;
    padding: 0.9rem 1.4rem;
    font-size: 0.92rem;
  }
}

/* 2. Dashboard Top Bar & Intro */
.dashboard-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 1.25rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
  gap: 1rem;
  position: relative;
}

.dashboard-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

/* Hamburger Menu Button */
.burger {
  display: none;
  cursor: pointer;
  width: 28px;
  height: 20px;
  position: relative;
  z-index: 1001;
  flex-direction: column;
  justify-content: space-between;
  background: transparent;
  border: none;
  padding: 0;
}

.burger .line {
  width: 100%;
  height: 2.5px;
  background-color: var(--text-primary);
  border-radius: 4px;
  transition: all 0.3s ease-in-out;
}

.toggle-burger .line-1 {
  transform: rotate(-45deg) translate(-5px, 7px);
}

.toggle-burger .line-2 {
  opacity: 0;
  transform: translateX(4px);
}

.toggle-burger .line-3 {
  transform: rotate(45deg) translate(-5px, -7px);
}

/* Mobile Aside Drawer */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  z-index: 998;
  animation: fadeIn 0.2s ease-out;
}

.mobile-drawer {
  position: fixed;
  width: 78%;
  max-width: 320px;
  right: 0;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface-elevated);
  border-left: 1px solid var(--border);
  z-index: 999;
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  padding: 4.5rem 1.25rem 2rem;
  box-shadow: -10px 0 30px rgba(0, 0, 0, 0.25);
}

.mobile-drawer.nav-active {
  transform: translateX(0);
}

.drawer-header {
  margin-bottom: 1.25rem;
}

.drawer-user-info {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.drawer-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--primary);
}

.drawer-avatar-placeholder {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--primary-light);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.drawer-user-details {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drawer-user-name {
  font-size: 0.98rem;
  font-weight: 750;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drawer-user-email {
  font-size: 0.76rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drawer-divider {
  height: 1px;
  background: var(--border);
  margin-bottom: 1.25rem;
}

.drawer-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.drawer-nav-group {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.drawer-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.88rem;
  font-weight: 650;
  color: var(--text-primary);
}

.drawer-item:hover {
  background: var(--primary-light);
  border-color: var(--border-focus);
}

.drawer-item-left {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.drawer-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.drawer-item.text-danger {
  color: var(--danger);
}

.drawer-item.text-danger .drawer-item-icon {
  color: var(--danger);
}

.drawer-item.text-danger:hover {
  background: var(--danger-bg);
  border-color: var(--danger);
}

.drawer-badge-theme {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-weight: 700;
}

.drawer-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.drawer-brand-mini {
  display: flex;
  align-items: center;
  gap: 6px;
}

.drawer-brand-name {
  font-size: 0.92rem;
  font-weight: 800;
  color: var(--text-primary);
}

.drawer-credit {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.drawer-credit strong {
  color: var(--text-primary);
}

.drawer-ig-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  color: #e1306c;
  text-decoration: none;
  margin-top: 2px;
}

/* Dashboard Intro with Desktop Button */
.dashboard-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.75rem;
  gap: 1.25rem;
}

.intro-left {
  display: flex;
  flex-direction: column;
}

.header-title {
  font-size: clamp(1.4rem, 4vw, 1.85rem);
  font-weight: 850;
  letter-spacing: -0.035em;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.header-subtitle {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
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
  white-space: nowrap;
}

.btn-create-task:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
  filter: brightness(1.05);
}

/* Mobile Action Bar */
.mobile-action-bar {
  display: none;
  margin-bottom: 1.5rem;
}

/* Modern Dashboard Metric & Progress Card (Dark, Sleek, Tanpa Outline Bersinar) */
.dashboard-highlight-section {
  width: 100%;
  margin-bottom: 1.75rem;
  display: flex;
  justify-content: center;
}

.card {
  position: relative;
  z-index: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.25);
  border-radius: var(--radius-xl);
  overflow: hidden;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;
}

[data-theme="dark"] .card {
  background: #141419;
  border: 1px solid rgba(255, 255, 255, 0.08); /* Outline gelap matte, subtle & tanpa sinar */
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
}

.card:hover {
  transform: translateY(-2px);
}

[data-theme="dark"] .card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}

[data-theme="light"] .card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}

.card-body {
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 1.25rem 1.6rem;
  text-align: left;
}

.stats-mini-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.25rem;
  margin-bottom: 1.25rem;
}

.summary-stat-tag {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0.85rem 1.15rem;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.2s ease;
}

[data-theme="light"] .summary-stat-tag {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.stat-dot-num {
  display: flex;
  align-items: center;
  gap: 7px;
}

.active-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #06b6d4;
  box-shadow: 0 0 6px #06b6d4;
  flex-shrink: 0;
}

.stat-tag-num {
  font-size: 1.55rem;
  font-weight: 850;
  color: var(--text-primary);
  line-height: 1;
  letter-spacing: -0.02em;
}

[data-theme="dark"] .stat-tag-num {
  color: #f8fafc;
}

.stat-tag-num.text-cyan {
  color: #06b6d4;
}

.stat-tag-num.text-emerald {
  color: #10b981;
}

.stat-tag-num.text-amber {
  color: #f43f5e;
}

.stat-tag-num.text-muted {
  color: var(--text-muted);
}

.stat-tag-lbl {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

[data-theme="dark"] .stat-tag-lbl {
  color: #64748b;
}

.card-body .progress {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.progress-labels {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.8rem;
  font-weight: 650;
  color: var(--text-secondary);
}

.progress-percent-val {
  color: #10b981;
  font-weight: 750;
}

.card-body .progress-bar {
  position: relative;
  width: 100%;
  background: var(--bg-subtle);
  height: 0.45rem;
  display: block;
  border-radius: 3.125rem;
  overflow: hidden;
}

[data-theme="dark"] .card-body .progress-bar {
  background: #232228ff;
}

.card-body .progress-bar .progress-bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  height: 100%;
  border-radius: 3.125rem;
  background: linear-gradient(90deg, #10b981 0%, #06b6d4 100%);
  transition: width 0.4s ease;
}

/* Responsive Breakpoints (Mobile & Tablet <= 825px) */
@media (max-width: 825px) {
  /* Hide Desktop Nav in Topbar & Show Animated Burger */
  .desktop-nav {
    display: none !important;
  }

  .burger {
    display: flex;
  }

  .dashboard-topbar {
    padding-bottom: 1rem;
    margin-bottom: 1.25rem;
  }

  /* Desktop Create Button Hidden on Mobile */
  .desktop-create-btn {
    display: none !important;
  }

  /* Mobile Create Button shown under Stats and above Search */
  .mobile-action-bar {
    display: block;
  }

  .mobile-create-btn {
    width: 100%;
    justify-content: center;
    padding: 0.85rem 1.25rem;
    font-size: 0.95rem;
    box-shadow: 0 8px 24px -4px rgba(16, 185, 129, 0.45);
  }

  /* Card di HP: Tetap rapi, responsif, dan proporsional */
  .dashboard-highlight-section {
    margin-bottom: 1.25rem;
  }

  .card {
    border-radius: var(--radius-lg);
  }

  .card-body {
    padding: 0.85rem 1rem;
  }

  .stats-mini-summary {
    gap: 0.75rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-bottom: 0.85rem;
  }

  .summary-stat-tag {
    padding: 0.65rem 0.85rem;
  }

  .stat-tag-num {
    font-size: 1.35rem;
  }

  .stat-tag-lbl {
    font-size: 0.68rem;
  }
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
    gap: 0.85rem;
  }
  .search-box {
    max-width: 100%;
    width: 100%;
  }
  .toolbar-filters {
    justify-content: space-between;
  }
}

@media (max-width: 540px) {
  .toolbar-filters {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 0.65rem;
  }
  .segmented-tabs {
    width: 100%;
  }
  .seg-btn {
    flex: 1;
    text-align: center;
    padding: 0.45rem 0.25rem;
    font-size: 0.78rem;
  }
  .filter-selects {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
    gap: 0.5rem;
  }
  .select-pill {
    width: 100%;
    padding: 0.45rem 0.5rem;
    font-size: 0.76rem;
  }
}

/* Footer */
.app-footer {
  margin-top: auto;
  border-top: 1px solid var(--border);
  background: transparent;
  padding: 3rem 1.5rem 2.5rem;
  position: relative;
  z-index: 1;
}

@media (max-width: 640px) {
  .app-footer {
    padding: 2.25rem 1rem 2rem;
  }
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

@media (max-width: 640px) {
  .footer-content {
    flex-direction: column;
    gap: 1.5rem;
  }
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

@media (max-width: 640px) {
  .footer-right {
    width: 100%;
  }
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

@media (max-width: 640px) {
  .instagram-btn {
    width: 100%;
    justify-content: center;
  }
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

@media (max-width: 640px) {
  .footer-bottom-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
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
