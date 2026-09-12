# Using the Chat Panel

This page describes the implemented viewer chat interface. Start with the [feature overview](README.md); processing rules are explained next in [Preparing inputs](inputs.md).

## Open the Panel

The viewer's right sidebar has Metadata and Assistant views. Switching between them preserves the metadata draft. Assistant has three areas:

- A header with New chat, History and Close.
- A scrollable conversation.
- A bottom composer with an input box, attachment tiles, Attach, Options, Send and Stop.

Keep interface controls English. Replies follow the user's language, with Chinese as the default when the language is unspecified. Suggestions in an empty conversation fill the input box without sending anything.

New chat prepares an independent draft with the current media attached. A conversation enters History only after its first user message is saved, including text-only or attachment-only submissions. New chat discards an unstarted draft and its imported copies; submitted conversations remain saved. Closing and reopening Assistant on the same media preserves the current draft or conversation.

## Add and Review Inputs

Each attachment is a 40px square tile in a horizontal row inside the composer, above the text box. Images show a local thumbnail; text files show a file icon and extension. The filename is available on hover and through accessible labels. A top-right remove button replaces the expandable details view. Users can paste supported images/files, use Attach to choose them, or choose + → Add current media to reference the photo or video currently displayed.

Navigating to another media item stops and saves any active reply, discards unsent composer content and prepares a fresh draft with the new media attached. This also applies when Assistant is closed: reopening uses the newly viewed media. Resume a previous conversation explicitly through History; loading it does not attach the current media automatically.

Reject unsupported files before completing their import. Explain that PDF, Office documents, archives, audio and external video attachments are not supported yet. Do not imply that the model has read a rejected file.

## Set Image Quality

Options includes an Image quality choice for the message:

| Choice | What PhotoManager sends |
| --- | --- |
| Optimized for chat | A smaller image, corrected for orientation and color, at most 1,024 pixels on its long edge. This is the default. |
| Original file | The unchanged static-image file, without resizing, recompression or metadata removal. |

The message choice applies to library static images. Imported static images initially follow it, but each imported image can override the choice in Message options. Later changes to the message setting update only library images and imported images without an override.

After a successful submission, the next message defaults to Optimized for chat. A failed unsent message keeps its choices. Retrying a submitted message keeps that message's recorded choices and creates another attempt.

When any input uses Original file, show this notice beside the composer before Send:

> Original file: larger upload and provider-dependent limits.

Tiles do not show dimensions or file sizes. Processing provenance remains stored in session history without a technical-details UI. Original files can contain embedded metadata and the provider may resize or process the upload. Do not silently change Original file to optimized mode if a limit is exceeded.

## Explain Video and GIF Processing Before Send

Video and animated-GIF tiles carry Video or GIF badges; sampling notices remain visible above the composer. They do not offer Original file mode.

Show these notices beside the composer while the corresponding input is present:

> Video: sent as up to N sampled frames, without audio. Events between frames may be missed.

> Animated GIF: sent as up to N sampled frames from one animation cycle. Motion between frames may be missed.

N changes when the attachment selection changes. The [input rules](inputs.md) explain how frames share the request limit. After sending, session records retain the actual number and timestamps used. The model also receives a description of the sampling limitation.

These notices are visible without opening Options. They explain the processing without adding another confirmation step.

## Choose Metadata and Send

Options lets users choose which saved PhotoManager metadata accompanies library media. Title, description and assigned tag names are enabled by default. Location, people, hidden description and technical details are opt-in. Unsaved metadata drafts are not included.

These choices control the extra metadata supplied by PhotoManager. They cannot remove metadata embedded in an Original file upload without changing its bytes; the original-upload explanation must make that clear.

Send dispatches in one action. Enter sends, Shift+Enter inserts a newline, and typing with a Chinese IME never sends before composition is complete. Only one model request can run at a time.

The assistant reply streams into the conversation and renders Markdown. User messages remain plain text. Rendering a reply must not execute HTML or automatically load remote images. Stop keeps the text received so far and marks it Stopped. After a crash, unfinished text is marked Interrupted. Errors explain what the user can do next without showing keys, encoded image payloads or raw server responses.

## Reopen History

History shows all conversations in the active library, ordered by latest activity. Each entry has a title, a compact date and a short excerpt. Its three-dot menu exposes Rename and Delete; Rename opens an inline editor for that conversation. Offer a Current media filter, plus reopen, rename and delete actions.

Use the first nonempty user message as the initial title; if there is none, use the first attachment name. Reopening continues that session without automatically adding the media currently in the viewer.

The full saved conversation remains readable even when it is too large to send back to the model. Show a notice when older turns are omitted from a request. If a referenced file or its supplied metadata changed, ask the user to start a new conversation to use the current version. If a required source is missing, ask the user to restore it or start a new conversation. The menu does not expose historical-input exclusion or change-acceptance controls.

Deleting a session requires confirmation because its imported files are deleted too and chat is not backed up. If file cleanup is still pending, show that status rather than reporting complete deletion.

## Configure the Model Separately

The header gear opens a centered modal provider settings dialog over the application. Users edit Base URL, Model and API key directly, then choose Save settings. Advanced options contain environment-variable fallback and model thinking. A blank key preserves the stored credential; stored keys never return to the renderer. Test connection uses the saved settings and a synthetic image. Opening or saving settings makes no network request. Escape or Close dismisses the dialog; keyboard focus stays inside while it is open.

The configuration accepts a base URL, API key or environment-variable name, model and optional thinking setting. The [implementation page](implementation.md) defines its location and transport rules. The model has no file-reading, registry-search or metadata-editing tools in this release.

## Visual Presentation

The Assistant uses a compact segmented view switch, neutral colors, consistent SVG icon buttons and a rounded composer. The text box grows with the draft, up to a fixed height. Header and composer icons have accessible names and tooltips. User messages use light bubbles; assistant Markdown occupies the conversation directly. Sent attachments appear as the same 40px preview tiles used by the composer, without removal controls. Reopened conversations regenerate local previews; missing or unreadable sources show a file tile with the saved filename available on hover.

Each nonempty user or assistant message has a Copy button. It copies the original message text, preserving assistant Markdown, and briefly shows a checkmark. Upload processing records remain stored without a technical-details button. Raw media UUIDs do not appear in the transcript. Original-file and video/GIF sampling notices remain visible before sending. Options contains image quality and directly visible metadata checkboxes, with no earlier-input controls; provider configuration stays in its separate settings view.

The composer’s + button opens upward with Add current media and Add text or image files. Provider settings is opened by the header gear. Message options contains only image quality and directly visible saved-metadata choices.

Provider settings is also available from the gallery gear menu as **LLM Provider Settings**. Both entry points open the same application-level dialog; opening it from the gallery does not create a conversation or submit media.

Test connection is a secondary action, disabled while settings have unsaved changes. Progress, success and failure appear in a floating banner without shifting the form. Remove saved key appears beside the key field only when a key exists; it marks the local copy for removal on Save settings and offers Undo removal. It does not revoke the provider credential.

Provider feedback uses dismissible floating banners in the modal top layer, preserving form layout. Connection tests show Testing, Connection successful or Connection failed rather than the model’s raw description. Key removal and Undo remain right-aligned beneath the key field.

Completed provider banners dismiss manually or after 10 seconds; progress stays visible while an operation runs. New notifications restart the timeout, and closing the dialog clears it. Floating interactive banners explicitly disable Electron window dragging so title-bar overlap cannot swallow clicks.

History cards expose a pencil Rename button and red bin Delete button directly at the right edge, with tooltips and keyboard focus indicators. Renaming acts on the selected card without switching the active conversation; deletion retains its confirmation.
