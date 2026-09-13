<template>
  <template
    v-for="step in message.attempt?.steps || []"
    :key="step.id || step.callId"
  >
    <div
      v-if="step.kind === 'completion' && step.text"
      class="chat-markdown"
      v-html="renderChatMarkdown(step.text)"
    ></div>
    <template v-if="step.kind === 'tool'">
      <details class="chat-tool-activity">
        <summary>
          {{ toolLabel(message, step.callId) }} · {{ outcomeLabel(step.outcome) }}
        </summary>
        <p v-if="step.outcome.status === 'error'" class="chat-error">
          {{ step.outcome.message }}
        </p>
        <template v-else-if="step.outcome.tags">
          <p v-if="!step.outcome.tags.length">No matching existing tags.</p>
          <span
            v-for="tag in step.outcome.tags"
            :key="tag.TagId"
            class="chat-result-tag"
            >{{ tag.Text }}</span
          >
        </template>
        <p v-else-if="step.outcome.status === 'no_change'">
          The suggested value is already saved.
        </p>
        <p v-else>
          Prepared for review. No metadata has been saved by the tool.
        </p>
      </details>
      <article
        v-for="p in proposals.filter((p) => p.callId === step.callId)"
        :key="p.id"
        class="chat-proposal"
        :aria-label="`${fieldLabel(p.field)} proposal`"
      >
        <header>
          <img
            v-if="previews['media:' + p.mediaId]?.previewUrl"
            :src="previews['media:' + p.mediaId].previewUrl"
            alt=""
          />
          <div>
            <strong>{{ fieldLabel(p.field) }}</strong
            ><small>{{ p.name }}</small>
          </div>
        </header>
        <dl>
          <dt>Saved when proposed</dt>
          <dd>{{ value(p, p.before) }}</dd>
          <dt>Proposed</dt>
          <dd>{{ value(p, p.after, true) }}</dd>
        </dl>
        <div v-if="p.field === 'TagIds'" class="chat-tag-diff">
          <span
            v-for="id in p.after.filter((id) => !p.before.includes(id))"
            :key="'add' + id"
            >+ {{ tagName(p, id) }}</span
          >
          <span
            v-for="id in p.before.filter((id) => !p.after.includes(id))"
            :key="'remove' + id"
            >− {{ tagName(p, id) }}</span
          >
        </div>
        <small role="status">{{ statusLabel(p.status) }}</small>
        <p
          v-if="p.status === 'pending_review' && reviewBlocked(p)"
          class="chat-notice"
        >
          Save or discard your Metadata edits before accepting.
        </p>
        <div
          v-if="['pending_review', 'stale'].includes(p.status)"
          class="chat-proposal-actions"
        >
          <button
            v-if="p.status === 'pending_review'"
            class="btn btn-primary"
            :disabled="busy || working || reviewBlocked(p)"
            @click="decideProposal(p, 'accept')"
          >
            Accept
          </button>
          <button
            v-else
            class="btn"
            :disabled="busy || working"
            @click="decideProposal(p, 'refresh')"
          >
            Refresh preview
          </button>
          <button
            class="btn"
            :disabled="busy || working"
            @click="decideProposal(p, 'decline')"
          >
            Decline
          </button>
        </div>
      </article>
    </template>
  </template>
</template>
<script setup>
import { inject } from "vue";
import { fieldLabel, tagName, value, statusLabel, outcomeLabel, toolLabel } from "../domain/chat-tools.mjs";
import { CHAT_CONTEXT } from "../context/renderer-contexts";
import { renderChatMarkdown } from "../domain/chat-markdown.mjs";
defineProps({
  message: Object,
  proposals: Array,
  previews: Object,
});
const { busy, working, decideProposal, reviewBlocked } = inject(CHAT_CONTEXT);
</script>
