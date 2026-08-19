# 🎬 YouTube 播放清單 AI 分類器 (YouTube Playlist Manager)

[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Google Gemini](https://img.shields.io/badge/AI-Google%20Gemini-orange.svg)](https://ai.google.dev/)
[![OpenAI](https://img.shields.io/badge/AI-OpenAI%20GPT--4o-green.svg)](https://openai.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

專為 YouTube 播放清單設計的 Chrome 擴充功能（Manifest V3）。能自動在播放清單頁面中向下滾動並擷取完整影片（標題、頻道、時長、連結），透過 **Google Gemini 3.6 Flash**、**Gemini 2.5 Flash** 或 **OpenAI GPT-4o mini**（亦支援自訂任意模型 ID）依自訂標籤進行智慧歸類，並在 Popup 介面中輸出視覺化分類報告，支援一鍵複製 Markdown 與匯出 JSON / CSV。

GitHub 儲存庫：[https://github.com/Uyen666/YoutubePlaylistManager](https://github.com/Uyen666/YoutubePlaylistManager)

---

## ✨ 核心特色

1. **🚀 智慧動態爬蟲 (`content.js`)**：
   - 支援 YouTube 播放清單頁面 (`/playlist?list=...`) 與影片播放頁中的清單面板 (`/watch?...&list=...`)。
   - 平滑自動向下滾動（Auto-scroll），動態載入並擷取影片 `videoId`、`title`、`channelTitle`、`duration` 等資訊。
   - 自動過濾已刪除或私人影片，並支援自訂擷取數量上限（50、100、200 或無上限）。

2. **🧠 LLM 批次分類引擎 (`popup.js`)**：
   - **多模型與自訂支援**：預載 **Google Gemini** (Gemini 3.6 Flash / 2.5 Flash / 1.5 Flash / 1.5 Pro)、**OpenAI** (GPT-4o mini / GPT-4o) 以及「自訂模型 ID」，永遠不用擔心模型過期。
   - **批次處理 (Batching)**：自動將大量影片以 25 部為單位分批請求，避免 Payload 超標或逾時。
   - **指數退避重試 (Exponential Backoff)**：若遇 API Rate Limit (HTTP 429) 或網路異常，自動進行指數延遲重試。
   - **嚴格結構化輸出**：支援 Gemini Native Schema Enum 與 OpenAI JSON Object，具備多層次映射與模糊比對容錯機制。

3. **🤖 DOM 自動化一鍵在 YouTube 建立清單 (`Step 2`)**：
   - 每個分類卡片支援一鍵「**➕ 建立清單**」功能。
   - 自動在 YouTube 介面模擬建立全新播放清單、設定自訂隱私度（私人 / 不公開 / 公開）。
   - 智慧定位影片 DOM 節點，批次自動勾選並加入該分類的所有影片。
   - 具備 600ms~1000ms 操作延遲節流，防止 YouTube 頻率限制或動畫卡死。

4. **🎨 現代化深色 UI (`popup.html` & `popup.css`)**：
   - 即時分頁狀態偵測（非 YouTube 清單時友善提示並禁用按鈕）。
   - 雙階段進度條（DOM 擷取進度 ➔ AI 批次分類進度）。
   - 手風琴式分類卡片（依影片數量自動排序、支援展開/收合、點擊直達 YouTube 影片）。
   - 多種格式匯出：**📋 一鍵複製 Markdown**、**💾 匯出 JSON**、**📊 匯出 CSV**。

5. **🔒 安全與隱私保護**：
   - API Key 僅儲存於使用者本機 `chrome.storage.local`，絕不上傳任何第三方伺服器。

---

## 📁 檔案架構

```text
YoutubePlaylistManager/
├── manifest.json            # Manifest V3 擴充功能配置檔
├── popup/
│   ├── popup.html           # 擴充功能彈出視窗介面 (Popup)
│   ├── popup.css            # 現代化深色主題樣式與動畫
│   └── popup.js             # 主邏輯 (狀態控制、LLM 分類、匯出)
├── scripts/
│   └── content.js           # YouTube 頁面爬蟲與自動滾動腳本
├── background/
│   └── background.js        # Service Worker 背景腳本
├── icons/
│   ├── icon16.png           # 16x16 擴充功能圖示
│   ├── icon48.png           # 48x48 擴充功能圖示
│   └── icon128.png          # 128x128 擴充功能圖示
├── .gitignore               # Git 忽略檔案配置
└── README.md                # 專案說明與使用手冊
```

---

## 🛠️ 安裝方式 (Chrome 開發者模式)

1. Clone 本儲存庫至本機：
   ```bash
   git clone https://github.com/Uyen666/YoutubePlaylistManager.git
   ```
2. 開啟 Chrome 瀏覽器，在網址列輸入 `chrome://extensions/` 並按下 Enter。
3. 開啟右上角的「**開發者模式** (Developer mode)」。
4. 點選左上角的「**載入未封裝項目** (Load unpacked)」。
5. 選擇本專案所在資料夾（即包含 `manifest.json` 的目錄）。
6. 安裝完成後，即可在瀏覽器工具列中看見「**YouTube 播放清單 AI 分類器**」圖示。建議將其固定 (Pin) 到工具列以方便使用。

---

## 🔑 取得 API 金鑰

本擴充功能支援兩種模型供應商，請依需求取得對應 API Key：

### 1. Google Gemini API (推薦 - 提供免費額度且速度極快)
1. 前往 [Google AI Studio](https://aistudio.google.com/app/apikey)。
2. 登入 Google 帳號後點選「**Create API key**」。
3. 複製產生的金鑰並貼入擴充功能的設定面板中。

### 2. OpenAI API
1. 前往 [OpenAI Platform API Keys](https://platform.openai.com/api-keys)。
2. 登入後點選「**Create new secret key**」。
3. 複製金鑰並貼入擴充功能設定中。

---

## 📖 使用教學

1. **開啟目標播放清單**：
   - 在 Chrome 中開啟任意 YouTube 播放清單頁面（例：`https://www.youtube.com/playlist?list=...`）。
2. **開啟擴充功能**：
   - 點擊工具列上的擴充功能圖示。
3. **完成初次設定**：
   - 點擊右上角「⚙️」開啟偏好設定。
   - 選擇模型（預設推薦 `Gemini 3.6 Flash`，亦可切換為其他模型或自訂 ID）。
   - 貼上您的 API Key。
   - 依需求自訂分類標籤（例：`程式開發, 投資理財, 流行音樂, 遊戲動漫, 生活雜談, 其他`）或點擊快速預設按鈕。
   - 點擊「💾 儲存設定」。
4. **開始分析**：
   - 點擊「🚀 **開始擷取並進行 AI 分類**」大按鈕。
   - 擴充功能將自動在背景平滑滾動 YouTube 頁面擷取影片，並分批送交 AI 分析。
5. **檢視與匯出**：
   - 分析完成後，可點擊各分類展開查看影片列表。
   - 點擊「📋 複製 Markdown」即可貼到 Notion、Obsidian 或筆記軟體中。
   - 亦可點擊「💾 匯出 JSON」或「📊 匯出 CSV」保存完整結構化資料。

---

## 📄 授權條款
本專案採用 [MIT License](LICENSE) 授權。
