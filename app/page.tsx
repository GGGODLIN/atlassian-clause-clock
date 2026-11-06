import { parseSkillContractSnapshot } from './_studio/host-port.ts';
import { WebStudioRoot } from './_studio/web-studio-root.tsx';
import { GET as readMcpServerDescriptor } from './api/mcp/route.ts';

// Rendered per request so the inspector opens on the SKILL.md that is on disk now, read through the same /api/mcp
// handler and parser the browser uses, instead of a build-time copy.
export const dynamic = 'force-dynamic';

export default async function ClauseClockStudioPage() {
  const descriptor = await readMcpServerDescriptor();
  const initialSkillContract = parseSkillContractSnapshot(await descriptor.json());
  return (
    <main>
      <WebStudioRoot initialSkillContract={initialSkillContract} />
    </main>
  );
}
