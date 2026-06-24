import { json, PagesHandler } from '../_shared';

export const onRequest: PagesHandler = async (context) =>
  json({
    ok: true,
    transcriptionConfigured: Boolean(context.env.AI),
    analysisConfigured: Boolean(context.env.AI),
  });
