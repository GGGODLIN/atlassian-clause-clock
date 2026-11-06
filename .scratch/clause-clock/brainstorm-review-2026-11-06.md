# `/review-brainstorm` 6-Seat Shootdown Report — `ClauseClock` (Atlassian Codegeist 2026)

- **Date**: 2026-11-06
- **Target Repo**: `/Users/linhancheng/Desktop/projects/atlassian-clause-clock`
- **Target Hackathon**: Atlassian Codegeist 2026 (`Apps for Business Teams` + Bonus Prizes: `Teamwork Graph`, `Best Agents - Rovo/Assignable agents`, `Best app with Atlassian MCP`)

---

## 1. Anchored Hypothesis

1. **Observed pain**:
   當 B2B SaaS 服務發生多起停機事故（Incidents）並在 Jira Service Management (JSM) 結案後，企業客戶會提出 SLA 服務抵免（Service Credit）申請。JSM 原生 SLA 計時器僅計算單張工單的回應與解決時間，無法計算「客戶合約涵蓋服務的月度累計可用率（扣除重疊事故時段、計劃性維護排除窗、跨時區切月與月度已核准抵免上限）」，也無法將該筆停機賠償按時間窗交集比例分攤給同時段故障的上游第三方供應商或內部值班團隊。
2. **Anchored hypothesis（補齊 6 席審查揭露之平台背景後）**:
   建立雙棲架構的 Atlassian Forge 應用程式 `ClauseClock`（單一純 TypeScript 整數分鐘區間代數與整數美分守恆核心 `lib/clause-clock-core.ts` ＋ 共用純 Client React 工作台 `_studio`，同時編譯為 Forge Custom UI 靜態資源束與獨立 Next.js 瀏覽器展示站）。當客服或財務在 JSM 索賠單／全域頁面打開工作台（或呼叫 `rovo:agent` / `rovo:mcp` 工具）時，系統透過 `SlaClaimContextPort`（優先執行單頁唯讀 Teamwork Graph 查詢與最小欄位 Jira REST 查詢，若評審站點為空或未授權則無縫切換內建 4 組標準 Seeded Scenarios 并標記 `SourceProvenanceManifest`），以純函式計算 `(Union(Incidents) \ Maintenance)` 對客抵免金額與 `(NetOutage ∩ UpstreamWindows)` 上游供應商違約分攤（最大餘數法美分守恆），隨附不可變 `CalculationReceipt` 與雙階段人類確認權杖（零內容 hash），經確認後寫回 JSM/Jira 與 KVS 帳本並透過 `@forge/realtime` 同步更新，且支援一鍵回滾重置（Reset Demo Write-Back）。
3. **Target scope**:
   `/Users/linhancheng/Desktop/projects/atlassian-clause-clock`
4. **Hard constraints**:
   - 符合 Atlassian Codegeist 2026 參賽規範（`Apps for Business Teams` 主獎 + `Teamwork Graph`、`rovo:agent`、`rovo:mcp` 附開源 `SKILL.md`、`@forge/realtime`）。
   - 所有時間區間聯集／差集／交集與金額分攤由純函式確定性引擎計算，搭配 `fast-check` 三角色 Property-Based Testing（含 `NAIVE_SPREADSHEET_SUM` 人工直加誤賠反例重播）。
   - 遵守全域 `CLAUDE.md` 零內容 hash（不使用 `sha256`/`md5`）與 `Opus 5.5 Max` 視覺／影片派工分工規則。

---

## 2. 6-Lens Reviewer Status

| Seat | Lens | Model | Status | Highest Severity | Summary of Key Catch |
|---|---|---|---|---|---|
| **Seat 1** | Contrarian / YAGNI & Codebase Reuse | `opus` | `completed` | **Blocker** | 抓出單一 Forge App 不能同時提供 `graph:connector` 與呼叫 `requestTeamworkGraph`（`twg-overview.md:104`），且無 Cypher 寫入 API；並找齊 `paypal-credit-roll-live`、`vultr-chart-truth`、`kiroween-signal-box` 可直接重用的美分運算、核准權杖、MCP 派發器與 3 角色 PBT 骨架。 |
| **Seat 2** | Cost, Quota & Token Economics | `opus` | `completed` | **Blocker** | 量化 Teamwork Graph 強制 `first <= 25` 單頁上限與 UI Resolver 25 秒硬逾時、Jira Tier 1 Global Pool `65,000 points/hr`（未過濾 User 欄位時每張 Issue 暴增為 7 點）、KVS `240 KiB` 單鍵上限與 10KB 進位懲罰、Realtime `50 ops/sec`、以及 Automation 觸發之 Rovo Agent 禁跑 `CREATE/UPDATE` Action。 |
| **Seat 3** | UX & Developer/Judge Ergonomics | `opus` | `completed` | **Blocker** | 抓出評審在全新 Atlassian 測試站點 `forge install` 後面對 0 筆事故與空白畫面的 Cold-Start 死因，以及外部 MCP / Realtime 單視窗看不出效果的摩擦；要求內建「1-Click Seed 4 大標準劇本」、「3 分鐘評審導覽列（含內建 MCP Inspector 與雙視角 Realtime 預覽）」、「五軌時間軸瀑布圖」與「Reset Demo Write-Back」。 |
| **Seat 4** | Migration, Compatibility & Rollback Safety | `opus` | `completed` | **Blocker** | 抓出跨系統寫回中途失敗或連點兩次會產生重複賠償單與髒狀態、同客戶同月多張索賠單並行超額賠付（違反 Monthly Cap）、預覽到寫回之間的 TOCTOU 漂移，要求建立步驟級 `WritebackManifest` 與一鍵回滾 Action。 |
| **Seat 5** | Observability & 3 AM Debuggability | `opus` | `completed` | **Blocker** | 抓出客戶／供應商質疑金額或 Teamwork Graph 靜默退回假資料時無法在 3 分鐘內舉證的缺口；要求每次計算強制產出結構化 `CalculationReceipt`（含逐步區間切片明細與 CLI 重放指令）、`SourceProvenanceManifest`（標明 `LIVE` vs `SEEDED_FIXTURE`）與 Rovo/MCP 防竄改收據 Footer。 |
| **Seat 6** | Long-Term Tech Debt & Coupling | `opus` | `completed` | **Blocker** | 抓出 `manifest.yml`（`action` / `rovo:mcp` / `rovo:skill` / `rovo:agent`）、`SKILL.md` frontmatter 與 TypeScript handler 的五方 Schema 漂移風險，以及 `function:` 展開超過 200KB 限制（`ECO-1310`）；要求建立單一契約 Registry、共用單一 Function Handler 路由，並透過 `ClauseClockHostPort` 讓 Forge Custom UI 與 Next.js Web Studio 100% 共用同一棵 UI 與核心引擎。 |

---

## 3. Existing Reuse Candidates（Seat 1 找到的本機現成可重用資產）

1. **人類確認權杖與結構化版本鍵（零 `sha256`）**：
   - 來源：`/Users/linhancheng/Desktop/projects/paypal-credit-roll-live/lib/credit-roll-reconciler.ts:633-665,845-955` 與 `lib/credit-roll-settlement.ts:692-730`。
   - 重用方式：直接移植 `discardedAiAmountOverrides`（強制鎖定合約金額，拒絕 AI 覆寫）、結構化可讀 `proposalVersionKey`（`CCLOCK-${claimKey}-${billingMonth}-NET${netMinutes}M-CRED${netCreditCents}-VEND${vendorTotalCents}`）與 `APPROVAL::${proposalVersionKey}::${approverId}` 權杖驗證及冪等收據 Map。
2. **整數美分格式化與最大餘數守恆分配（Largest Remainder Method）**：
   - 來源：`/Users/linhancheng/Desktop/projects/paypal-credit-roll-live/lib/format-usd.ts:3-12` 與 `/Users/linhancheng/Desktop/projects/vultr-chart-truth/lib/oracle.ts:470-556`。
   - 重用方式：所有金額以整數美分（`cents`）計算，上游供應商與內部吸收分攤使用最大餘數法，保證 `sum(vendorApportionedCents) + internalAbsorbedCents === netCreditCents` 恆成立。
3. **Node 24 原生測試與 3 角色 `fast-check` PBT 引擎（含故障注入反例重播）**：
   - 來源：`/Users/linhancheng/Desktop/projects/kiroween-signal-box/src/lib/pbt-exorcist.ts:49-62,86-211` 與 `/Users/linhancheng/Desktop/projects/qnx-vss-warden/tests/warden-core-pbt.test.ts:24-31`。
   - 重用方式：以 `node --experimental-strip-types --test` 執行 Role 1（基準劇本）、Role 2（`P1..P4` 區間代數與美分守恆不變量 + `reachabilityWitnesses`）、Role 3（`NAIVE_SPREADSHEET_SUM` 人工試算表直加誤賠故障注入，自動縮減出最小重疊反例供 UI 時間軸重播）。
4. **單一 MCP / Rovo Tool 派發器與單一純 Client React `_studio` 架構**：
   - 來源：`/Users/linhancheng/Desktop/projects/kiroween-signal-box/src/lib/signal-box-store.ts:364-496`、`src/app/api/mcp/route.ts:16-28` 與 `/Users/linhancheng/Desktop/projects/qnx-vss-warden/app/_studio/bench.tsx`。
   - 重用方式：Forge Function 與 Next.js `/api/mcp` 共用同一個 `executeClauseClockTool()` 派發器；`jira:issuePanel`、`jira:globalPage` 與 Next.js Web Studio 共用同一棵 `app/_studio/` 純 Client React 元件樹。

---

## 4. Prioritized Objections & Contested Trade-offs

### Blockers（已無爭議，直接採納進規格護欄）
1. **[Blocker · Seat 1/2/6] 淘汰 `graph:connector` 與動態 Cypher，改用單頁唯讀 Teamwork Graph + 最小欄位 Jira REST + Seed Fallback**：
   - 因 Forge 明文禁止同一 App 同時提供 `graph:connector` 與呼叫 `requestTeamworkGraph`（`twg-overview.md:104`），且單頁強制 `first <= 25`（`twg-persisted.md:97-105`），故只做單頁唯讀 Teamwork Graph 查詢（完全符合 `Best apps with Teamwork Graph integration` 資格），並為 Jira REST 強制加上最小 `fields` 投影（排除 User 物件 7x 點數膨脹）。
2. **[Blocker · Seat 3] 內建「1-Click Seed 4 大標準劇本」與「3 分鐘評審導覽軌（含 MCP Inspector & 雙視角 Realtime 預覽）」**：
   - 解決評審在空白測試站點 `forge install` 後無事故、無合約、無外部 MCP Client 的死因；打開畫面第一秒即可在「五軌對齊視覺時間軸（Multi-Track Interval Waterfall）」互動切換 4 組劇本，並在同畫面並排展示 Support 端與 Finance 端透過 `@forge/realtime`（Web 端為 `BroadcastChannel` / Store）的即時廣播同步。
3. **[Blocker · Seat 5] 強制產出結構化 `CalculationReceipt`、`SourceProvenanceManifest` 與 Rovo/MCP 防竄改收據 Footer**：
   - 每次計算必輸出逐步區間切片明細（原始事故 → 跨時區切月 → 聯集折疊 → 維護剪除 → 淨停機 → 供應商交集分攤）、明確標示資料源為 `LIVE` 或 `SEEDED_FIXTURE`，並在 Rovo / MCP 回應附上機讀對帳 Footer。
4. **[Blocker · Seat 6] 單一 Tool 契約表與共用 Forge Function Handler + `skills/clause-clock/SKILL.md`**：
   - 將所有工具收斂為 4 個粗粒度確定性 Action（`evaluate-clause-clock` `GET`、`run-pbt-audit` `GET`、`commit-credit-settlement` `CREATE`、`reset-settlement-state` `UPDATE`），在 `manifest.yml` 共用單一 `function:` router（避開 `ECO-1310` 展開限制），並建立符合 `agentskills.io` 規範的 `skills/clause-clock/SKILL.md` 同時掛載於 `rovo:skill` 與開源 MCP 指引。

### Contested Trade-offs（席次間主張對撞，待拍板）
1. **`[contested: Seat 1 vs Seat 4/6]` 合約條款來源與寫回範圍（Confluence 跨產品安裝 vs 純 Jira/JSM + KVS 結構化合約）**：
   - **Seat 1（減法席）** 指出：安裝在 Jira 的 Forge App 預設無權讀寫 Confluence（`rovo-mcp.md:129-131`），若啟用多產品相容，不僅會讓評審多一道跨產品連結摩擦、在 Marketplace 被強制綁定為 Paid App（`app-compatibility.md:236`），且解析 Confluence HTML/ADF 表格極脆弱；建議將合約級距直接存為 Forge KVS / Jira Issue Entity Property 的結構化 JSON（只附 `confluenceContractUrl` 來源連結），寫回也鎖定在 JSM/Jira 工單留言、財務／供應商工單與 KVS 帳本（並提供一鍵複製 Confluence / 客戶 / 供應商 Markdown 稽核收據）。
   - **Seat 4 & Seat 6** 則建議：在 `manifest.yml` 宣告 `confluence: { required: false }` 並寫雙軌 Adapter。
2. **`[contested: Seat 1/2 vs Seat 4]` 結算寫回與一鍵回滾的實現深度**：
   - **Seat 1 & Seat 2** 建議：寫回動作採用輕量原子化的「單張 JSM 索賠單內部稽核留言 + Entity Property 寫入 + KVS 結算帳本與一鍵 Reset」，避免在單次點擊中跨專案連開多張 Jira 子工單與 Confluence 頁面而撞上 `jira-per-issue-on-write` 限流與跨專案欄位必填錯誤。
   - **Seat 4** 建議：實作完整多工單建立（Finance 單 + N 張 Vendor 單 + Confluence 頁）加上多步驟 Outbox 補償刪除器。

### Noise（已剔除）
- Seat 4 提及「以 `inputSnapshotDigest` 計算雜湊」：依全域 `CLAUDE.md`「自家機制不算、不存、不比內容 hash（sha256 / md5 / checksum / digest）」硬規則直接剔除，統一採用 Seat 1 的人類可讀結構化 `proposalVersionKey`。

---

## 5. Key Decisions Needed Before `/to-spec`

1. **決策 1（合約儲存與跨產品安裝邊界 `[contested: Seat 1 vs Seat 4/6]`）**：
   - **a（推薦 · 採 Seat 1 單點安裝零摩擦方案）**：Forge App 專注於單一 Jira/JSM 安裝（免除評審額外連結 Confluence 的阻礙），將 SLA 合約級距存為結構化 JSON（KVS / Issue Property，附 Confluence 條款參考連結），並提供一鍵匯出 Confluence / 客戶 / 供應商 Markdown 稽核收據。
   - **b（採 Seat 4/6 雙產品選用方案）**：在 `manifest.yml` 加入 `confluence: { required: false }` 並額外實作 Confluence 頁面讀寫 Adapter。
2. **決策 2（結算寫回與一鍵回滾範圍 `[contested: Seat 1/2 vs Seat 4]`）**：
   - **a（推薦 · 採 Seat 1/2 + Seat 3 穩健可重測方案）**：確認結算（`commit-credit-settlement`）時，將完整 `CalculationReceipt`（含對客抵免明細與上游供應商求償分攤表）寫入目標 JSM 工單內部留言、Jira Entity Property 與 KVS 月度累計帳本（含 Monthly Cap 扣減與 `proposalVersionKey` 防重），並提供 `reset-settlement-state` 一鍵回滾重置，確保在任何評審站點 100% 不因跨專案必填欄位差異而失敗。
   - **b（採 Seat 4 多工單裂變方案）**：除了寫入原工單與 KVS 帳本外，還嘗試跨專案動態建立多張獨立的 Finance 與 Vendor Jira Issue（失敗時走多步 Outbox 補償刪除）。
