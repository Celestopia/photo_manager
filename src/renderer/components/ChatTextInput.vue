<template>
  <textarea ref="element" rows="2" :value="modelValue" :placeholder="placeholder" :aria-label="label" :disabled="disabled"
    @input="$emit('update:modelValue',$event.target.value)" @paste="$emit('paste',$event)" @keydown="$emit('keydown',$event)"></textarea>
</template>
<script setup>
import {ref,watch,nextTick} from 'vue';
const props=defineProps({modelValue:String,disabled:Boolean,placeholder:{type:String,default:'Message Assistant…'},label:{type:String,default:'Message Assistant'}});
defineEmits(['update:modelValue','paste','keydown']);
const element=ref(null);
watch(()=>props.modelValue,async()=>{await nextTick();if(element.value){element.value.style.height='auto';element.value.style.height=Math.min(element.value.scrollHeight,160)+'px';}});
defineExpose({focus:()=>element.value?.focus()});
</script>
