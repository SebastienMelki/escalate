/**
 * Transcription module for converting audio to text.
 *
 * Provides a provider interface for testability and future provider swaps.
 */

import type { TranscriptionResult } from './types.js';

/** Abstract transcription provider for testability and future provider swaps. */
export interface TranscriptionProvider {
  transcribe(audio: Buffer, mimeType: string, filename: string): Promise<TranscriptionResult>;
}

export type { TranscriptionResult } from './types.js';
export { WhisperTranscriptionProvider } from './whisper.js';
