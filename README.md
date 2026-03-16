# FYP 畢業專題報告排程系統

## 系統簡介

本系統是一套專為大學設計的**畢業專題（FYP）報告排程自動化工具**，能夠根據場地空閒時段、教授出席可用性及個人偏好，自動為所有學生安排口試時段，並盡量在滿足硬性限制的前提下，優化軟性偏好設定。

---

## 主要功能

- **多格式資料匯入**：支援 CSV 及 Excel（XLSX）格式，自動識別不同欄位命名方式
- **雙引擎求解**：
  - **CP-SAT 求解器**（推薦）：基於 Google OR-Tools 的約束規劃，保證最多學生可成功排程
  - **傳統啟發式求解器**：於瀏覽器中以 Web Worker 執行，作為備用方案
- **硬性限制自動強制執行**（必須滿足）：
  - 同一時段、同一房間不可安排兩位學生
  - 同一時段，教授不可同時出現在兩個場合
  - 學生只能被安排至其指導教授及評核教授均有空的時段
- **軟性限制優化**（盡量滿足）：
  - `CONCENTRATE`（集中）：教授希望所有口試集中在同一天
  - `MAX_PER_DAY`（每日上限）：教授每天最多評核指定場次
  - `SPREAD`（分散）：教授希望口試分散在多天
- **AI 智能分析**：整合 Google Gemini API，自動分析無法排程的原因並提供建議
- **互動式排程管理介面**：支援以時段、房間或教授等不同維度查看結果，並可手動調整
- **匯出功能**：可將排程結果匯出為 CSV 檔案

---

## 技術架構

### 前端
| 技術 | 用途 |
|------|------|
| React 19 + TypeScript | 使用者介面 |
| Vite 6 | 開發伺服器及打包工具 |
| Tailwind CSS | 介面樣式 |
| PapaParse | CSV 解析 |
| XLSX | Excel 檔案支援 |
| Lucide React | 圖示庫 |

### 後端 / 求解引擎
| 技術 | 用途 |
|------|------|
| Python 3 + Google OR-Tools | CP-SAT 約束規劃求解 |
| Node.js child_process | 啟動 Python 子程序 |
| Web Worker (TypeScript) | 瀏覽器端啟發式求解（備用） |
| Google Gemini API | AI 分析建議（選用） |

---

## 目錄結構

```
FYP-Scheduling-System/
├── components/
│   ├── FileUpload.tsx           # 檔案上傳元件（支援 CSV/XLSX）
│   ├── ProfPreferenceInput.tsx  # 教授偏好設定介面
│   └── ScheduleDashboard.tsx    # 排程結果顯示與編輯介面
├── server/
│   └── cp_sat_solver.py         # Google OR-Tools CP-SAT 求解器
├── utils/
│   ├── csvHelper.ts             # CSV/XLSX 解析與資料驗證
│   ├── scheduler.ts             # 排程主協調器
│   ├── scheduler.worker.ts      # Web Worker 啟發式求解器
│   └── tabularParser.ts         # 通用表格解析工具
├── App.tsx                      # React 應用程式主元件
├── index.tsx                    # React 進入點
├── index.html                   # HTML 範本
├── index.css                    # 樣式（Tailwind CSS）
├── types.ts                     # TypeScript 型別定義
├── vite.config.ts               # Vite 設定（含 API 路由中介層）
├── tsconfig.json                # TypeScript 設定
└── package.json                 # 專案依賴
```

---

## 資料輸入格式

啟動排程前，需上傳以下四份 CSV / XLSX 檔案：

| 檔案 | 必要欄位 | 說明 |
|------|---------|------|
| **學生資料** | `id`、`name`、`supervisorId`、`observerId` | 每位學生的指導教授與評核教授 |
| **時段資料** | `id`、`timeLabel` | 可用的口試時段（如 `Day 1 09:00`） |
| **房間資料** | `id`、`name`、`capacity`、`availableSlots` | 各房間及其可用時段 |
| **教授可用性** | `professorId` + 可用時段欄位 | 各教授在哪些時段有空 |

系統會自動識別多種常見的欄位命名方式（如 `supervisorId` 或 `Supervisor`）。

---

## 軟性限制類型說明

| 類型 | 說明 | 計分方式 |
|------|------|---------|
| `CONCENTRATE` | 希望所有口試集中於同一天 | 超出天數 × 權重 |
| `MAX_PER_DAY` | 每天口試不超過指定場次 | 超出場次 × 權重 |
| `SPREAD` | 希望口試分散在多天 | (理想天數 − 實際天數) × 權重 |

**範例（`CONCENTRATE`，權重 = 10）：**
- 全部集中在第 1 天 → 費用 = 0
- 分散在第 1、2 天 → 費用 = 10
- 分散在第 1、2、3 天 → 費用 = 20

---

## 求解流程

```
上傳四份 CSV/XLSX 檔案
        ↓
   資料解析與驗證
        ↓
（選用）設定教授軟性偏好
        ↓
   點擊「開始自動排程」
        ↓
┌─────────────────────────────┐
│     CP-SAT 求解器（推薦）    │
│  OR-Tools 約束規劃最大化排程 │
└─────────────────────────────┘
        ↓ 若無法使用 Python
┌─────────────────────────────┐
│   傳統啟發式求解器（備用）   │
│ 第一階段：回溯搜尋（1500ms） │
│ 第二階段：貪婪分配（備援）   │
│ 第三階段：軟性限制優化       │
└─────────────────────────────┘
        ↓
   顯示排程結果
        ↓
（選用）AI 分析無法排程的原因
        ↓
   手動調整 / 匯出 CSV
```

---

## 安裝與執行

### 前置需求

- **Node.js** 及 npm
- **Python 3** 及 OR-Tools（用於 CP-SAT 求解器）：
  ```bash
  pip install ortools
  ```
- （選用）Google Gemini API 金鑰

### 安裝

```bash
npm install
```

### 環境變數設定

複製 `.env.example` 並重新命名為 `.env`，填入以下設定（均為選用）：

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-lite-preview
PYTHON_BIN=python
```

### 啟動開發伺服器

```bash
npm run dev
```

開啟瀏覽器並進入 [http://localhost:3000](http://localhost:3000)

### 建置正式版本

```bash
npm run build
npm run preview
```

---

## 核心元件說明

### `App.tsx` — 主應用程式
負責整體狀態管理、檔案上傳流程、資料解析及求解啟動。

### `ScheduleDashboard.tsx` — 排程結果儀表板
提供三種查看維度（時段、房間、教授），支援手動重新分配及結果匯出。

### `ProfPreferenceInput.tsx` — 教授偏好設定
折疊式介面，可為每位教授設定偏好類型、權重及每日上限。

### `FileUpload.tsx` — 檔案上傳元件
支援拖放上傳，並即時顯示格式驗證錯誤。

### `cp_sat_solver.py` — CP-SAT 求解器
透過 Google OR-Tools 建立二元變數約束模型，最大化已排程學生數量，並於求解後計算軟性限制費用。

### `scheduler.worker.ts` — 啟發式求解器
瀏覽器端 Web Worker，實作三階段求解策略：回溯搜尋、貪婪分配、隨機爬山軟性優化。

### `csvHelper.ts` — 資料解析與驗證
支援多種欄位命名格式，自動正規化教授 ID，並進行跨檔案的參照完整性驗證。

### `vite.config.ts` — 開發伺服器及 API 中介層
定義兩個自訂 API 端點：
- `POST /api/solve-cp-sat`：啟動 Python CP-SAT 求解子程序
- `POST /api/ai-advice`：呼叫 Gemini API 進行 AI 分析

---

## 效能參考

| 指標 | 數值 |
|------|------|
| 典型排程時間 | 2–5 秒 |
| 最大優化迭代次數 | 3,000 次 |
| 嚴格求解逾時限制 | 1,500 ms |
| 支援學生規模 | 50–500+ 人 |

---

## 詳細技術文件

請參閱 [SOFT_CONSTRAINTS_IMPLEMENTATION.md](./SOFT_CONSTRAINTS_IMPLEMENTATION.md)，內含軟性限制的完整實作說明、計分範例及測試步驟。