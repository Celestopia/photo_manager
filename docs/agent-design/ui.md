# Assistant Interface Specification

Part of the [agent design](README.md). Current runtime behavior and remaining implementation gaps are recorded in the [runtime reference](../reference/agent-support.md).

## Conversation and composer

Use the application's English interface, light palette and existing typography. Replies follow the user's language. Keep the viewer's 400px and gallery's 420px Assistant sidebar. The sidebar is a flex column: compact header, scrollable conversation, fixed bottom composer. Avoid a form-like checklist in the chat surface.

- Header: Assistant, New chat icon and Close icon, with accessible names/tooltips.
- Gallery only: compact Find media / Selected items switch. Verification is entered from selected search results, not a technical mode dropdown.
- Empty conversation: short welcome question and suggestions. Suggestions populate the composer; they never send automatically.
- Transcript: user bubbles and streamed assistant text. Batch replies identify their media without repeating the same user bubble for every item.
- Composer: growing textarea, Options button and Send arrow. Enter sends, Shift+Enter adds a newline, IME composition never sends. Stop replaces Send during a run.
- Selection chip: current media thumbnail/title or selected count. Clicking reveals the scope. It never selects additional library files automatically.
- Status: brief text such as Searching your library, Thinking, or Analyzing 3 of 12. Do not display raw progress objects or token/IPC internals.
- Scroll follows new output while the user remains near the bottom; scrolling up preserves their reading position.

New chat clears model history and displayed replies for the selected media. Pending metadata suggestions are retained and a notice explains that they still require review. Closing the sidebar does not silently save or discard drafts.

## One-action Send

Send immediately prepares a main-owned scope snapshot and dispatches the message. It captures the request, selected files, provider, enabled metadata groups and tag-removal preference together. A changed or expired scope rejects dispatch. Prevent duplicate clicks while preparation or a run is active.

No mandatory preview or second Send confirmation. Optional View shared context remains in Options. Opening that inspection never transmits content. Every Send creates a fresh snapshot even if an earlier inspection exists.

Only enabled metadata groups are shared: Basic information by default; Location, People, Private notes and Technical details opt-in. Hidden controls must not silently expand these defaults. Local embeddings and ordinary search still never upload library media. Query planning transmits typed search text only. Selected visual analysis requires a separate explicit Send action.

## Composer Options

The compact popover closes on outside click or Escape. It contains:

- Provider/model label.
- Shared context: metadata group choices, under a disclosure.
- Tag changes: add by default; allow replacing/removing only when explicitly enabled.
- View shared context: selected filenames, derivative/frame bounds, enabled groups and destination.
- Assistant settings: opens a separate modal, never replaces the transcript.

In Find media mode, Options contains current-gallery/whole-library scope, local-only search and advanced search details. Query plans and reduced-index diagnostics are hidden under a disclosure. Raw similarity scores remain hidden.

## Natural-language editing

No Propose metadata checkbox. An ordinary question receives an answer; an explicit request to change title, description or tags may produce a Suggested changes card. The agent may look up existing tags for tagging requests without a separate catalogue checkbox. The model must not query the catalogue for unrelated image descriptions. No tag creation, person editing or direct model writes are added.

Cards show previous and proposed values, field selection, editable proposed text and tag choices. Viewer Use changes merges accepted fields into the current draft; normal Save persists it. Show an explicit replacement checkbox only for an actual overlapping manual draft conflict. Gallery Apply changes and Apply all reviewed fields use the existing atomic transaction. Review is never removed by simplifying Send.

Completed results/proposals survive Stop. Continue processes unfinished items in bounded windows (100 chat/edit, 40 verification) without a second preview step. No automatic continuation or partial metadata commit.

## Search results and settings

Render thumbnail candidates in the conversation, grouped into Matches, Supported by metadata, Unknown location or date, Conflicting evidence and Possible matches. Find more expands the frozen original search. Analyze selected and Suggest changes act only on explicit selections. Additional evidence presentation and result paging remain governed by the retrieval acceptance requirements.

Assistant settings is a focused modal with a close control, Escape handling and native modal focus containment. It holds provider configuration/reload/synthetic test, local model download/import, index build/resume/rebuild, budgets/retention and edit history. No model tests or downloads run merely by opening it. Credentials remain in machine-local configuration and never appear in renderer payloads.

History exposes recorded before/after fields before Undo. Retain conditional all-or-nothing undo, expiry and conflict handling. Advanced index diagnostics, evidence sheets and complete paginated history remain tracked in [validation](validation.md); the simplified shell does not imply those gates are complete.
