'use client';

import { useState } from 'react';
import { ClauseClockWorkbench } from './clause-clock-workbench.tsx';
import { createHttpClauseClockHostPort, type SkillContractSnapshot } from './host-port.ts';
import type { SettlementMap } from './settlement-sync.ts';

export interface WebStudioRootProps {
  initialSkillContract: SkillContractSnapshot | null;
  initialSettlements: SettlementMap;
}

// A host port carries functions, which cannot cross the server/client boundary, so the browser builds its own once.
export function WebStudioRoot({ initialSkillContract, initialSettlements }: WebStudioRootProps) {
  const [hostPort] = useState(() => createHttpClauseClockHostPort());
  return (
    <ClauseClockWorkbench
      hostPort={hostPort}
      initialSkillContract={initialSkillContract}
      initialSettlements={initialSettlements}
    />
  );
}
