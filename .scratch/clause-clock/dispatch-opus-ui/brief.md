# Worker brief：clause-clock / atlassian-clause-clock

你是 `/Users/linhancheng/Desktop/projects/atlassian-clause-clock/.worktrees/opus-ui` 裡的完整 Claude Code session（`opus[1m]` + `effort: max`），這個 repo 的 hook、skill 與 settings 對你生效。派工的是另一個 session（main），它不在這個 worktree 裡；使用者本人也可能直接在這個視窗打字。

## 任務

用全域 `implement` skill（直接走 Inline 模式，不需再派 subagent 或再開 Herdr worker）做完 `/Users/linhancheng/Desktop/projects/atlassian-clause-clock/.worktrees/opus-ui/.scratch/clause-clock/issues/` 的最後一張 frontier 票：`03-studio-workbench-ui.md`（Tickets `01` 與 `02` 已在 `HEAD` `adc688e` 完成並標為 `done`）。

## 互動規則

- 使用者已在 main 完成 `/implement` Step 1 的唯一一輪提問（測試模式選 `tdd` 原 TDD），因此**不需要**再次向使用者提問 Step 1 問題，直接進入 Ticket `03` 實作：
  1. 先按 `tdd` 規則撰寫 `tests/ticket-03-studio-workbench-ui.test.ts`（Role 1 驗收測試批次，檢驗 `ClauseClockHostPort` adapter、workbench state controller、3-Minute Judge Checklist Bar、1-Click Seed 4-Scenario selector、5-Track Interval Waterfall、邊界橫幅、3 顆 Markdown 複製匯出、Support ↔ Finance `@forge/realtime` 同步與 Reset、以及 Rovo MCP & `SKILL.md` Live Inspector），先跑一次確認 RED。
  2. 實作 `app/_studio/`、`app/layout.tsx`、`app/page.tsx`、`app/globals.css`（及必要的收據 Markdown 格式化輔助函式），打磨出極具視覺張力、瑞士精密鐘錶／財務審計風格的五軌時間軸切片工作台（Five-Track Interval Waterfall Splicer & Upstream Vendor Apportionment Workbench）。
  3. 跑 `node --experimental-strip-types --test tests/ticket-01-interval-engine-and-pbt.test.ts tests/ticket-02-actions-mcp-and-forge-contract.test.ts tests/ticket-03-studio-workbench-ui.test.ts`、`npx tsc --noEmit`、`npm run build`，以及 `npx -y react-doctor@latest . --offline --verbose`（確認分數 `>= 90/100`）。
  4. 跑手動 ticket-yagni 檢查（`python3 ~/.claude/hooks/ticket-yagni-runner.py --manual --session "$CLAUDE_CODE_SESSION_ID" --ticket 03 --ticket-file /Users/linhancheng/Desktop/projects/atlassian-clause-clock/.worktrees/opus-ui/.scratch/clause-clock/issues/03-studio-workbench-ui.md --worktree /Users/linhancheng/Desktop/projects/atlassian-clause-clock/.worktrees/opus-ui --base adc688e`），處理完後勾選 `03-studio-workbench-ui.md` 的核取方塊、將 `**Status:**` 改為 `done`，並在 `feat/opus-ui` 分支完成 `git commit`。
- 以 `[main]` 開頭的訊息是 main 轉達的；其中標「以下為使用者原話」的段落才是使用者裁決，其餘是 main 的判讀。沒有前綴的訊息是使用者本人打的。
- 一包票做完再回報一次，不逐票回報。回報要含：Ticket `03` 的驗收逐條證據、commit 範圍、沒做的部分。

## 邊界

- 不 push、不開 PR、不 rebase、不 amend。
- 不跑 review-implement，main 會對這個 worktree 跑。
- 測試帶 `--maxWorkers=3`，不同時跑多個 build。
- 手動截圖與 curl 收據放 `/Users/linhancheng/Desktop/projects/atlassian-clause-clock/.scratch/clause-clock/dispatch-opus-ui/receipts`，不放會被測試清掉的目錄。
- 嚴禁使用任何 `sha256` / `md5` / `checksum` / `digest` 雜湊計算。

## 脈絡

- 規格：`/Users/linhancheng/Desktop/projects/atlassian-clause-clock/.worktrees/opus-ui/.scratch/clause-clock/spec.md`
- 票檔：`/Users/linhancheng/Desktop/projects/atlassian-clause-clock/.worktrees/opus-ui/.scratch/clause-clock/issues/03-studio-workbench-ui.md`
- 以下為使用者原話（逐字）：
  - 「`1.1 2.a`」
  - 「`照你推薦`」
  - 「`可以`」
  - 「`e`」
  - 「`1.b\n2.a\n3.a`」
  - 「`允許這次派工`」
- main 的判讀（不是裁決）：
  - Tickets `01`（`src/core/*`）與 `02`（`src/actions/*`, `app/api/clause-clock/route.ts`, `app/api/mcp/route.ts`, `manifest.yml`, `skills/clause-clock/SKILL.md`）皆已實作並通過 15/15 測試。
  - 請在 `app/_studio/` 建構核心無關宿主的 React 工作台與控制器（支援 `ClauseClockHostPort`，讓 Next.js Web Studio 與 Forge Custom UI `jira:issuePanel` / `jira:globalPage` 共用同一套元件），並確保包含所有驗收要求的 `data-testid` 與互動功能（包含 3 種一鍵 Markdown 收據匯出：`Copy Customer Credit Receipt`、`Copy Vendor Recovery Claim`、`Copy Confluence Ledger Row`）。
