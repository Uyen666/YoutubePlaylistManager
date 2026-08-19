# 🎬 YouTube & Bilibili 播放清單 / 收藏夾 AI 分類器

[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Platforms](https://img.shields.io/badge/Platform-YouTube%20%7C%20Bilibili-critical.svg)](#)
[![Google Gemini](https://img.shields.io/badge/AI-Google%20Gemini-orange.svg)](https://ai.google.dev/)
[![OpenAI](https://img.shields.io/badge/AI-OpenAI%20GPT--4o-green.svg)](https://openai.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

專為 **YouTube 播放清單** 與 **Bilibili（B站）收藏夾** 設計的雙平台智慧管理 Chrome 擴充功能（Manifest V3）。支援自動向下滾動與跨頁翻頁擷取完整影片清單（標題、UP主/頻道、時長、連結、BV號/影片ID），透過 **Google Gemini 3.6 Flash** 或 **OpenAI GPT-4o mini** 依自訂標籤進行智慧語意歸類，輸出視覺化分類報告，並支援一鍵複製 Markdown 與匯出 JSON / CSV。

GitHub 儲存庫：[https://github.com/Uyen666/YoutubePlaylistManager](https://github.com/Uyen666/YoutubePlaylistManager)

---

## ✨ 核心特色

1. **🌐 雙平台適配器架構 (Adapter Pattern)**：
   - **YouTube 支援**：播放清單頁面 (`/playlist?list=...`) 與影片播放頁右側面板 (`/watch?...&list=...`)，支援 500+ ~ 2000+ 部大清單動態滾動載入。
   - **Bilibili 支援**：個人空間收藏夾 (`space.bilibili.com/.../favlist`) 與媒體播放列表 (`bilibili.com/medialist/play/...`)，自動解析 BV 號、標題、UP 主與時長。
   - **B 站防風控機制**：自動翻頁間加入 800ms~1500ms 隨機擬人化延遲，安全穩定杜絕頻率限制。

2. **🧠 LLM 批次分類引擎 (支援 75 部大批次與冷卻倒數)**：
   - **多模型與自訂支援**：預載 **Google Gemini** (Gemini 3.6 Flash / 1.5 Flash / 1.5 Pro)、**OpenAI** (GPT-4o mini / GPT-4o) 以及「自訂模型 ID」。
   - **75 部大容量批次**：大幅縮減 API 請求次數（561 部影片僅需 7~8 次請求），徹底壓在免費頻率上限之內。
   - **即時秒級冷卻倒數**：若觸發 Google 每日/每分鐘配額限制，Popup 介面即時動態倒數冷卻並自動接續重試，保證不報錯、不中斷。

3. **🎯 輕量單鍵微調分類（隨點隨改 & 即時同步）**：
   - 每個影片項目右側嵌入微型「**📁 移至分類**」下拉選單。
   - 支援快速更換至現有分類或直接「➕ 新建分類」，切換瞬間即時遷移、刷新卡片計數並自動持久化儲存。
   - 微調成果無縫連動至 YouTube 原生建立播放清單與所有匯出格式。

4. **🤖 DOM 自動化一鍵在 YouTube 建立清單**：
   - 每個分類卡片支援一鍵「**➕ 建立清單**」功能。
   - 自動在 YouTube 帳號模擬建立全新播放清單、設定自訂隱私度（私人 / 不公開 / 公開）。
   - 智慧定位影片 DOM 節點，批次自動勾選並加入該分類的所有影片。

5. **⚡ 0 Token 快速純擷取（免 API Key 快速備份）**：
   - 提供「**⚡ 僅擷取 (0 Token 匯出)**」功能，無須消耗任何 AI Tokens 或填寫 API Key。
   - 秒級自動滾動載入完整清單的所有影片，並一鍵匯出為 **Markdown 報表、JSON 或 CSV** 試算表。

6. **📂 支援 JSON / CSV 檔案直接匯入（0 Token 消耗）**：
   - 支援將先前匯出的 `.json` 或 `.csv` 分類檔案直接匯入回擴充功能。
   - 匯入後瞬間還原分類卡片，直接跳過 AI 分析階段。

7. **🔔 Chrome 桌面通知即時提醒**：
   - 支援背景分析完成或異常中斷時自動發送系統桌面通知，無需盯著視窗等待。

8. **🎨 現代化深色 UI**：
   - 即時分頁狀態與平台辨識（自動切換 🔴 YouTube / 🔵 Bilibili 徽章）。
   - 雙階段進度條（DOM 擷取進度 ➔ AI 批次分類進度）。
   - 手風琴式分類卡片（依影片數量自動排序、支援展開/收合、點擊直達影片）。
   - 多種格式匯出：**📋 一鍵複製 Markdown**、**💾 匯出 JSON**、**📊 匯出 CSV**。

9. **🔒 安全與隱私保護**：
   - API Key 僅儲存於使用者本機 `chrome.storage.local`，絕不上傳任何第三方伺服器。

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
6. 安裝完成後，即可在瀏覽器工具列中看見擴充功能圖示。建議將其固定 (Pin) 到工具列以方便使用。

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

1. **開啟目標播放清單或收藏夾**：
   - **YouTube**：開啟播放清單頁面（例：`https://www.youtube.com/playlist?list=...`）。
   - **Bilibili**：開啟個人空間收藏夾（例：`https://space.bilibili.com/<uid>/favlist`）。
2. **開啟擴充功能**：
   - 點擊工具列上的擴充功能圖示，介面將自動識別平台並標註徽章。
3. **完成初次設定**：
   - 點擊右上角「⚙️」開啟偏好設定。
   - 選擇模型（預設推薦 `Gemini 3.6 Flash`）。
   - 貼上您的 API Key。
   - 依需求自訂分類標籤或點擊快速預設按鈕，點擊「💾 儲存設定」。
4. **開始分析**：
   - 點擊「🚀 **開始擷取並進行 AI 分類**」大按鈕。
   - 擴充功能將在背景自動滾動/翻頁擷取影片，並分批送交 AI 分析。
5. **檢視、微調與建立/匯出**：
   - **手風琴檢視**：點擊各分類卡片展開查看影片列表。
   - **單鍵微調分類**：若想修正特定影片分類，直接在影片右側下拉選單點選目標分類（或新建分類），即時遷移並自動同步。
   - **一鍵建立 YouTube 清單**：點擊分類卡片右上角的「➕ 建立清單」，自動在您的 YouTube 帳號建立全新播放清單並加入所有影片。
   - **多元格式匯出**：點擊「📋 複製 Markdown」貼至 Notion / Obsidian，或點擊「💾 匯出 JSON」/「📊 匯出 CSV」儲存結構化資料。

---

## 📄 授權條款
本專案採用 [MIT License](LICENSE) 授權。
