import { LatestOnlyQueue } from '../networkQueue';
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

interface QueueItem {
  mimeType: string;
  base64Audio: string;
}

export class ApiTranscriptionProvider implements TranscriptionProvider {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private active = false;
  private retryBuffer: QueueItem | null = null;
  private consecutiveFailures = 0;
  private queue: LatestOnlyQueue<QueueItem>;

  constructor(
    private readonly handlers: TranscriptionProviderHandlers,
    private readonly networkMode: NetworkMode
  ) {
    this.queue = new LatestOnlyQueue(async (item) => {
      await this.sendChunk(item);
    });
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Audio recording for high accuracy mode is not supported.');
    }

    this.active = true;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredMimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));

    this.mediaRecorder = preferredMimeType
      ? new MediaRecorder(this.stream, { mimeType: preferredMimeType })
      : new MediaRecorder(this.stream);

    this.mediaRecorder.ondataavailable = async (event) => {
      if (!this.active || !event.data || event.data.size === 0) return;
      this.handlers.onActivity();
      this.handlers.onStatusChange('processing');
      this.handlers.onInterim('AIで文字起こし中...');
      const base64Audio = await blobToBase64(event.data);
      this.queue.enqueue({
        mimeType: event.data.type || preferredMimeType || 'audio/webm',
        base64Audio,
      });
    };

    this.mediaRecorder.onerror = (event) => {
      this.handlers.onError((event as any).error || event);
    };

    this.handlers.onStatusChange('listening');
    this.mediaRecorder.start(this.networkMode === 'low-bandwidth' ? 8000 : 4500);
  }

  async stop() {
    this.active = false;
    this.queue.clear();
    this.retryBuffer = null;
    this.consecutiveFailures = 0;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.handlers.onInterim('');
    this.handlers.onStatusChange('idle');
  }

  private async sendChunk(item: QueueItem) {
    try {
      const response = await fetch('/api/transcribe-audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(item),
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
      this.retryBuffer = null;
      this.consecutiveFailures = 0;
      this.handlers.onInterim('');
      this.handlers.onStatusChange('listening');
    } catch (error) {
      this.consecutiveFailures += 1;
      this.retryBuffer = item;
      this.handlers.onError(error);
      this.handlers.onStatusChange('waiting-network');
      if (this.consecutiveFailures >= 3) {
        this.handlers.onInterim('AI文字起こしに接続できません。標準認識に切り替えるか、少し待って再開してください。');
        this.retryBuffer = null;
        this.consecutiveFailures = 0;
        return;
      }
      window.setTimeout(() => {
        if (this.active && this.retryBuffer) {
          this.queue.enqueue(this.retryBuffer);
        }
      }, 2000);
    }
  }
}
