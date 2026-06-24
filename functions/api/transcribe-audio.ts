import {
  ensurePost,
  ensureSameOrigin,
  enforceRateLimit,
  handleFunctionError,
  json,
  PagesHandler,
  readJsonBody,
  RequestError,
} from '../_shared';

interface TranscriptionRequest {
  base64Audio?: string;
  mimeType?: string;
}

const MAX_REQUEST_BYTES = 2_500_000;
const supportedAudioTypes = [
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
];

export const onRequest: PagesHandler = async (context) => {
  const methodError = ensurePost(context.request);
  if (methodError) return methodError;
  const originError = ensureSameOrigin(context.request);
  if (originError) return originError;

  try {
    const limitError = await enforceRateLimit(context, 'transcribe', 20);
    if (limitError) return limitError;

    const { base64Audio, mimeType } = await readJsonBody<TranscriptionRequest>(
      context.request,
      MAX_REQUEST_BYTES
    );
    if (!base64Audio || !mimeType) {
      throw new RequestError('音声データが不足しています。', 400);
    }

    const normalizedMimeType = mimeType.split(';')[0].toLowerCase();
    if (!supportedAudioTypes.includes(normalizedMimeType)) {
      throw new RequestError('未対応の音声形式です。', 415);
    }

    let audioBuffer: Uint8Array;
    try {
      const binary = atob(base64Audio);
      audioBuffer = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
      throw new RequestError('音声データを読み取れませんでした。', 400);
    }

    if (audioBuffer.byteLength === 0 || audioBuffer.byteLength > 1_800_000) {
      throw new RequestError('音声データのサイズが不正です。', 413);
    }

    const result = await context.env.AI.run(
      (context.env.TRANSCRIBE_MODEL || '@cf/openai/whisper') as any,
      {
        audio: Array.from(audioBuffer),
      } as any
    ) as any;

    return json({ text: typeof result?.text === 'string' ? result.text.trim() : '' });
  } catch (error) {
    return handleFunctionError(error);
  }
};
