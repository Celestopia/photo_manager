# Using Assistant

Open a photo or video, then choose **Assistant** in the left sidebar. Customization remains on the right. The current media appears as a removable input. Type your question and press Enter or Send. Shift+Enter inserts a newline; Stop keeps the partial reply.

## Configure Your Provider Once

Choose the **Provider settings** gear in the Assistant header. Enter the Base URL, Model and API key in the centered dialog, then choose **Save settings**. Leave the API key blank to preserve a saved key. Advanced options contains environment-variable fallback and model thinking. Closing without saving discards draft changes.

PhotoManager stores these settings in the following file; manual editing is optional:

```text
%LOCALAPPDATA%\PhotoManager\app-data\chat-provider.yml
```

Fill in your service's base URL, API key and model name. The base URL should end at the API version path, such as `/v1`; PhotoManager appends `/chat/completions`.

```yaml
schemaVersion: 1
baseUrl: "https://YOUR-PROVIDER/compatible-mode/v1"
apiKey: ""
apiKeyEnv: "DASHSCOPE_API_KEY"
model: "qwen3-vl-plus-2025-12-19"
streaming: true
enable_thinking: false
```

Replace the example URL with the endpoint for your provider account and region. Put your key in `apiKey`, or leave it empty and set the environment variable named by `apiKeyEnv` before starting PhotoManager. A nonempty `apiKey` takes precedence. Keys entered in this file are stored as local plaintext; using an environment variable avoids putting the key in the file. Neither method puts credentials in conversation history.

The Qwen default is listed in [Alibaba Cloud's model documentation](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-vl-plus). A local multimodal server can use a loopback URL such as `http://127.0.0.1:8000/v1` and its own model name. If your server does not accept `enable_thinking`, choose **Use provider default** under Model thinking. The server must support streaming Chat Completions and function calling for tools. PhotoManager does not download or start a local model.

Choose **Save settings**, then **Test connection**. The test sends a generated blue square; it does not use your photos. Opening Settings and saving configuration do not contact the provider. A successful configuration check validates the fields, not the availability of the remote model; the explicit test checks the connection.

## Choose What to Send

Use **+ → Add text or image files** to choose an image or UTF-8 text file, or paste one into the composer. Library inputs remain references to their `MediaId`; imported attachments are copied into the conversation's local folder. PDF, Office, archives, audio and external video attachments are rejected with an explanation.

**+ → Add current media** adds the photo or video currently displayed. Navigating to another item saves and stops an active reply, discards unsent text and attachments, and starts a fresh draft with that item attached. To discuss several media items together, reopen the earlier conversation through History and add the current media explicitly.

Static images default to **Optimized for chat**, with a maximum 1,024-pixel long edge. **Original file** sends unchanged bytes, with a 20 MiB file limit and the provider's own limits. Imported images can override the message's quality setting in Message options. Successful submission resets the next message to optimized quality.

Original bytes can contain embedded EXIF metadata regardless of the separate application-metadata choices. The provider may resize or process original uploads. Videos and animated GIFs always use sampled still frames; no original moving file or audio is sent. The composer displays their sampling notices before Send.

The basic saved title, description and assigned tags are included by default. Enable location/GPS, people, hidden description or technical details using the directly visible **Include saved metadata** checkboxes when needed. Unsaved viewer edits are never supplied.

## Return to a Conversation

**History** lists only conversations with a submitted user message. Opening Assistant, typing or adding attachments does not create a history entry. Closing and reopening on the same media keeps your current draft or conversation; changing media prepares a fresh draft. Reopen one to continue, filter by the current media, rename a conversation or delete it. The complete text stays on disk even when only recent turns fit into a model request.

Earlier inputs remain part of the conversation automatically. If a referenced source changed, start a new conversation to use its current version. If it is missing, restore it or start a new conversation with available inputs. Saved history remains unchanged.

## Consequences and Limits

Remote requests upload the selected content and can incur API charges. There is no library-wide media upload, vector index or model download. Tool suggestions apply only to supplied library media and never save automatically.

## Research with Web Search

Open **Provider settings → Web search**, enter your separate Tavily key (or use the configured environment variable), and save. **Test connection** searches a generic topic and extracts one public result without sending library content. A saved Assistant key is never reused for Tavily. Removing a saved Tavily key leaves any environment fallback applicable.

The globe beside Options enables web tools for the current conversation. It starts off and stays on through successive messages and panel hide/reopen. New chat, media navigation, another history conversation, leaving the viewer, library changes, or restart reset it. Retry uses the currently visible setting. Saving settings does not turn it on.

Ask, for example, “Research this landmark and suggest a description.” Assistant may search, read a returned page, explain its findings with clickable numbered citations, and prepare the usual review cards. Search is optional even when enabled. Sources open in your system browser. You can inspect saved sources with web access off; previously saved evidence is not automatically refreshed.

Generated queries go to Tavily, and retrieved text goes to the Assistant model. Queries may contain details you supplied. Images, paths, complete metadata, and the transcript are not automatically attached to Tavily requests. Search credits are shown separately from model tokens; unknown or partial usage stays labeled. Source text can be incomplete or inaccurate, and failed extraction is reported explicitly. Stop cancels current web work. Search never approves a metadata change.

Each message accepts up to eight attachments. A model request accepts up to eight images in total, so each video/GIF consumes several of those slots. Older whole turns can be omitted to stay within the request limits; the reply records a notice when that happens. See [input processing](inputs.md) for exact limits.

Conversations and imported attachments are saved under `<library>/.photo_manager/chat/v2/`. They are excluded from automatic library backups. Deleting a conversation deletes its imported attachments after confirmation, but preserves original library media. If a locked file delays cleanup, the app reports it and retries on the next library open.


The composer’s + button opens upward with Add current media and Add text or image files. Provider settings is opened by the header gear. Message options contains only image quality and directly visible saved-metadata choices.

Provider settings is also available from the gallery gear menu as **LLM Provider Settings**. Both entry points open the same application-level dialog; opening it from the gallery does not create a conversation or submit media.

Pending attachments appear as square tiles above the text box, with local image previews or file icons. Use the corner × to remove an attachment; hover to see its filename. Previews are generated locally and do not upload anything.

Click a static-image or GIF tile in the composer or a sent message to see a larger, complete-frame preview in the center of the application. GIF previews show the first frame. When that draft or message contains multiple previewable images, use the floating Previous and Next buttons or Left Arrow and Right Arrow to switch between them; navigation stops at the first and last image, and the counter shows the current position. Click the dark backdrop or the preview's Close button to return to the conversation. Video and text tiles are excluded.

Responses always stream; there is no streaming switch. To erase a stored credential, choose **Remove saved key** beneath the API-key field and **Save settings**. **Undo removal** cancels this before saving. This removes only the local copy. **Test connection** becomes available once changes are saved and sends only a generated test image.

## Ask for Metadata Suggestions

Ask naturally for a title, description or tags. The four starter buttons include **Introduce this photo**, **Suggest a title**, **Suggest a description** and **Suggest tags**; they fill and focus the composer without sending. Video prompts use video wording.

The agent can look up existing library tags and make several tool calls in one reply. Basic metadata sharing also permits this bounded tag lookup, including tag names and descriptions. Disabling it disables tag lookup and tag suggestions; title and description suggestions remain available. Imported files cannot be edited through these tools.

Each preview shows the target file, saved value, suggested value and status. **Accept** saves that field; **Decline** leaves metadata unchanged. Review buttons become available after the reply ends. Save or discard unsaved Metadata edits on the selected item before accepting. If the saved field, source file or referenced tag changed, the preview needs refresh; refreshing creates a new preview requiring another Accept. Changed source bytes require a new suggestion. Tag suggestions never create registry entries.

Accepted changes are recorded together with the metadata write. They can be discussed in later messages without rewriting earlier input snapshots. Manual changes to previously supplied metadata still require a new conversation. Deleting a conversation does not undo accepted changes.

Switching to Information or hiding Assistant with its Close button keeps the current reply and tool calls running. Reopening shows the ongoing or completed response. Use Stop to cancel explicitly. Changing media or conversations, leaving the viewer, closing the library/window, or starting maintenance still stops active work. Background suggestions remain pending until accepted; unsaved-draft and stale-preview checks still apply.


In History, choose **Select** to select several conversations. Click rows or their checkboxes; **Select all** includes all available conversations matching **Current media only**, including offscreen rows. Unreadable entries remain unavailable. The fixed footer shows **Clear selection** and **Delete (N)**. Deletion requires one confirmation and preserves original library media. Successful deletions remain complete if another item fails; failed items remain selected for retry. Changing the filter clears the selection; Done, Back, hiding Assistant, or changing media/library exits selection mode. Deleting the current conversation clears it so a new chat can be started.
