const { fingerprint } = require("../../shared/agent-schema");
function projectMetadata(item, registries) {
  const c=item.Customization||{}, location=item.Location||{};
  const line=(name,value)=>value?`${name}: ${JSON.stringify(String(value).normalize("NFC").replace(/\r\n/g,"\n").replace(/[\t ]+/g," ").trim())}`:"";
  const assigned=(ids,map,name)=>[...(ids||[])].sort().flatMap(id=>{const r=map?.get(id);return r?[line(name,r.Text||r.Title||r.Name),line(`${name} description`,r.Description)]:[];});
  const ancestors=[];const visited=new Set();let id=location.LocationId;
  while(id){if(visited.has(id))throw new Error("Location cycle");visited.add(id);const r=registries.locations?.get(id);if(!r)break;ancestors.unshift(r);id=r.ParentId;}
  const description=[line("Title",c.Title),line("Description",c.Description),line("Hidden description",c.HiddenDescription),...assigned(c.TagIds,registries.tags,"Tag")].filter(Boolean).join("\n");
  const context=[...assigned(c.PersonIds,registries.people,"Assigned person"),...assigned(c.AlbumId?[c.AlbumId]:[],registries.albums,"Album"),...ancestors.flatMap(r=>[line("Location",[r.Country,r.Province,r.City,r.Name].filter(Boolean).join(" / ")),line("Location description",r.Description)]),line("Location detail",location.Detail),line("Relative file path",item.FilePath)].filter(Boolean).join("\n");
  return {description,context,fingerprint:fingerprint({description,context,version:1})};
}
function selectedMetadata(item, registries, groups) {
  const allowed=new Set(groups),c=item.Customization||{};
  const result={MediaId:item.MediaId};
  if(allowed.has("basic"))Object.assign(result,{FilePath:item.FilePath,type:item.FileSystem?.FileType,title:c.Title,description:c.Description,tags:(c.TagIds||[]).map(id=>({id,text:registries.tags.get(id)?.Text})),album:c.AlbumId?registries.albums.get(c.AlbumId)?.Title:null,shootingTime:item.FileSystem?.ShootingTimeString});
  if(allowed.has("hidden"))result.hiddenDescription=c.HiddenDescription;
  if(allowed.has("people"))result.people=(c.PersonIds||[]).map(id=>registries.people.get(id));
  if(allowed.has("location"))Object.assign(result,{location:item.Location,locationDefinition:registries.locations.get(item.Location?.LocationId),GPS:item.GPS});
  if(allowed.has("technical"))Object.assign(result,{FileSystem:item.FileSystem,Camera:item.Camera,Picture:item.Picture,Video:item.Video});
  return result;
}
module.exports={projectMetadata,selectedMetadata};
