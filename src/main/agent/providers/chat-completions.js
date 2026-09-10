const { setTimeout: delay } = require("node:timers/promises");
async function chatCompletion(profile, { messages, tools = [], signal, budget, onText = () => {}, stream = true, maxTokens = 4096, newImageCount }, fetcher = fetch) {
  if (!profile.supportsTools && tools.length) throw new Error("This profile does not support tools");
  const images = messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(c => c.type === "image_url").length;
  if (images && !profile.supportsImages) throw new Error("This profile does not support images");
  const estimate = Buffer.byteLength(JSON.stringify(messages.map(m => ({...m,content: Array.isArray(m.content) ? m.content.filter(c=>c.type!=="image_url") : m.content})))) + images*1600;
  if (estimate > 24000 || images > 8) throw new Error("Model context budget exceeded; start a shorter turn");
  const body = JSON.stringify({ model: profile.model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}), stream: stream && profile.streaming, temperature: 0.2, max_tokens: maxTokens, ...profile.providerOptions });
  if (Buffer.byteLength(body)>16*1024*1024) throw new Error("Model payload too large");
  let response;
  for (let attempt=0;attempt<3;attempt++) {
    budget?.reserve({imageCount:attempt?0:newImageCount??images,cost:budget.estimate(estimate,maxTokens)});
    response = await fetcher(profile.baseUrl.replace(/\/$/,"")+"/chat/completions",{ method:"POST",redirect:"error",headers:{"Content-Type":"application/json",...(profile.apiKey?{Authorization:`Bearer ${profile.apiKey}`}:{})},body,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000) });
    if (![429,502,503,504].includes(response.status) || attempt===2) break;
    await response.body?.cancel(); await delay(attempt?5000:2000,undefined,{signal});
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Model request failed (HTTP ${response.status})`); }
  if (!(stream && profile.streaming)) {
    const raw=await response.text(); if(raw.length>4*1024*1024)throw new Error("Model output too large");
    const json=JSON.parse(raw),message=json.choices?.[0]?.message;
    if(!message)throw new Error("Invalid model response");
    if(["length","content_filter"].includes(json.choices[0].finish_reason))throw new Error("Model output did not complete; tools were not executed");
    return message;
  }
  const decoder=new TextDecoder();let buffer="",content="",size=0,finished=false,incomplete=false;const calls=new Map();
  function line(value){
    if(!value.startsWith("data:"))return;
    const data=value.slice(5).trim();if(data==="[DONE]"){finished=true;return;}if(!data)return;
    const object=JSON.parse(data),delta=object.choices?.[0]?.delta||{};
    if(["length","content_filter"].includes(object.choices?.[0]?.finish_reason))incomplete=true;
    if(typeof delta.content==="string"){content+=delta.content;onText(delta.content);}
    for(const part of delta.tool_calls||[]){
      if(!Number.isInteger(part.index)||part.index<0||part.index>=4)throw new Error("Too many model tools");
      const call=calls.get(part.index)||{id:"",type:"function",function:{name:"",arguments:""}};
      if(part.id)call.id=part.id;if(part.function?.name)call.function.name+=part.function.name;
      if(part.function?.arguments)call.function.arguments+=part.function.arguments;
      if(call.function.arguments.length>65536)throw new Error("Model tool arguments too large");calls.set(part.index,call);
    }
  }
  for await(const chunk of response.body){
    signal?.throwIfAborted();size+=chunk.length;if(size>4*1024*1024)throw new Error("Model output too large");
    buffer+=decoder.decode(chunk,{stream:true});let end;
    while((end=buffer.indexOf("\n"))>=0){line(buffer.slice(0,end).replace(/\r$/,""));buffer=buffer.slice(end+1);}
  }
  buffer+=decoder.decode();if(buffer.trim())line(buffer);
  if(!finished||incomplete)throw new Error("Model stream ended before completion; tools were not executed");
  const tool_calls=[...calls.values()];
  for(const call of tool_calls){if(!call.id||!call.function.name)throw new Error("Incomplete tool call");JSON.parse(call.function.arguments);}
  return {role:"assistant",content,...(tool_calls.length?{tool_calls}:{})};
}
module.exports={chatCompletion};
