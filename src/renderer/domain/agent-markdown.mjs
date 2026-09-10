import MarkdownIt from 'markdown-it';

// Model output is untrusted. Keep raw HTML disabled and never create network
// assets or navigation from a generated reply. Do not add HTML-enabled plugins.
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content || 'Image');
markdown.renderer.rules.link_open = (tokens, index) => {
  const destination = markdown.utils.escapeHtml(tokens[index].attrGet('href') || '');
  return `<span class="agent-markdown-link" title="${destination}">`;
};
markdown.renderer.rules.link_close = () => '</span>';

export function renderAgentMarkdown(content) {
  return markdown.render(typeof content === 'string' ? content : '');
}
