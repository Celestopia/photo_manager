<template>
  <template
    v-for="step in message.attempt?.steps || []"
    :key="step.id || step.callId"
  >
    <div
      v-if="step.kind === 'completion' && step.text"
      class="chat-markdown"
      @click="citationClick($event, step.id)"
      v-html="renderChatMarkdown(step.text, sourcesBefore(session, message, step.id))"
    ></div>
    <p v-if="step.kind === 'completion' && message.status === 'executing' && pendingWebCall(step)" class="chat-notice" role="status">{{ pendingWebCall(step).name === 'web_search' ? 'Searching the web…' : 'Reading a source…' }}</p>
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
        <template v-else-if="step.outcome.provider === 'tavily'">
          <p v-if="callQuery(step.callId)">{{ callQuery(step.callId) }}</p>
          <p v-if="step.outcome.sources && !step.outcome.sources.length">No usable public sources found.</p>
          <div v-for="source in step.outcome.sources || []" :key="source.sourceId" class="chat-web-source">
            <button type="button" @click="openSource(source.sourceId)">{{ source.title || source.url }}</button>
            <small>{{ sourceHost(source.url) }}</small><p>{{ source.excerpt }}</p>
          </div>
          <p v-if="step.outcome.text" class="chat-web-text">{{ step.outcome.text }}</p>
          <small v-if="step.outcome.truncated">Content shortened to fit the request limits.</small>
          <small v-if="step.outcome.discardedCount">{{ step.outcome.discardedCount }} sources omitted.</small>
          <small>Reported web credits: {{ step.outcome.credits ?? 'unknown' }}</small>
        </template>
        <p v-else-if="step.outcome.status === 'proposal_created'">
          Prepared for review. No metadata has been saved by the tool.
        </p>
        <p v-else>Tool completed.</p>
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
  <details v-if="ownSources.length" class="chat-tool-activity chat-source-list"><summary>Sources · {{ ownSources.length }}</summary>
    <div v-for="source in ownSources" :key="source.sourceId" class="chat-web-source"><button type="button" @click="openSource(source.sourceId)">{{ source.title || source.url }}</button><small>{{ sourceHost(source.url) }}</small></div>
  </details>
  <small v-if="webUsage(message)" class="chat-web-usage">{{ webUsage(message) }}</small>
</template>
<script setup>
import { inject, computed } from "vue";
import { fieldLabel, tagName, value, statusLabel, outcomeLabel, toolLabel } from "../domain/chat-tools.mjs";
import { CHAT_CONTEXT } from "../context/renderer-contexts";
import { renderChatMarkdown } from "../domain/chat-markdown.mjs";
import { sourcesBefore, webUsage } from '../domain/chat-sources.mjs';
const props = defineProps({
  message: Object,
  proposals: Array,
  previews: Object,
});
const { busy, working, decideProposal, reviewBlocked, session, openSource } = inject(CHAT_CONTEXT);
const ownSources = computed(() => (props.message.attempt?.steps || []).flatMap(s => s.kind === 'tool' ? s.outcome.sources || [] : []));
const sourceHost = url => { try { return new URL(url).hostname; } catch { return ''; } };
function citationClick(event, stepId) {
  const button = event.target.closest('button[data-source-id]');
  if (button && event.currentTarget.contains(button) && sourcesBefore(session.value, props.message, stepId).some(s => s.sourceId === button.dataset.sourceId)) void openSource(button.dataset.sourceId);
}
function callQuery(id) {
  const call = (props.message.attempt?.steps || []).flatMap(s => s.calls || []).find(c => c.id === id && c.name === 'web_search');
  try { return call ? JSON.parse(call.arguments).query : ''; } catch { return ''; }
}
function pendingWebCall(step) {
  const call = step.calls.find(c => !props.message.attempt.steps.some(s => s.kind === 'tool' && s.callId === c.id));
  return ['web_search', 'read_web_page'].includes(call?.name) ? call : null;
}
</script>
