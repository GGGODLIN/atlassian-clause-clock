import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { getSeededScenario, reconcileClauseClock } from '../src/core/index.ts';
import { POST } from '../app/api/mcp/route.ts';

test('IANA calendar boundaries clip physical UTC intervals at both ends and include DST', () => {
  const base = getSeededScenario('cross-timezone-boundary');
  const scenario = { ...base, incidents: [{ id: 'boundary', label: 'UTC month start', startMinute: -20, endMinute: 40 }], vendorFeeds: [] };
  assert.equal(reconcileClauseClock(scenario, { timezoneOverride: 'America/Los_Angeles' }).mathBreakdown.netOutageMinutes, 0);
  assert.equal(reconcileClauseClock(scenario, { timezoneOverride: 'Asia/Tokyo' }).mathBreakdown.netOutageMinutes, 60);
  const utc = reconcileClauseClock(base);
  const la = reconcileClauseClock(base, { timezoneOverride: 'America/Los_Angeles' });
  assert.equal(utc.mathBreakdown.netOutageMinutes, 40);
  assert.equal(utc.mathBreakdown.newCreditCents, 0);
  assert.equal(la.mathBreakdown.netOutageMinutes, 60);
  assert.equal(la.mathBreakdown.newCreditCents, 150000);
  assert.equal(la.inputsSnapshot.billingMonthTotalMinutes, 43260);
});

test('P1/P2/P3: randomized UTC minutes match independent Intl month-membership oracle', () => {
  const base = getSeededScenario('cross-timezone-boundary');
  const origin = Date.parse('2026-11-01T00:00:00Z');
  fc.assert(fc.property(
    fc.constantFrom('UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Lord_Howe'),
    fc.integer({ min: -720, max: 44000 }),
    fc.integer({ min: 1, max: 120 }),
    (zone, start, duration) => {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit' });
      let expected = 0;
      for (let minute = start; minute < start + duration; minute += 1) {
        const parts = formatter.formatToParts(origin + minute * 60000);
        if (parts.find(p => p.type === 'year')?.value === '2026' && parts.find(p => p.type === 'month')?.value === '11') expected += 1;
      }
      const scenario = { ...base, incidents: [{ id: 'physical', label: 'physical', startMinute: start, endMinute: start + duration }], vendorFeeds: [], maintenanceWindows: [] };
      const receipt = reconcileClauseClock(scenario, { timezoneOverride: zone });
      assert.equal(receipt.mathBreakdown.netOutageMinutes, expected);
      assert.ok(receipt.mathBreakdown.newCreditCents <= base.contract.monthlyCapCents);
      assert.equal(receipt.mathBreakdown.internalAbsorbedCents + receipt.mathBreakdown.vendorTotalApportionedCents, receipt.mathBreakdown.newCreditCents);
    },
  ), { numRuns: 100, seed: 20261111 });
});

async function rpc(body: unknown): Promise<Response> {
  return POST(new Request('http://localhost/api/mcp', { method: 'POST', body: JSON.stringify(body) }));
}

test('MCP JSON-RPC initializes, accepts notification, discovers and reads resources, calls tools and returns errors', async () => {
  const initialized = await (await rpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } } })).json();
  assert.equal(initialized.jsonrpc, '2.0');
  assert.equal(initialized.id, 0);
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  assert.ok(initialized.result.capabilities.tools);
  const notification = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
  const tools = await (await rpc({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' })).json();
  assert.equal(tools.result.tools.length, 4);
  const resources = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'resources/list' })).json();
  const read = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: resources.result.resources[0].uri } })).json();
  assert.match(read.result.contents[0].text, /name: clause-clock/);
  const call = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'evaluate-clause-clock', arguments: {} } })).json();
  assert.equal(call.result.isError, false);
  assert.match(call.result.content[0].text, /ClauseClock Receipt/);
  assert.equal(call.result.structuredContent.receipt.mathBreakdown.netOutageMinutes, 75);
  const missing = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'unknown' })).json();
  assert.equal(missing.error.code, -32601);
  const invalid = await (await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: null })).json();
  assert.equal(invalid.error.code, -32602);
  const invalidArgument = await (await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'evaluate-clause-clock', arguments: { timezoneOverride: 12 } } })).json();
  assert.equal(invalidArgument.error.code, -32602);
  const malformed = await POST(new Request('http://localhost/api/mcp', { method: 'POST', body: '{' }));
  assert.equal((await malformed.json()).error.code, -32700);
});
