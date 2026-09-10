const {resolveApplicationPaths}=require("./application-paths");
const {createModelAssets}=require("../src/main/agent/model-assets");
async function main(){
  const args=process.argv.slice(2);if(args.length!==1||!["--status","--download"].includes(args[0]))throw new Error("Usage: node scripts/agent-models.js --status|--download");
  const assets=createModelAssets(resolveApplicationPaths().agentModelsDir);
  let last=0;
  const result=args[0]==="--download"?await assets.install({onProgress:p=>{if(Date.now()-last>5000){console.log(`${p.model} ${p.file}: ${Math.round(p.completed/p.total*100)}%`);last=Date.now();}}}):await assets.status();
  console.log(JSON.stringify(result,null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
