# Preparing Inputs for the Model

This page explains what happens between choosing an input and sending a message. It continues [Using the Chat Panel](interface.md). These rules are implemented by `src/main/chat/inputs.js` and `service.js`.

## 1. Check Whether the Input Is Supported

The composer accepts library media references and imported attachments. Library media stays in its existing location. Accepted external files are copied into the conversation's attachment folder so they remain available when the conversation is reopened.

| Input | What the model receives |
| --- | --- |
| Static JPG/JPEG, PNG, WebP, BMP or single-frame GIF | An optimized image, or the unchanged original file if selected. |
| Animated GIF, from the library or an import | Several still frames sampled across one animation cycle. |
| Video in the current library | Several still frames sampled across the video, without audio. |
| Imported UTF-8 `.txt`, `.md`, `.csv` or `.json` | Quoted text, clearly identified as attachment content. It is not executed or treated as application instructions. |
| PDF, Office document, archive, audio or external video attachment | Nothing. Explain that the format is unsupported before accepting the import. |

Check the file's contents as well as its extension. Other animated image formats are unsupported; do not quietly use their first frame. Reject symbolic links and paths outside the permitted library or attachment locations.

A pasted image is stored as an imported file. For clipboard images, **Original file** means the representation supplied by the clipboard; PhotoManager cannot recover an original source file that the clipboard did not provide.

## 2. Prepare Static Images in the Selected Quality

The composer defaults to **Optimized for chat**. Users can choose **Original file** for a message, and can override that choice for an individual imported static image. The [interface design](interface.md#set-image-quality) defines how these controls behave between messages and retries.

### Optimized for chat

Create a temporary image for upload, leaving the source untouched:

1. Apply the source orientation, convert color to sRGB and flatten transparency onto white.
2. Resize to at most 1,024 pixels on the long edge, without enlarging smaller images.
3. Encode as JPEG at quality 85. If the result exceeds 1 MiB, try quality 75, then 60.
4. If it is still too large, try a 768-pixel long edge, then 512 pixels, at quality 60.
5. If no result fits within 1 MiB, report a preparation error.

Limit image decoding to 100 million pixels. This preparation process also applies to sampled video and GIF frames.

### Original file

Send the validated source bytes with their detected MIME type. Do not resize, recompress, rotate, convert color, flatten transparency or strip embedded metadata. Imported attachments use their stored source file; a new copy is not created for each message.

An original upload may be at most 20 MiB, including when it comes from the library. If it is larger, ask the user to choose optimized quality or remove the input. Never change the quality silently. If the provider rejects the format, dimensions or upload size, explain the rejection and leave the choice to the user.

Original files can contain EXIF or other embedded metadata beyond the application metadata selected in the composer. The visible notice and its details are specified in the [interface design](interface.md#set-image-quality). Provider processing remains outside PhotoManager's control: sending original bytes does not guarantee that the model uses them at their original resolution.

## 3. Turn Videos and Animated GIFs into Still Frames

Moving media always uses sampled frames. There is no original video or animated-GIF upload in this release. Before Send, the composer explains this processing and the possibility of missed events; see [the processing notices](interface.md#explain-video-and-gif-processing-before-send).

### Library videos

Accept videos with a positive duration of up to 30 minutes. Sample up to eight frames spaced evenly across the duration, from the beginning to a point just before the end. Extract them with FFmpeg, preserve orientation and display aspect ratio, and prepare each frame using the optimized-image rules above. Record the timestamps of the frames actually decoded. No audio is sent.

### Animated GIFs

Sample up to four distinct displayed frames across one animation cycle, including the first and final frames. Use elapsed time, calculated from the frame delays, to choose samples. Equal spacing by frame number would misrepresent animations whose frames have different durations.

Decode the displayed, fully composited image at each sample, respecting GIF disposal behavior. Do not repeat the animation loop. A single-frame GIF follows the static-image rules instead.

### Incomplete or invalid sampling

Record each sample's actual timestamp and source-frame identity. Repeated extraction of the same source frame counts only once. Every moving input must provide at least two distinct source frames. Missing requested samples, invalid GIF timing or an inability to obtain enough frames produces an actionable preparation error; do not substitute placeholders or quietly send only the first frame.

The model also receives an explanation that these are samples. Neither the model nor the interface should imply that an event is absent from the whole video simply because it is absent from the selected frames.

## 4. Fit the Current Message Within the Request Limits

An *attachment* is a selected file or library reference. A *visual input* is one image sent to the model. A video is one attachment but uses several visual inputs.

| Limit | Value |
| --- | --- |
| Attachments in one user message, including library references | 8 |
| Imported image source file, regardless of upload quality | 20 MiB per file |
| Original static-image upload, including a library image | 20 MiB per file |
| Imported UTF-8 text source | 1 MiB per file |
| Extracted attachment text | 32,000 characters per user message |
| Visual inputs, including those from conversation history | 8 per model request |
| Complete serialized request, including base64 overhead | 32 MiB |

Reject oversized text rather than silently truncating it. If the current message exceeds a limit, explain what the user must reduce; do not drop selected inputs or change original uploads to optimized ones.

Allocate the eight available visual inputs as follows:

1. Reserve one for each static image and at least two for each video or animated GIF. If these minimums cannot fit, block Send.
2. Give remaining slots to the moving inputs, one at a time in attachment order. Stop at eight frames per video, four per GIF, or the number of distinct frames available.
3. Recalculate the sample times for the allocated count so the samples still span the full video or animation cycle.

For example, one photo and one video can use one image plus seven video frames. The composer updates the advertised frame counts when the selection changes.

## 5. Add Recent Conversation History

The saved conversation and the context sent to the model are different. All conversation text remains available in History, but a request includes only the recent turns that fit.

Give the current message and its inputs priority. Then select preceding complete user/assistant turns, starting with the most recent, up to twelve pairs and within the same visual and request-size limits. Send the selected turns in chronological order. When older turns do not fit, leave out whole turns, including their attachments, and show a notice that earlier history was omitted.

This size limit does not permit silently dropping an unavailable source. If an input needed for the next request is missing, the user must restore it or explicitly remove it from that request. Historical messages remain unchanged.

## 6. Send a Consistent Request and Record What Was Used

When the user presses Send, capture the message text, input references, effective quality choices, enabled metadata groups and provider configuration together. Check each source's identity and fingerprint before preparation and again before dispatch. If it changes during preparation, stop and explain the change instead of sending a mixture of versions.

A later message may use a newer version of a library file or its saved metadata, after notifying the user. It must not rewrite the record of what earlier messages sent.

Save a record of the actual input sizes, transformations, sampled frames, supplied metadata and included history. The fields are defined in [Saving Conversations and Attachments](sessions.md#record-what-was-sent). Do not store base64 payloads or duplicate the uploaded derivatives in the conversation. Remove temporary derivatives after the request finishes or is cancelled; imported source files remain owned by the session.

Next: [Saving Conversations and Attachments](sessions.md).
