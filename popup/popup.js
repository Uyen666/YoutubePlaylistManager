/**
 * YouTube 播放清單 AI 分類器 - Popup 控制腳本 (popup/popup.js)
 * 負責頁面狀態偵測、DOM 爬蟲通訊、Gemini / OpenAI API 批次分類、UI 互動與報表匯出
 */

document.addEventListener('DOMContentLoaded', () => {
  // ==========================================
  // DOM 元素引用
  // ==========================================
  const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const pageAlert = document.getElementById('pageAlert');
  
  // 設定欄位
  const providerSelect = document.getElementById('providerSelect');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleKeyVisibilityBtn = document.getElementById('toggleKeyVisibilityBtn');
  const eyeIcon = document.getElementById('eyeIcon');
  const apiKeyHelpLink = document.getElementById('apiKeyHelpLink');
  const categoriesInput = document.getElementById('categoriesInput');
  const maxItemsSelect = document.getElementById('maxItemsSelect');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const saveStatus = document.getElementById('saveStatus');
  const presetButtons = document.querySelectorAll('.preset-btn');

  // 主要操作與資訊
  const currentPlaylistTitle = document.getElementById('currentPlaylistTitle');
  const startAnalyzeBtn = document.getElementById('startAnalyzeBtn');

  // 進度條與狀態
  const progressSection = document.getElementById('progressSection');
  const statusTitle = document.getElementById('statusTitle');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const statusDetailText = document.getElementById('statusDetailText');

  // 結果展示區
  const resultsSection = document.getElementById('resultsSection');
  const statTotalVideos = document.getElementById('statTotalVideos');
  const statCategoryCount = document.getElementById('statCategoryCount');
  const statModelUsed = document.getElementById('statModelUsed');
  const categoriesList = document.getElementById('categoriesList');
  const toggleAllAccordionBtn = document.getElementById('toggleAllAccordionBtn');

  // 匯出按鈕
  const copyMarkdownBtn = document.getElementById('copyMarkdownBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  // Toast
  const toast = document.getElementById('toast');

  // ==========================================
  // 全域狀態
  // ==========================================
  let currentTab = null;
  let isTargetPlaylist = false;
  let scrapedVideos = [];
  let categorizedResults = {}; // { [categoryName]: [video1, video2, ...] }
  let isProcessing = false;
  let allExpanded = false;

  const DEFAULT_CATEGORIES = '程式開發, 投資理財, 流行音樂, 遊戲動漫, 生活雜談, 其他';

  // 顏色色票清單 (用於分類卡片的小色點)
  const BADGE_COLORS = [
    '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', 
    '#8b5cf6', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
  ];

  // ==========================================
  // 初始化程序
  // ==========================================
  init();

  async function init() {
    bindEvents();
    await loadSettings();
    await checkCurrentTab();
  }

  // ==========================================
  // 事件綁定
  // ==========================================
  function bindEvents() {
    // 切換設定面板展開/收合
    toggleSettingsBtn.addEventListener('click', () => {
      const isHidden = settingsPanel.classList.toggle('hidden');
      toggleSettingsBtn.classList.toggle('active', !isHidden);
    });

    // 密碼顯示/隱藏切換
    toggleKeyVisibilityBtn.addEventListener('click', () => {
      if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        eyeIcon.textContent = '🙈';
      } else {
        apiKeyInput.type = 'password';
        eyeIcon.textContent = '👁️';
      }
    });

    // 模型供應商切換時更新說明連結
    providerSelect.addEventListener('change', () => {
      updateApiKeyHelpLink(providerSelect.value);
    });

    // 點擊快速分類預設按鈕
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tags = btn.getAttribute('data-tags');
        if (tags) {
          categoriesInput.value = tags;
          showToast('已套用預設分類標籤');
        }
      });
    });

    // 儲存設定
    saveSettingsBtn.addEventListener('click', saveSettings);

    // 開始分析按鈕
    startAnalyzeBtn.addEventListener('click', startAnalysisFlow);

    // 全部展開/收合
    toggleAllAccordionBtn.addEventListener('click', () => {
      allExpanded = !allExpanded;
      const cards = document.querySelectorAll('.category-card');
      cards.forEach(card => card.classList.toggle('open', allExpanded));
      toggleAllAccordionBtn.textContent = allExpanded ? '全部收合' : '全部展開';
    });

    // 匯出功能
    copyMarkdownBtn.addEventListener('click', copyAsMarkdown);
    exportJsonBtn.addEventListener('click', exportAsJson);
    exportCsvBtn.addEventListener('click', exportAsCsv);

    // 監聽來自 content script 的即時滾動進度訊息
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'SCRAPE_PROGRESS' && isProcessing) {
        const current = message.currentCount || 0;
        const target = message.target || 0;
        const targetText = target === Infinity ? '全部' : target;
        updateProgress(
          '步驟 1/2: 正在滾動網頁擷取影片...',
          `已發現 ${current} 部影片 (目標: ${targetText})`,
          Math.min(40, (current / (target === Infinity ? current + 20 : target)) * 40)
        );
      }
    });
  }

  // ==========================================
  // 設定存取 (chrome.storage.local)
  // ==========================================
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['provider', 'apiKey', 'categories', 'maxItems'], (result) => {
        if (result.provider) providerSelect.value = result.provider;
        if (result.apiKey) apiKeyInput.value = result.apiKey;
        categoriesInput.value = result.categories || DEFAULT_CATEGORIES;
        if (result.maxItems) maxItemsSelect.value = result.maxItems;

        updateApiKeyHelpLink(providerSelect.value);

        // 若無 API Key，自動展開設定面板引導使用者
        if (!result.apiKey) {
          settingsPanel.classList.remove('hidden');
          toggleSettingsBtn.classList.add('active');
        }

        resolve();
      });
    });
  }

  function updateApiKeyHelpLink(provider) {
    if (provider.startsWith('gemini')) {
      apiKeyHelpLink.href = 'https://aistudio.google.com/app/apikey';
      apiKeyHelpLink.textContent = '取得免費 Gemini Key ↗';
    } else {
      apiKeyHelpLink.href = 'https://platform.openai.com/api-keys';
      apiKeyHelpLink.textContent = '取得 OpenAI Key ↗';
    }
  }

  function saveSettings() {
    const settings = {
      provider: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      categories: categoriesInput.value.trim() || DEFAULT_CATEGORIES,
      maxItems: maxItemsSelect.value
    };

    chrome.storage.local.set(settings, () => {
      saveStatus.classList.remove('hidden');
      showToast('設定已成功儲存！');
      setTimeout(() => {
        saveStatus.classList.add('hidden');
      }, 2500);
    });
  }

  // ==========================================
  // 當前分頁偵測與 Content Script 通訊
  // ==========================================
  async function checkCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = tab;

      if (!tab || !tab.url) {
        setNotPlaylistState('無法取得當前分頁資訊');
        return;
      }

      const url = tab.url;
      const isYtUrl = url.includes('youtube.com/playlist') || (url.includes('youtube.com/watch') && url.includes('list='));

      if (!isYtUrl) {
        setNotPlaylistState();
        return;
      }

      // 嘗試向 content script 發送 PING 請求
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'CHECK_PAGE' });
        if (response && response.isPlaylist) {
          setPlaylistReadyState(tab.title || 'YouTube 播放清單');
        } else {
          setNotPlaylistState();
        }
      } catch (err) {
        // 若 Content Script 尚未載入，嘗試動態注入
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['scripts/content.js']
          });
          const retryResponse = await chrome.tabs.sendMessage(tab.id, { action: 'CHECK_PAGE' });
          if (retryResponse && retryResponse.isPlaylist) {
            setPlaylistReadyState(tab.title || 'YouTube 播放清單');
          } else {
            setNotPlaylistState();
          }
        } catch (injectErr) {
          console.warn('動態注入 content script 失敗:', injectErr);
          setNotPlaylistState();
        }
      }
    } catch (e) {
      console.error('分頁偵測異常:', e);
      setNotPlaylistState();
    }
  }

  function setPlaylistReadyState(title) {
    isTargetPlaylist = true;
    pageAlert.classList.add('hidden');
    startAnalyzeBtn.disabled = false;
    currentPlaylistTitle.textContent = cleanTitle(title);
    currentPlaylistTitle.title = title;
  }

  function setNotPlaylistState(customMsg) {
    isTargetPlaylist = false;
    pageAlert.classList.remove('hidden');
    startAnalyzeBtn.disabled = true;
    currentPlaylistTitle.textContent = customMsg || '未偵測到 YouTube 播放清單';
  }

  function cleanTitle(title) {
    return title.replace(/ - YouTube$/, '').trim();
  }

  // ==========================================
  // 主流程：擷取 DOM -> 批次 AI 分類 -> 渲染結果
  // ==========================================
  async function startAnalysisFlow() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      settingsPanel.classList.remove('hidden');
      toggleSettingsBtn.classList.add('active');
      apiKeyInput.focus();
      showToast('⚠️ 請先填寫 API Key 再開始分析');
      return;
    }

    const categoriesRaw = categoriesInput.value.trim() || DEFAULT_CATEGORIES;
    const categoryList = categoriesRaw.split(/[,，\n]+/).map(c => c.trim()).filter(Boolean);
    if (categoryList.length === 0) {
      showToast('⚠️ 請至少填寫一個分類標籤');
      return;
    }

    if (!categoryList.includes('其他')) {
      categoryList.push('其他');
    }

    isProcessing = true;
    startAnalyzeBtn.disabled = true;
    resultsSection.classList.add('hidden');
    progressSection.classList.remove('hidden');

    try {
      // ----------------------------------------------------
      // 階段 1: 擷取播放清單 DOM
      // ----------------------------------------------------
      updateProgress('步驟 1/2: 正在擷取播放清單...', '啟動自動滾動爬蟲...', 5);

      const maxItems = parseInt(maxItemsSelect.value, 10) || 0;
      const scrapeRes = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'SCRAPE_PLAYLIST',
        maxItems
      });

      if (!scrapeRes || !scrapeRes.success || !scrapeRes.videos || scrapeRes.videos.length === 0) {
        throw new Error(scrapeRes?.error || '未能擷取到任何影片，請確認播放清單是否有內容');
      }

      scrapedVideos = scrapeRes.videos;
      console.log(`[Popup] Successfully scraped ${scrapedVideos.length} videos:`, scrapedVideos);

      updateProgress(
        '步驟 1/2: 網頁擷取完成！',
        `共擷取 ${scrapedVideos.length} 部影片，準備進行 AI 分類...`,
        40
      );

      // ----------------------------------------------------
      // 階段 2: 批次呼叫 LLM 智慧分類
      // ----------------------------------------------------
      const provider = providerSelect.value;
      const categorizedVideos = await classifyVideosWithLLM(
        scrapedVideos,
        categoryList,
        provider,
        apiKey,
        (batchIndex, totalBatches, percent) => {
          updateProgress(
            `步驟 2/2: AI 分類中 (批次 ${batchIndex}/${totalBatches})...`,
            `正在使用 ${getProviderDisplayName(provider)} 分析影片內容...`,
            40 + Math.round(percent * 0.55)
          );
        }
      );

      // ----------------------------------------------------
      // 階段 3: 分組並呈現結果
      // ----------------------------------------------------
      updateProgress('完成！', '整理分類報表中...', 100);
      setTimeout(() => {
        progressSection.classList.add('hidden');
        renderResults(categorizedVideos, categoryList, provider);
        resultsSection.classList.remove('hidden');
        showToast('🎉 播放清單分類完成！');
      }, 500);

    } catch (err) {
      console.error('[Popup] Analysis Flow Error:', err);
      showToast(`❌ 錯誤: ${err.message}`);
      statusTitle.textContent = '發生錯誤';
      statusDetailText.textContent = err.message;
      progressBarFill.style.background = '#ef4444';
    } finally {
      isProcessing = false;
      startAnalyzeBtn.disabled = false;
    }
  }

  function updateProgress(title, detail, percent) {
    statusTitle.textContent = title;
    statusDetailText.textContent = detail;
    progressPercent.textContent = `${Math.round(percent)}%`;
    progressBarFill.style.width = `${percent}%`;
  }

  // ==========================================
  // LLM 分類引擎 (支援批次、指數退避與防禦性解析)
  // ==========================================
  async function classifyVideosWithLLM(videos, categories, provider, apiKey, onBatchProgress) {
    const BATCH_SIZE = 25; // 每批 25 部影片
    const totalBatches = Math.ceil(videos.length / BATCH_SIZE);
    const results = [];

    for (let i = 0; i < totalBatches; i++) {
      const batchStart = i * BATCH_SIZE;
      const batchVideos = videos.slice(batchStart, batchStart + BATCH_SIZE);

      if (onBatchProgress) {
        onBatchProgress(i + 1, totalBatches, (i / totalBatches) * 100);
      }

      // 提取精簡資訊給 LLM，節省 Token
      const simplifiedList = batchVideos.map(v => ({
        id: v.videoId,
        title: v.title,
        channel: v.channelTitle
      }));

      const classifiedBatch = await classifySingleBatchWithRetry(
        simplifiedList,
        categories,
        provider,
        apiKey
      );

      // 合併原始影片屬性
      const classifiedMap = new Map();
      if (Array.isArray(classifiedBatch)) {
        classifiedBatch.forEach(item => {
          if (item && item.id) classifiedMap.set(item.id, item.category);
          else if (item && item.videoId) classifiedMap.set(item.videoId, item.category);
        });
      }

      batchVideos.forEach(v => {
        let assignedCat = classifiedMap.get(v.videoId) || '其他';
        // 若模型產生的分類不在使用者定義中，歸入「其他」
        if (!categories.includes(assignedCat)) {
          assignedCat = '其他';
        }
        results.push({
          ...v,
          category: assignedCat
        });
      });
    }

    if (onBatchProgress) {
      onBatchProgress(totalBatches, totalBatches, 100);
    }

    return results;
  }

  /**
   * 具備指數退避重試的單一批次分類函式
   */
  async function classifySingleBatchWithRetry(items, categories, provider, apiKey, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          console.warn(`[Popup] Retrying API request (Attempt ${attempt}/${maxRetries}) after ${Math.round(delayMs)}ms...`);
          await new Promise(r => setTimeout(r, delayMs));
        }

        if (provider.startsWith('gemini')) {
          return await callGeminiAPI(items, categories, provider, apiKey);
        } else {
          return await callOpenAIAPI(items, categories, provider, apiKey);
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Popup] API Attempt ${attempt + 1} failed:`, err.message);
        // 如果是 API Key 錯誤 (401, 403)，不要重試，直接拋出
        if (err.message.includes('API_KEY_INVALID') || err.message.includes('401') || err.message.includes('403')) {
          throw err;
        }
      }
    }

    console.error('[Popup] All retries exhausted. Fallback to default categories.');
    // 容錯 Fallback：若全數重試失敗，自動將此批次所有影片歸為「其他」
    return items.map(it => ({ id: it.id, category: '其他' }));
  }

  /**
   * 呼叫 Google Gemini API
   */
  async function callGeminiAPI(items, categories, model, apiKey) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const promptText = `
你是一個專業的 YouTube 影片主題分類專家。
請依據影片清單（包含標題與頻道名稱），將每部影片精準歸類至以下指定分類之一：
【可選分類】：${categories.join(', ')}

【嚴格規則】：
1. 每一部影片必須歸類到上述【可選分類】之一。若無法明確判斷，請填入「其他」。
2. 請務必保持影片的 id 與原始清單完全一致。
3. 請回傳標準 JSON 物件，格式如下：
{
  "results": [
    { "id": "影片ID", "category": "分類名稱" }
  ]
}
4. 嚴禁輸出任何 Markdown 代碼塊（例如 \`\`\`json）、開頭或結尾問候語。僅輸出純 JSON 字串。

【待分類影片清單】：
${JSON.stringify(items, null, 2)}
`;

    const requestBody = {
      contents: [
        {
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const errorMsg = errorJson?.error?.message || `HTTP ${response.status} ${response.statusText}`;
      throw new Error(`Gemini API 呼叫失敗: ${errorMsg}`);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('Gemini API 未回傳有效內容');
    }

    return safeParseClassificationJSON(rawText);
  }

  /**
   * 呼叫 OpenAI API
   */
  async function callOpenAIAPI(items, categories, model, apiKey) {
    const endpoint = 'https://api.openai.com/v1/chat/completions';

    const systemPrompt = `你是一個專業的 YouTube 影片主題分類專家。
請將每部影片精準歸類至以下指定分類之一：${categories.join(', ')}。
若無法明確歸類請填入「其他」。
請回傳包含 results 陣列的 JSON 物件，格式為: {"results": [{"id": "...", "category": "..."}]}`;

    const userPrompt = `待分類影片清單：\n${JSON.stringify(items, null, 2)}`;

    const requestBody = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const errorMsg = errorJson?.error?.message || `HTTP ${response.status} ${response.statusText}`;
      throw new Error(`OpenAI API 呼叫失敗: ${errorMsg}`);
    }

    const data = await response.json();
    const rawText = data?.choices?.[0]?.message?.content;
    if (!rawText) {
      throw new Error('OpenAI API 未回傳有效內容');
    }

    return safeParseClassificationJSON(rawText);
  }

  /**
   * 安全解析 LLM 回傳的 JSON (過濾 Markdown 標記)
   */
  function safeParseClassificationJSON(raw) {
    let clean = raw.trim();
    // 清除可能包夾的 ```json ... ``` 標記
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed.results && Array.isArray(parsed.results)) {
        return parsed.results;
      }
      if (parsed.videos && Array.isArray(parsed.videos)) {
        return parsed.videos;
      }
      // 搜尋任何 Array 屬性
      for (const key in parsed) {
        if (Array.isArray(parsed[key])) return parsed[key];
      }
      return [];
    } catch (err) {
      console.warn('JSON 解析異常，嘗試正則抓取:', err, clean);
      return [];
    }
  }

  // ==========================================
  // 結果渲染 (卡片手風琴與摘要)
  // ==========================================
  function renderResults(videos, categoryList, provider) {
    categorizedResults = {};

    // 初始化所有分類陣列
    categoryList.forEach(cat => {
      categorizedResults[cat] = [];
    });

    // 將影片分配到各分類
    videos.forEach(v => {
      const cat = v.category || '其他';
      if (!categorizedResults[cat]) {
        categorizedResults[cat] = [];
      }
      categorizedResults[cat].push(v);
    });

    // 統計數據
    const activeCategories = Object.keys(categorizedResults).filter(cat => categorizedResults[cat].length > 0);
    statTotalVideos.textContent = videos.length;
    statCategoryCount.textContent = activeCategories.length;
    statModelUsed.textContent = getProviderShortName(provider);

    // 清空並構建卡片 DOM
    categoriesList.innerHTML = '';

    // 依影片數量由多到少排序
    const sortedCategories = Object.keys(categorizedResults).sort((a, b) => {
      // 讓「其他」盡量排在最後
      if (a === '其他') return 1;
      if (b === '其他') return -1;
      return categorizedResults[b].length - categorizedResults[a].length;
    });

    sortedCategories.forEach((catName, index) => {
      const catVideos = categorizedResults[catName];
      if (catVideos.length === 0) return; // 略過沒有影片的分類

      const color = BADGE_COLORS[index % BADGE_COLORS.length];
      const card = createCategoryCard(catName, catVideos, color);
      categoriesList.appendChild(card);
    });

    allExpanded = false;
    toggleAllAccordionBtn.textContent = '全部展開';
  }

  function createCategoryCard(categoryName, videos, color) {
    const card = document.createElement('div');
    card.className = 'category-card';

    const header = document.createElement('div');
    header.className = 'category-header';
    header.innerHTML = `
      <div class="category-title-group">
        <span class="category-dot" style="background-color: ${color}"></span>
        <span class="category-name">${escapeHtml(categoryName)}</span>
        <span class="category-badge">${videos.length} 部</span>
      </div>
      <span class="category-chevron">▶</span>
    `;

    const body = document.createElement('div');
    body.className = 'category-body';

    videos.forEach((v, idx) => {
      const item = document.createElement('a');
      item.className = 'video-item';
      item.href = v.url;
      item.target = '_blank';
      item.title = `點擊在 YouTube 開啟: ${v.title}`;
      
      item.innerHTML = `
        <div class="video-main">
          <div class="video-title">${idx + 1}. ${escapeHtml(v.title)}</div>
          <div class="video-meta">
            <span>👤 ${escapeHtml(v.channelTitle)}</span>
          </div>
        </div>
        ${v.duration && v.duration !== 'N/A' ? `<span class="video-duration">⏱️ ${escapeHtml(v.duration)}</span>` : ''}
      `;

      item.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: v.url });
      });

      body.appendChild(item);
    });

    // 點擊 Header 切換展開
    header.addEventListener('click', () => {
      card.classList.toggle('open');
    });

    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  // ==========================================
  // 匯出功能 (Markdown, JSON, CSV)
  // ==========================================
  async function copyAsMarkdown() {
    if (!scrapedVideos || scrapedVideos.length === 0) {
      showToast('⚠️ 目前無分類資料可匯出');
      return;
    }

    const dateStr = new Date().toLocaleString('zh-TW');
    const playlistName = currentPlaylistTitle.textContent;
    const providerName = getProviderDisplayName(providerSelect.value);

    let md = `# 🎬 YouTube 播放清單分類報表：${playlistName}\n\n`;
    md += `- **總影片數**：${scrapedVideos.length} 部\n`;
    md += `- **分析模型**：${providerName}\n`;
    md += `- **生成時間**：${dateStr}\n\n`;
    md += `---\n\n`;

    for (const [catName, vList] of Object.entries(categorizedResults)) {
      if (vList.length === 0) continue;
      md += `## 📁 ${catName} (${vList.length} 部)\n\n`;
      vList.forEach((v, idx) => {
        const durText = v.duration && v.duration !== 'N/A' ? ` [${v.duration}]` : '';
        md += `${idx + 1}. [${v.title}](${v.url}) - *${v.channelTitle}*${durText}\n`;
      });
      md += `\n`;
    }

    try {
      await navigator.clipboard.writeText(md);
      showToast('📋 已複製 Markdown 報表至剪貼簿！');
    } catch (err) {
      console.error('複製 Markdown 失敗:', err);
      showToast('❌ 複製失敗，請手動複製');
    }
  }

  function exportAsJson() {
    if (!scrapedVideos || scrapedVideos.length === 0) {
      showToast('⚠️ 目前無分類資料可匯出');
      return;
    }

    const exportData = {
      playlistTitle: currentPlaylistTitle.textContent,
      exportedAt: new Date().toISOString(),
      model: providerSelect.value,
      totalVideos: scrapedVideos.length,
      categories: categorizedResults
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    downloadFile(jsonStr, 'youtube_playlist_categorized.json', 'application/json');
    showToast('💾 已下載 JSON 檔案');
  }

  function exportAsCsv() {
    if (!scrapedVideos || scrapedVideos.length === 0) {
      showToast('⚠️ 目前無分類資料可匯出');
      return;
    }

    let csvContent = '\uFEFF'; // 加入 BOM 防止 Excel 亂碼
    csvContent += 'VideoId,Title,Channel,Duration,Category,URL\n';

    for (const [catName, vList] of Object.entries(categorizedResults)) {
      vList.forEach(v => {
        const escapeCsv = (str) => `"${(str || '').replace(/"/g, '""')}"`;
        csvContent += [
          escapeCsv(v.videoId),
          escapeCsv(v.title),
          escapeCsv(v.channelTitle),
          escapeCsv(v.duration),
          escapeCsv(catName),
          escapeCsv(v.url)
        ].join(',') + '\n';
      });
    }

    downloadFile(csvContent, 'youtube_playlist_categorized.csv', 'text/csv;charset=utf-8;');
    showToast('📊 已下載 CSV 檔案');
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==========================================
  // 輔助工具函式
  // ==========================================
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2800);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getProviderDisplayName(provider) {
    switch (provider) {
      case 'gemini-2.0-flash': return 'Google Gemini 2.0 Flash';
      case 'gemini-1.5-flash': return 'Google Gemini 1.5 Flash';
      case 'gpt-4o-mini': return 'OpenAI GPT-4o mini';
      case 'gpt-4o': return 'OpenAI GPT-4o';
      default: return provider;
    }
  }

  function getProviderShortName(provider) {
    if (provider.startsWith('gemini')) return 'Gemini';
    if (provider.startsWith('gpt')) return 'OpenAI';
    return provider;
  }
});
