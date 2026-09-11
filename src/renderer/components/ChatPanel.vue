<template>
  <section class="chat-panel" aria-label="Assistant" @keydown.stop @keydown.esc="attachmentsOpen = false; options = false; settings = false; detailMessage = null">
    <header class="chat-header">
      <span class="chat-heading">{{ historyOpen ? "Conversations" : "Assistant" }}</span>
      <div>
        <button class="btn" title="Provider settings" aria-label="Provider settings" @click="attachmentsOpen = false; showSettings()"><ChatIcon name="gear" /></button>
        <button
          class="btn"
          title="New chat"
          aria-label="New chat"
          :disabled="working"
          @click="newChat"
        >
          <ChatIcon name="plus" />
        </button>
        <button
          class="btn"
          title="History"
          aria-label="History"
          @click="showHistory"
        >
          <ChatIcon name="history" />
        </button>
        <button
          class="btn"
          title="Close Assistant"
          aria-label="Close Assistant"
          @click="close"
        >
          <ChatIcon name="close" />
        </button>
      </div>
    </header>
    <div v-if="historyOpen" class="chat-history">
      <div class="chat-row">
        <strong class="chat-section-label">Saved chats</strong
        ><button class="btn" @click="historyOpen = false">Back</button>
      </div>
      <label
        ><input type="checkbox" v-model="currentOnly" /> Current media
        only</label
      >
      <p v-if="!filteredHistory.length">No saved conversations.</p>
      <article
        v-for="row in filteredHistory"
        :key="row.sessionId"
        class="chat-history-item"
      >
        <button
          class="chat-history-open"
          :disabled="Boolean(row.error) || working"
          @click="load(row.sessionId)"
        >
          <strong>{{ row.title }}</strong
          ><small>{{
            row.updatedAt ? new Date(row.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""
          }}</small
          ><span>{{ row.error || row.excerpt }}</span>
        </button>
        <details v-if="!row.error" class="chat-history-menu">
          <summary aria-label="Conversation actions" title="Conversation actions"><ChatIcon name="more" /></summary>
          <div class="chat-history-actions">
            <button class="btn" :disabled="working" @click="renameId = row.sessionId; renameTitle = row.title">Rename</button>
            <button class="btn chat-danger" :disabled="working" @click="removeSession(row.sessionId)">Delete</button>
          </div>
        </details>
        <form v-if="renameId === row.sessionId" class="chat-rename" @submit.prevent="rename(row.sessionId); renameId = null">
          <input class="input" v-model="renameTitle" aria-label="Conversation title" required maxlength="200" />
          <button class="btn" :disabled="working || !renameTitle.trim()">Save</button>
          <button class="btn" type="button" @click="renameId = null">Cancel</button>
        </form>
      </article>
    </div>
    <div
      v-else
      ref="conversationElement"
      class="chat-conversation"
      aria-live="polite"
      aria-relevant="additions text"
    >
      <div v-if="!session?.messages.length" class="chat-empty">
        <div class="chat-empty-icon"><ChatIcon name="chat" /></div><h2>A closer look.</h2><p>Ask a question about your photo or video.</p>
        <button
          class="btn"
          @click="text = 'Please introduce this photo for me.'"
        >
          Introduce this photo
        </button>
      </div>
      <article
        v-for="m in session?.messages || []"
        :key="m.id"
        :class="['chat-message', m.role]"
      >
        <div
          v-if="m.role === 'assistant'"
          class="chat-markdown"
          v-html="renderChatMarkdown(m.text)"
        ></div>
        <p v-else class="chat-user-text">{{ m.text }}</p>
        <div v-if="m.inputs.length" class="chat-sent-inputs">
          <span v-for="i in m.inputs" :key="i.kind + i.id" :title="session.inputLabels?.[i.kind + ':' + i.id] || i.kind"><ChatIcon name="file" />{{ session.inputLabels?.[i.kind + ':' + i.id] || i.kind }}</span>
        </div>
        <small v-if="m.status !== 'complete'">{{
          m.status === "pending"
            ? "Preparing inputs…"
            : m.status === "streaming"
              ? "Replying…"
              : m.status
        }}</small>
        <p v-if="m.attempt?.notice" class="chat-notice">
          {{ m.attempt.notice }}
        </p>
        <p v-if="m.attempt?.error" class="chat-error">{{ m.attempt.error }}</p>
        <button v-if="m.attempt?.inputs.length" class="chat-message-info" title="Message details" aria-label="Message details" @click="detailMessage = m"><ChatIcon name="info" /></button>
        <button
          v-if="
            m.role === 'assistant' &&
            ['failed', 'stopped', 'interrupted'].includes(m.status)
          "
          class="btn"
          :disabled="busy || working"
          @click="retry(m)"
        >
          Retry
        </button>
      </article>
    </div>
    <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="chat-notice">
      {{ notice }}
      <button
        class="chat-dismiss"
        @click="notice = ''"
        aria-label="Dismiss notice"
      >
        ×
      </button>
    </p>
    <div v-if="!historyOpen" class="chat-composition">
      <p v-if="inputLimitError" class="chat-error">{{ inputLimitError }}</p>
      <div class="chat-attachments">
        <details
          v-for="(i, n) in inputs"
          :key="i.kind + i.id"
          class="chat-chip"
        >
          <summary>
            {{ i.name }}
            <span v-if="['gif', 'video'].includes(i.mediaKind)"
              >· Sampled frames</span
            >
          </summary>
          <p>
            {{ formatSize(i.size) }} · {{ i.width || "—" }} ×
            {{ i.height || "—" }}
          </p>
          <label v-if="i.kind === 'attachment' && i.mediaKind === 'image'"
            >Image quality
            <select v-model="i.override" :disabled="busy">
              <option value="">Message default</option>
              <option value="optimized">Optimized for chat</option>
              <option value="original">Original file</option>
            </select></label
          >
          <p
            v-if="
              i.mediaKind === 'image' && (i.override || quality) === 'original'
            "
          >
            Unchanged bytes may include embedded metadata. The provider may
            resize or process this file.
          </p>
          <button
            class="btn"
            :disabled="busy || working"
            @click="removeInput(n)"
          >
            Remove
          </button>
        </details>
      </div>
      <p v-if="hasOriginal" class="chat-notice">
        Original file: larger upload and provider-dependent limits.
      </p>
      <template v-for="(i, n) in inputs" :key="i.kind + i.id"
        ><p v-if="i.mediaKind === 'video'" class="chat-notice">
          Video: sent as up to {{ counts[n] }} sampled frames, without audio.
          Events between frames may be missed.
        </p>
        <p v-if="i.mediaKind === 'gif'" class="chat-notice">
          Animated GIF: sent as up to {{ counts[n] }} sampled frames from one
          animation cycle. Motion between frames may be missed.
        </p></template
      >
      <div class="chat-composer">
        <textarea
          ref="composerElement"
          rows="2"
          v-model="text"
          placeholder="Message Assistant…"
          aria-label="Message Assistant"
          :disabled="busy"
          @paste="paste"
          @keydown="keydown"
        ></textarea>
        <div class="chat-row">
          <div>
            <button
              class="btn"
              :disabled="busy || working"
              title="Add attachments"
              aria-label="Add attachments"
              :aria-expanded="attachmentsOpen"
              @click="attachmentsOpen = !attachmentsOpen; options = false"
            >
              <ChatIcon name="plus" /></button
            ><button
              class="btn"
              title="Options"
              aria-label="Options"
              :aria-expanded="options"
              @click="options = !options; attachmentsOpen = false"
            >
              <ChatIcon name="options" />
            </button>
          </div>
          <button v-if="busy" class="btn btn-primary" title="Stop response" aria-label="Stop response" @click="stop"><ChatIcon name="stop" /></button
          ><button
            v-else
            class="btn btn-primary"
            title="Send message"
            aria-label="Send message"
            :disabled="
              working ||
              Boolean(inputLimitError) ||
              (!text.trim() && !inputs.length)
            "
            @click="send()"
          >
            <ChatIcon name="send" />
          </button>
        </div>
      </div>
      <div v-if="attachmentsOpen" ref="attachmentMenu" class="chat-attachment-menu" aria-label="Add attachments">
        <button class="btn" :disabled="busy || working" @click="attachmentsOpen = false; addCurrent()"><ChatIcon name="plus" />Add current media</button>
        <button class="btn" :disabled="busy || working" @click="attachmentsOpen = false; attach()"><ChatIcon name="file" />Add text or image files</button>
      </div>
      <div v-if="options" class="chat-options">
        <div class="chat-row">
          <strong>Message options</strong
          ><button
            class="btn"
            @click="options = false"
            aria-label="Close options"
          >
            <ChatIcon name="close" />
          </button>
        </div>
        <label
          >Image quality
          <select v-model="quality" :disabled="busy">
            <option value="optimized">Optimized for chat</option>
            <option value="original">Original file</option>
          </select></label
        >
        <fieldset class="chat-metadata-options">
          <legend>Include saved metadata</legend>
          <label v-for="(label, key) in metadataLabels" :key="key">
            <input type="checkbox" v-model="groups[key]" :disabled="busy" />
            <span>{{ label }}</span>
          </label>
          <small>Saved values only. Original files may also contain embedded metadata.</small>
        </fieldset>
      </div>
    </div>
    <div v-if="detailMessage" class="chat-settings" role="dialog" aria-label="Message details" @keydown.esc="detailMessage = null">
      <div class="chat-row"><strong>Message details</strong><button class="btn" aria-label="Close message details" @click="detailMessage = null"><ChatIcon name="close" /></button></div>
      <p class="chat-notice">Files used to prepare this reply.</p>
      <div v-for="(p, n) in detailMessage.attempt.inputs" :key="n" class="chat-input-detail">
        <strong>{{ session.inputLabels?.[p.kind + ':' + p.id] || 'Attachment' }}</strong>
        <span>{{ p.mode === 'original' ? 'Original file' : 'Optimized for chat' }} · {{ formatSize(p.sourceSize) }} · {{ p.width || '—' }} × {{ p.height || '—' }}</span>
        <span v-for="(u, k) in p.uploads" :key="k">{{ u.transformation }} · {{ u.width }} × {{ u.height }} · {{ formatSize(u.size) }}<template v-if="u.timestamp != null"> · {{ u.timestamp.toFixed(3) }} s</template></span>
      </div>
    </div>
    <ProviderSettings v-if="settings" />
</section>
</template>
<script setup>
import { inject, ref, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import ChatIcon from "./ChatIcon.vue";
import ProviderSettings from "./ProviderSettings.vue";
import { CHAT_CONTEXT } from "../context/renderer-contexts";
import { renderChatMarkdown } from "../domain/chat-markdown.mjs";
const chat = inject(CHAT_CONTEXT);
const {
  session,
  busy,
  working,
  text,
  inputs,
  quality,
  error,
  notice,
  options,
  historyOpen,
  filteredHistory,
  currentOnly,
  settings,
  configuration,
  groups,
  renameTitle,
  counts,
  hasOriginal,
  inputLimitError,
  close,
  newChat,
  addCurrent,
  showHistory,
  load,
  rename,
  removeSession,
  attach,
  paste,
  removeInput,
  send,
  retry,
  stop,
  showSettings,
  reloadConfiguration,
  openConfiguration,
  testConnection,
  keydown,
} = chat;
const metadataLabels = {
  basic: "Title, description and tags",
  location: "Location",
  people: "People",
  hidden: "Hidden description",
  technical: "Technical details",
};
const formatSize = (bytes) =>
  bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + " MiB"
    : Math.ceil(bytes / 1024) + " KiB";
const attachmentsOpen = ref(false);
const attachmentMenu = ref(null);
function dismissAttachments(event) {
  if (!attachmentMenu.value?.contains(event.target) && !event.target.closest('button[aria-label="Add attachments"]')) attachmentsOpen.value = false;
}
onMounted(() => document.addEventListener('pointerdown', dismissAttachments));
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismissAttachments));
watch([historyOpen, busy, () => session.value?.sessionId], () => { attachmentsOpen.value = false; });
const conversationElement = ref(null);
const composerElement = ref(null);
const detailMessage = ref(null);
const renameId = ref(null);
watch(text, async () => {
  await nextTick();
  const el = composerElement.value;
  if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }
});
watch(() => session.value?.sessionId, () => { detailMessage.value = null; renameId.value = null; });
watch(
  () => session.value?.messages.map((m) => m.text).join(""),
  async () => {
    const element = conversationElement.value;
    const nearBottom =
      !element ||
      element.scrollHeight - element.scrollTop - element.clientHeight < 140;
    await nextTick();
    if (nearBottom && conversationElement.value)
      conversationElement.value.scrollTop =
        conversationElement.value.scrollHeight;
  },
);
</script>
