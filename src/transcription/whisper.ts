/**
 * OpenAI Whisper transcription provider.
 *
 * Calls the Whisper API (whisper-1 model) to convert audio buffers to text.
 * Requires an OpenAI API key (ESCALATE_OPENAI_API_KEY).
 */

import OpenAI, { toFile } from 'openai';

import type { TranscriptionProvider } from './index.js';
import type { TranscriptionResult } from './types.js';

/** Transcription provider backed by the OpenAI Whisper API. */
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
      ...(result.duration != null ? { durationMs: result.duration * 1000 } : {}),
    };
  }
}
