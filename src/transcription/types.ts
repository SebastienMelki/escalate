/** Result of a successful audio transcription. */
export interface TranscriptionResult {
  readonly text: string;
  readonly confidence?: number;
  readonly durationMs?: number;
}
