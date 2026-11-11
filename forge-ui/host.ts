import { invoke, realtime } from '@forge/bridge';
import type { ClauseClockActionResult } from '../src/actions/clause-clock-dispatcher.ts';
import { parseSkillContractSnapshot, type ClauseClockHostPort, type SettlementBroadcast } from '../app/_studio/host-port.ts';

async function invokeAction(name: string, payload: Record<string, unknown>): Promise<ClauseClockActionResult> {
  const result = await invoke<ClauseClockActionResult>(name, payload);
  return 'body' in result ? result.body : result;
}

export function createForgeHostPort(): ClauseClockHostPort {
  return {
    hostLabel: 'Atlassian Forge · persistent KVS · Jira + Teamwork Graph',
    executeAction: (key, payload) => invokeAction(key, payload),
    async callMcpTool(name, args) {
      const result = await invokeAction(name, args);
      return {
        request: { method: 'tools/call', params: { name, arguments: args } },
        httpStatus: result.status, response: result, result, machineReadableFooter: result.machineReadableFooter,
      };
    },
    async readSkillContract() {
      return parseSkillContractSnapshot(await invoke('skill-contract'));
    },
    subscribeSettlementChannel(listener) {
      let disposed = false;
      const subscription = realtime.subscribeGlobal('clause-clock-settlement-sync', payload => {
        if (disposed || typeof payload !== 'object' || payload === null || !('scenarioId' in payload) || typeof payload.scenarioId !== 'string') return;
        void invokeAction('evaluate-clause-clock', { scenarioId: payload.scenarioId }).then(result => {
          const receipt = result.receipt;
          if (disposed || !receipt) return;
          listener({
            channel: 'clause-clock-settlement-sync', receipt,
            event: {
              channel: 'clause-clock-settlement-sync', eventId: `REFRESH-${receipt.proposalVersionKey}`,
              claimKey: receipt.claimKey, scenarioId: receipt.scenarioId,
              status: result.settlementStatus ?? 'READY', proposalVersionKey: receipt.proposalVersionKey,
              newCreditCents: receipt.mathBreakdown.newCreditCents,
              vendorTotalApportionedCents: receipt.mathBreakdown.vendorTotalApportionedCents,
              internalAbsorbedCents: receipt.mathBreakdown.internalAbsorbedCents,
              approverId: result.jiraEntityProperty?.approverId ?? '', timestampIso: new Date().toISOString(),
            },
          });
        });
      });
      return () => { disposed = true; void subscription.then(value => value.unsubscribe()); };
    },
    copyText: text => navigator.clipboard.writeText(text),
  };
}
