<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  size: {
    type: [Number, String],
    default: 20,
  },
  strokeWidth: {
    type: [Number, String],
    default: 2,
  },
  class: {
    type: String,
    default: '',
  },
});

// Accurate Lucide Icon SVG path definitions (24x24 viewBox)
const iconPaths = {
  // Navigation & General
  'sparkles': [
    { type: 'path', d: 'm12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z' },
    { type: 'path', d: 'M5 3v4' },
    { type: 'path', d: 'M19 17v4' },
    { type: 'path', d: 'M3 5h4' },
    { type: 'path', d: 'M17 19h4' },
  ],
  'book-open': [
    { type: 'path', d: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' },
    { type: 'path', d: 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' },
  ],
  'clipboard-check': [
    { type: 'rect', width: '8', height: '4', x: '8', y: '2', rx: '1', ry: '1' },
    { type: 'path', d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' },
    { type: 'path', d: 'm9 14 2 2 4-4' },
  ],
  'calendar-check': [
    { type: 'path', d: 'M8 2v4' },
    { type: 'path', d: 'M16 2v4' },
    { type: 'rect', width: '18', height: '18', x: '3', y: '4', rx: '2' },
    { type: 'path', d: 'M3 10h18' },
    { type: 'path', d: 'm9 16 2 2 4-4' },
  ],
  'graduation-cap': [
    { type: 'path', d: 'M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z' },
    { type: 'path', d: 'M22 10v6' },
    { type: 'path', d: 'M6 12.5V16a6 3 0 0 0 12 0v-3.5' },
  ],
  'check-circle-2': [
    { type: 'circle', cx: '12', cy: '12', r: '10' },
    { type: 'path', d: 'm9 12 2 2 4-4' },
  ],
  'check-circle': [
    { type: 'path', d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' },
    { type: 'polyline', points: '22 4 12 14.01 9 11.01' },
  ],
  'check': [
    { type: 'polyline', points: '20 6 9 17 4 12' },
  ],
  'arrow-right': [
    { type: 'path', d: 'M5 12h14' },
    { type: 'path', d: 'm12 5 7 7-7 7' },
  ],
  'shield-check': [
    { type: 'path', d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' },
    { type: 'path', d: 'm9 12 2 2 4-4' },
  ],
  'cloud': [
    { type: 'path', d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' },
  ],
  'cloud-lightning': [
    { type: 'path', d: 'M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973' },
    { type: 'path', d: 'm13 12-3 5h4l-3 5' },
  ],
  'clock': [
    { type: 'circle', cx: '12', cy: '12', r: '10' },
    { type: 'polyline', points: '12 6 12 12 16 14' },
  ],
  'lock': [
    { type: 'rect', width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' },
    { type: 'path', d: 'M7 11V7a5 5 0 0 1 10 0v4' },
  ],
  'sun': [
    { type: 'circle', cx: '12', cy: '12', r: '4' },
    { type: 'path', d: 'M12 2v2' },
    { type: 'path', d: 'M12 20v2' },
    { type: 'path', d: 'm4.93 4.93 1.41 1.41' },
    { type: 'path', d: 'm17.66 17.66 1.41 1.41' },
    { type: 'path', d: 'M2 12h2' },
    { type: 'path', d: 'M20 12h2' },
    { type: 'path', d: 'm6.34 17.66-1.41 1.41' },
    { type: 'path', d: 'm19.07 4.93-1.41 1.41' },
  ],
  'moon': [
    { type: 'path', d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' },
  ],
  'search': [
    { type: 'circle', cx: '11', cy: '11', r: '8' },
    { type: 'path', d: 'm21 21-4.3-4.3' },
  ],
  'plus': [
    { type: 'path', d: 'M5 12h14' },
    { type: 'path', d: 'M12 5v14' },
  ],
  'list-todo': [
    { type: 'rect', x: '3', y: '5', width: '6', height: '6', rx: '1' },
    { type: 'path', d: 'm3 17 2 2 4-4' },
    { type: 'path', d: 'M13 6h8' },
    { type: 'path', d: 'M13 12h8' },
    { type: 'path', d: 'M13 18h8' },
  ],
  'activity': [
    { type: 'path', d: 'M22 12h-4l-3 9L9 3l-3 9H2' },
  ],
  'zap': [
    { type: 'polygon', points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' },
  ],
  'alert-triangle': [
    { type: 'path', d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' },
    { type: 'line', x1: '12', y1: '9', x2: '12', y2: '13' },
    { type: 'line', x1: '12', y1: '17', x2: '12.01', y2: '17' },
  ],
  'layers': [
    { type: 'path', d: 'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z' },
    { type: 'path', d: 'm22 12.5-8.58 3.91a2 2 0 0 1-1.66 0L2 12.5' },
    { type: 'path', d: 'm22 17.5-8.58 3.91a2 2 0 0 1-1.66 0L2 17.5' },
  ],
  'user': [
    { type: 'path', d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' },
    { type: 'circle', cx: '12', cy: '7', r: '4' },
  ],
  'users': [
    { type: 'path', d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' },
    { type: 'circle', cx: '9', cy: '7', r: '4' },
    { type: 'path', d: 'M22 21v-2a4 4 0 0 0-3-3.87' },
    { type: 'path', d: 'M16 3.13a4 4 0 0 1 0 7.75' },
  ],
  'log-out': [
    { type: 'path', d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' },
    { type: 'polyline', points: '16 17 21 12 16 7' },
    { type: 'line', x1: '21', y1: '12', x2: '9', y2: '12' },
  ],
  'log-in': [
    { type: 'path', d: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4' },
    { type: 'polyline', points: '10 17 15 12 10 7' },
    { type: 'line', x1: '15', y1: '12', x2: '3', y2: '12' },
  ],
  'tag': [
    { type: 'path', d: 'M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z' },
    { type: 'path', d: 'M7 7h.01' },
  ],
  'calendar': [
    { type: 'path', d: 'M8 2v4' },
    { type: 'path', d: 'M16 2v4' },
    { type: 'rect', width: '18', height: '18', x: '3', y: '4', rx: '2' },
    { type: 'path', d: 'M3 10h18' },
  ],
  'edit-3': [
    { type: 'path', d: 'M12 20h9' },
    { type: 'path', d: '16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' },
  ],
  'trash-2': [
    { type: 'path', d: 'M3 6h18' },
    { type: 'path', d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' },
    { type: 'path', d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' },
    { type: 'line', x1: '10', y1: '11', x2: '10', y2: '17' },
    { type: 'line', x1: '14', y1: '11', x2: '14', y2: '17' },
  ],
  'chevron-down': [
    { type: 'path', d: 'm6 9 6 6 6-6' },
  ],
  'x': [
    { type: 'path', d: 'M18 6 6 18' },
    { type: 'path', d: 'm6 6 12 12' },
  ],
  'file-text': [
    { type: 'path', d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' },
    { type: 'path', d: 'M14 2v4a2 2 0 0 0 2 2h4' },
    { type: 'path', d: 'M10 9H8' },
    { type: 'path', d: 'M16 13H8' },
    { type: 'path', d: 'M16 17H8' },
  ],
  'database': [
    { type: 'ellipse', cx: '12', cy: '5', rx: '9', ry: '3' },
    { type: 'path', d: 'M3 5V19A9 3 0 0 0 21 19V5' },
    { type: 'path', d: 'M3 12A9 3 0 0 0 21 12' },
  ],
  'instagram': [
    { type: 'rect', width: '20', height: '20', x: '2', y: '2', rx: '5', ry: '5' },
    { type: 'path', d: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z' },
    { type: 'line', x1: '17.5', y1: '6.5', x2: '17.51', y2: '6.5' },
  ],
};

const elements = computed(() => iconPaths[props.name] || iconPaths['sparkles']);
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    :class="['lucide-icon', props.class]"
  >
    <template v-for="(el, idx) in elements" :key="idx">
      <path v-if="el.type === 'path'" :d="el.d" />
      <circle v-else-if="el.type === 'circle'" :cx="el.cx" :cy="el.cy" :r="el.r" />
      <rect v-else-if="el.type === 'rect'" :x="el.x" :y="el.y" :width="el.width" :height="el.height" :rx="el.rx" :ry="el.ry" />
      <polyline v-else-if="el.type === 'polyline'" :points="el.points" />
      <polygon v-else-if="el.type === 'polygon'" :points="el.points" />
      <line v-else-if="el.type === 'line'" :x1="el.x1" :y1="el.y1" :x2="el.x2" :y2="el.y2" />
      <ellipse v-else-if="el.type === 'ellipse'" :cx="el.cx" :cy="el.cy" :rx="el.rx" :ry="el.ry" />
    </template>
  </svg>
</template>

<style scoped>
.lucide-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
