import { getDefaultClauseClockStore } from '../src/actions/clause-clock-store.ts';
import { parseSkillContractSnapshot } from './_studio/host-port.ts';
import { snapshotStoreSettlements } from './_studio/settlement-sync.ts';
import { WebStudioRoot } from './_studio/web-studio-root.tsx';
import { GET as readMcpServerDescriptor } from './api/mcp/route.ts';

// Rendered per request so the inspector opens on the SKILL.md that is on disk now and both settlement panels open on
// what the shared store holds now, instead of build-time copies.
export const dynamic = 'force-dynamic';

export default async function ClauseClockStudioPage() {
  const descriptor = await readMcpServerDescriptor(new Request('http://localhost/api/mcp'));
  const initialSkillContract = parseSkillContractSnapshot(await descriptor.json());
  return (
    <main>
      <WebStudioRoot
        initialSkillContract={initialSkillContract}
        initialSettlements={snapshotStoreSettlements(getDefaultClauseClockStore())}
      />
    </main>
  );
}
