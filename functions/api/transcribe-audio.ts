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
      (context.env.TRANSCRIBE_MODEL || '@cf/openai/whisper-large-v3-turbo') as any,
      {
        audio: base64Audio,
        language: 'ja',
        task: 'transcribe',
        vad_filter: true,
        initial_prompt:
          '日本語の会話、会議、打ち合わせです。映像制作、撮影、編集、企画、納期、品質、取引先、クライアント、マーケティングなどの業務用語や、人名、会社名、製品名を含め、聞こえた内容を省略せず自然な日本語で文字起こししてください。',
        condition_on_previous_text: false,
        no_speech_threshold: 0.55,
      } as any
    ) as any;

    return json({ text: typeof result?.text === 'string' ? result.text.trim() : '' });
  } catch (error) {
    return handleFunctionError(error);
  }
};
