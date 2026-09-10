<template>
  <!-- Only the HTML-disabled, inert-link renderer may supply this markup. -->
  <div class="agent-markdown" v-html="rendered" />
</template>

<script setup>
import { computed } from 'vue';
import { renderAgentMarkdown } from '../domain/agent-markdown.mjs';
const props = defineProps({ content: { type: String, default: '' } });
const rendered = computed(() => renderAgentMarkdown(props.content));
</script>

<style scoped>
.agent-markdown { min-width:0; overflow-wrap:anywhere; white-space:normal; font-size:14px; line-height:1.65; }
.agent-markdown :deep(> :first-child) { margin-top:0; }
.agent-markdown :deep(> :last-child) { margin-bottom:0; }
.agent-markdown :deep(p) { margin:0 0 .85em; }
.agent-markdown :deep(ul), .agent-markdown :deep(ol) { padding-left:1.6em; margin:.6em 0 1em; }
.agent-markdown :deep(li) { margin:.3em 0; }
.agent-markdown :deep(li > p) { margin:.3em 0; }
.agent-markdown :deep(h1), .agent-markdown :deep(h2), .agent-markdown :deep(h3), .agent-markdown :deep(h4), .agent-markdown :deep(h5), .agent-markdown :deep(h6) { line-height:1.35; margin:1.1em 0 .5em; font-size:1.05em; }
.agent-markdown :deep(h1) { font-size:1.3em; }.agent-markdown :deep(h2) { font-size:1.15em; }
.agent-markdown :deep(code) { font-family:Consolas,monospace; font-size:.9em; background:#edf2f6; padding:.12em .3em; border-radius:4px; }
.agent-markdown :deep(pre) { max-width:100%; overflow-x:auto; white-space:pre; padding:12px; background:#edf2f6; border-radius:8px; }
.agent-markdown :deep(pre code) { background:none; padding:0; }
.agent-markdown :deep(blockquote) { margin:.8em 0; padding-left:12px; border-left:3px solid #c7d7e6; color:#65798c; }
.agent-markdown :deep(table) { display:block; max-width:100%; overflow-x:auto; border-collapse:collapse; margin:.8em 0; font-size:.9em; }
.agent-markdown :deep(th), .agent-markdown :deep(td) { border:1px solid #dce3eb; padding:6px 9px; }
.agent-markdown :deep(hr) { border:0; border-top:1px solid #dce3eb; margin:1em 0; }
.agent-markdown :deep(.agent-markdown-link) { text-decoration:underline dotted; text-underline-offset:3px; }
</style>
