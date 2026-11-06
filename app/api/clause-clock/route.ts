import {
  executeClauseClockAction,
  getDefaultClauseClockStore,
} from '../../../src/actions/index.ts';
import {
  CLAUSE_CLOCK_SEEDED_SCENARIOS,
  getSeededScenario,
  reconcileClauseClock,
} from '../../../src/core/index.ts';

export async function GET(request: Request): Promise<Response> {
  const store = getDefaultClauseClockStore();
  const url = new URL(request.url);
  const scenarioId =
    url.searchParams.get('scenarioId') ??
    url.searchParams.get('claimKey') ??
    'hero-overlap-splicer';
  const timezoneOverride = url.searchParams.get('timezoneOverride') ?? undefined;

  const result = executeClauseClockAction(store, 'evaluate-clause-clock', {
    scenarioId,
    timezoneOverride,
  });

  return Response.json(
    {
      ...result,
      scenarios: CLAUSE_CLOCK_SEEDED_SCENARIOS,
      realtimeEvents: store.realtimeEvents,
    },
    { status: result.status },
  );
}

export async function POST(request: Request): Promise<Response> {
  const store = getDefaultClauseClockStore();
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    const fallbackFooter = reconcileClauseClock(
      getSeededScenario(),
    ).machineReadableFooter;
    return Response.json(
      {
        status: 400,
        ok: false,
        actionKey: '',
        errorCode: 'MALFORMED_ACTION_PAYLOAD',
        message: 'Request body must be valid JSON.',
        machineReadableFooter: fallbackFooter,
      },
      { status: 400 },
    );
  }

  if (
    typeof parsedBody !== 'object' ||
    parsedBody === null ||
    Array.isArray(parsedBody)
  ) {
    const result = executeClauseClockAction(
      store,
      'evaluate-clause-clock',
      parsedBody,
    );
    return Response.json(result, { status: result.status });
  }

  const bodyRecord = parsedBody as Record<string, unknown>;
  const actionKey = bodyRecord.actionKey ?? bodyRecord.action;
  const payload =
    'payload' in bodyRecord
      ? bodyRecord.payload
      : Object.fromEntries(
          Object.entries(bodyRecord).filter(
            ([key]) => key !== 'actionKey' && key !== 'action',
          ),
        );

  const result = executeClauseClockAction(store, actionKey, payload);
  return Response.json(
    {
      ...result,
      realtimeEvents: store.realtimeEvents,
    },
    { status: result.status },
  );
}
