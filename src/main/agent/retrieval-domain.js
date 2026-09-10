const {exact,text}=require("../../shared/agent-schema");
const {validateTree,evaluateTree}=require("./query-predicates");
function validateQueryPlan(plan){
  exact(plan,["visualQuery","descriptiveQuery","contextualQuery","predicates"]);
  for(const k of ["visualQuery","descriptiveQuery","contextualQuery"])text(plan[k],400,k);
  validateTree(plan.predicates);
  return plan;
}
function evaluatePredicates(item,plan,registries){return evaluateTree(item,plan.predicates,registries);}
function lexicalTokens(value){const normalized=value.normalize("NFC").toLowerCase();const words=normalized.match(/\p{Script=Han}+|[\p{L}\p{N}]+/gu)||[];return words.flatMap(w=>{const chars=[...w];return /^\p{Script=Han}+$/u.test(w)&&chars.length>1?chars.slice(0,-1).map((c,i)=>c+chars[i+1]):[w];});}
function bm25(documents,query){
  const q=[...new Set(lexicalTokens(query))];if(!q.length)return new Map();
  const docs=documents.map(d=>({...d,tokens:lexicalTokens(d.text)}));const avg=docs.reduce((n,d)=>n+d.tokens.length,0)/Math.max(1,docs.length)||1;
  const df=new Map(q.map(t=>[t,docs.filter(d=>d.tokens.includes(t)).length]));
  return new Map(docs.map(d=>[d.id,q.reduce((sum,t)=>{const f=d.tokens.filter(x=>x===t).length;return sum+Math.log(1+(docs.length-df.get(t)+0.5)/(df.get(t)+0.5))*f*2.2/(f+1.2*(0.25+0.75*d.tokens.length/avg));},0)]));
}
module.exports={validateQueryPlan,evaluatePredicates,bm25,lexicalTokens};
