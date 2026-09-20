<template>
  <Teleport to="body">
    <dialog ref="dialog" class="retrieval-dialog" aria-labelledby="retrieval-title" @cancel.prevent="visible=false" @keydown.stop>
      <section class="chat-panel">
        <header class="chat-header">
          <strong id="retrieval-title">Gallery Assistant</strong>
          <div><TokenUsage label="Conversation token usage" :usage="usage.usage" :incomplete="usage.incomplete" />
            <button class="btn" title="Provider settings" aria-label="Provider settings" @click="openSettings"><ChatIcon name="gear" /></button>
            <button class="btn" title="New chat" aria-label="New chat" :disabled="working" @click="control('new')"><ChatIcon name="plus" /></button>
            <button class="btn" title="Close Gallery Assistant" aria-label="Close Gallery Assistant" @click="visible=false"><ChatIcon name="close" /></button>
          </div>
        </header>
        <p v-if="state.restrictions?.length" class="retrieval-warning" role="status">Existing gallery filters are active. Assistant results will also be restricted by them: {{state.restrictions.join('; ')}}.</p>
        <div ref="conversation" class="chat-conversation" aria-live="polite">
          <div v-if="!state.messages.length" class="chat-empty"><h2>Find media by meaning.</h2><p>Describe scenery, objects, or places. Search uses your manually built local semantic index.</p><small>This conversation is temporary. Closing this panel keeps an active request running.</small></div>
          <article v-for="message in state.messages" :key="message.id" :class="['chat-message',message.role]">
            <p v-if="message.role==='user'" class="chat-user-text">{{message.text}}</p>
            <ChatRunContent v-else :message="message" :proposals="[]" :previews="{}" :context="runContext" />
            <p v-if="message.attempt?.error" class="chat-error">{{message.attempt.error}}</p>
            <small v-if="message.role==='assistant' && !['complete','failed','stopped'].includes(message.status)" role="status">{{message.status==='executing'?'Searching local embeddings…':'Replying…'}}</small>
            <ChatMessageActions :message="message" :copied="copied===message.id" @copy="copy" />
          </article>
        </div>
        <p v-if="error" class="chat-error" role="alert">{{error}}</p>
        <div class="chat-composer"><div class="chat-composer-box">
          <ChatTextInput ref="input" v-model="text" :disabled="working" placeholder="For example: sea scenery at Santa Cruz Beach" label="Retrieval request" @keydown="keydown" />
          <div class="chat-row"><label class="semantic-result-count">Results <input type="number" class="input" min="1" max="100" step="1" :value="state.limit || 10" :disabled="working" @change="setLimit(Number($event.target.value))" /></label><small>Closest matches within gallery filters.</small><ChatSendControl :busy="working" :disabled="!text.trim()" @send="send" @stop="stop" /></div>
        </div></div>
      </section>
    </dialog>
  </Teleport>
</template>
<script setup>
import {ref,computed,onMounted,onBeforeUnmount,watch,nextTick} from 'vue';
import ChatIcon from './ChatIcon.vue';
import ChatRunContent from './ChatRunContent.vue';
import ChatMessageActions from './ChatMessageActions.vue';
import ChatTextInput from './ChatTextInput.vue';
import ChatSendControl from './ChatSendControl.vue';
import TokenUsage from './TokenUsage.vue';
import {sessionUsage} from '../domain/chat-usage.mjs';
const props=defineProps({assistant:Object,openSettings:Function});
const {visible,text,error,state,working,copied,send,stop,control,copy,setLimit}=props.assistant;
const dialog=ref(null),conversation=ref(null),input=ref(null);
const usage=computed(()=>sessionUsage(state.value.messages));
const runContext={busy:working,working,session:computed(()=>({messages:state.value.messages})),decideProposal:()=>{},reviewBlocked:()=>true,openSource:()=>{}};
function keydown(event){if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send();}}
onMounted(()=>{dialog.value.showModal();input.value?.focus();});
onBeforeUnmount(()=>dialog.value?.close());
watch(()=>state.value.sequence,async()=>{const el=conversation.value;const near=!el || el.scrollHeight-el.scrollTop-el.clientHeight<140;await nextTick();if(near && conversation.value)conversation.value.scrollTop=conversation.value.scrollHeight;});
</script>
