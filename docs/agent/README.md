# Viewer Chat

Viewer chat is implemented in v0.28.0. Start with [Using Assistant](usage.md) for provider setup and everyday use. These pages document its behavior and implementation as part of [PROJECT.md](../../PROJECT.md).

Assistant sits beside the photo or video in the viewer. Users can ask questions, attach images or text files, and return to saved conversations later. It does not search the media library or change metadata. Gallery agent panels, embeddings, model tools, audio transcription and cross-library access remain out of scope.

## A Conversation from Start to Finish

### 1. Open Assistant and start a conversation

The viewer's right sidebar switches between Metadata and Assistant. Switching panels preserves any unsaved metadata draft.

A new conversation includes the currently viewed photo or video as a removable attachment. The conversation has its own identity: it does not belong permanently to that file. For example, a user can start by discussing one photo, move to another photo, and explicitly add the second one to the same conversation.

### 2. Choose what to include

The composer shows the inputs for the next message. Users can remove them, add the currently viewed media, paste an image or file, or use a file picker.

Library files stay in their original locations; chat stores references to them. External attachments are copied into the conversation's storage so they remain available after the original file or clipboard content disappears.

### 3. Choose how images are sent

Static images default to **Optimized for chat**, which sends a smaller, normalized copy. **Original file** sends the existing file bytes unchanged. Imported images can have their own quality choice.

Videos and animated GIFs always become a small set of timestamped frames. They are not uploaded as complete moving images, and no audio is included. The composer explains this before Send. Original-image uploads also have a visible notice about upload size and provider limits.

### 4. Send a message and read the reply

Send takes one click. PhotoManager prepares the chosen inputs and sends them to the configured remote API or compatible local model server. Replies appear progressively and support Markdown. Stop interrupts the request and keeps the partial reply.

By default, a library-media input includes its saved title, description and assigned tag names. Other metadata must be enabled in Options. Ordinary viewing and browsing chat history make no provider requests.

### 5. Return to the conversation later

Messages are saved automatically in the active library. History lists that library's conversations and can filter them by references to the current media.

Moving to another photo stops an active reply but keeps the conversation open. It does not add that photo automatically. Reopening an old conversation also leaves its inputs unchanged until the user chooses to add something.

### 6. Delete it when it is no longer needed

Sessions remain until the user deletes them. Deleting a session removes its messages and imported attachments, but never its referenced library files. Chat is excluded from automatic library backups, so deletion has no automatic chat-backup recovery path.

## Read the Details in This Order

| Page | What it explains |
| --- | --- |
| [Using the chat panel](interface.md) | What the user sees while composing, sending and revisiting conversations. |
| [Preparing inputs for the model](inputs.md) | How each file type is handled, how quality choices work and which limits apply. |
| [Saving conversations and attachments](sessions.md) | What is stored, where it lives, and how saving, recovery and deletion work. |
| [Building and testing the feature](implementation.md) | Provider setup, code responsibilities, delivery steps and acceptance checks. |

## What Users Need to Know

Remote chat can upload the selected content and incur API charges. Original image bytes may include embedded metadata even when the corresponding PhotoManager metadata group is disabled. The provider may also resize or otherwise process an original upload; PhotoManager cannot control that.

Frame sampling can miss brief events. Imported attachments take disk space until removed or their conversation is deleted. This feature requires no local model downloads or vector database.

These files are permanent project documentation. Keep credentials, conversations and actual attachments out of docs. This implementation was built incrementally on main, without merging the agent-probe prototype.
