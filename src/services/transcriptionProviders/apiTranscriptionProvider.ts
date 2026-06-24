import { SequentialQueue } from '../networkQueue';
import {
  NetworkMode,
  TranscriptionProvider,
  TranscriptionProviderHandlers,
} from './types';

const blobToBase64 = async (blob: Blob) => {
  const arrayBuffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

interface QueueItem {
  mimeType: string;
  audio: Blob;
}

export class ApiTranscriptionProvider implements TranscriptionProvider {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private active = false;
  private segmentTimer: number | null = null;
  private currentSegmentStopped: Promise<void> | null = null;
  private resolveCurrentSegmentStopped: (() => void) | null = null;
  private preferredMimeType: string | undefined;
  private queue: SequentialQueue<QueueItem>;

  constructor(
    private readonly handlers: TranscriptionProviderHandlers,
    private readonly networkMode: NetworkMode
  ) {
    this.queue = new SequentialQueue(async (item) => {
      await this.sendChunk(item);
    });
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Audio recording for high accuracy mode is not supported.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.preferredMimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));

    this.active = true;
    this.handlers.onStatusChange('listening');
    this.startSegmentRecorder();
  }

  async stop() {
    this.active = false;
    if (this.segmentTimer !== null) {
      window.clearTimeout(this.segmentTimer);
      this.segmentTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      await this.currentSegmentStopped;
    }

    this.mediaRecorder = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    if (this.queue.size > 0) {
      this.handlers.onStatusChange('processing');
      await this.queue.whenIdle();
    }

    this.handlers.onInterim('');
    this.handlers.onStatusChange('idle');
  }

  private startSegmentRecorder() {
    if (!this.active || !this.stream) return;

    const chunks: Blob[] = [];
    const recorderOptions: MediaRecorderOptions = {
      audioBitsPerSecond: this.networkMode === 'low-bandwidth' ? 32_000 : 64_000,
    };
    if (this.preferredMimeType) {
      recorderOptions.mimeType = this.preferredMimeType;
    }
    const recorder = new MediaRecorder(this.stream, recorderOptions);
    this.mediaRecorder = recorder;
    this.currentSegmentStopped = new Promise<void>((resolve) => {
      this.resolveCurrentSegmentStopped = resolve;
    });

    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };

    recorder.onerror = (event) => {
      this.handlers.onError((event as any).error || event);
    };

    recorder.onstop = () => {
      if (this.segmentTimer !== null) {
        window.clearTimeout(this.segmentTimer);
        this.segmentTimer = null;
      }

      const mimeType =
        recorder.mimeType ||
        chunks[0]?.type ||
        this.preferredMimeType ||
        'audio/webm';
      const audio = new Blob(chunks, { type: mimeType });
      if (audio.size >= 1_000) {
        this.handlers.onActivity();
        this.handlers.onStatusChange('processing');
        this.queue.enqueue({ mimeType, audio });
      }

      this.resolveCurrentSegmentStopped?.();
      this.resolveCurrentSegmentStopped = null;
      this.currentSegmentStopped = null;
      this.mediaRecorder = null;

      if (this.active) {
        this.startSegmentRecorder();
      }
    };

    recorder.start();
    const segmentDurationMs = 60_000;
    this.segmentTimer = window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, segmentDurationMs);
  }

  private async sendChunk(item: QueueItem) {
    const base64Audio = await blobToBase64(item.audio);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch('/api/transcribe-audio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            mimeType: item.mimeType,
            base64Audio,
          }),
        });

        if (!response.ok) {
          const result = await response.json().catch(() => null) as any;
          throw new Error(result?.error || `Transcription API returned ${response.status}`);
        }

        const result = await response.json() as any;
        const text = typeof result.text === 'string' ? result.text.trim() : '';
        if (text) {
          this.handlers.onFinal(text);
        }
        this.handlers.onInterim('');
        this.handlers.onStatusChange(this.active ? 'listening' : 'processing');
        return;
      } catch (error) {
        this.handlers.onError(error);
        if (attempt === 3) {
          this.handlers.onStatusChange('waiting-network');
          return;
        }
        this.handlers.onStatusChange('waiting-network');
        await wait(1_500 * attempt);
      }
    }
  }
}
