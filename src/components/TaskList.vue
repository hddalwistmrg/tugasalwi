<script setup>
import { computed } from "vue";
import LucideIcon from "./LucideIcon.vue";

const props = defineProps({
  tasks: {
    type: Array,
    default: () => [],
  },
});

defineEmits(["toggle-task", "remove-task", "edit-task"]);

function getDeadlineMeta(deadlineStr) {
  if (!deadlineStr) return null;
  const target = new Date(deadlineStr);
  if (isNaN(target.getTime())) return null;

  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const formattedDate = target.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (diffMs < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      status: "overdue",
      label: overdueDays === 0 ? "Lewat batas waktu" : `Terlambat ${overdueDays} hari`,
      detail: formattedDate,
      badgeClass: "badge-danger",
    };
  }

  if (diffHours <= 24) {
    return {
      status: "urgent",
      label: diffHours <= 1 ? "Mendesak (< 1 jam)" : `Hari ini (${diffHours} jam lagi)`,
      detail: formattedDate,
      badgeClass: "badge-warning",
    };
  }

  if (diffDays <= 2) {
    return {
      status: "soon",
      label: "Besok",
      detail: formattedDate,
      badgeClass: "badge-warning",
    };
  }

  return {
    status: "safe",
    label: formattedDate,
    detail: formattedDate,
    badgeClass: "badge-subtle",
  };
}

function getCategoryColor(category) {
  if (!category) return "cat-default";
  const lower = category.toLowerCase();
  if (lower.includes("web")) return "cat-indigo";
  if (lower.includes("data") || lower.includes("basis")) return "cat-teal";
  if (lower.includes("jaringan") || lower.includes("network")) return "cat-blue";
  if (lower.includes("algoritma") || lower.includes("struktur")) return "cat-purple";
  if (lower.includes("kalkulus") || lower.includes("matematika")) return "cat-pink";
  if (lower.includes("pribadi")) return "cat-amber";
  return "cat-default";
}
</script>

<template>
  <div class="list-wrapper">
    <TransitionGroup name="task-item-anim" tag="div" class="task-grid">
      <div
        v-for="task in tasks"
        :key="task.id"
        :class="['task-card', { 'task-card--done': task.done }]"
      >
        <!-- Custom Checkbox -->
        <label class="custom-check-label" :title="task.done ? 'Tandai belum selesai' : 'Tandai selesai'">
          <input
            type="checkbox"
            :checked="task.done"
            @change="$emit('toggle-task', task.id)"
            class="sr-only"
          />
          <div :class="['check-circle', { checked: task.done }]">
            <svg viewBox="0 0 24 24" class="check-icon">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </label>

        <!-- Task Content -->
        <div class="task-main">
          <div class="task-header-row">
            <h4 class="task-title">{{ task.title }}</h4>
          </div>

          <!-- Badges & Meta info -->
          <div class="task-meta-row">
            <!-- Category Tag -->
            <span :class="['cat-badge', getCategoryColor(task.category)]">
              <LucideIcon name="tag" size="13" />
              <span>{{ task.category || "Umum" }}</span>
            </span>

            <!-- Priority Tag -->
            <span
              v-if="task.priority === 'high'"
              class="priority-badge priority-high"
              title="Prioritas Tinggi"
            >
              <LucideIcon name="alert-triangle" size="13" />
              <span>Tinggi</span>
            </span>
            <span
              v-else-if="task.priority === 'low'"
              class="priority-badge priority-low"
              title="Prioritas Rendah"
            >
              <LucideIcon name="clock" size="13" />
              <span>Rendah</span>
            </span>
            <span
              v-else
              class="priority-badge priority-medium"
              title="Prioritas Sedang"
            >
              <LucideIcon name="zap" size="13" />
              <span>Sedang</span>
            </span>

            <!-- Deadline Badge -->
            <span
              v-if="task.deadline"
              :class="['deadline-badge', getDeadlineMeta(task.deadline)?.badgeClass]"
              :title="'Deadline: ' + getDeadlineMeta(task.deadline)?.detail"
            >
              <LucideIcon name="calendar" size="13" />
              <span>{{ getDeadlineMeta(task.deadline)?.label }}</span>
            </span>
          </div>

          <!-- Extra Notes if present -->
          <p v-if="task.notes" class="task-notes">
            <LucideIcon name="file-text" size="13" class="note-icon" />
            <span>{{ task.notes }}</span>
          </p>
        </div>

        <!-- Task Actions -->
        <div class="task-actions">
          <button
            class="action-btn edit-btn"
            @click="$emit('edit-task', task)"
            title="Edit tugas"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 20h9"></path>
              <path
                d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
              ></path>
            </svg>
          </button>

          <button
            class="action-btn delete-btn"
            @click="$emit('remove-task', task.id)"
            title="Hapus tugas"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="3 6 5 6 21 6"></polyline>
              <path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              ></path>
            </svg>
          </button>
        </div>
      </div>
    </TransitionGroup>

    <!-- Empty State -->
    <div v-if="tasks.length === 0" class="empty-state-box">
      <div class="empty-icon-wrapper">
        <LucideIcon name="check-circle-2" size="32" stroke-width="1.8" />
      </div>
      <h3 class="empty-title">Tidak ada tugas yang cocok</h3>
      <p class="empty-desc">
        Semua tugas telah diselesaikan atau belum ada catatan tugas di filter ini.
      </p>
    </div>
  </div>
</template>

<style scoped>
.list-wrapper {
  min-height: 250px;
}

.task-grid {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.task-card {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1rem 1.25rem;
  box-shadow: var(--card-shadow);
  transition: all 0.25s ease;
}

.task-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-focus);
}

.task-card--done {
  opacity: 0.65;
  background: var(--bg-subtle);
  border-style: dashed;
}

.task-card--done .task-title {
  text-decoration: line-through;
  color: var(--text-muted);
}

/* Checkbox */
.custom-check-label {
  cursor: pointer;
  margin-top: 2px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.check-circle {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.check-circle.checked {
  background: var(--success);
  border-color: var(--success);
}

.check-icon {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: white;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  transition: stroke-dashoffset 0.25s ease;
}

.check-circle.checked .check-icon {
  stroke-dashoffset: 0;
}

/* Main info */
.task-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.task-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.task-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.task-meta-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Category Badges */
.cat-badge {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  letter-spacing: 0.02em;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.cat-indigo { background: #e0e7ff; color: #4338ca; }
.cat-teal { background: #ccfbf1; color: #0f766e; }
.cat-blue { background: #dbeafe; color: #1e40af; }
.cat-purple { background: #f3e8ff; color: #6b21a8; }
.cat-pink { background: #fce7f3; color: #9d174d; }
.cat-amber { background: #fef3c7; color: #92400e; }
.cat-default { background: var(--bg-subtle); color: var(--text-secondary); }

[data-theme="dark"] .cat-indigo { background: rgba(99, 102, 241, 0.2); color: #a5b4fc; }
[data-theme="dark"] .cat-teal { background: rgba(20, 184, 166, 0.2); color: #5eead4; }
[data-theme="dark"] .cat-blue { background: rgba(59, 130, 246, 0.2); color: #93c5fd; }
[data-theme="dark"] .cat-purple { background: rgba(168, 85, 247, 0.2); color: #d8b4fe; }
[data-theme="dark"] .cat-pink { background: rgba(236, 72, 153, 0.2); color: #f472b6; }
[data-theme="dark"] .cat-amber { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }

/* Priority Badges */
.priority-badge {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.priority-high {
  background: var(--danger-bg);
  color: var(--danger);
}
.priority-medium {
  background: var(--warning-bg);
  color: var(--warning);
}
.priority-low {
  background: var(--bg-subtle);
  color: var(--text-secondary);
}

/* Deadline Badges */
.deadline-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.badge-danger {
  background: var(--danger-bg);
  color: var(--danger);
  animation: pulse-danger 2s infinite;
}

.badge-warning {
  background: var(--warning-bg);
  color: var(--warning);
}

.badge-subtle {
  background: var(--bg-subtle);
  color: var(--text-secondary);
}

.task-notes {
  font-size: 0.85rem;
  color: var(--text-secondary);
  background: var(--bg-subtle);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  margin-top: 4px;
  word-break: break-word;
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
}

.note-icon {
  margin-top: 2px;
  color: var(--text-muted);
}

/* Actions */
.task-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-btn {
  background: transparent;
  border: none;
  padding: 6px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.edit-btn:hover {
  background: var(--primary-light);
  color: var(--primary);
}

.delete-btn:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

/* Empty State */
.empty-state-box {
  text-align: center;
  padding: 3.5rem 1rem;
  background: var(--bg-surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius-xl);
  margin-top: 1rem;
}

.empty-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--primary-light);
  color: var(--primary);
  margin: 0 auto 0.75rem;
}

.empty-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.35rem;
}

.empty-desc {
  font-size: 0.9rem;
  color: var(--text-muted);
  max-width: 320px;
  margin: 0 auto;
}

/* Animations */
.task-item-anim-enter-active,
.task-item-anim-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.task-item-anim-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.task-item-anim-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

@keyframes pulse-danger {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

@media (max-width: 640px) {
  .task-card {
    padding: 0.85rem 0.95rem;
    gap: 0.75rem;
    border-radius: var(--radius-md);
  }
  .task-title {
    font-size: 0.92rem;
  }
  .task-meta-row {
    gap: 0.35rem;
  }
  .cat-badge,
  .priority-badge,
  .deadline-badge {
    font-size: 0.68rem;
    padding: 2px 6px;
  }
  .task-notes {
    font-size: 0.8rem;
    padding: 4px 8px;
  }
  .action-btn {
    padding: 7px;
    min-width: 32px;
    min-height: 32px;
  }
}
</style>
