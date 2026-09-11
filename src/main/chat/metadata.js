const metadataGroups = (
  item,
  groups,
  { tags, people, locations, locationPath },
) => {
  const c = item.Customization,
    output = {};
  if (groups.basic)
    Object.assign(output, {
      title: c.Title,
      description: c.Description,
      tags: (c.TagIds || []).map((id) => tags.get(id)?.Text || ""),
    });
  if (groups.hidden) output.hidden = c.HiddenDescription;
  if (groups.people)
    output.people = (c.PersonIds || []).map((id) => people.get(id)?.Name || "");
  if (groups.location)
    output.location = {
      ...item.Location,
      gps: item.GPS || null,
      path: item.Location?.LocationId
        ? locationPath(item.Location.LocationId)
        : "",
      definition: item.Location?.LocationId
        ? locations.get(item.Location.LocationId)
        : null,
    };
  if (groups.technical)
    output.technical = {
      fileSystem: item.FileSystem,
      picture: item.Picture || null,
      video: item.Video || null,
      camera: item.Camera || null,
    };
  return JSON.parse(JSON.stringify(output));
};
module.exports = { metadataGroups };
