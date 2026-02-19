# Phase 6: Multimodal Responses - Research

**Researched:** 2026-02-19
**Domain:** Slack audio file handling, emoji reaction events, speech-to-text transcription, escalation resolution pipeline extension
**Confidence:** MEDIUM

## Summary

Phase 6 adds two new input modalities to the escalation system: voice notes (MDIA-01) and emoji reactions (MDIA-02). Both feed into the existing escalation resolution pipeline as new `ResponseType` variants, ultimately resolving pending escalations the same way button clicks and thread replies do today.

The critical finding is that **Claude API does NOT support audio input or transcription**. The Anthropic Messages API only accepts text, images (JPEG/PNG/GIF/WebP), and documents. There is no audio content type, no transcription endpoint, and no announced timeline for adding one. The phase description's assumption of "send to Claude API for transcription" is incorrect. An external transcription service is required. The recommended approach is the **OpenAI Whisper API** via the `openai` npm package -- it costs $0.006/minute, supports webm/mp4/ogg/wav/mp3 formats (matching Slack audio clip formats), accepts files up to 25 MB, and has a clean TypeScript SDK. This adds a new runtime dependency (`openai`) and requires an `OPENAI_API_KEY` environment variable.

Emoji reactions (MDIA-02) are straightforward. Slack's `reaction_added` event delivers the emoji name (`event.reaction`), the message coordinates (`event.item.channel`, `event.item.ts`), and the reacting user (`event.user`). The existing `tsToEscalation` map in the SlackAdapter already maps message timestamps to escalation IDs, so matching a reaction to its escalation is a direct lookup. A configurable emoji-to-decision mapping in `escalate.config.json` completes the feature. This requires adding the `reactions:read` OAuth scope and subscribing to `reaction_added` events in the Slack app configuration.

**Primary recommendation:** Use OpenAI Whisper API (`openai` npm package, `whisper-1` model) for audio transcription. Register `app.event('reaction_added')` in Slack Bolt for emoji reactions. Extend `ResponseType` to include `'voice'` and `'reaction'` variants. Add `multimodal` config section to `escalate.config.json` with emoji mapping and transcription provider settings. Both features resolve escalations through the same `store.resolve()` + `responseResolvers` pipeline used by existing button and text responses.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MDIA-01 | Voice note interpretation -- download audio from Slack thread, send to transcription service, normalize to text response | Claude API confirmed NOT to support audio. Use OpenAI Whisper API (`openai` npm, `whisper-1` model, $0.006/min). Slack audio clips arrive as `file_share` message subtype with `url_private_download`. Download with bot token Authorization header. Whisper accepts webm/mp4/ogg/wav/mp3 up to 25 MB. Transcribed text feeds into existing `store.resolve()` as a voice-type response. |
| MDIA-02 | Emoji reaction responses -- configurable emoji-to-decision mapping (e.g., checkmark = approve, X = deny) | Slack `reaction_added` event provides `event.reaction` (emoji name), `event.item.ts` (message timestamp), `event.user` (reactor). Requires `reactions:read` OAuth scope. Existing `tsToEscalation` map enables direct escalation lookup by message ts. Config-driven mapping (e.g., `{ "white_check_mark": "approve", "x": "deny" }`) resolves escalation via existing `store.resolve()` + `responseResolvers` pipeline. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `openai` | ^4.x | OpenAI Whisper API client for audio transcription | Official OpenAI SDK; TypeScript-first; `audio.transcriptions.create()` accepts ReadStream; handles multipart uploads; actively maintained; 25M+ weekly npm downloads |
| `@slack/bolt` | ^4.6.0 | Already installed; add `reaction_added` event listener and file download | Already a project dependency; `app.event('reaction_added')` built-in; `app.client.files.info()` for file metadata |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@slack/web-api` | bundled with bolt | `files.info()` for file metadata, fetch for downloading `url_private_download` | When downloading audio files from Slack; bundled with @slack/bolt |
| Node.js `fs` + `os` | built-in | Temporary file management for audio download/upload pipeline | Write downloaded Slack audio to temp file, stream to Whisper API, clean up |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| OpenAI Whisper API | Google Cloud Speech-to-Text | 4x more expensive ($0.024/min vs $0.006/min); more complex auth (service account JSON vs API key); overkill for short voice clips |
| OpenAI Whisper API | Local `whisper.cpp` via `nodejs-whisper` | Zero API cost but requires downloading 1-3 GB model files; significant CPU/memory overhead; model management complexity; not suitable for a lightweight plugin |
| OpenAI Whisper API | AssemblyAI | Higher accuracy for noisy audio but ~$0.015/min; unnecessary for short clear voice clips in a professional Slack context |
| Configurable emoji mapping | Hardcoded emoji set | Loses flexibility; different teams use different emoji conventions; config is trivial to implement |

**Installation:**
```bash
pnpm add openai
```

**Environment Variables (new):**
```bash
OPENAI_API_KEY=sk-...  # Required only if voice note transcription is enabled
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── slack/
│   ├── adapter.ts          # MODIFY: add reaction handler registration, file download method
│   ├── handlers.ts         # MODIFY: add registerReactionHandler(), registerFileShareHandler()
│   ├── types.ts            # MODIFY: extend SlackAdapterCallbacks with new event types
│   └── blocks.ts           # No changes needed
├── transcription/
│   ├── index.ts            # TranscriptionProvider interface + factory
│   ├── whisper.ts          # OpenAI Whisper implementation
│   └── types.ts            # TranscriptionResult, TranscriptionConfig types
├── types/
│   ├── escalation.ts       # MODIFY: extend ResponseType with 'voice' | 'reaction'
│   └── adapter.ts          # No interface changes needed (resolution is internal)
├── config/
│   └── schema.ts           # MODIFY: add multimodal config section
└── server/
    └── http-bridge.ts      # No changes needed (resolution happens in adapter)
```

### Pattern 1: Reaction-to-Decision Resolution
**What:** Map Slack emoji reactions to escalation decisions using the existing resolver pipeline
**When to use:** When a user adds a reaction emoji to an escalation message
**Example:**
```typescript
// In handlers.ts - new handler registration
export function registerReactionHandler(app: App, callbacks: SlackAdapterCallbacks): void {
  app.event('reaction_added', async ({ event }) => {
    // Only handle reactions on messages (not files, file comments)
    if (event.item.type !== 'message') return;

    callbacks.onReaction(
      event.item.channel,
      event.item.ts,
      event.reaction, // e.g., "white_check_mark", "x", "thumbsup"
      event.user,
    );
  });
}

// In adapter.ts - new callback handler
private handleReaction(channelId: string, messageTs: string, emoji: string, userId: string): void {
  // Only handle reactions on our channel
  if (channelId !== this.channelId) return;

  // Look up escalation by message timestamp
  const escalationId = this.tsToEscalation.get(messageTs);
  if (!escalationId) return; // Not a tracked escalation message

  // Look up emoji mapping from config
  const decision = this.emojiMapping.get(emoji);
  if (!decision) return; // Unrecognized emoji, ignore

  // Resolve through existing pipeline
  const resolved = this.store.resolve(
    escalationId,
    JSON.stringify({ type: 'reaction', emoji, actionId: decision }),
  );

  if (!resolved) return;

  const resolver = this.responseResolvers.get(escalationId);
  if (resolver) {
    resolver({ type: 'reaction', actionId: decision, respondedAt: new Date() });
  }

  // Clean up maps (same as handleAction/handleThreadReply)
  this.escalationToTs.delete(escalationId);
  this.tsToEscalation.delete(messageTs);
  this.responseResolvers.delete(escalationId);
}
```

### Pattern 2: Voice Note Download-Transcribe-Resolve Pipeline
**What:** Download audio from Slack, transcribe via Whisper API, resolve escalation with transcribed text
**When to use:** When a user posts a voice note in an escalation thread
**Example:**
```typescript
// In adapter.ts - voice note handler
private async handleVoiceNote(threadTs: string, fileId: string): Promise<void> {
  const escalationId = this.tsToEscalation.get(threadTs);
  if (!escalationId) return;

  try {
    // 1. Get file metadata from Slack
    const fileInfo = await this.app.client.files.info({ file: fileId });
    const file = fileInfo.file;
    if (!file?.url_private_download) return;

    // 2. Download the audio file
    const audioBuffer = await this.downloadFile(file.url_private_download);

    // 3. Transcribe via configured provider
    const transcription = await this.transcriptionProvider.transcribe(
      audioBuffer,
      file.mimetype ?? 'audio/webm',
      file.name ?? 'voice_note.webm',
    );

    // 4. Resolve escalation with transcribed text
    const resolved = this.store.resolve(
      escalationId,
      JSON.stringify({ type: 'voice', text: transcription.text, confidence: transcription.confidence }),
    );

    if (!resolved) return;

    const resolver = this.responseResolvers.get(escalationId);
    if (resolver) {
      resolver({ type: 'text', text: transcription.text, respondedAt: new Date() });
    }

    // Clean up
    this.escalationToTs.delete(escalationId);
    this.tsToEscalation.delete(threadTs);
    this.responseResolvers.delete(escalationId);
  } catch (err) {
    console.error('[escalate] Voice note processing failed:', err);
    // Do NOT resolve -- let user retry with text or button
  }
}

// File download helper
private async downloadFile(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${this.botToken}` },
  });
  if (!response.ok) throw new Error(`File download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
```

### Pattern 3: TranscriptionProvider Interface
**What:** Abstract transcription behind an interface for testability and future provider swaps
**When to use:** Always -- even with only one provider, the interface enables mocking in tests
**Example:**
```typescript
// src/transcription/types.ts
export interface TranscriptionResult {
  readonly text: string;
  readonly confidence?: number;
  readonly durationMs?: number;
}

// src/transcription/index.ts
export interface TranscriptionProvider {
  transcribe(audio: Buffer, mimeType: string, filename: string): Promise<TranscriptionResult>;
}

// src/transcription/whisper.ts
import OpenAI, { toFile } from 'openai';
import type { TranscriptionProvider, TranscriptionResult } from './types.js';

export class WhisperTranscriptionProvider implements TranscriptionProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(audio: Buffer, mimeType: string, filename: string): Promise<TranscriptionResult> {
    const file = await toFile(audio, filename, { type: mimeType });
    const result = await this.client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'verbose_json',
    });
    return {
      text: result.text,
      durationMs: result.duration ? result.duration * 1000 : undefined,
    };
  }
}
```

### Pattern 4: Config Schema Extension
**What:** Add multimodal configuration section to `escalate.config.json`
**When to use:** Always -- enables emoji mapping customization and optional voice note support
**Example:**
```typescript
// Addition to src/config/schema.ts
export const EmojiMappingSchema = z.record(z.string(), z.string()).default({
  white_check_mark: 'approve',
  heavy_check_mark: 'approve',
  thumbsup: 'approve',
  x: 'deny',
  no_entry_sign: 'deny',
  thumbsdown: 'deny',
});

export const VoiceNoteConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['whisper']).default('whisper'),
  maxDurationSeconds: z.number().min(1).max(300).default(120),
  maxFileSizeMb: z.number().min(1).max(25).default(10),
});

export const MultimodalConfigSchema = z.object({
  emojiReactions: z.object({
    enabled: z.boolean().default(true),
    mapping: EmojiMappingSchema,
  }).default({ enabled: true, mapping: {} }),
  voiceNotes: VoiceNoteConfigSchema.default({
    enabled: false,
    provider: 'whisper',
    maxDurationSeconds: 120,
    maxFileSizeMb: 10,
  }),
});

// Add to root EscalateConfigSchema
export const EscalateConfigSchema = z.object({
  // ... existing fields ...
  multimodal: MultimodalConfigSchema.default({
    emojiReactions: { enabled: true, mapping: {} },
    voiceNotes: { enabled: false, provider: 'whisper', maxDurationSeconds: 120, maxFileSizeMb: 10 },
  }),
});
```

### Anti-Patterns to Avoid
- **Processing audio synchronously in the event handler:** Slack requires event acknowledgment within 3 seconds. Audio download + transcription takes 5-30 seconds. Fire-and-forget the transcription pipeline, resolve the escalation asynchronously.
- **Storing audio files permanently:** Audio files are transient. Download to a temp buffer/file, transcribe, resolve, discard. Never persist audio to SQLite or the filesystem.
- **Hardcoding emoji meanings:** Different teams use different emoji conventions. Always use the configurable mapping.
- **Resolving on reaction_removed:** Users accidentally add reactions. Only resolve on `reaction_added`, never undo on `reaction_removed`. Once resolved, it stays resolved.
- **Trying to use Claude API for transcription:** Claude API does NOT support audio input. Do not waste time attempting base64 audio content blocks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio transcription | Custom speech-to-text using FFmpeg + local models | OpenAI Whisper API | Speech recognition is an extremely complex ML domain; even "simple" approaches require model management, GPU access, and acoustic preprocessing |
| Audio format conversion | Manual FFmpeg pipeline to normalize audio formats | Whisper API directly (accepts webm, mp4, ogg, wav, mp3) | Whisper accepts all common Slack audio formats natively; no conversion needed |
| Multipart file upload | Manual HTTP multipart/form-data construction | `openai` SDK's `toFile()` helper | The SDK handles multipart encoding, content-type headers, and streaming correctly |
| Slack file download auth | Custom OAuth token management for file URLs | `fetch()` with `Authorization: Bearer ${botToken}` header | Slack's `url_private_download` just needs the bot token in the Authorization header |
| Emoji name normalization | Mapping skin tone variants, aliases, custom emoji | Slack's canonical `event.reaction` field | Slack normalizes emoji names before delivering events; `event.reaction` is always the canonical short name |

**Key insight:** The voice note pipeline has exactly three steps (download, transcribe, resolve) and each step has a well-tested library/API. The complexity is in the wiring, not in any individual step.

## Common Pitfalls

### Pitfall 1: Slack 3-Second Event Acknowledgment Timeout
**What goes wrong:** Audio transcription takes 5-30 seconds. If the event handler blocks on transcription before acknowledging, Slack retries the event, causing duplicate processing.
**Why it happens:** Bolt events (unlike actions) are auto-acknowledged, BUT if the handler throws or takes too long, Bolt's internal machinery may fail. Additionally, Slack can send duplicate `reaction_added` events.
**How to avoid:** For voice notes, fire-and-forget the download-transcribe-resolve pipeline using `void this.handleVoiceNote(threadTs, fileId).catch(...)`. For reactions, the handler is synchronous map lookups (sub-millisecond). Add idempotency -- if escalation is already resolved, `store.resolve()` returns false and the handler exits early.
**Warning signs:** Escalations being resolved twice; duplicate Slack API calls; "operation_timeout" errors in Bolt logs.

### Pitfall 2: Voice Notes vs Regular File Shares
**What goes wrong:** Every file shared in a thread triggers `file_share` events, including images, PDFs, and code snippets. Processing non-audio files as voice notes wastes API calls and produces garbage transcriptions.
**Why it happens:** Slack's `file_share` event does not distinguish voice notes from other file types at the event level.
**How to avoid:** Filter by `file.mimetype` -- only process files with `audio/*` mimetypes (audio/webm, audio/mp4, audio/ogg, audio/wav, audio/mpeg). Also check file size against `maxFileSizeMb` config. Additionally, check that the file is in a tracked escalation thread (`tsToEscalation` lookup).
**Warning signs:** Whisper API errors on non-audio files; unexpected API charges; transcription results that are gibberish.

### Pitfall 3: Reactions on Non-Escalation Messages
**What goes wrong:** Users react to ALL messages in the channel, not just escalation messages. Processing every reaction floods the handler with irrelevant events.
**Why it happens:** `reaction_added` fires for every reaction in channels the bot can see.
**How to avoid:** First check: is the reaction on a message in our channel? Second check: does `tsToEscalation.get(event.item.ts)` return an escalation ID? If either check fails, return immediately. The existing map provides O(1) filtering.
**Warning signs:** High handler invocation count with zero resolutions; performance degradation in busy channels.

### Pitfall 4: Race Between Reaction and Button/Text Responses
**What goes wrong:** User clicks "Approve" button AND adds a checkmark emoji simultaneously. Both handlers try to resolve the same escalation.
**Why it happens:** Multiple Slack events can arrive for the same escalation within milliseconds.
**How to avoid:** The existing `store.resolve()` method is already idempotent -- it uses `WHERE status = 'pending'` in the UPDATE, so only the first resolution succeeds. The second handler sees `resolved === false` and exits. This pattern is already battle-tested by the button/text race handling in the current codebase.
**Warning signs:** None -- the existing pattern handles this correctly if followed.

### Pitfall 5: Missing OAuth Scopes After Adding New Event Types
**What goes wrong:** The plugin starts but `reaction_added` events never arrive, or file downloads return 403.
**Why it happens:** Adding new Bolt event listeners requires corresponding OAuth scopes AND event subscriptions in the Slack app config. Forgetting either means silent failure.
**How to avoid:** Document the required Slack app configuration changes: add `reactions:read` scope, add `files:read` scope (if not already present), subscribe to `reaction_added` event. Include a validation step in `validateAndAnnounce()` that warns if expected scopes are missing.
**Warning signs:** Event handlers never fire; 403 errors on file downloads; "missing_scope" errors in Slack API responses.

### Pitfall 6: OpenAI API Key Not Configured
**What goes wrong:** Voice note feature is enabled in config but `OPENAI_API_KEY` is not set, causing runtime errors on first voice note.
**Why it happens:** Voice notes are optional; the env var is easy to forget.
**How to avoid:** Validate at startup: if `multimodal.voiceNotes.enabled === true`, check for `OPENAI_API_KEY` env var. Throw a clear configuration error during `validateAndAnnounce()`, not on first voice note. If voice notes are disabled (the default), skip the check entirely.
**Warning signs:** "AuthenticationError" from the OpenAI SDK on first voice note; users confused about why voice notes are silently ignored.

## Code Examples

Verified patterns from official sources:

### Downloading a Slack File with Bot Token
```typescript
// Source: Slack API docs (https://docs.slack.dev/messaging/working-with-files/)
// and community patterns (https://github.com/slackapi/bolt-js/issues/1711)
async function downloadSlackFile(url: string, botToken: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!response.ok) {
    throw new Error(`Slack file download failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
```

### OpenAI Whisper Transcription
```typescript
// Source: OpenAI API docs (https://platform.openai.com/docs/guides/speech-to-text)
// and openai npm package examples
import OpenAI, { toFile } from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function transcribeAudio(audioBuffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const file = await toFile(audioBuffer, filename, { type: mimeType });
  const result = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
  });
  return result.text;
}
```

### Bolt.js Reaction Event Listener
```typescript
// Source: Slack Bolt docs (https://docs.slack.dev/tools/bolt-js/reference/)
// and GitHub issue examples (https://github.com/slackapi/bolt-js/issues/766)
import type { App } from '@slack/bolt';

app.event('reaction_added', async ({ event, client }) => {
  // event.reaction: string (emoji name, e.g., "white_check_mark")
  // event.item.type: 'message' | 'file' | 'file_comment'
  // event.item.channel: string (channel ID)
  // event.item.ts: string (message timestamp)
  // event.user: string (user who reacted)

  if (event.item.type !== 'message') return;

  // Optionally fetch the original message for context
  const result = await client.conversations.history({
    channel: event.item.channel,
    latest: event.item.ts,
    inclusive: true,
    limit: 1,
  });
  const message = result.messages?.[0];
});
```

### Detecting Audio Files in Message Events
```typescript
// Source: Slack API file type docs (https://docs.slack.dev/reference/objects/file-object/)
// Audio mimetypes for Slack clips: audio/webm, audio/mp4, audio/ogg, audio/wav, audio/mpeg
const AUDIO_MIMETYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
  'audio/x-m4a',
  'audio/mp3',
]);

function isAudioFile(file: { mimetype?: string }): boolean {
  return file.mimetype !== undefined && AUDIO_MIMETYPES.has(file.mimetype);
}
```

### Extended ResponseType Union
```typescript
// Extension of existing src/types/escalation.ts
export type ResponseType = 'action' | 'text' | 'timeout' | 'voice' | 'reaction';

export interface UserResponse {
  readonly type: ResponseType;
  readonly actionId?: string;   // Used by 'action' and 'reaction' types
  readonly text?: string;       // Used by 'text' and 'voice' types
  readonly emoji?: string;      // Used by 'reaction' type (the raw emoji name)
  readonly respondedAt: Date;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Claude API for audio transcription | Not possible -- Claude API has no audio input | N/A | Must use external transcription service (Whisper, Google, etc.) |
| Whisper-1 only model | GPT-4o-transcribe + GPT-4o-mini-transcribe models available | Late 2025 | Higher accuracy options at same or lower price; `whisper-1` remains reliable and cost-effective |
| files.upload for Slack | files.getUploadURLExternal + files.completeUploadExternal | March 2025 | files.upload deprecated; not relevant for this phase (we download, not upload) |
| Manual multipart for OpenAI SDK | `toFile()` helper in `openai` SDK | 2024 | Simplifies Buffer-to-File conversion for API upload |

**Deprecated/outdated:**
- Claude API audio input: Does not exist. No announced timeline. Do NOT attempt.
- `files.upload` Slack API method: Deprecated March 2025. Not relevant (we only download files).
- OpenAI `whisper-1` is not deprecated but newer `gpt-4o-transcribe` offers better accuracy at same price.

## Open Questions

1. **Slack audio clip exact file metadata**
   - What we know: Slack audio clips (recorded in-app) are up to 5 minutes. File objects include `mimetype`, `url_private_download`, `filetype`, `size`.
   - What's unclear: The exact `mimetype` and `filetype` values for in-app recorded audio clips vs uploaded audio files. Community reports suggest `audio/webm` for clips.
   - Recommendation: During implementation, log the first few audio file objects received to confirm exact field values. Filter broadly on `audio/*` mimetype prefix rather than specific values.

2. **Voice note detection vs regular audio file upload**
   - What we know: Slack audio clips are a specific feature (record button in message composer). Regular audio file uploads also trigger `file_share`.
   - What's unclear: Whether the file object has a distinguishing field (e.g., `subtype: 'voice_clip'`) for native audio clips vs uploaded audio files.
   - Recommendation: Treat all audio files in escalation threads the same -- if it has an `audio/*` mimetype and is in a tracked escalation thread, transcribe it. The user intent is the same regardless of how the audio was created.

3. **OpenAI API key management in plugin context**
   - What we know: The plugin already uses `ESCALATE_SLACK_BOT_TOKEN` and `ESCALATE_SLACK_APP_TOKEN` environment variables.
   - What's unclear: Whether Claude Code plugin hooks can reliably access environment variables set in the user's shell profile, or if they need to be set in `.claude/settings.json` or a `.env` file.
   - Recommendation: Follow the existing pattern -- use `ESCALATE_OPENAI_API_KEY` or `OPENAI_API_KEY` env var. Document in setup instructions. Validate at startup when voice notes are enabled.

4. **Handling transcription failures gracefully**
   - What we know: Whisper API can fail (rate limits, invalid audio, network errors).
   - What's unclear: Best UX when transcription fails -- should the escalation remain pending? Should the bot post an error message in the thread?
   - Recommendation: On transcription failure, post a threaded reply: "Could not transcribe voice note. Please type your response instead." Do NOT resolve the escalation. Leave it pending for retry via text/button.

## Sources

### Primary (HIGH confidence)
- Anthropic Claude API Vision docs (https://platform.claude.com/docs/en/docs/build-with-claude/vision) -- Confirmed: only image/jpeg, image/png, image/gif, image/webp supported. NO audio support.
- OpenAI Audio API reference (https://platform.openai.com/docs/api-reference/audio/) -- Whisper API params, supported formats, models
- Slack API reaction_added event (https://docs.slack.dev/reference/events/reaction_added/) -- Event payload structure
- Slack API file object (https://docs.slack.dev/reference/objects/file-object/) -- File metadata fields including audio types
- Slack API files:read scope (https://api.slack.com/scopes/files:read) -- Required scope for file downloads

### Secondary (MEDIUM confidence)
- OpenAI npm package TypeScript examples (https://codesignal.com/learn/courses/getting-started-with-openai-whisper-api/lessons/making-your-first-whisper-api-request-with-typescript) -- TypeScript usage patterns verified against OpenAI docs
- Slack Bolt.js reaction_added handling (https://github.com/slackapi/bolt-js/issues/766) -- Pattern for accessing original message from reaction event
- Slack Bolt.js file download patterns (https://github.com/slackapi/bolt-js/issues/1711) -- Authorization header pattern for url_private
- Speech-to-text API pricing comparison (https://vocafuse.com/blog/best-speech-to-text-api-comparison-2025/) -- Pricing verification across providers
- OpenAI Whisper API pricing (https://brasstranscripts.com/blog/openai-whisper-api-pricing-2025-self-hosted-vs-managed) -- $0.006/min confirmed

### Tertiary (LOW confidence)
- Slack audio clip exact mimetype values -- Community reports suggest `audio/webm` but no official docs enumerate the exact mimetype for in-app recorded audio clips. Needs runtime validation.
- Slack `file_share` event subtype for voice clips -- Whether native Slack voice clips have a distinguishing subtype field is unverified. Need to test empirically.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- OpenAI Whisper API is well-documented, widely used, TypeScript SDK verified. @slack/bolt reaction handling is documented and tested.
- Architecture: HIGH -- Both features feed into the existing resolution pipeline with minimal changes. The adapter already has the maps and patterns needed.
- Pitfalls: MEDIUM -- Most pitfalls are inferred from Slack event handling patterns and the existing codebase. The 3-second timeout and race condition handling are well-understood from Phase 3.
- Claude API audio limitation: HIGH -- Verified directly against official Anthropic vision docs. Only image types supported. No audio content type exists.

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (30 days -- Whisper API is stable; Slack events API is stable; Claude API audio support unlikely to change within 30 days)
