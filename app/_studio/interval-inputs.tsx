'use client';

import type { ClauseClockScenario, HalfOpenInterval } from '../../src/core/clause-clock-types.ts';
import { formatBillingRange, formatMinutes } from './format.ts';
import { TimezoneSwitcher } from './edge-case-banners.tsx';
import type { TimezoneOption } from './workbench-controller.ts';

interface IntervalSwitchProps {
  testId: 'incident-toggle' | 'maintenance-toggle';
  interval: HalfOpenInterval;
  billingMonth: string;
  billingTimezone: string;
  enabled: boolean;
  onToggle: (id: string) => void;
}

function IntervalSwitch({ testId, interval, billingMonth, billingTimezone, enabled, onToggle }: IntervalSwitchProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-rule bg-paper px-3 py-2.5 transition-colors hover:border-ink/30">
      <input
        type="checkbox"
        role="switch"
        className="cc-switch mt-0.5"
        data-testid={testId}
        data-interval-id={interval.id}
        checked={enabled}
        onChange={() => onToggle(interval.id)}
      />
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${enabled ? 'text-ink' : 'text-steel line-through'}`}>
          {interval.label}
        </span>
        <span className="block font-mono text-[11px] text-steel">
          {formatBillingRange(billingMonth, interval.startMinute, interval.endMinute, billingTimezone)} ·{' '}
          {formatMinutes(interval.endMinute - interval.startMinute)} · contract clock
        </span>
      </span>
    </label>
  );
}

export interface IntervalInputsProps {
  scenario: ClauseClockScenario;
  disabledIncidentIds: readonly string[];
  disabledMaintenanceIds: readonly string[];
  timezoneOptions: readonly TimezoneOption[];
  timezoneOverride: string | null;
  showTimezoneSwitcher: boolean;
  onToggleIncident: (incidentId: string) => void;
  onToggleMaintenance: (maintenanceId: string) => void;
  onTimezoneChange: (timezoneOverride: string | null) => void;
}

export function IntervalInputs({
  scenario,
  disabledIncidentIds,
  disabledMaintenanceIds,
  timezoneOptions,
  timezoneOverride,
  showTimezoneSwitcher,
  onToggleIncident,
  onToggleMaintenance,
  onTimezoneChange,
}: IntervalInputsProps) {
  const billingMonth = scenario.contract.billingMonth;
  const disabledIncidents = new Set(disabledIncidentIds);
  const disabledMaintenance = new Set(disabledMaintenanceIds);
  return (
    <section aria-labelledby="cc-inputs-heading" className="cc-rise flex flex-col gap-4 rounded-[2rem] border border-rule bg-dial/60 p-5">
      <div>
        <p className="cc-eyebrow text-steel">Crown · calibration inputs</p>
        <h2 id="cc-inputs-heading" className="mt-1 font-display text-2xl leading-none">
          Bend the evidence
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-steel">
          Every toggle recomputes the proposal key in the browser and voids any prior human approval.
        </p>
      </div>

      {showTimezoneSwitcher && timezoneOptions.length > 1 ? (
        <div>
          <p className="cc-eyebrow mb-2 text-[10px] text-steel">Billing timezone · contract vs UTC</p>
          <TimezoneSwitcher
            options={timezoneOptions}
            value={timezoneOverride}
            label="Billing timezone"
            onChange={onTimezoneChange}
          />
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="cc-eyebrow mb-2 text-[10px] text-steel">Incidents · {scenario.incidents.length}</legend>
        {scenario.incidents.map((incident) => (
          <IntervalSwitch
            key={incident.id}
            testId="incident-toggle"
            interval={incident}
            billingMonth={billingMonth}
            billingTimezone={scenario.contract.billingTimezone ?? 'UTC'}
            enabled={!disabledIncidents.has(incident.id)}
            onToggle={onToggleIncident}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="cc-eyebrow mb-2 text-[10px] text-steel">
          Maintenance windows · {scenario.maintenanceWindows.length}
        </legend>
        {scenario.maintenanceWindows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-rule px-3 py-2 font-mono text-[11px] text-steel">
            No scheduled change window in this claim.
          </p>
        ) : (
          scenario.maintenanceWindows.map((maintenance) => (
            <IntervalSwitch
              key={maintenance.id}
              testId="maintenance-toggle"
              interval={maintenance}
              billingMonth={billingMonth}
            billingTimezone={scenario.contract.billingTimezone ?? 'UTC'}
              enabled={!disabledMaintenance.has(maintenance.id)}
              onToggle={onToggleMaintenance}
            />
          ))
        )}
      </fieldset>
    </section>
  );
}
