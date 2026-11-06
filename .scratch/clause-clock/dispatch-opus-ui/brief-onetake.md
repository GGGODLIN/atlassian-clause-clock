# Worker brief：ClauseClock `onetake` 45s Launch Film（Concept A：`The Calibre Escape`）

你是 `/Users/linhancheng/Desktop/projects/atlassian-clause-clock/.worktrees/opus-ui` 裡的完整 Claude Code session（`opus[1m]` + `effort: max`）。Main 已完成 `/implement` Step 3 全數收尾（`review-implement` Run 1 `PASS`、`task-verifier` `PASS`、commit `91aefe5`），並已將你的 worktree fast-forward 對齊至 `91aefe5`。

## 任務

使用 `/Users/linhancheng/Desktop/projects/onetake-trial/.claude/skills/onetake/SKILL.md`（可參考旁邊刚做完通過 8/8 驗收的 `/Users/linhancheng/Desktop/projects/onetake-trial/films/qnx-vss-warden-opus/` 的 `tools/whisper_words.py`、`tools/balance.py`、`score.py` 與 `verify_promo.py` 做法），在 `/Users/linhancheng/Desktop/projects/onetake-trial/films/atlassian-clause-clock-opus/` 製作 **ClauseClock** 的 45 秒 1080p30 產品演示影片（含 Kokoro 英文配音＋中英雙語字幕＋合成音效＋`verify_promo.py` 全項目 PASS），並將最終產物複製回本專案 `docs/media/`。

## 這支片要讓人看懂的一句話（必填核心主旨）

> 當企業客戶在 Jira Service Management 提出 SLA 賠償索賠時，傳統試算表把重疊事故與排定維護重複相加而超賠 `$3,500`，而 `ClauseClock` 用半開整數分鐘掃描線與 `BigInt` 最大餘數法把 `120m` 摺疊扣除成精準的 `75m`（`$1,500` 淨抵扣 ＝ `$900` 上游供應商求償 ＋ `$600` 內部吸收），並經人類核准權杖一鍵同步至 Support 與 Finance 雙視角及 Rovo MCP。

## 使用者原話與拍板概念

- 以下為使用者原話（逐字）：
  - 「`1a 2a`」
- 對應使用者選定的 **概念 A：`The Calibre Escape（擒縱輪的刀鋒）`**：
  - **一句話核心畫面**：一顆發光的瑞士鐘錶紅寶石／夜光綠游標從題頭錶盤秒針跳出，化為時間掃描線切開重疊事故、削去維護紅區、把 `$5,000` 試算表泡沫切成 `$1,500`，滑入供應商分攤表拆出 `$900 / $600`，最後凝聚成人類核准開關圓鈕，撥動後裂變為左右兩道 `@forge/realtime` 脈衝同時點亮 Support 與 Finance 的 `SETTLED` 徽章。
  - **每段轉場承接（Carry）**：錶盤指針尖端 → 五軌瀑布圖掃描線（`morphRect` / 游標引導）→ 切下的 `45m` 藍寶石切片落入供應商分攤表 → 凝聚成 `Human approval` 撥桿 → 雙欄 `@forge/realtime` 同步脈衝與 Rovo MCP 收據頁尾 → 收攏為 `ClauseClock · CALIBRE CC-26` 終場標誌。
  - **視覺風格（Look）**：直接沿用你自己剛設計的 `ClauseClock` 瑞士精密鐘錶審計美學（象牙宣紙 `#F6F2EA` 搭配深色黑曜石機芯面板 `#121417`、夜光計時綠 `#D4FF47`、藍寶石供應商軌 `#5B8DEF`、硃砂警示紅 `#E5484D`，字型 `Instrument Serif` / `Instrument Sans` / `IBM Plex Mono` / `Noto Sans TC`）。

## 必須與產品 100% 一致的真實資料（由產品引擎 `reconcileClauseClock` 實際輸出，不可捏造）

可寫一支小腳本直接執行本 repo `src/core/index.ts` 與 `src/actions/index.ts` 匯出真實 JSON：
1. **Hero Scenario (`hero-overlap-splicer` / `JSM-402` · `Acme Global Retail`)**：
   - 帳期：`2026-11`（`America/New_York`，`43,200` 分鐘，月費 `$20,000.00`，月度上限 `$6,000.00`，前期已核發 `$500.00`）。
   - Track I Raw Incidents：`INC-901` (`10:00–11:00`, `60m`) + `INC-902` (`10:30–11:30`, `60m`) = `120m`（傳統試算表誤入 `25%` 級距 = `$5,000.00`）。
   - Track II Merged Union：`[10:00, 11:30)` = `90m`（摺疊 `30m` 重疊）。
   - Track III Maintenance Deduction：`CHG-210` (`10:45–11:00`) = `-15m`。
   - Track IV Customer Net Outage：`[10:00, 10:45)` (`45m`) + `[11:00, 11:30)` (`30m`) = `75m`（可用率 `99.8264%`，匹配 `10%` 級距 = 毛抵扣 `$2,000.00` 減前期 `$500.00` = **`$1,500.00`** 淨抵扣，攔截 **`$3,500.00`** 超發）。
   - Track V Vendor Overlap Slices：`CloudEdge Transit` (`VEND-CLOUD-NET`, `edge-bgp-us-east`) `[10:00, 10:45)` 重疊 `45m`（`60.00%` = **`$900.00`** 供應商求償；剩餘 `30m` `40.00%` = **`$600.00`** 內部吸收）。
   - Proposal Version Key：`CCLOCK-JSM-402-2026-11-NET75M-CRED150000-VEND90000`
   - Receipt ID：`RCPT-JSM-402-2026-11-NET75M`
2. **其他三大防呆與亮點（可在中段 staccato burst 或快速巡檢帶出）**：
   - `JSM-418` (`Meridian FinTech Corp`)：缺時區預設 `UTC` (`40m` → `$0.00`) vs 切換時區 (`60m` → `$1,500.00`)。
   - `JSM-425` (`Titan Cloud Logistics`)：`$3,000.00` 毛抵扣受月度剩餘上限截斷為 `$800.00` (`80000` cents)，3 家供應商各重疊 `20m` 由 `BigInt` 最大餘數法精確拆為 `26667 + 26667 + 26666 === 80000` cents（`$266.67 / $266.67 / $266.66`）。
   - `JSM-439` (`Nova BioLabs`)：`DRAFT` 合約自動鎖定提交，直到填入 Finance Override；以及 Rovo MCP 4 工具與 `fast-check` `P1..P4` 對照 `Uint8Array(44640)` 位元圖 Oracle 全綠。

## 硬性邊界與環境提示

- **只能殺自己啟動的 PID**：絕對禁止跑 `pkill -f chrom` 或殺掉非自己啟動的瀏覽器／程序。
- 轉字詞時間可直接重用 `/Users/linhancheng/Desktop/projects/onetake-trial/films/qnx-vss-warden-opus/tools/whisper_words.py`（避開 PyAV `metadata_errors` 問題）。
- `render.py` 請帶 `--gap 6 --samples-max 48`（1080p30 draft 即為最終交付規格，不需跑 4K60 `--final`）。
- 算圖完成後必跑 `verify_promo.py <mp4> --comp comp.html --shots ...`，確認所有檢查腿（rhythm、continuity carry >= 0.5、curves、framing、audio）全數 **PASS**。
- 完成後將：
  1. 最終影片複製到 `/Users/linhancheng/Desktop/projects/atlassian-clause-clock/.worktrees/opus-ui/docs/media/clause-clock-demo.mp4`
  2. `stills.png` 與 4–6 張高解析度展示圖複製到 `/Users/linhancheng/Desktop/projects/atlassian-clause-clock/.worktrees/opus-ui/docs/media/`（並 commit 進 `feat/opus-ui` 分支）。
