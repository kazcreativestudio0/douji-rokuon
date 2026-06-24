export interface ConversationNode {
  id: string;
  type: 'topic' | 'reason' | 'example' | 'supplement' | 'summary';
  text: string;
  shortLabel: string;
  parentId?: string;
  sourceSegmentIds?: string[];
  sourceTextSnippet?: string;
}

export interface InsightData {
  summary: string;
  nodes: ConversationNode[];
  keyTerms: { term: string; definition: string; detail?: string }[];
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean
  ) {
    super(message);
  }
}

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(
      'サーバーへ接続できません。通信状態を確認してください。',
      0,
      true
    );
  }

  const result = await response.json().catch(() => null) as any;
  if (!response.ok) {
    throw new ApiRequestError(
      result?.error || 'AI処理に失敗しました。',
      response.status,
      response.status === 429 || response.status >= 500
    );
  }
  return result as T;
};

export async function analyzeConversation(
  transcript: string,
  currentNodes: ConversationNode[],
  rollingSummary = ''
): Promise<InsightData | null> {
  if (!transcript || transcript.length < 20) return null;
  return postJson<InsightData>('/api/analyze-conversation', {
    transcript,
    currentNodes,
    rollingSummary,
  });
}

export async function getTermDefinition(
  term: string
): Promise<{ term: string; definition: string; detail?: string }> {
  return postJson('/api/define-term', { term });
}
