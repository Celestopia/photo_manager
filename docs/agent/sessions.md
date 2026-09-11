# Saving Conversations and Attachments

This page explains how conversations survive closing the viewer or restarting the application. It follows [Preparing Inputs for the Model](inputs.md). Session persistence is implemented by `src/main/chat/store.js`, with strict records validated by `schema.js`.

## Give Each Conversation Its Own Identity

A conversation belongs to one library and has its own UUID. Its identity does not depend on a photo or video. For example, a user can start a conversation about photo A, navigate to photo B, reopen the earlier conversation through History, and explicitly add B. Each message records its own inputs.

Library inputs use `MediaId`, so renaming or moving a file within the library does not break the association. Imported attachments have their own IDs and belong to the conversation that imported them. This structure can support a future multi-selection entry point without changing conversation identity; that entry point is outside this release.

## Store References and Imported Files Differently

| Input source | What is saved locally |
| --- | --- |
| Media already in the active library | A `MediaId` reference in the message. No additional copy of the original. |
| Pasted image or accepted external file | One source-file copy in the session's attachment folder, referenced by attachment ID. |
| Temporary optimized image or sampled frame | No permanent payload copy. Keep the processing details, then clean up the temporary file. |

Use this layout:

```text
<library>/.photo_manager/chat/
  sessions/
    <session-id>/
      session.json
      attachments/
        <attachment-id>.<validated-extension>
  trash/
    <session-id>/
```

Imported files retain their original display filename, detected MIME type, byte size and hash in the attachment inventory. Reusing an attachment in several messages does not create more source-file copies. Do not share or deduplicate files between sessions: each session must be able to delete its own attachments independently.

All writes use the existing exclusive library lock, validated paths and atomic persistence helpers. Chat does not change media metadata, registries or original library files.

## Save During Composition and Generation

When a user imports an attachment, save it under the session. If they remove it before sending, delete that copy only when no submitted message references it. Clean up partial files after a failed import. Drafts may have temporary session directories but never appear in History. Abandoning a draft removes its owned files, even if it has imported attachments. Library recovery and clean closure remove leftover records with no messages; unreadable records remain untouched. Submitted conversations retain referenced attachments, while abandoning their composer removes only unsent copies. A saved first user message establishes a conversation even if the model request fails or stops.

Reopening a session restores its unsubmitted imported attachments to the composer with optimized quality. Unsubmitted message text and quality overrides are temporary; only submitted messages persist those choices.

When the user sends a message:

1. Save the submitted user message before making the provider request.
2. Save streamed response text at most once per second, with writes performed sequentially for that session.
3. Save the final text and status immediately when the request completes, fails or stops.

The stored states distinguish draft, pending, streaming, complete, stopped, failed and interrupted, as appropriate to the message role. Stop preserves the partial response. An explicit retry creates a new attempt and retains the previous attempt's result; it does not overwrite history or automatically resend after a failure.

## Reopen and Recover a Conversation

On application startup or library open, mark unfinished responses as Interrupted and retain their last saved text. Do not resend them automatically. Report a corrupt session individually, without blocking ordinary library browsing or overwriting it with partially loaded data. Clean up abandoned partial imports while protecting valid referenced files.

Keep the full conversation text until the user deletes it. The smaller history window sent to the model is governed separately by the [request limits](inputs.md#5-add-recent-conversation-history).

If a library update removes a referenced media record, preserve the conversation and show **Media unavailable**. Never substitute a similar filename or matching hash automatically. If the source or saved metadata has changed, explain that continuation will use the current version. Earlier records stay unchanged. A missing input needed for continuation must be restored or explicitly removed from the next request.

## Delete a Conversation and Its Attachments Together

Deletion requires confirmation because it removes the conversation and its imported attachments, and chat history has no automatic backup. It never removes original library media or changes registries and metadata.

Perform deletion in this order:

1. Stop any active request for the session and wait for preparation and writes to finish.
2. Atomically move the entire session directory into `chat/trash` on the same filesystem.
3. Remove the session from visible History.
4. Recursively delete that session's validated trash directory.

A remaining trash directory records cleanup still to be done. If a locked file prevents deletion, report that cleanup is pending and retry on the next library open. Do not claim that every attachment has been removed until cleanup succeeds. Resolve and validate all recursive-operation paths, reject symbolic links, and never reach another session or a library source file.

Chat storage is excluded from automatic library backups. Copying or moving the entire library folder still carries the chat directory with it. No separate chat backup system is added.

## Define the Stored Records

Use `schemaVersion: 1`, strict field validation and validated references. Do not introduce implicit migrations or partially load invalid records.

| Record | Required information |
| --- | --- |
| Session | `sessionId`, `libraryId`, title, creation/update timestamps, messages and attachment inventory. There is no required session-level `MediaId`. |
| Message | UUID, role, text, creation/update timestamps, status and ordered input references. |
| Library input | The library's `MediaId`. |
| Imported input | An attachment ID belonging to this session. |
| Request attempt | Provider/model identity, outcome and the record of what was sent, described below. Never credentials. |

Message IDs and attachment IDs must be unique within the session. An attachment reference cannot point into another session's directory.

### Record What Was Sent

For each transmitted input, save enough information to explain how PhotoManager prepared it:

| Information | Fields to retain |
| --- | --- |
| Source | Library or attachment reference, SHA256, actual byte size and encoded pixel dimensions. Use null dimensions for text. |
| Upload choice | The effective optimized/original mode for a static image, or sampled-frame processing for moving media. |
| Prepared content | Transmitted MIME type, byte size, dimensions and a description of the transformations applied. |
| Video or GIF samples | Actual source timestamps, frame identities/indices and sample count. |
| Request context | Exact application metadata and attachment text supplied, plus the IDs of prior messages included. |

For Original file uploads, transmitted bytes, dimensions and SHA256 must match the source. Save the recorded values, not another copy of those bytes. Likewise, do not put base64 payloads or derivative image bytes in `session.json`.

This record describes what PhotoManager sent. It cannot establish how the provider resized, processed or retained that content.

Next: [Building and Testing the Feature](implementation.md).
