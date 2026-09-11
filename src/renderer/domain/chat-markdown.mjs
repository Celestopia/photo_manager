import MarkdownIt from "markdown-it";
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
// Images and links are displayed without fetching assets or navigating the Electron window.
md.renderer.rules.image = (tokens, index) =>
  md.utils.escapeHtml(`[Image: ${tokens[index].content}]`);
md.renderer.rules.link_open = () => '<span class="chat-link">';
md.renderer.rules.link_close = () => "</span>";
export const renderChatMarkdown = (text) => md.render(String(text || ""));
