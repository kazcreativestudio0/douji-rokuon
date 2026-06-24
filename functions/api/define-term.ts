import {
  ensurePost,
  ensureSameOrigin,
  enforceRateLimit,
  getStructuredAiResponse,
  handleFunctionError,
  json,
  PagesHandler,
  readJsonBody,
  RequestError,
} from '../_shared';

const termSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    term: { type: 'string', maxLength: 80 },
    definition: { type: 'string', maxLength: 240 },
    detail: { type: 'string', maxLength: 700 },
  },
  required: ['term', 'definition', 'detail'],
};

export const onRequest: PagesHandler = async (context) => {
  const methodError = ensurePost(context.request);
  if (methodError) return methodError;
  const originError = ensureSameOrigin(context.request);
  if (originError) return originError;

  try {
    const limitError = await enforceRateLimit(context, 'term', 10);
    if (limitError) return limitError;

    const payload = await readJsonBody<{ term?: string }>(context.request, 2_000);
    const term = payload.term?.trim() || '';
    if (!term || term.length > 80) {
      throw new RequestError('用語を80文字以内で入力してください。', 400);
    }

    const result = await context.env.AI.run(
      (context.env.ANALYSIS_MODEL || '@cf/qwen/qwen3-30b-a3b-fp8') as any,
      {
        messages: [
          {
            role: 'system',
            content:
              '入力された用語を、日本語で正確かつ簡潔に説明してください。IT・ビジネス文脈を優先し、断定できない場合は曖昧さを明示してください。',
          },
          { role: 'user', content: term },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: termSchema,
        },
        max_tokens: 800,
        temperature: 0.1,
      } as any
    ) as any;

    const definition = getStructuredAiResponse(result);
    if (!definition || typeof definition !== 'object') {
      throw new RequestError('用語解説の応答が空でした。', 502);
    }
    return json(definition);
  } catch (error) {
    return handleFunctionError(error);
  }
};
