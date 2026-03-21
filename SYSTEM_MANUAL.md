# FYP Scheduling System Manual / FYP 排程系統手冊

## 1. System Overview
### English
This system schedules FYP presentation sessions by combining student-supervisor-observer relationships, professor availability, and room availability. The application has five major parts:

1. Frontend UI: file upload, validation feedback, schedule display, manual adjustments, and AI advice.
2. Data parsing layer: converts CSV/XLSX files into normalized students, slots, rooms, and professor availability.
3. Scheduling layer: sends a normalized payload to the selected solver and validates the returned result.
4. Python solver layer: solves the scheduling problem with CP-SAT, PuLP ILP, or the legacy heuristic solver.
5. Support tools: subset generator, testing fixtures, and bilingual text resources.

### 繁體中文
本系統會結合學生、指導教授、口試教授、教授可用時間與房間可用時間，自動安排 FYP 口試時段。系統可分成五個主要部分：

1. 前端介面：負責上傳檔案、顯示驗證結果、呈現排程、手動調整與 AI 建議。
2. 資料解析層：將 CSV/XLSX 轉成統一格式的學生、時段、房間與教授可用時間資料。
3. 排程層：把正規化後的資料送到指定 solver，並驗證 solver 回傳結果。
4. Python solver 層：使用 CP-SAT、PuLP ILP 或 legacy heuristic 進行排程求解。
5. 輔助工具：包含子集資料產生器、測試樣本與雙語文字資源。

## 2. Frontend Flow
### English
Main file: [App.tsx](App.tsx)

The frontend flow is:

1. User uploads student, room, and professor files.
2. The app derives slots from a slot file, room file, or professor file.
3. Parsed data is validated before any solver is called.
4. Room-slot combinations are generated from rooms and slots.
5. A selected solver is called through the frontend scheduling wrapper.
6. The result is shown in the dashboard, and partial schedules can request AI advice.

Main UI files:

1. [components/FileUpload.tsx](components/FileUpload.tsx): upload widgets and header checks.
2. [components/ProfPreferenceInput.tsx](components/ProfPreferenceInput.tsx): professor soft-constraint preferences.
3. [components/ScheduleDashboard.tsx](components/ScheduleDashboard.tsx): grouped schedule display, CSV export, and manual reassignment.
4. [i18n.tsx](i18n.tsx): English, Simplified Chinese, and Traditional Chinese strings.

### 繁體中文
主要檔案：[App.tsx](App.tsx)

前端流程如下：

1. 使用者上傳學生、房間與教授檔案。
2. 系統從 slots 檔、room 檔或 professor 檔推導出時段。
3. 在呼叫 solver 之前，會先驗證資料一致性。
4. 系統依據房間與時段建立 room-slot 組合。
5. 透過前端排程包裝層呼叫所選 solver。
6. 排程結果會顯示在 dashboard；若是部分成功，也可以呼叫 AI 提示。

主要 UI 檔案：

1. [components/FileUpload.tsx](components/FileUpload.tsx)：上傳元件與欄位檢查。
2. [components/ProfPreferenceInput.tsx](components/ProfPreferenceInput.tsx)：教授軟限制偏好設定。
3. [components/ScheduleDashboard.tsx](components/ScheduleDashboard.tsx)：分組顯示排程、匯出 CSV、手動調整。
4. [i18n.tsx](i18n.tsx)：英文、簡中、繁中的文字資源。

## 3. Data Parsing and Validation
### English
Main file: [utils/csvHelper.ts](utils/csvHelper.ts)

Responsibilities:

1. Normalize professor identifiers and aliases.
2. Parse student files that may contain IDs, names, or mixed professor references.
3. Parse room files in either compact availableSlots format or Date + Time Slot + Venue format.
4. Parse professor availability in compact or wide per-slot-column format.
5. Derive slots automatically when no dedicated slot file is supplied.
6. Validate that students, professors, rooms, and slots remain consistent.

Important validation rules:

1. Student supervisor and observer must exist in professor availability.
2. Supervisor and observer cannot be the same person.
3. Slot IDs should not be duplicated.
4. Rooms and professors should not reference missing slot IDs.
5. Empty students, rooms, or slots are treated as errors.

### 繁體中文
主要檔案：[utils/csvHelper.ts](utils/csvHelper.ts)

職責如下：

1. 正規化教授 ID 與別名。
2. 解析可能同時包含 ID、姓名或混合寫法的學生檔。
3. 解析兩種房間格式：compact availableSlots 與 Date + Time Slot + Venue。
4. 解析兩種教授可用時間格式：compact 與每時段欄位格式。
5. 若未提供專用 slots 檔，自動推導時段。
6. 驗證學生、教授、房間與時段是否仍然一致。

重要驗證規則：

1. 學生的指導教授與口試教授必須存在於 professor availability。
2. 指導教授與口試教授不能是同一人。
3. 不能有重複的 slot ID。
4. 房間與教授不應引用不存在的 slot ID。
5. 空學生、空房間、空時段會直接視為錯誤。

## 4. Scheduling Layer
### English
Main files:

1. [utils/scheduler.ts](utils/scheduler.ts)
2. [utils/scheduleResult.ts](utils/scheduleResult.ts)

The scheduling wrapper does three things:

1. Converts availability sets into plain arrays for transport.
2. Calls the chosen backend solver or the browser worker fallback.
3. Normalizes the returned schedule so malformed or empty solver output becomes a visible error instead of a blank UI.

Supported solver modes:

1. CP-SAT Python solver
2. PuLP ILP Python solver
3. Legacy Python heuristic solver
4. Browser worker fallback when CP-SAT API is unavailable

### 繁體中文
主要檔案：

1. [utils/scheduler.ts](utils/scheduler.ts)
2. [utils/scheduleResult.ts](utils/scheduleResult.ts)

排程包裝層主要做三件事：

1. 把 Set 型別的 availability 轉成可傳輸的陣列。
2. 呼叫指定後端 solver，或在必要時退回瀏覽器 worker。
3. 正規化 solver 回傳結果，避免 malformed 或 empty result 直接造成空白畫面。

支援的 solver 模式：

1. CP-SAT Python solver
2. PuLP ILP Python solver
3. Legacy Python heuristic solver
4. 當 CP-SAT API 不可用時的瀏覽器 worker fallback

## 5. Python Solvers and Faculty Priority
### English
Main files:

1. [server/solver_cp_sat_optimized.py](server/solver_cp_sat_optimized.py)
2. [server/solver_pulp_ilp.py](server/solver_pulp_ilp.py)
3. [server/legacy_solver.py](server/legacy_solver.py)
4. [server/faculty_priority.py](server/faculty_priority.py)

The solver layer enforces hard constraints first:

1. A student can be assigned at most one room slot.
2. A room slot can host at most one student.
3. A professor cannot appear in two presentations in the same slot.

Soft constraints are then optimized:

1. CONCENTRATE: keep a professor’s presentations on fewer days.
2. MAX_PER_DAY: limit a professor’s daily load.
3. SPREAD: distribute a professor’s presentations across more days.

Faculty priority is used when preference conflicts exist. The current rule is role-first and HKBU website order as a tie-breaker.

### 繁體中文
主要檔案：

1. [server/solver_cp_sat_optimized.py](server/solver_cp_sat_optimized.py)
2. [server/solver_pulp_ilp.py](server/solver_pulp_ilp.py)
3. [server/legacy_solver.py](server/legacy_solver.py)
4. [server/faculty_priority.py](server/faculty_priority.py)

solver 層會先處理硬限制：

1. 每位學生最多只能被分配到一個 room slot。
2. 每個 room slot 最多只能安排一位學生。
3. 同一位教授不能在同一時段出現在兩場口試。

接著再優化軟限制：

1. CONCENTRATE：盡量把教授的口試集中在較少天數。
2. MAX_PER_DAY：限制教授每天最多場次。
3. SPREAD：將教授口試分散到更多天。

當偏好互相衝突時，會用 faculty priority 做加權。現在的規則是先看職級，再用 HKBU 官網順序做 tie-break。

## 6. AI Advice Layer
### English
Main files:

1. [App.tsx](App.tsx)
2. [vite.config.ts](vite.config.ts)

The AI layer does not schedule directly. Instead, it analyzes partial schedules and explains bottlenecks. The frontend sends:

1. Failed assignment diagnostics
2. Professor diagnostics
3. Suggested extra slots inferred from current room and professor states

The middleware can call either Google Gemini or HKBU GenAI, then converts the model response into the app’s expected JSON shape.

### 繁體中文
主要檔案：

1. [App.tsx](App.tsx)
2. [vite.config.ts](vite.config.ts)

AI 層本身不直接排程，而是分析部分成功的排程結果，找出瓶頸。前端會送出：

1. 未排入學生的診斷資料
2. 教授層級的統計資料
3. 根據目前房間與教授狀態推導出的建議額外時段

middleware 目前可呼叫 Google Gemini 或 HKBU GenAI，並把模型回傳整理成系統可用的 JSON 格式。

## 7. Subset Generator Tool
### English
Main files:

1. [scripts/create-consistent-subset.mjs](scripts/create-consistent-subset.mjs)
2. [scripts/subset-generator-core.mjs](scripts/subset-generator-core.mjs)

This tool creates smaller demo datasets. It supports:

1. Cutting student rows
2. Keeping all professors unchanged
3. Cutting room-slot availability independently
4. Writing metadata so the generated subset can be audited later

### 繁體中文
主要檔案：

1. [scripts/create-consistent-subset.mjs](scripts/create-consistent-subset.mjs)
2. [scripts/subset-generator-core.mjs](scripts/subset-generator-core.mjs)

這個工具用來建立較小的 demo 資料集，支援：

1. 裁切學生資料
2. 完整保留教授資料
3. 獨立裁切 room-slot 可用時段
4. 產出 metadata 方便日後追蹤子集如何生成

## 8. Testing Strategy
### English
Main files:

1. [utils/scheduleResult.test.ts](utils/scheduleResult.test.ts)
2. [utils/csvParsing.test.ts](utils/csvParsing.test.ts)
3. [tests/subset-generator.test.ts](tests/subset-generator.test.ts)

Tests currently cover:

1. Empty or malformed solver responses
2. Empty input datasets and minimal valid datasets
3. CSV fixture parsing
4. Subset generator behavior, including preserved professor files

### 繁體中文
主要檔案：

1. [utils/scheduleResult.test.ts](utils/scheduleResult.test.ts)
2. [utils/csvParsing.test.ts](utils/csvParsing.test.ts)
3. [tests/subset-generator.test.ts](tests/subset-generator.test.ts)

目前測試覆蓋：

1. 空或格式錯誤的 solver 回應
2. 空資料集與最小合法資料集
3. CSV fixture 解析
4. 子集工具行為，包含保留完整 professor 檔的情況

## 9. Operating Guide
### English
Recommended workflow:

1. Upload student, room, and professor availability files.
2. Review validation issues before solving.
3. Choose a solver mode.
4. Review the dashboard and unscheduled list.
5. Use manual mode or AI advice when needed.
6. Export the final CSV when satisfied.

### 繁體中文
建議操作流程：

1. 上傳學生、房間與教授可用時間檔。
2. 先查看 validation issues，再決定是否求解。
3. 選擇 solver 模式。
4. 查看 dashboard 與未排入清單。
5. 必要時使用手動調整或 AI 建議。
6. 確認結果後匯出最終 CSV。

## 10. Detailed Explanation of the Three Scheduling Algorithms
### English
This section is written for presentation use. It explains not only what each solver does, but also how to describe the solver clearly to an audience.

### 10.1 Shared Problem Model

Before comparing the three algorithms, it is important to understand that they all solve the same core problem.

Input objects:

1. Student: each student has one supervisor and one observer.
2. Room slot: each room slot is one room at one time.
3. Professor availability: each professor can attend only specific logical slots.
4. Preference settings: professors may request concentrated days, spread days, or a daily limit.

Common feasibility rule:

1. A student can only be placed into a room slot if the supervisor is available in that slot.
2. A student can only be placed into a room slot if the observer is also available in that slot.
3. Therefore, every student first gets a candidate domain, which is the list of room slots acceptable to both professors.

In presentation language, you can describe the problem like this:

1. Step one is domain generation.
2. Step two is conflict elimination.
3. Step three is optimization.

That framing works for all three solvers.

### 10.2 Algorithm 1: CP-SAT Optimized Solver

Main file: [server/solver_cp_sat_optimized.py](server/solver_cp_sat_optimized.py)

Core idea:

This solver models scheduling as a Boolean optimization problem. For every valid student-room-slot combination, it creates a binary decision variable. The OR-Tools CP-SAT solver then searches for the best combination of 0 and 1 assignments that satisfies all hard constraints and minimizes weighted soft penalties.

Decision variable:

1. $x_{i,j} = 1$ means student $i$ is assigned to room-slot $j$.
2. $x_{i,j} = 0$ means that assignment is not used.

The solver does not create variables for impossible assignments. If a room slot is unavailable to either professor, that variable does not exist at all. This is an important optimization because it reduces the search space before solving even begins.

Hard constraints:

1. Student uniqueness:

$$
\sum_{j \in D_i} x_{i,j} \le 1
$$

This means each student can appear in at most one room slot.

2. Room-slot uniqueness:

$$
\sum_i x_{i,j} \le 1
$$

This means each room-slot can host at most one student.

3. Professor no-conflict rule:

$$
\sum_{(i,j) \in P_{p,s}} x_{i,j} \le 1
$$

For a given professor $p$ and logical slot $s$, the professor can only attend one presentation in that slot.

Soft constraints:

The CP-SAT solver also models professor preferences.

1. CONCENTRATE:
	A professor wants presentations packed into fewer days. The model introduces day-used variables and penalizes extra used days.
2. MAX_PER_DAY:
	A professor wants a daily upper bound. The model introduces an excess variable for each day when assignments exceed the target.
3. SPREAD:
	A professor wants presentations spread across more days. The model penalizes shortage in the number of used days.

Lexicographic objective design:

The solver first prioritizes assigning as many students as possible, and only then optimizes soft preferences. Instead of using a true two-phase optimization, the code scales the assignment count by a large constant:

$$
\max \; \bigl(\text{assignmentCount} \times \text{assignmentScale}\bigr) - \text{softPenalty}
$$

The scale is chosen to be larger than the maximum possible soft penalty, so one extra scheduled student is always more important than any soft-constraint improvement.

Why this algorithm is strong:

1. It is mathematically exact for the modeled problem.
2. It handles combinatorial constraints very well.
3. It is the best solver in the system when you want high-quality schedules.
4. It supports hard constraints and weighted soft constraints in one unified model.

Why this algorithm can still struggle:

1. It may take longer on very large instances.
2. Runtime depends on search complexity, not just the number of students.
3. If domains are very dense and conflicts are heavy, the search tree grows quickly.

How to explain it in a presentation:

You can say:

1. We transform scheduling into a binary optimization model.
2. Each feasible assignment becomes a Boolean variable.
3. The solver enforces no double-booking constraints.
4. The objective is hierarchical: maximize scheduled students first, then improve professor comfort.

### 10.3 Algorithm 2: PuLP MILP Solver

Main file: [server/solver_pulp_ilp.py](server/solver_pulp_ilp.py)

Core idea:

This solver models the same scheduling problem as a Mixed-Integer Linear Programming problem. It uses PuLP as the modeling interface and CBC as the backend solver. Conceptually it is very similar to CP-SAT, but instead of constraint programming primitives, it relies on linear inequalities and integer variables.

Decision variable:

1. $x_{i,j} \in \{0,1\}$ means student $i$ is assigned to room-slot $j$.

Like CP-SAT, the MILP model only creates variables for feasible candidate assignments, so domain pruning happens before the optimization model is built.

Hard constraints:

The same three hard constraints are enforced:

1. Each student at most once.
2. Each room-slot at most once.
3. Each professor can attend at most one presentation in the same slot.

The difference is in expression style. In MILP, everything must be linear. For example, if the system needs to know whether a professor uses a day, it creates a binary variable called day_used and links it to assignment variables through linear constraints.

For example, if any assignment on a day is active, then day_used must become 1.

Soft constraints in linear form:

1. CONCENTRATE:
	extra_days is an integer variable with a lower bound of used_days minus 1.
2. MAX_PER_DAY:
	excess is an integer variable that captures how much the schedule exceeds the target on that day.
3. SPREAD:
	shortage is an integer variable that captures insufficient day distribution.

Objective:

The objective follows the same priority design as CP-SAT:

$$
\max \; \bigl(\text{assignmentCount} \times \text{assignmentScale}\bigr) - \text{softPenalty}
$$

So the MILP solver is also trying to maximize scheduled students first and minimize discomfort second.

Why this algorithm matters in the system:

1. It provides an alternative exact optimization formulation.
2. It is easier to explain in operations research terms because the model is a standard integer program.
3. It is useful for comparison with CP-SAT during experiments or presentations.

Strengths:

1. Clear mathematical formulation.
2. Good for explaining linear optimization methodology.
3. Same high-level business logic as CP-SAT, which makes solver comparison fair.

Limitations:

1. Some logical patterns are less natural in MILP and need auxiliary variables.
2. The linear model can become larger because relationships such as day usage must be linearized.
3. CBC may be slower or less robust than CP-SAT for some combinatorial instances.

How to explain it in a presentation:

You can say:

1. This solver turns the scheduling problem into an integer programming model.
2. The constraints are written as linear equations or inequalities.
3. Binary variables represent assignment decisions.
4. Additional integer variables convert preference rules into measurable penalties.

### 10.4 Algorithm 3: Legacy Heuristic Solver

Main file: [server/legacy_solver.py](server/legacy_solver.py)

Core idea:

This solver is not an exact mathematical optimizer. Instead, it is a hybrid heuristic search engine. It combines backtracking, greedy assignment, repair search, multi-start perturbation, and local improvement. Its design goal is to return a useful answer quickly even when the exact solver is unavailable.

This solver is best understood as a layered algorithm rather than a single technique.

Stage 1: Domain construction

1. For each student, it computes all room slots that both professors can attend.
2. This produces the same candidate domain concept used in the exact solvers.

Stage 2: Conflict graph construction

1. Two students are connected if they share any professor.
2. This graph estimates how difficult each student is to schedule.
3. A student with a small domain and a high conflict degree is considered difficult.

Stage 3: Strict backtracking

1. Students are ordered by smallest domain first, then highest conflict degree.
2. This is similar to the Minimum Remaining Values idea in constraint satisfaction.
3. The solver tries candidate room slots recursively.
4. It uses forward checking to reject a move if that move would leave a neighbor with no valid options.

This stage aims to find a complete feasible schedule exactly, but only within a short timeout.

Stage 4: Greedy fallback

If strict backtracking cannot finish in time, the solver switches to a constructive heuristic:

1. It processes students in priority order.
2. For each student, it sorts candidate slots by estimated blocking cost.
3. It picks the first non-conflicting slot.

The slot ranking uses several heuristics:

1. Fewer current blockers is better.
2. Lower slot demand is better.
3. Earlier time labels are preferred when scores tie.

Stage 5: Repair search

If some students remain unscheduled, the solver tries to repair the schedule by moving already assigned students.

1. It identifies blockers of a desired candidate slot.
2. It temporarily removes those blockers.
3. It recursively tries to re-place the blockers elsewhere.
4. If all blockers can be repaired, the unscheduled student is inserted.

This is important because a pure greedy algorithm often gets trapped in a local dead end. The repair phase gives the heuristic a way to escape from bad early choices.

Stage 6: Multi-start search

The solver perturbs the student order randomly and repeats the greedy plus repair process many times.

1. Each restart explores a different construction path.
2. The best partial schedule found so far is kept.
3. This improves robustness without paying the full cost of exhaustive search.

Stage 7: Local soft-constraint improvement

After feasibility is achieved, the solver performs local improvement for preferences.

1. It randomly selects an assigned student.
2. It tries a different valid slot.
3. It keeps the move only if the weighted soft cost does not get worse.

This is essentially a hill-climbing style improvement phase.

Why this algorithm is useful:

1. It is fast.
2. It can run in environments where Python optimization libraries are unavailable.
3. It is resilient because it degrades gracefully from exact search to heuristic construction.

Limitations:

1. It does not guarantee global optimality.
2. Its final quality depends on heuristic choices and timeout.
3. Two runs may produce different schedules because of randomized restarts.

How to explain it in a presentation:

You can say:

1. This solver behaves like a practical search strategy instead of a strict optimizer.
2. It first tries exact backtracking on the hardest students.
3. If that is too slow, it switches to greedy construction.
4. It then repairs conflicts and uses random restarts to improve coverage.
5. Finally, it performs local search to reduce preference cost.

### 10.5 Comparison Summary

1. CP-SAT:
	Best overall optimization quality, strongest exact solver, best for final schedules.
2. PuLP MILP:
	Also exact in formulation, easier to explain in classic optimization language, good for model comparison.
3. Legacy heuristic:
	Fast and practical fallback, easier to run, but not guaranteed to be optimal.

### 10.6 Suggested Presentation Script

If you need a short script, you can explain the three algorithms in this order:

1. Start from the common model: student, room-slot, professor availability.
2. Explain that all solvers first build candidate domains.
3. Say CP-SAT is the main exact combinatorial optimizer.
4. Say PuLP MILP is the linear-integer version of the same scheduling model.
5. Say the legacy solver is a hybrid heuristic fallback combining backtracking, greedy search, repair, and local improvement.
6. End by explaining why multiple solvers are useful: quality, robustness, and comparison.

### 繁體中文
這一節是為了簡報而寫，不只說明每個 solver 在做什麼，也會整理成比較容易上台講解的版本。

### 10.1 共用問題模型

在比較三個演算法之前，先理解它們其實都在解同一個核心問題。

輸入物件：

1. Student：每個學生都有一位 supervisor 與一位 observer。
2. Room slot：每個 room slot 代表一個房間在一個特定時段。
3. Professor availability：每位教授只能出現在自己可用的 logical slot。
4. Preference settings：教授可以設定偏好，例如集中排、分散排、或每天上限。

共通可行性規則：

1. 只有當 supervisor 在某個 slot 可用時，學生才可能被放進那個 room slot。
2. 只有當 observer 在同一個 slot 也可用時，這個安排才有效。
3. 所以每個學生一開始都會先建立自己的 candidate domain，也就是兩位教授都能出席的 room slot 清單。

如果你要在簡報中講得清楚，可以把整個問題拆成三句：

1. 先建立每個學生的可選時段 domain。
2. 再排除所有衝堂與重複使用資源的情況。
3. 最後在可行解裡找最好的一個。

這個講法可以套用到三個 solver。

### 10.2 演算法一：CP-SAT Optimized Solver

主要檔案：[server/solver_cp_sat_optimized.py](server/solver_cp_sat_optimized.py)

核心概念：

這個 solver 把排程問題建模成 Boolean optimization problem。對每一個合法的學生與 room-slot 配對，建立一個二元決策變數。接著交給 OR-Tools 的 CP-SAT solver，在滿足所有硬限制的前提下，找出排入最多學生、且軟限制代價最低的解。

決策變數：

1. $x_{i,j} = 1$ 代表學生 $i$ 被分配到 room-slot $j$。
2. $x_{i,j} = 0$ 代表這個安排沒有被採用。

這個 solver 不會替不可能的安排建立變數。也就是說，如果某個 room slot 對 supervisor 或 observer 其中之一不可用，這個變數根本不會存在。這一點很重要，因為它在求解前就先縮小了搜尋空間。

硬限制：

1. 每個學生最多一次：

$$
\sum_{j \in D_i} x_{i,j} \le 1
$$

2. 每個 room-slot 最多一位學生：

$$
\sum_i x_{i,j} \le 1
$$

3. 每位教授在同一 logical slot 不能同時出席兩場：

$$
\sum_{(i,j) \in P_{p,s}} x_{i,j} \le 1
$$

軟限制：

CP-SAT 也會同時建模教授偏好。

1. CONCENTRATE：教授希望口試集中在比較少的天數，因此模型會建立 day-used 變數，並對多出的天數加罰。
2. MAX_PER_DAY：教授希望每天不要超過某個上限，因此模型會建立 excess 變數來表示超出的場次。
3. SPREAD：教授希望口試分散到較多天，因此模型會對不足的使用天數加罰。

目標函數設計：

系統先把「排入更多學生」當成第一優先，再處理教授舒適度。程式中不是用兩次求解，而是用放大 assignment_count 的方法實現階層式目標：

$$
\max \; \bigl(\text{assignmentCount} \times \text{assignmentScale}\bigr) - \text{softPenalty}
$$

其中 assignmentScale 會設定得比所有可能的軟限制總罰分還大，因此多排進一位學生，一定比任何軟限制改善更重要。

這個演算法的優點：

1. 對目前建模的問題來說，它是精確的最佳化方法。
2. 很適合處理大量組合式限制。
3. 當你要追求高品質排程時，它是系統裡最主要的 solver。
4. 硬限制與軟限制可以放在同一個模型裡處理。

可能的限制：

1. 問題規模很大時，求解時間可能變長。
2. 執行時間不只取決於學生數，也取決於衝突結構。
3. 如果 domain 很密、教授衝突很多，搜尋樹會快速膨脹。

簡報講法：

1. 我們先把排程轉成二元最佳化模型。
2. 每一個可行安排對應一個 Boolean 變數。
3. Solver 會強制滿足所有不重複使用資源的限制。
4. 目標函數是分層的：先最大化排入人數，再最佳化教授偏好。

### 10.3 演算法二：PuLP MILP Solver

主要檔案：[server/solver_pulp_ilp.py](server/solver_pulp_ilp.py)

核心概念：

這個 solver 把同一個排程問題建模成 Mixed-Integer Linear Programming。它使用 PuLP 作為建模介面、CBC 當作後端求解器。概念上它和 CP-SAT 很像，但不是使用 constraint programming primitives，而是把所有限制寫成線性不等式與整數變數。

決策變數：

1. $x_{i,j} \in \{0,1\}$ 代表學生 $i$ 是否被分配到 room-slot $j$。

和 CP-SAT 一樣，MILP 也只會對可行 candidate 建立變數，所以在模型建立前一樣會先做 domain pruning。

硬限制：

同樣維持三個核心限制：

1. 每個學生最多一次。
2. 每個 room-slot 最多一次。
3. 每位教授在相同 slot 最多參與一場。

差別在表示方式。MILP 要求所有關係都必須是線性的。例如系統若要知道某位教授某一天是否有使用，就會建立一個 day_used 的 binary variable，再用線性限制把它和各個 assignment 連結起來。

線性化的軟限制：

1. CONCENTRATE：用 extra_days 這個整數變數表示多出來的使用天數。
2. MAX_PER_DAY：用 excess 這個整數變數表示某一天超過上限多少場。
3. SPREAD：用 shortage 這個整數變數表示分散程度不足多少。

目標函數：

和 CP-SAT 一樣，目標仍然是先排最多人，再減少偏好罰分：

$$
\max \; \bigl(\text{assignmentCount} \times \text{assignmentScale}\bigr) - \text{softPenalty}
$$

所以從業務邏輯看，它和 CP-SAT 是一致的；差別主要在數學建模方式與底層求解器。

這個演算法在系統中的價值：

1. 它提供另一種精確最佳化建模方式。
2. 如果要用 OR / optimization 的語言來講，它比 CP-SAT 更容易對應到傳統整數規劃。
3. 在實驗或簡報中，它很適合拿來和 CP-SAT 做比較。

優點：

1. 數學形式清楚。
2. 很適合說明線性最佳化方法。
3. 高層 business rules 與 CP-SAT 一致，因此比較公平。

限制：

1. 有些邏輯關係在 MILP 中不夠自然，必須透過額外變數線性化。
2. 模型可能因為輔助變數而變得更大。
3. 對某些組合型問題，CBC 可能沒有 CP-SAT 強。

簡報講法：

1. 這個 solver 把排程問題寫成整數規劃模型。
2. 所有限制都用線性方程式或不等式表示。
3. 二元變數代表是否採用某個安排。
4. 額外的整數變數把教授偏好轉成可計算的罰分。

### 10.4 演算法三：Legacy Heuristic Solver

主要檔案：[server/legacy_solver.py](server/legacy_solver.py)

核心概念：

這個 solver 不是精確數學最佳化器，而是一個混合式 heuristic search engine。它結合了 backtracking、greedy assignment、repair search、multi-start perturbation 和 local improvement。設計目標是在精確 solver 不可用或時間不足時，仍然能快速給出一個實用的答案。

這個 solver 比較像是一個分層流程，而不是單一技巧。

階段一：建立 domain

1. 對每位學生，先計算兩位教授都能出席的 room slot。
2. 這和 exact solver 使用的是同一個 candidate domain 概念。

階段二：建立 conflict graph

1. 如果兩位學生共享任何一位教授，就在圖上連一條邊。
2. 這張圖用來估計誰比較難排。
3. domain 小、衝突度高的學生，通常要先處理。

階段三：嚴格回溯搜尋

1. 學生會依照 smallest domain first，再搭配 highest conflict degree 排序。
2. 這個概念很接近 constraint satisfaction 裡的 Minimum Remaining Values。
3. solver 會遞迴嘗試不同 room slot。
4. 並使用 forward checking，提前排除會讓鄰居完全沒路可走的選擇。

這個階段想做的是在短時間內直接找完整可行解。

階段四：Greedy fallback

如果嚴格回溯在時間內沒完成，solver 就改用建構式 heuristic：

1. 依照優先順序逐一處理學生。
2. 對每位學生，把候選 slot 依照 blocking cost 排序。
3. 選第一個不衝突的 slot。

排序時使用的啟發式：

1. 目前 blocker 越少越好。
2. slot demand 越低越好。
3. 分數一樣時，傾向較早的 time label。

階段五：Repair search

若還有學生沒排進去，solver 會嘗試透過移動已排入的學生來修復排程：

1. 先找出某個候選 slot 的 blockers。
2. 暫時移除這些 blockers。
3. 遞迴嘗試把 blockers 重新放到其他位置。
4. 如果所有 blockers 都能被修復，就把原本沒排到的學生插進來。

這一步很重要，因為純 greedy 很容易卡在 local dead end，而 repair phase 提供了一種跳脫早期錯誤決策的方法。

階段六：Multi-start search

solver 會隨機擾動學生順序，重複進行 greedy + repair：

1. 每次 restart 都會探索不同的建構路徑。
2. 系統保留目前找到最好的部分排程。
3. 這能提升穩定度，又不需要付出完整 exhaustive search 的代價。

階段七：軟限制局部改善

在可行性建立後，solver 會對教授偏好做 local improvement：

1. 隨機挑一位已排入的學生。
2. 試著換到另一個合法 slot。
3. 只有在 weighted soft cost 不變差時，才保留這個 move。

這本質上是一個 hill-climbing 式的改善程序。

這個演算法有用的原因：

1. 它很快。
2. 在某些環境中，就算沒有完整 optimization library，也能運作。
3. 它不是一失敗就完全沒結果，而是會從 exact search 漸進退化到 heuristic construction。

限制：

1. 不能保證全域最優。
2. 最終品質會受 heuristic 設計與 timeout 影響。
3. 由於有 random restart，不同次執行可能得到不同排程。

簡報講法：

1. 這個 solver 比較像務實的搜尋策略，而不是嚴格的最佳化器。
2. 它先對最難的學生做精確回溯。
3. 如果太慢，就切到 greedy 建構。
4. 接著用 repair 與 random restart 提升覆蓋率。
5. 最後再用 local search 降低教授偏好代價。

### 10.5 三個演算法的比較總結

1. CP-SAT：
	整體最佳化品質最好，是系統中的主力 exact solver，適合最終正式排程。
2. PuLP MILP：
	也是精確建模，且更容易用傳統 OR 語言說明，適合做模型比較。
3. Legacy heuristic：
	速度快、實務性高，適合作為 fallback，但不保證最優。

### 10.6 簡報建議講稿順序

如果你要在簡報中快速說明，可以用這個順序：

1. 先講共同問題模型：student、room-slot、professor availability。
2. 說明三個 solver 都會先建立 candidate domain。
3. 接著介紹 CP-SAT 是主要的 exact combinatorial optimizer。
4. 再說 PuLP MILP 是同一業務問題的線性整數規劃版本。
5. 最後介紹 legacy solver 是結合 backtracking、greedy、repair 與 local improvement 的 heuristic fallback。
6. 最後收斂到為什麼系統需要多個 solver：品質、穩定性與比較性。