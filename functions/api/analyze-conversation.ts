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

interface ConversationNode {
  id: string;
  type: 'topic' | 'reason' | 'example' | 'supplement' | 'summary';
  text: string;
  shortLabel: string;
  parentId?: string;
  sourceSegmentIds?: string[];
  sourceTextSnippet?: string;
}

interface AnalyzeRequest {
  transcript?: string;
  currentNodes?: ConversationNode[];
  rollingSummary?: string;
}

const insightSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', maxLength: 500 },
    nodes: {
      type: 'array',
      maxItems: 45,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', maxLength: 80 },
          type: {
            type: 'string',
            enum: ['topic', 'reason', 'example', 'supplement', 'summary'],
          },
          text: { type: 'string', maxLength: 500 },
          shortLabel: { type: 'string', maxLength: 20 },
          parentId: { type: ['string', 'null'], maxLength: 80 },
          sourceSegmentIds: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string', maxLength: 80 },
          },
          sourceTextSnippet: { type: 'string', maxLength: 160 },
        },
        required: [
          'id',
          'type',
          'text',
          'shortLabel',
          'parentId',
          'sourceSegmentIds',
          'sourceTextSnippet',
        ],
      },
    },
    keyTerms: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string', maxLength: 80 },
          definition: { type: 'string', maxLength: 240 },
          detail: { type: 'string', maxLength: 700 },
        },
        required: ['term', 'definition', 'detail'],
      },
    },
  },
  required: ['summary', 'nodes', 'keyTerms'],
};

export const onRequest: PagesHandler = async (context) => {
  const methodError = ensurePost(context.request);
  if (methodError) return methodError;
  const originError = ensureSameOrigin(context.request);
  if (originError) return originError;

  try {
    const limitError = await enforceRateLimit(context, 'analyze', 12);
    if (limitError) return limitError;

    const payload = await readJsonBody<AnalyzeRequest>(context.request, 180_000);
    const transcript = payload.transcript?.trim() || '';
    if (transcript.length < 20 || transcript.length > 60_000) {
      throw new RequestError('会話テキストの長さが不正です。', 400);
    }

    const currentNodes = Array.isArray(payload.currentNodes)
      ? payload.currentNodes.slice(-70)
      : [];
    const rollingSummary = (payload.rollingSummary || '').slice(0, 2_000);

    const result = await context.env.AI.run(
      (context.env.ANALYSIS_MODEL || '@cf/qwen/qwen3-30b-a3b-fp8') as any,
      {
        messages: [
          {
            role: 'system',
            content:
              'あなたは日本語会話の論理構造をリアルタイムで整理する専門家です。事実を追加せず、入力に根拠がある内容だけを構造化してください。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              goal: '会話の累積要約、論理構造マップ、重要用語を更新する',
              rules: [
                'summaryは累積要約と直近発言を統合し300文字以内',
                'nodesは最大45件',
                '古い細部はsummaryノードへ統合する',
                '既存ノードを残す場合は同じidを優先する',
                'shortLabelは10文字以内',
                'sourceSegmentIdsとsourceTextSnippetで発言根拠を示す',
                'parentIdがない場合はnull',
                'sourceTextSnippetがない場合は空文字',
                'detailが不要でも空文字を返す',
              ],
              rollingSummary,
              recentTranscript: transcript,
              currentNodes,
            }),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: insightSchema,
        },
        max_tokens: 3_500,
        temperature: 0.1,
      } as any
    ) as any;

    const insight = getStructuredAiResponse(result) as any;
    if (
      !insight ||
      typeof insight !== 'object' ||
      typeof insight.summary !== 'string' ||
      insight.summary.replace(/[、。,\s]/g, '').length < 5 ||
      !Array.isArray(insight.nodes) ||
      insight.nodes.length === 0
    ) {
      throw new RequestError('会話解析で有効な構造を生成できませんでした。', 502);
    }
    return json({
      summary: insight.summary,
      nodes: insight.nodes.map((node: any) => ({
        ...node,
        parentId: node.parentId || undefined,
      })),
      keyTerms: insight.keyTerms,
    });
  } catch (error) {
    return handleFunctionError(error);
  }
};
