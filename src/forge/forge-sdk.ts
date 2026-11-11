import api, { route, assumeTrustedRoute, authorize } from '@forge/api';
import { kvs, Filter, FilterConditions } from '@forge/kvs';
import { publishGlobal } from '@forge/realtime';
import { buildPrunedJiraRestUrl, buildTeamworkGraphIncidentQuery, type ClauseClockActionResult } from '../actions/clause-clock-dispatcher.ts';
import { liveScenarioSchema, type ForgeRuntimePort, type StoredAccount } from './forge-runtime.ts';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createForgeRuntimePort(cloudId: string): ForgeRuntimePort {
  const entity = kvs.entity<StoredAccount>('clause-clock-account');
  return {
    async authorizeMutation(issueKey) {
      const permissions = authorize().onJiraIssue(issueKey);
      const [edit, comment] = await Promise.all([permissions.canEdit(), permissions.canAddComments()]);
      if (!edit || !comment) throw new Error('Current user must be able to edit the issue and add comments');
    },
    async loadScenario(issueKey) {
      if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) throw new Error('Invalid Jira issue key');
      const visibility = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`);
      if (visibility.status === 404) return null;
      if (!visibility.ok) throw new Error(`Current user cannot read this Jira issue (${visibility.status})`);
      const issue = await api.asApp().requestJira(assumeTrustedRoute(buildPrunedJiraRestUrl({ issueKey })));
      if (issue.status === 404) return null;
      if (!issue.ok) throw new Error(`Jira issue read failed (${issue.status})`);
      const issueData = record(await issue.json());
      const graph = buildTeamworkGraphIncidentQuery({ issueAri: `ari:cloud:jira:${cloudId}:issue/${issueData.id}`, first: 25 });
      const graphResponse = await api.asUser().requestTeamworkGraph(graph.query, {
        cypherQuery: `MATCH (issue:JiraWorkItem {ari: $id})--(target:JiraWorkItem) RETURN target LIMIT ${graph.variables.first}`,
        params: { id: graph.variables.issueAri },
      });
      const graphData = record(await graphResponse.json());
      if (!graphResponse.ok || graphData.errors || !record(graphData.data).cypherQuery) throw new Error('Teamwork Graph relation read failed');
      const property = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/properties/clauseclock.scenario`);
      if (property.status === 404) return null;
      if (!property.ok) throw new Error(`Scenario property read failed (${property.status})`);
      const parsed = liveScenarioSchema.parse(record(await property.json()).value);
      if (parsed.contract.claimKey !== issueKey) throw new Error('Scenario property claim key does not match the Jira issue');
      return parsed;
    },
    readAccount: key => entity.get(key),
    initializeAccount: (key, value) => entity.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS' }),
    async compareAndSetAccount(key, revision, value) {
      await kvs.transact().set(key, value, {
        entityName: 'clause-clock-account',
        conditions: new Filter<StoredAccount>().and('revision', FilterConditions.equalTo(revision)),
      }).execute();
    },
    async deliver(result: ClauseClockActionResult) {
      const receipt = result.receipt;
      if (!receipt) return;
      if (receipt.provenance.sourceMode === 'LIVE_GRAPH_AND_REST') {
        // Entity properties are idempotent; append-only Jira comments cannot be safely replayed after a lost response.
        const property = await api.asApp().requestJira(route`/rest/api/3/issue/${receipt.claimKey}/properties/clauseclock.settlement`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: result.settlementStatus, receipt, internalNote: result.jsmInternalNote?.bodyMarkdown ?? null }),
        });
        if (!property.ok) throw new Error(`Jira settlement property write failed (${property.status})`);
        if (result.jsmInternalNote) {
          const marker = `ClauseClock settlement ${receipt.proposalVersionKey}`;
          let start = 0;
          let found = false;
          let lastPage = false;
          while (!lastPage && !found) {
            const comments = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${receipt.claimKey}/comment?start=${start}&limit=50`);
            if (!comments.ok) throw new Error(`JSM comment read failed (${comments.status})`);
            const page = record(await comments.json());
            const values = Array.isArray(page.values) ? page.values : [];
            found = values.some(value => record(value).public === false && String(record(value).body ?? '').includes(marker));
            lastPage = page.isLastPage === true;
            if (!lastPage && values.length === 0) throw new Error('Invalid JSM comment pagination');
            start += values.length;
          }
          if (!found) {
            const comment = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${receipt.claimKey}/comment`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ body: `${marker}\n${result.jsmInternalNote.bodyMarkdown}`, public: false }),
            });
            if (!comment.ok) throw new Error(`JSM internal note write failed (${comment.status})`);
          }
        }
      }
      const event = result.realtimeEvent;
      if (event) {
        // Global channels carry only a refresh hint; authorized resolvers load monetary details.
        await publishGlobal('clause-clock-settlement-sync', { scenarioId: receipt.scenarioId, claimKey: receipt.claimKey });
      }
    },
  };
}
