<template>
  <aside
    ref="menuRef"
    class="gallery-media-details-menu"
    :class="{ 'is-positioned': position.ready }"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    role="dialog"
    aria-label="媒体详细信息"
    @click.stop
    @pointerdown.stop
    @contextmenu.prevent.stop
  >
    <dl class="gallery-media-details-list">
      <div class="gallery-media-details-row" v-for="row in rows" :key="row.key">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </div>
    </dl>
  </aside>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { buildGalleryMediaDetailRows } from "../domain/gallery-media-details.mjs";

const props = defineProps({
  item: { type: Object, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
});

const menuRef = ref(null);
const rows = computed(() => buildGalleryMediaDetailRows(props.item));
const position = reactive({ left: 0, top: 0, ready: false });

async function updatePosition() {
  position.ready = false;
  await nextTick();
  const menu = menuRef.value;
  if (!menu) return;

  const margin = 10;
  const pointerOffset = 8;
  const rect = menu.getBoundingClientRect();
  let left = props.x + pointerOffset;
  let top = props.y + pointerOffset;
  if (left + rect.width > window.innerWidth - margin) left = props.x - rect.width - pointerOffset;
  if (top + rect.height > window.innerHeight - margin) top = props.y - rect.height - pointerOffset;
  position.left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
  position.top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
  position.ready = true;
}

watch(
  () => [props.item?.FilePath, props.x, props.y],
  updatePosition,
  { immediate: true, flush: "post" },
);
</script>
