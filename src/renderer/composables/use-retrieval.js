import { ref, shallowRef, computed, watch, onScopeDispose } from 'vue';
export function useRetrieval({api,libraryState,refresh,copyText}) {
  const visible=ref(false), text=ref(''), error=ref(''), pending=ref(false), copied=ref(null);
  const state=shallowRef({messages:[],working:false,revision:0,sequence:0,semanticQuery:null,limit:10,summary:'',restrictions:[]});
  let copyTimer, generation=0;
  const working=computed(()=>pending.value || state.value.working);
  function accept(value, reload=true) {
    if(!value || value.libraryId!==libraryState.value?.active?.libraryId || value.sequence<=state.value.sequence) return;
    const changed=value.revision!==state.value.revision || (value.resultRevision || 0)!==(state.value.resultRevision || 0);
    state.value=value;
    if(changed && reload) void refresh();
  }
  const unsubscribe=api.onEvent(value=>accept(value));
  async function action(fn) { const epoch=generation;error.value='';try {const result=await fn();if(epoch===generation)accept(result);}catch(e){if(epoch===generation)error.value=e.message;} }
  async function open(){visible.value=true;await action(()=>api.snapshot());}
  async function send(){if(working.value || !text.value.trim())return;const value=text.value, epoch=generation; pending.value=true;await action(()=>api.send(value));if(epoch===generation){if(!error.value)text.value='';pending.value=false;}}
  async function control(name){const epoch=generation;await action(()=>api.control(name));if(epoch===generation && name==='new' && !error.value)text.value='';}
  async function copy(message){try{await copyText(message.text);copied.value=message.id;clearTimeout(copyTimer);copyTimer=setTimeout(()=>{copied.value=null;},1800);}catch{error.value='Unable to copy this message.';}}
  watch(()=>libraryState.value?.active?.libraryId,()=>{generation++;visible.value=false;text.value=error.value='';pending.value=false;state.value={messages:[],working:false,revision:0,sequence:0,semanticQuery:null,limit:10,summary:'',restrictions:[]};});
  onScopeDispose(()=>{unsubscribe();clearTimeout(copyTimer);});
  return {visible,text,error,state,working,copied,accept,open,send,control,copy,setLimit:value=>action(()=>api.setLimit(value)),stop:()=>action(()=>api.stop())};
}
