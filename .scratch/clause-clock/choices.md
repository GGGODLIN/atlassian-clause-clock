# 實作決定帳本 · clause-clock

## Ticket 03 · implement run（commits e3ef15f、81da873、554aeb3；base adc688e；2026-11-06）

### 八類掃描

- 資料形狀與格式：有（D1、D2、D3）
- 存放位置與命名：有（D4）
- API 契約與錯誤行為：有（D5、D6、D7、D8、D9）
- 新增的相依套件：有（D10）——沒有新增 npm 套件；next/font 的三套 Google 字型與測試借用既有 typescript 轉譯算在這一條
- 並行與效能取捨：有（D11、D12）
- 範圍解讀：有（D13、D14、D15、D16、D17、D18）
- 測試設定改動：有（D19、D20）
- 之後的程式會照抄的模式：有（D21）
- 內部命名與純外觀選擇：合併計數——43 個 data-testid 名稱、19 個 `@theme` 色票、25 個 `cc-*` 樣式類別、字級與版面寬度、介面英文文案，不逐條列

### 決定

#### D1 · 對外的兩份 Markdown 收據不附 proposal key 與機器可讀 footer
- **何時**：e3ef15f（`app/_studio/receipt-markdown.ts:63`、`:39`）
- **決定**：評審按「Copy Customer Credit Receipt」或「Copy Vendor Recovery Claim」時，文件結尾只附收據編號（`RCPT-…`）。proposal key 裡嵌著廠商金額（`VEND…`），footer 裡有廠商分攤與內部吸收金額，這兩樣只放進內部用的 Confluence 帳本列。沒選的做法是三份都附 footer：稽核比較直接，但會把內部成本寄給客戶與廠商。
- **規格缺口**：Story 3 只說要給客戶、廠商、Confluence 三種「Markdown audit receipts」，沒定每份的內容；Story 5 要求每次計算回傳 footer，沒說對外文件也要附。
- **影響範圍**：之後新增的對外文件（email 範本、PDF 匯出）會照「對外只給收據編號」的切法。
- **判定**：sound — 對外文件不揭露內部成本，收據編號仍能回查完整 receipt。
- **把握度**：中

#### D2 · 廠商求償是一份列出所有廠商的文件
- **何時**：e3ef15f（`app/_studio/receipt-markdown.ts:91`；`:90` 的註解寫「each vendor sees its own」，與實際輸出不符）
- **決定**：一個 claim 有多家上游廠商時（Titan 有 3 家），按一次「Copy Vendor Recovery Claim」會產出一份文件，每家一段，各自列重疊時段、分攤比例與求償金額，也列出客戶拿到的抵扣額。沒選的做法是每家各產一份，彼此看不到別家的求償金額。
- **規格缺口**：規格只說要給「upstream vendors」的收據，沒說一份還是每家一份、廠商能不能看到彼此。
- **影響範圍**：決定了求償文件的發送單位；改成每家一份要改匯出按鈕的數量或互動。
- **判定**：needs-user — 廠商之間能不能互看金額是商務揭露政策。暫定做法：維持一份多段；撤回方式：`vendorRecoveryClaim` 依 `vendorId` 拆成多份，匯出區改成每家一顆按鈕，順手修正 `:90` 的註解。
- **把握度**：低

#### D3 · Confluence 帳本列是「表頭＋分隔線＋一列」的完整小表格，共 11 欄
- **何時**：e3ef15f（`app/_studio/receipt-markdown.ts:123`）
- **決定**：按「Copy Confluence Ledger Row」會複製三行 Markdown：表頭、分隔線、資料列。欄位有 claim、客戶、帳期、淨停機、客戶抵扣、廠商回收、各廠商明細、內部吸收、proposal key、收據編號、狀態。沒選的做法是只複製資料列一行：貼進既有表格最省事，但單獨貼上時不會變成表格。
- **規格缺口**：規格只寫「Confluence Ledger Row」，沒定欄位與是否帶表頭。
- **影響範圍**：日後 Confluence 帳本的欄位順序會照這 11 欄排。
- **判定**：sound — 單獨貼上也能顯示成表格；欄位涵蓋 receipt 裡所有對帳要用的金額。
- **把握度**：中

#### D4 · 共用元件全部放在 `app/_studio`，不 import `next/*`
- **何時**：e3ef15f（`app/_studio/` 共 19 檔；`grep "from 'next" app/_studio` 無結果）
- **決定**：工作台、控制器、轉接層、時間軸模型、收據格式化都放在 `app/_studio`，元件只靠 `ClauseClockHostPort` 拿外部能力。Next 專屬的東西（字型、伺服器端讀 SKILL.md、讀 store 快照）只在 `app/layout.tsx` 與 `app/page.tsx`。沒選的做法是元件直接 `fetch('/api/…')` 或用 `next/link`：寫起來短，但 Forge Custom UI 就不能直接掛同一套元件。
- **規格缺口**：spec 只說兩個宿主共用同一套 React 工作台，沒定檔案邊界。
- **影響範圍**：之後做 Forge 打包時，只需要另寫一個 `@forge/bridge` 版的 host port。
- **判定**：sound — 直接對應 spec「injected `ClauseClockHostPort` adapter」的設計。
- **把握度**：高

#### D5 · `ClauseClockHostPort` 定為五個方法
- **何時**：e3ef15f（`app/_studio/host-port.ts:128`）
- **決定**：工作台需要外部能力時一律走 port：`executeAction`（四個 action）、`callMcpTool`（回傳 MCP 請求與回應原文）、`readSkillContract`、`subscribeSettlementChannel`、`copyText`。Web 版用 HTTP 打既有的 `/api/clause-clock` 與 `/api/mcp`。剪貼簿也放進 port，因為 Forge iframe 不一定能用 `navigator.clipboard`。沒選的做法是只開一個通用的 `fetch` 介面：介面更小，但 Forge 版得在元件裡分辨路由。
- **規格缺口**：spec 只寫了 port 的名字，沒定它的方法。
- **影響範圍**：Forge 版轉接層必須實作這五個方法。
- **判定**：sound — 每個方法對應一個票面驗收（四個 action、MCP 檢視、SKILL.md、realtime、複製）。
- **把握度**：中

#### D6 · Web 版用頁內廣播模擬 `@forge/realtime`，冪等重放時補發一則事件
- **何時**：e3ef15f、554aeb3（`app/_studio/host-port.ts:133`、`:105`）
- **決定**：伺服器回應裡帶 `realtimeEvent` 時，轉接層把它轉發給同一頁的訂閱者（Support 與 Finance 兩欄）。如果回應是冪等重放（store 早已結算、這次沒有新事件），就從 KVS 紀錄合成一則 `EVT-<claim>-SETTLED-REPLAY` 事件，讓錯過原始提交的訂閱者也會變成 SETTLED。沒選的做法是在伺服器端加推播（SSE 或 polling）：可以跨分頁同步，但要改 Ticket 02 的 API 契約。已知限制：透過 MCP 呼叫 `resetAll` 只會廣播當前 claim 的 READY。
- **規格缺口**：spec 只說要「split-view `@forge/realtime` broadcast preview」，沒定 web 版怎麼模擬，也沒定重放算不算一次廣播。
- **影響範圍**：Forge 版要用真正的 realtime 訂閱取代這段，同時決定重放時要不要補發。
- **判定**：sound — 不改既有 API 就滿足 AC4，重放補發的行為有回歸測試釘住。
- **把握度**：中

#### D7 · 預覽在瀏覽器算，approval token 在瀏覽器組，提交時由伺服器重算比對
- **何時**：e3ef15f（`app/_studio/workbench-controller.ts:283`、`:371`）
- **決定**：每次切換情境、時區或勾選，瀏覽器直接用核心引擎重算 proposal key（不呼叫伺服器）。核准開關打開後，按提交時在瀏覽器組出 `APPROVAL::<key>::<approverId>`，由伺服器重算一次 key 來比對。沒選的做法是每次切換都呼叫 evaluate API：瀏覽器與伺服器的引擎版本必然一致，但每個切換都要等一次網路。風險（未驗證的推測）：引擎用 `new Date(toLocaleString(...))` 算時區偏移，依 ECMAScript 規格，非 ISO 格式的字串怎麼解析由各瀏覽器決定；如果某個瀏覽器解析失敗，瀏覽器算出的 key 會和伺服器不同，提交會被 409 擋下。
- **規格缺口**：spec 說「instant browser evaluation」與「recomputes … via the shared core engine」，沒寫伺服器與瀏覽器的計算分工。
- **影響範圍**：引擎的瀏覽器相容性從此是使用者看得到的行為。
- **判定**：sound — 符合 spec「shared core engine」；伺服器重算保證不會寫入錯的 key。
- **把握度**：中

#### D8 · 提交鎖、核准清除與晚到回應的規則
- **何時**：e3ef15f、554aeb3（`app/_studio/workbench-controller.ts:330`、`:194`、`:236`、`:158`）
- **決定**：
  - 提交鍵在這些情況會鎖住：claim 已結算（不論是哪個 key 結算的）、沒填審批者、核准沒有綁在目前的 key、草稿合約沒填例外理由、另一個請求還在跑。
  - 改審批者、收到 409（key 已過期）都會清掉核准；收到 400（例如缺例外理由）會保留核准。
  - 切換情境後才回來的舊回應，只更新它自己那個 claim 的結算狀態，不動新情境的核准和橫幅。
  - 沒選的做法是請求在跑時鎖住所有輸入：程式更簡單，但每次請求期間整個畫面都不能動。
- **規格缺口**：AC2 只寫切換時要清核准與舊橫幅，沒寫請求在路上時怎麼辦；也沒寫哪些拒絕會清掉核准。
- **影響範圍**：之後新增的 action（例如批次結算）都要遵守「回應只改自己的 claim」。
- **判定**：sound — 核准永遠綁在畫面上那個 key；晚到回應的規則有回歸測試釘住。
- **把握度**：高

#### D9 · 失敗橫幅一律標成 `HOST_UNREACHABLE`
- **何時**：e3ef15f（`app/_studio/workbench-controller.ts:254`）
- **決定**：不論是複製到剪貼簿失敗、MCP 呼叫失敗，還是伺服器回了非 JSON，畫面都顯示 `HOST_UNREACHABLE` 橫幅，附上例外訊息。沒選的做法是依失敗的操作分別標示。
- **規格缺口**：規格沒定前端錯誤的分類與文案。
- **影響範圍**：評審看到剪貼簿權限問題時，會以為是伺服器掛了。
- **判定**：unsound — 橫幅代碼應該標出失敗的是哪個操作（copy／host request／MCP），只有網路層真的連不上時才叫 unreachable。應該重做成：`HOST_FAILED` 帶上操作種類，橫幅依種類顯示。
- **把握度**：中

#### D10 · 字型用 next/font 的三套 Google 字型；測試借既有 typescript 轉譯 .tsx
- **何時**：e3ef15f（`app/layout.tsx:14`；`tests/ticket-03-studio-workbench-ui.test.ts:58`）
- **決定**：
  - 字型用 Instrument Serif、Instrument Sans（含字寬軸）、IBM Plex Mono，在 build 時下載後由站台自己提供，執行時不連外，也不受 Forge CSP 限制。
  - 測試用 Node 執行期才有的 `module.registerHooks` 加上 repo 既有的 `typescript` 即時轉譯 `.tsx`，沒有新增測試套件。
  - 沒選的做法：系統字型（build 不用連網，但瑞士錶風格會打折）；或加裝 jsdom、testing-library（測得到元件掛載，但多兩個開發套件）。
  - 附帶條件：build 要能連到 Google Fonts；測試要 Node 22.15、23.5 或更新版本。
- **規格缺口**：brief 只要求「極具視覺張力、瑞士精密鐘錶／財務審計風格」，沒定字型與測試工具。
- **影響範圍**：CI 或離線環境跑 build 會被字型下載卡住；測試鎖定較新的 Node。
- **判定**：sound — 沒增加 npm 相依；兩個附帶條件都寫進了 Verification Log。
- **把握度**：中

#### D11 · 預設 store 改成整個行程共用一份（動到 Ticket 02 的檔案）
- **何時**：554aeb3（`src/actions/clause-clock-store.ts:152`）
- **決定**：實測發現 Next 16.3 把頁面和 API 路由打包成兩份 store 模組，頁面讀到的是另一份全新的 store。改成把預設 store 掛在 `globalThis`，同一個 Node 行程只有一份。沒選的做法是頁面不讀伺服器狀態：不用改 Ticket 02，但重新整理後兩欄永遠先顯示 READY。
- **規格缺口**：spec 說 MCP 與工作台要用「shared store」，沒說 Next 打包後要怎麼保證共用。
- **影響範圍**：所有用 `getDefaultClauseClockStore` 的伺服器程式都共用這一份；如果部署成多個 serverless 實例，實例之間仍然各有一份（不在本票範圍）。
- **判定**：sound — 讓「共用 store」在 Next 打包後仍然成立，Ticket 01、02 的測試全綠。
- **把握度**：中

#### D12 · 頁面每次請求讀一次伺服器快照，之後不輪詢
- **何時**：554aeb3（`app/page.tsx:9`、`:18`；`app/_studio/settlement-sync.ts:77`）
- **決定**：首頁設成每次請求動態產生，把當下 store 的結算狀態（含已結算的 receipt 與審批者）交給兩欄當初始值。之後只靠自己的動作、重放補發或重新整理更新，不輪詢伺服器。沒選的做法是固定間隔輪詢 evaluate：其他分頁或其他評審的變更也看得到，但會多出持續的請求。
- **規格缺口**：spec 沒定 web studio 的多客戶端同步要求。
- **影響範圍**：兩位評審同時操作同一個部署時，要重新整理才看得到對方的結算。
- **判定**：sound — 第一次渲染反映真實狀態，不另加輪詢機制。
- **把握度**：中

#### D13 · 不做 Forge Custom UI 打包與 `@forge/bridge` 轉接層
- **何時**：開工前預檢回報的假設 1（main 沒有糾正）；落點記在 `.scratch/clause-clock/issues/03-studio-workbench-ui.md:49`（Verification Log「Not built in this ticket」），範圍體現在 e3ef15f 的 `app/_studio/host-port.ts:128`（只有 HTTP 版轉接層）
- **決定**：只交付共用元件、port 介面和 Next 版轉接層。`@forge/bridge` 版轉接層、Custom UI 靜態包（`out/`）、manifest 指定的 Forge function handler 都沒做。沒選的做法是這張票順便做 Forge 打包：要新增套件、另一套 build 設定和 Forge 後端。
- **規格缺口**：「What to build」寫兩個宿主都要能渲染，但驗收 5 條與驗證方法只要求 web 版。
- **影響範圍**：要上 Forge 前還需要一張票。
- **判定**：sound — 照驗收清單縮到最小範圍，介面已預留好。
- **把握度**：中

#### D14 · 時區切換只給兩個選項
- **何時**：e3ef15f（`app/_studio/workbench-controller.ts:52`、`:313`）
- **決定**：合約缺時區時給「UTC（補位）」和 `America/Los_Angeles`；合約有時區時給「合約時區」和 UTC；合約本身就是 UTC 時不顯示切換。洛杉磯是照 Meridian 情境描述選的。沒選的做法是列出所有 IANA 時區：彈性大，但示範焦點會散掉。
- **規格缺口**：AC2 寫「`UTC` vs. contract timezone」，沒說合約缺時區時要拿什麼對照。
- **影響範圍**：示範時唯一能看到的跨月邊界效果，就是洛杉磯這一組；而它目前建立在引擎方向相反的時區換算上（見 D20）。
- **判定**：sound — 照情境描述；引擎問題已另外記錄。
- **把握度**：中

#### D15 · 評審檢查列 7 步，依實際動作自動打勾
- **何時**：e3ef15f、81da873（`app/_studio/workbench-controller.ts:41`、`:137`）
- **決定**：檢查列定了 7 步（選情境、改輸入、核准提交、看 Finance 同步、複製收據、呼叫 MCP、重置），評審做完對應動作就自動打勾，並顯示「x / 7」。沒選的做法是只列步驟、不追蹤完成度。YAGNI 審查把自動打勾判為降級，我保留了簡化版。
- **規格缺口**：Story 2 寫「3-Minute Judge Guided Checklist Bar」，沒說要不要追蹤進度、要列哪幾步。
- **影響範圍**：之後新增的示範能力要記得補一步。
- **判定**：needs-user — 「guided checklist」要不要追蹤進度是產品取捨。暫定做法：保留自動打勾；撤回方式：刪掉 `completedSteps`、`completeStep` 和檢查列的完成樣式，改成靜態清單。
- **把握度**：中

#### D16 · 保留 YAGNI 審查判刪的三錶盤儀表
- **何時**：e3ef15f、81da873（`app/_studio/chronograph-subdials.tsx`；使用處在 `app/_studio/clause-clock-workbench.tsx:112`）
- **決定**：首屏右側放三個錶盤（淨停機、可用率、抵扣額），紅色虛線指針是試算表的讀數，夜光綠指針是 ClauseClock 的讀數。YAGNI 審查判它「重複既有比較、不對應驗收」應刪除；我以 brief 的瑞士錶視覺要求保留。沒選的做法是刪掉，首屏只留情境卡。
- **規格缺口**：驗收沒提到這類視覺元件，brief 只寫了風格要求。
- **影響範圍**：只有視覺，沒有其他程式依賴它。
- **判定**：needs-user — 視覺品味的取捨。暫定做法：保留；撤回方式：刪掉 `chronograph-subdials.tsx` 和 `clause-clock-workbench.tsx:112` 那一處，情境選擇改佔滿整列。
- **把握度**：低

#### D17 · 審批者 ID 預設空白，要自己輸入
- **何時**：81da873（`app/_studio/workbench-controller.ts:126`）
- **決定**：原本預填 `USR-SUPPORT-LEAD`，YAGNI 刪除後改成空白，評審要先輸入自己的 ID 才能提交（輸入框有範例提示）。沒選的做法是預填：示範少一步，但 token 裡的身分就不是人自己給的。
- **規格缺口**：spec 要求 token 帶 approverId，沒說 web 版的身分從哪來。
- **影響範圍**：Forge 版會改用登入者帳號。
- **判定**：sound — 身分由人提供，才符合人工核准的意思。
- **把握度**：中

#### D18 · MCP 提交範本的 token 預設空白
- **何時**：e3ef15f、554aeb3（`app/_studio/workbench-controller.ts:307`；`app/_studio/mcp-inspector.tsx:346`）
- **決定**：檢視器裡 `commit-credit-settlement` 的參數範本，approvalToken 預設是空字串。評審直接按執行會先看到 400 `MISSING_HUMAN_APPROVAL_TOKEN`。說明文字寫明 token 只是可讀的綁定字串，不是密鑰。沒選的做法是預填一個有效的 token：一鍵就能提交，但示範不到閘門。
- **規格缺口**：Story 2 要求檢視器能執行四個工具，沒定預設參數。
- **影響範圍**：評審第一次執行 commit 一定會先失敗，要有心理準備。
- **判定**：sound — 先看到人工核准閘門，正是 Story 4 的重點。
- **把握度**：中

#### D19 · UI 測試只做伺服器端渲染，不掛載元件
- **何時**：e3ef15f（`tests/ticket-03-studio-workbench-ui.test.ts:58` 的 `.tsx` 轉譯 hook、`:193` 的 `renderWorkbench` 伺服器端渲染）
- **決定**：
  - 現在的測法：畫面合約用 `renderToStaticMarkup` 驗 data-testid 和數字，互動行為用 reducer 與 host port 驗，元件的訂閱另外靠真實 Chrome 手動檢查。
  - 已知缺口（審查 F-08）：把元件裡的 `useEffect` 訂閱刪掉，測試仍然全綠。
  - 沒選的做法是加 jsdom 或 happy-dom 做掛載測試。
- **規格缺口**：票的 test seam 是「state controller、host port、UI contract」，不含元件掛載。
- **影響範圍**：之後改元件的訂閱或事件處理，只有手動檢查擋得住。
- **判定**：needs-user — 要不要為這個缺口新增開發套件是範圍決定。暫定做法：維持現狀，加上已記錄的 Chrome 檢查；撤回方式：新增 jsdom 或 happy-dom，用 `react-dom/client` 加 `act()` 補 FinanceSubscriberPanel 與工作台的掛載測試。
- **把握度**：中

#### D20 · AC2 測試釘住引擎目前（方向相反）的時區換算結果
- **何時**：e3ef15f、81da873（`tests/ticket-03-studio-workbench-ui.test.ts:340`）
- **決定**：AC2 測試裡，切到洛杉磯後預期的 key 是 `CCLOCK-JSM-418-2026-11-NET60M-CRED150000-VEND75000`，也就是引擎現在的輸出。照真實洛杉磯時間，這起事故落在 10 月，應該是 `CCLOCK-JSM-418-2026-11-NET0M-CRED0-VEND0`。沒選的做法是在這張票順便修引擎：會動到 Ticket 01 的程式與情境描述。
- **規格缺口**：Ticket 01 的測試只檢查切時區後分鐘數會變，沒檢查方向；情境描述寫的就是錯誤方向的結果。
- **影響範圍**：修正引擎時，這個 key、情境描述和時區切換的示範故事都要一起改。
- **判定**：needs-user — 要不要修、什麼時候修是 Ticket 01 的範圍決定。暫定做法：維持現狀，並在 Verification Log 記錄；撤回方式：引擎改用 `offset(billing) − offset(contract)`，更新這個 key 與 Meridian 情境描述，示範改用 UTC 以東的時區（例如 `Asia/Tokyo`）。
- **把握度**：中

#### D21 · 之後會被照抄的模式：純 reducer、回傳 action 的 async command、能力只走 port
- **何時**：e3ef15f（`app/_studio/workbench-controller.ts`、`app/_studio/host-port.ts`）
- **決定**：
  - 狀態轉換寫成純 reducer。
  - 需要打伺服器的動作寫成 async command，例如 `runCommitCommand`，它只回傳要 dispatch 的 action，不碰 React。
  - 元件不 import `next/*`。
  - 沒選的做法是把 fetch 寫在元件的事件處理裡：比較短，但測試得掛載元件才能測。
- **規格缺口**：spec 沒定前端的狀態管理寫法。
- **影響範圍**：之後加的面板與 action 會照這個切法寫。
- **判定**：sound — 讓控制器能在沒有 DOM 的 Node 測試裡完整驗證。
- **把握度**：高

### 霧區建議

- D6、D11、D12 都落在「結算狀態以誰為準、多個客戶端怎麼同步」，建議回 spec 補一段 web studio 的狀態來源與同步策略，否則每加一個面板都要再判一次。
- D1、D2 都落在「對外文件能揭露什麼」，建議回 spec 補一段收據對象與揭露政策。

---

## Tickets 01–02 & Closeout Review · implement run（commits f38949d、31fc2c3、adc688e 與收尾修補；base 6b085e2；2026-11-06）

### 八類掃描

- 資料形狀與格式：有（D22）
- 存放位置與命名：無（依 ticket 與 Next.js App Router 慣例放置於 `src/core`、`src/actions`、`app/api`）
- API 契約與錯誤行為：有（D23、D24）
- 新增的相依套件：有（D25）
- 並行與效能取捨：有（D26）
- 範圍解讀：無（已在 D13、D20 涵蓋）
- 測試設定改動：無（維持 Node 內建 `--experimental-strip-types --test`）
- 之後的程式會照抄的模式：有（D27）
- 內部命名與純外觀選擇：合併計數——14 個匯出型別名稱與 4 個固定劇本 ID，不逐條列

### 決定

#### D22 · 多供應商同時段重疊時，以 `BigInt` 共同分母解耦內部吸收權重與供應商重疊池
- **何時**：f38949d（`src/core/clause-clock-engine.ts:438-625`）
- **決定**：當同一段客戶淨停機（例如 60 分鐘）同時被多家上游供應商的故障時段重疊覆蓋時，引擎先把「有任一供應商覆蓋的聯集分鐘數（`vendorCoveredMinutes`）」與「純內部吸收分鐘數（`internalAbsorbedMinutes`）」按 `netOutageMinutes` 切開，再以 `BigInt(netOutageMinutes) * BigInt(sumRawVendorOverlapMinutes)` 為共同有理數分母，在單一最大餘數法（Largest Remainder Method）迴圈內同時分攤各供應商與內部吸收的美分。沒選的做法是直接拿 `sum(vendorOverlapMinutes) + internalAbsorbedMinutes` 當分母：當兩家供應商在同一時段重疊時，總分鐘數會超過 `netOutageMinutes`，導致內部吸收的百分比與金額被不當稀釋。
- **規格缺口**：spec 只規定 `sum(vendorApportionedCents) + internalAbsorbedCents === newCreditCents` 與最大餘數法，未規定多家供應商在同一分鐘重疊時如何避免稀釋內部吸收比例。
- **影響範圍**：所有多供應商重疊劇本（含 `monthly-cap-truncation` 與隨機 PBT 測試）的各供應商求償金額與內部吸收金額。
- **判定**：sound — 以 `BigInt` 精確有理數同時保證美分守恆、消除浮點數餘數誤差，且內部吸收比例嚴格等於 `internalAbsorbedMinutes / netOutageMinutes`。
- **把握度**：高

#### D23 · 非法 `timezoneOverride` 字串退回合約時區或 `UTC`，並將 `disabledIncidentIds`／`disabledMaintenanceIds` 納入 `replayCommand`
- **何時**：收尾審查修補（`src/core/clause-clock-engine.ts:35-48,645-655,826-834`）
- **決定**：當外部呼叫端或 MCP 傳入的 `timezoneOverride` 不是合法的 IANA 時區名稱（例如含引號或控制字元的字串）時，`isValidIanaTimezone` 先以正規表示式與 `Intl.DateTimeFormat` 驗證；驗證失敗時直接忽略該覆寫、退回合約時區或 `UTC`，並在組裝 `replayCommand` 時以 `node --experimental-strip-types -e` 搭配 `JSON.stringify` 輸出 `timezoneOverride`、`disabledIncidentIds` 與 `disabledMaintenanceIds`。沒選的做法是直接把原始字串拼進 `replayCommand` 與 `machineReadableFooter`：會讓非法字串破壞收據頁尾格式，且停用單一事件後複製 `replayCommand` 無法重現相同結果。
- **規格缺口**：spec 只寫缺時區時退回 `UTC`，沒定傳入損壞或惡意時區覆寫字串時的處理方式，也沒定停用部分區間後的 `replayCommand` 序列化格式。
- **影響範圍**：`/api/clause-clock`、`/api/mcp` 與 CLI 重放指令的輸入邊界與重現性。
- **判定**：sound — 防止非法時區破壞收據格式，並確保任何區間開關組合下的 `replayCommand` 都能一鍵重現。
- **把握度**：高

#### D24 · 結算與重置的 `@forge/realtime` 事件時間戳依事件序號單調遞增
- **何時**：收尾審查修補（`src/actions/clause-clock-dispatcher.ts:641,802`）
- **決定**：當操作者執行 `commit-credit-settlement` 或 `reset-settlement-state` 時，產生的 `@forge/realtime` 事件與內部紀錄時間戳以基準時間加上 `store.realtimeEvents.length` 秒（`Date.UTC(2026, 10, 6, 12, 0, store.realtimeEvents.length)`）計算。沒選的做法是呼叫系統即時時鐘 `new Date()`（會讓確定性測試每次結果不同）或寫死兩個固定常數時間（會在「結算 → 重置 → 再結算」時發生時間戳倒退）。
- **規格缺口**：spec 要求決定性測試與即時事件預覽，但沒定無真實時鐘注入時如何產生單調遞增的事件時間戳。
- **影響範圍**：`store.realtimeEvents`、`jsmInternalNotes` 與 `kvsSettlementRecords` 的時間戳欄位。
- **判定**：sound — 兼具測試決定性與事件時間序列單調遞增性。
- **把握度**：高

#### D25 · 基礎建設僅安裝 `next`、`react`、`react-dom`、`fast-check` 與 `tailwindcss`，零額外執行期套件
- **何時**：6b085e2（`package.json:14-27`）
- **決定**：專案執行期相依套件只放 `next@16.3.6`、`react@19.2.8`、`react-dom@19.2.8` 與 `fast-check@^4.1.1`；YAML 與 `SKILL.md` frontmatter 解析、區間掃描線與 MCP JSON-RPC 路由全部以純 TypeScript 實作。沒選的做法是額外引入 `js-yaml`、`gray-matter`、`luxon` 或 `@modelcontextprotocol/sdk`：會增加安裝體積與供應鏈風險。
- **規格缺口**：spec 只指定 `fast-check` 與 Next.js / Forge 架構，沒定輔助解析套件清單。
- **影響範圍**：`src/actions/forge-contract-validator.ts` 與 `app/api/mcp/route.ts` 的解析器需維持在專案支援的固定語法子集內。
- **判定**：sound — 保持零多餘相依套件，3 秒完成安裝且通過所有契約測試。
- **把握度**：高

#### D26 · `run-pbt-audit` 的隨機測試次數夾限於 `10..500`（預設 `100` 次）
- **何時**：f38949d、adc688e（`src/core/clause-clock-pbt.ts:183`）
- **決定**：當使用者或 MCP 呼叫 `run-pbt-audit` 時，`numRuns` 預設為 `100`，並強制夾限在 `[10, 500]` 之間（單次執行約 40–80ms）。沒選的做法是不設上限任由呼叫端傳入 `1000000`：會在每次分配 `Uint8Array(44640)` 位元圖時耗盡伺服器 CPU、撞上 Forge 25 秒限制。
- **規格缺口**：spec 要求提供互動式 `run-pbt-audit` 工具，但未指定單次呼叫的 `numRuns` 上下限。
- **影響範圍**：MCP 與 UI 呼叫 `run-pbt-audit` 的回應延遲與覆蓋深度。
- **判定**：sound — 在 100ms 內完成 `P1..P4` 驗證並防止過大 `numRuns` 造成阻斷服務。
- **把握度**：高

#### D27 · 雙型別區間回傳（Array + 具名欄位）作為核心引擎與工作台之間的共用慣例
- **何時**：f38949d（`src/core/clause-clock-engine.ts:72-128,185-267`）
- **決定**：當呼叫 `clipIntervalsToWindow` 或 `subtractIntervals` 時，回傳值以 `Object.assign(arrayResult, { clippedIntervals, clippedCount })` 同時具備陣列行為與具名屬性。沒選的做法是只回傳純物件或只回傳純陣列：只回傳陣列拿不到被裁切筆數（`clippedCount`）與被扣除切片（`deductedSlices`），只回傳物件則不方便直接串接區間管線。
- **規格缺口**：Ticket 01 要求匯出 `subtractIntervals` 並在 `CalculationReceipt` 提供 `maintenanceDeductedSlices` 與 `boundaryClippedCount`，未規定輔助函式的回傳包裝方式。
- **影響範圍**：之後新增的區間運算函式若同時需要切片主體與統計附帶資訊，會沿用此雙型別回傳模式。
- **判定**：sound — 兼顧函數式陣列串接與收據明細欄位提取。
- **把握度**：中

