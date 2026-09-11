# Using the Chat Panel

This page describes the implemented viewer chat interface. Start with the [feature overview](README.md); processing rules are explained next in [Preparing inputs](inputs.md).

## Open the Panel

The viewer's right sidebar has Metadata and Assistant views. Switching between them preserves the metadata draft. Assistant has three areas:

- A header with New chat, History and Close.
- A scrollable conversation.
- A bottom composer with an input box, attachment chips, Attach, Options, Send and Stop.

Keep interface controls English. Replies follow the user's language, with Chinese as the default when the language is unspecified. Suggestions in an empty conversation fill the input box without sending anything.

New chat creates an independent conversation and adds the currently viewed media as a removable input. It does not delete the previous session. Closing Assistant or the viewer also preserves saved history.

## Add and Review Inputs

Each attachment chip represents an input to the next message. It shows its name and offers details and removal. Users can paste supported images/files, use Attach to choose them, or choose + → Add current media to reference the photo or video currently displayed.

Navigating to another media item stops any active reply but keeps the session open. The new media is not attached automatically. This lets the user decide whether to continue discussing the earlier input or add the new one.

Reject unsupported files before completing their import. Explain that PDF, Office documents, archives, audio and external video attachments are not supported yet. Do not imply that the model has read a rejected file.

## Set Image Quality

Options includes an Image quality choice for the message:

| Choice | What PhotoManager sends |
| --- | --- |
| Optimized for chat | A smaller image, corrected for orientation and color, at most 1,024 pixels on its long edge. This is the default. |
| Original file | The unchanged static-image file, without resizing, recompression or metadata removal. |

The message choice applies to library static images. Imported static images initially follow it, but each imported-image chip can override the choice. Later changes to the message setting update only library images and imported images without an override.

After a successful submission, the next message defaults to Optimized for chat. A failed unsent message keeps its choices. Retrying a submitted message keeps that message's recorded choices and creates another attempt.

When any input uses Original file, show this notice beside the composer before Send:

> Original file: larger upload and provider-dependent limits.

Attachment details show its source dimensions and file size, and explain that unchanged bytes can contain embedded metadata. They also explain that the provider may resize or process the upload. Do not silently change Original file to optimized mode if a limit is exceeded.

## Explain Video and GIF Processing Before Send

Video and animated-GIF chips are labelled Sampled frames. They do not offer Original file mode.

Show these notices beside the composer while the corresponding input is present:

> Video: sent as up to N sampled frames, without audio. Events between frames may be missed.

> Animated GIF: sent as up to N sampled frames from one animation cycle. Motion between frames may be missed.

N changes when the attachment selection changes. The [input rules](inputs.md) explain how frames share the request limit. After sending, attachment details show the actual number and timestamps used. The model also receives a description of the sampling limitation.

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

The header gear opens a centered modal provider settings dialog over the application. Users edit Base URL, Model and API key directly, then choose Save settings. Advanced options contain environment-variable fallback, streaming, model thinking and explicit key removal. A blank key preserves the stored credential; stored keys never return to the renderer. Test saved connection uses the saved settings and a synthetic image. Opening or saving settings makes no network request. Escape or Close dismisses the dialog; keyboard focus stays inside while it is open.

The configuration accepts a base URL, API key or environment-variable name, model, streaming capability and optional thinking setting. The [implementation page](implementation.md) defines its location and transport rules. The model has no file-reading, registry-search or metadata-editing tools in this release.

## Visual Presentation

The Assistant uses a compact segmented view switch, neutral colors, consistent SVG icon buttons and a rounded composer. The text box grows with the draft, up to a fixed height. Header and composer icons have accessible names and tooltips. User messages use light bubbles; assistant Markdown occupies the conversation directly. Submitted filenames appear as small attachment labels without a redundant input count.

Upload processing records are available through the information icon below each reply, in a separate Message details view. Raw media UUIDs do not appear in the transcript. Original-file and video/GIF sampling notices remain visible before sending. Options contains image quality and directly visible metadata checkboxes, with no earlier-input controls; provider configuration stays in its separate settings view.

The composer’s + button opens upward with Add current media and Add text or image files. Provider settings is opened by the header gear. Message options contains only image quality and directly visible saved-metadata choices.
