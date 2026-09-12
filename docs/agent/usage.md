# Using Assistant

Open a photo or video, then choose **Assistant** in the right sidebar. The current media appears as a removable input. Type your question and press Enter or Send. Shift+Enter inserts a newline; Stop keeps the partial reply.

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

The Qwen default is listed in [Alibaba Cloud's model documentation](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-vl-plus). A local multimodal server can use a loopback URL such as `http://127.0.0.1:8000/v1` and its own model name. If your server does not accept `enable_thinking`, choose **Use provider default** under Model thinking. Turn off **Stream responses** if it only returns complete responses. PhotoManager does not download or start a local model.

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

Remote requests upload the selected content and can incur API charges. There is no library-wide upload, retrieval, metadata editing, vector index or model download.

Each message accepts up to eight attachments. A model request accepts up to eight images in total, so each video/GIF consumes several of those slots. Older whole turns can be omitted to stay within the request limits; the reply records a notice when that happens. See [input processing](inputs.md) for exact limits.

Conversations and imported attachments are saved under `<library>/.photo_manager/chat/`. They are excluded from automatic library backups. Deleting a conversation deletes its imported attachments after confirmation, but preserves original library media. If a locked file delays cleanup, the app reports it and retries on the next library open.


The composer’s + button opens upward with Add current media and Add text or image files. Provider settings is opened by the header gear. Message options contains only image quality and directly visible saved-metadata choices.

Provider settings is also available from the gallery gear menu as **LLM Provider Settings**. Both entry points open the same application-level dialog; opening it from the gallery does not create a conversation or submit media.

Pending attachments appear as square tiles above the text box, with local image previews or file icons. Use the corner × to remove an attachment; hover to see its filename. Previews are generated locally and do not upload anything.

Click a static-image or GIF tile in the composer or a sent message to see a larger, complete-frame preview in the center of the application. GIF previews show the first frame. Click the dark backdrop or the preview's Close button to return to the conversation; video and text tiles do not open the image preview.

Responses always stream; there is no streaming switch. To erase a stored credential, choose **Remove saved key** beneath the API-key field and **Save settings**. **Undo removal** cancels this before saving. This removes only the local copy. **Test connection** becomes available once changes are saved and sends only a generated test image.
