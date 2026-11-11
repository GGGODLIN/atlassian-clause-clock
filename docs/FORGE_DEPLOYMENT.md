# Forge deployment and live data

The source checkout is unregistered. Its placeholder app ID is intentionally not a deployed app. Build and package checks run locally; registration, production deployment and installation require the owner’s Atlassian account.

## Deploy

After authenticating with `npx forge login`, run this from the repository root:

```bash
npm run build:forge-ui && npm run verify:forge && npx forge register ClauseClock --personal && npx forge deploy -e production
```

Then install on a Jira Service Management test site:

```bash
npx forge install -e production -p Jira -s YOUR-SITE.atlassian.net
```

Open the registered app in the Atlassian developer console, enable distribution as required by the account, and copy the actual installation link into [the submission draft](/devpost/DEVPOST_SUBMISSION.md). Do not construct an installation URL from the placeholder ID. Teamwork Graph and Rovo availability, consent, distribution eligibility and real site behavior remain deployment acceptance items.

`build:forge-ui` creates `static/clause-clock-ui/{index.html,main.js,main.css}` and a self-contained `build/forge/index.cjs`. The manifest uses the official `manual@2026` package mode so Forge’s TypeScript loader does not conflict with Next.js’s `noEmit` and directly executable `.ts` imports. `verify:forge` calls the installed CLI’s official manifest validator and runtime packager and checks the handler export and generated UI files. `forge lint` itself requires login.

## Live source contract

The Forge issue panel uses its trusted issue context. The global page and actions accept a seeded scenario selection; its claim key identifies the corresponding Jira issue. On that issue, set the entity property `clauseclock.scenario` to a JSON scenario matching `liveScenarioSchema` in [the runtime adapter](/src/forge/forge-runtime.ts). A starting value is the object returned by `getSeededScenario()`, with the real claim/customer/contract and interval values substituted. Each interval stores integer elapsed minutes from local midnight at the start of the contract billing month. Optional ISO labels are informational.

The handler reads:

- Jira issue fields `summary,status,created,resolutiondate` through `asApp().requestJira`.
- Related Jira work items through `asUser().requestTeamworkGraph`, using the official Cypher-backed GraphQL response shape. The app declares `read:graph:jira`; Graph access also depends on the current user and site.
- The validated `clauseclock.scenario` property for authoritative contract, incident, maintenance and vendor windows. Graph relationships provide related-work context; they do not invent billing durations or amounts.

If the issue/property is absent or the Graph request fails, the receipt says `SEEDED_FIXTURE` and includes its fallback reason. The seeded ledger is isolated from the live ledger and never writes fixture claims into Jira.

## Settlement and retry boundaries

A conditional Custom Entity transaction persists one customer/month ledger, settlement records and a pending-delivery record through `@forge/kvs`. Conflicting revisions fail instead of overwriting another invocation’s cap deduction. Jira property writes, JSM internal comments and realtime publication happen after that transaction. They are not atomic across services. The result reports `PENDING_RETRY` if delivery fails; the next action attempts delivery before accepting another mutation.

The Jira settlement property is idempotent. Before posting a JSM internal comment (`public: false`), the adapter searches comments for the proposal marker. A response lost after a comment write is retried by searching that marker. Concurrent retries and delayed comment visibility can still duplicate an audit note; the cap ledger remains guarded separately. Reset restores ledger state and writes READY to the entity property. It retains historical Jira internal comments.

Global realtime broadcasts contain only a refresh hint. Subscribers load receipt details through the Forge resolver. The public Web Studio retains its in-memory demonstration ledger and local subscriber simulation.

The approval token binds a displayed proposal and approver string; it is not an authentication credential or proof of a human action. Use a test site for the demonstration. Production role-based settlement authorization, long-term ledger retention and high-volume storage limits are outside this submission’s validated behavior.

## Judge walkthrough (target: three minutes, not a measured guarantee)

1. Install the production app using the actual installation link.
2. Open Jira’s ClauseClock global page and evaluate the hero scenario. Expect 75 minutes and $1,500 credit, labeled seeded unless the site has the live scenario property and Graph access.
3. Select Scenario II. Compare UTC (40 minutes, $0) with Los Angeles (60 minutes, $1,500).
4. Enter an approver and approve the displayed proposal. Commit, reload, and confirm the KVS settlement persists. Confirm the Finance view refreshes.
5. Run the PBT audit in the inspector and inspect the receipt footer. Reset the demonstration ledger.
6. On a configured JSM issue, verify the internal note, settlement entity property and LIVE source label. Exercise a Graph-permission failure and confirm a labeled fallback rather than a fabricated live result.
