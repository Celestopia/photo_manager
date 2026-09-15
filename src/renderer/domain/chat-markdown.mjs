import MarkdownIt from "markdown-it";
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
// Images and links are displayed without fetching assets or navigating the Electron window.
md.renderer.rules.image = (tokens, index) =>
  md.utils.escapeHtml(`[Image: ${tokens[index].content}]`);
md.renderer.rules.link_open = () => '<span class="chat-link">';
md.renderer.rules.link_close = () => "</span>";
md.inline.ruler.before('link', 'source_citation', (state, silent) => {
  const match = /^\[source:([0-9a-f-]{36})\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  const index = (state.env.sources || []).findIndex(s => s.sourceId === match[1]);
  if (index < 0) return false;
  if (!silent) {
    const token = state.push('source_citation', '', 0);
    token.meta = { source: state.env.sources[index], number: index + 1 };
  }
  state.pos += match[0].length;
  return true;
});
md.renderer.rules.source_citation = (tokens, index) => {
  const { source, number } = tokens[index].meta;
  return `<button type="button" class="chat-source-citation" data-source-id="${md.utils.escapeHtml(source.sourceId)}" aria-label="Open source ${number}: ${md.utils.escapeHtml(source.title)}">[${number}]</button>`;
};
export const renderChatMarkdown = (text, sources = []) => md.render(String(text || ''), { sources });
