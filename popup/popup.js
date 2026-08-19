/**
 * YouTube 播放清單 AI 分類器 - Popup 控制腳本 (popup/popup.js)
 * 負責頁面狀態偵測、背景任務狀態同步、UI 互動與報表匯出
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
  const customModelGroup = document.getElementById('customModelGroup');
  const customModelInput = document.getElementById('customModelInput');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleKeyVisibilityBtn = document.getElementById('toggleKeyVisibilityBtn');
  const eyeIcon = document.getElementById('eyeIcon');
  const apiKeyHelpLink = document.getElementById('apiKeyHelpLink');
  const categoriesInput = document.getElementById('categoriesInput');
  const maxItemsSelect = document.getElementById('maxItemsSelect');
  const playlistPrivacySelect = document.getElementById('playlistPrivacySelect');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const saveStatus = document.getElementById('saveStatus');
  const presetButtons = document.querySelectorAll('.preset-btn');

  // 主要操作與資訊
  const currentPlaylistTitle = document.getElementById('currentPlaylistTitle');
  const platformBadge = document.getElementById('platformBadge');
  let currentDetectedPlatform = 'youtube';
  const startAnalyzeBtn = document.getElementById('startAnalyzeBtn');
  const quickExtractBtn = document.getElementById('quickExtractBtn');
  const importFileBtn = document.getElementById('importFileBtn');
  const importFileInput = document.getElementById('importFileInput');

  // 進度條與狀態
  const progressSection = document.getElementById('progressSection');
  const statusTitle = document.getElementById('statusTitle');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const statusDetailText = document.getElementById('statusDetailText');
  const statusSpinner = document.getElementById('statusSpinner');
  const cancelTaskBtn = document.getElementById('cancelTaskBtn');

  // 結果展示區
  const resultsSection = document.getElementById('resultsSection');
  const statTotalVideos = document.getElementById('statTotalVideos');
  const statCategoryCount = document.getElementById('statCategoryCount');
  const statModelUsed = document.getElementById('statModelUsed');
  const categoriesList = document.getElementById('categoriesList');
  const toggleAllAccordionBtn = document.getElementById('toggleAllAccordionBtn');
  const clearResultsBtn = document.getElementById('clearResultsBtn');

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
  let allExpanded = false;
  let currentCachedTask = null;

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
    await syncTaskState();
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

    // 模型供應商切換時更新說明連結與自訂輸入框
    providerSelect.addEventListener('change', () => {
      toggleCustomModelField(providerSelect.value);
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

    // 取消當前任務按鈕
    if (cancelTaskBtn) {
      cancelTaskBtn.addEventListener('click', cancelTaskFlow);
    }

    // 清除結果按鈕
    if (clearResultsBtn) {
      clearResultsBtn.addEventListener('click', clearTaskResultsFlow);
    }

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

    // 快速純擷取功能 (0 Token 直接匯出原始清單)
    if (quickExtractBtn) {
      quickExtractBtn.addEventListener('click', startQuickExtractFlow);
    }

    // 匯入功能 (支援 JSON 與 CSV)
    if (importFileBtn && importFileInput) {
      importFileBtn.addEventListener('click', () => importFileInput.click());
      importFileInput.addEventListener('change', handleFileImport);
    }

    // 核心：監聽 storage 變更以達成背景即時同步
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.currentTask) {
        handleTaskStateUpdate(changes.currentTask.newValue);
      }
    });

    // 監聽來自 Content Script 的 DOM 自動化建立進度
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'CREATE_PLAYLIST_PROGRESS') {
        const activeBtn = document.querySelector(`.category-card[data-category="${message.categoryName}"] .btn-create-playlist`);
        if (activeBtn) {
          activeBtn.innerHTML = `<span>⏳ 加入中 (${message.current}/${message.total})...</span>`;
        }
      }
    });
  }

  // ==========================================
  // 設定存取 (chrome.storage.local)
  // ==========================================
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['provider', 'customModel', 'apiKey', 'categories', 'maxItems', 'privacy'], (result) => {
        let provider = result.provider || 'gemini-3.6-flash';
        if (provider === 'gemini-2.0-flash' || provider === 'gemini-2.5-flash') {
          provider = 'gemini-3.6-flash';
          chrome.storage.local.set({ provider: 'gemini-3.6-flash' });
        }

        providerSelect.value = provider;
        if (result.customModel) customModelInput.value = result.customModel;
        if (result.apiKey) apiKeyInput.value = result.apiKey;
        categoriesInput.value = result.categories || DEFAULT_CATEGORIES;
        if (result.maxItems) maxItemsSelect.value = result.maxItems;
        if (result.privacy && playlistPrivacySelect) playlistPrivacySelect.value = result.privacy;

        toggleCustomModelField(provider);
        updateApiKeyHelpLink(provider);

        // 若無 API Key，自動展開設定面板引導使用者
        if (!result.apiKey) {
          settingsPanel.classList.remove('hidden');
          toggleSettingsBtn.classList.add('active');
        }

        resolve();
      });
    });
  }

  function toggleCustomModelField(provider) {
    if (provider === 'custom') {
      customModelGroup.classList.remove('hidden');
    } else {
      customModelGroup.classList.add('hidden');
    }
  }

  function updateApiKeyHelpLink(provider) {
    const isGemini = provider.startsWith('gemini') || (provider === 'custom' && customModelInput.value.toLowerCase().includes('gemini'));
    if (isGemini) {
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
      customModel: customModelInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      categories: categoriesInput.value.trim() || DEFAULT_CATEGORIES,
      maxItems: maxItemsSelect.value,
      privacy: playlistPrivacySelect ? playlistPrivacySelect.value : 'PRIVATE'
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
      const isBiliUrl = (url.includes('space.bilibili.com') && url.includes('/favlist')) ||
                        url.includes('bilibili.com/medialist/play/') ||
                        url.includes('bilibili.com/list/ml');

      if (!isYtUrl && !isBiliUrl) {
        setNotPlaylistState();
        return;
      }

      const fallbackPlatform = isBiliUrl ? 'bilibili' : 'youtube';

      // 嘗試向 content script 發送 PING 請求
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'CHECK_PAGE' });
        if (response && response.isPlaylist) {
          const platform = response.platform || fallbackPlatform;
          setPlaylistReadyState(response.title || tab.title || (platform === 'bilibili' ? 'Bilibili 收藏夾' : 'YouTube 播放清單'), platform);
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
            const platform = retryResponse.platform || fallbackPlatform;
            setPlaylistReadyState(retryResponse.title || tab.title || (platform === 'bilibili' ? 'Bilibili 收藏夾' : 'YouTube 播放清單'), platform);
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

  function setPlaylistReadyState(title, platform = 'youtube') {
    isTargetPlaylist = true;
    currentDetectedPlatform = platform;
    pageAlert.classList.add('hidden');
    // 如果目前沒有正在進行的任務，啟用開始分析按鈕
    if (!currentCachedTask || (currentCachedTask.status !== 'scraping' && currentCachedTask.status !== 'classifying')) {
      startAnalyzeBtn.disabled = false;
    }
    if (platformBadge) {
      platformBadge.classList.remove('hidden', 'platform-youtube', 'platform-bilibili');
      platformBadge.classList.add(`platform-${platform}`);
      platformBadge.textContent = platform === 'bilibili' ? 'Bilibili' : 'YouTube';
    }
    currentPlaylistTitle.textContent = cleanTitle(title, platform);
    currentPlaylistTitle.title = title;
  }

  function setNotPlaylistState(customMsg) {
    isTargetPlaylist = false;
    currentDetectedPlatform = 'unknown';
    pageAlert.classList.remove('hidden');
    if (platformBadge) {
      platformBadge.classList.add('hidden');
    }
    // 若沒有背景任務進行中，停用按鈕
    if (!currentCachedTask || (currentCachedTask.status !== 'scraping' && currentCachedTask.status !== 'classifying')) {
      startAnalyzeBtn.disabled = true;
    }
    currentPlaylistTitle.textContent = customMsg || '未偵測到 YouTube 清單或 B 站收藏夾';
  }

  function cleanTitle(title, platform = 'youtube') {
    if (!title) return platform === 'bilibili' ? 'Bilibili 收藏夾' : 'YouTube 播放清單';
    return title
      .replace(/ - YouTube$/i, '')
      .replace(/_哔哩哔哩_bilibili$/i, '')
      .replace(/的个人空间-哔哩哔哩.*$/i, '')
      .replace(/- 哔哩哔哩.*$/i, '')
      .trim();
  }

  // ==========================================
  // 背景任務狀態同步機制
  // ==========================================
  async function syncTaskState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['currentTask'], (result) => {
        if (result.currentTask) {
          handleTaskStateUpdate(result.currentTask);
        }
        resolve();
      });
    });
  }

  function handleTaskStateUpdate(task) {
    if (!task) return;
    currentCachedTask = task;

    console.log('[Popup] Task State Update:', task.status, task);

    const btnTextSpan = startAnalyzeBtn.querySelector('.btn-text');

    if (task.status === 'scraping' || task.status === 'classifying') {
      // 進行中狀態：顯示進度條、禁用按鈕
      resultsSection.classList.add('hidden');
      progressSection.classList.remove('hidden');
      if (statusSpinner) statusSpinner.style.display = 'block';

      const isQuick = task.model === '純擷取 (0 Token)';
      if (isQuick) {
        progressBarFill.style.background = 'linear-gradient(90deg, var(--accent-indigo), #10b981)';
        if (btnTextSpan) btnTextSpan.textContent = '⏳ 背景擷取進行中...';
      } else {
        progressBarFill.style.background = 'linear-gradient(90deg, var(--accent-indigo), var(--accent-purple), var(--accent-red))';
        if (btnTextSpan) btnTextSpan.textContent = '⏳ AI 分析進行中 (背景運行)...';
      }

      statusTitle.textContent = task.statusTitle || '任務進行中...';
      statusDetailText.textContent = task.statusDetail || '正在處理...';
      const percent = Math.min(100, Math.max(0, task.progressPercent || 0));
      progressPercent.textContent = `${percent}%`;
      progressBarFill.style.width = `${percent}%`;

      startAnalyzeBtn.disabled = true;
      if (quickExtractBtn) quickExtractBtn.disabled = true;
    } else if (task.status === 'completed') {
      // 完成狀態：隱藏進度條、直接渲染結果、恢復按鈕
      progressSection.classList.add('hidden');
      renderResults(task.categorizedResults, task.totalVideos, task.model);
      resultsSection.classList.remove('hidden');

      if (isTargetPlaylist) {
        startAnalyzeBtn.disabled = false;
        if (quickExtractBtn) quickExtractBtn.disabled = false;
        if (btnTextSpan) btnTextSpan.textContent = '🚀 重新分析此播放清單';
      }
    } else if (task.status === 'error') {
      // 錯誤狀態
      progressSection.classList.remove('hidden');
      if (statusSpinner) statusSpinner.style.display = 'none';
      statusTitle.textContent = '發生錯誤';
      statusDetailText.textContent = task.error || task.statusDetail || '未知錯誤';
      progressBarFill.style.background = '#ef4444';
      progressPercent.textContent = '!';

      if (isTargetPlaylist) {
        startAnalyzeBtn.disabled = false;
        if (quickExtractBtn) quickExtractBtn.disabled = false;
        if (btnTextSpan) btnTextSpan.textContent = '🚀 開始擷取並進行 AI 分類';
      }
    } else if (task.status === 'idle') {
      // 空閒狀態
      progressSection.classList.add('hidden');
      if (!task.categorizedResults || Object.keys(task.categorizedResults).length === 0) {
        resultsSection.classList.add('hidden');
      }
      if (isTargetPlaylist) {
        startAnalyzeBtn.disabled = false;
        if (quickExtractBtn) quickExtractBtn.disabled = false;
        if (btnTextSpan) btnTextSpan.textContent = '🚀 開始擷取並進行 AI 分類';
      }
    }
  }

  // ==========================================
  // 啟動分析流程 (發送訊息給 Background 執行)
  // ==========================================
  async function startAnalysisFlow() {
    // 檢查是否有進行中的任務
    if (currentCachedTask && (currentCachedTask.status === 'scraping' || currentCachedTask.status === 'classifying')) {
      showToast('⚠️ 任務已在背景進行中，請稍候');
      return;
    }

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

    const selectedProvider = providerSelect.value;
    const customModelVal = customModelInput.value.trim();
    const maxItems = parseInt(maxItemsSelect.value, 10) || 0;

    startAnalyzeBtn.disabled = true;
    resultsSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    if (statusSpinner) statusSpinner.style.display = 'block';
    statusTitle.textContent = '步驟 1/2: 正在啟動背景任務...';
    statusDetailText.textContent = '初始化自動滾動爬蟲...';
    progressPercent.textContent = '5%';
    progressBarFill.style.width = '5%';
    progressBarFill.style.background = 'linear-gradient(90deg, var(--accent-indigo), var(--accent-purple), var(--accent-red))';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'START_ANALYSIS',
        tabId: currentTab.id,
        playlistUrl: currentTab.url,
        playlistTitle: currentPlaylistTitle.textContent,
        platform: currentDetectedPlatform,
        maxItems,
        categories: categoryList,
        provider: selectedProvider,
        customModel: customModelVal,
        apiKey
      });

      if (response && !response.success && response.message) {
        showToast(response.message);
      }
    } catch (err) {
      console.error('[Popup] Failed to send START_ANALYSIS to background:', err);
      showToast(`❌ 啟動失敗: ${err.message}`);
      statusTitle.textContent = '啟動失敗';
      statusDetailText.textContent = err.message;
      if (statusSpinner) statusSpinner.style.display = 'none';
      progressBarFill.style.background = '#ef4444';
      startAnalyzeBtn.disabled = false;
    }
  }

  // ==========================================
  // 純擷取原始清單 (0 Token 消耗，背景執行)
  // ==========================================
  async function startQuickExtractFlow() {
    if (!currentTab || !isTargetPlaylist) {
      showToast('⚠️ 請先開啟 YouTube 播放清單或 Bilibili 收藏夾網頁');
      return;
    }

    if (currentCachedTask && (currentCachedTask.status === 'scraping' || currentCachedTask.status === 'classifying')) {
      showToast('⚠️ 任務已在背景進行中，請稍候');
      return;
    }

    const maxItems = parseInt(maxItemsSelect.value, 10) || 0;

    startAnalyzeBtn.disabled = true;
    if (quickExtractBtn) quickExtractBtn.disabled = true;
    resultsSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    if (statusSpinner) statusSpinner.style.display = 'block';
    statusTitle.textContent = '正在啟動背景擷取任務...';
    statusDetailText.textContent = '自動滾動載入清單中所有影片 (背景運行，可關閉視窗)...';
    progressPercent.textContent = '5%';
    progressBarFill.style.width = '5%';
    progressBarFill.style.background = 'linear-gradient(90deg, var(--accent-indigo), #10b981)';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'START_QUICK_EXTRACT',
        tabId: currentTab.id,
        playlistUrl: currentTab.url,
        playlistTitle: currentPlaylistTitle.textContent,
        platform: currentDetectedPlatform,
        maxItems
      });

      if (response && !response.success && response.message) {
        showToast(response.message);
      }
    } catch (err) {
      console.error('[Popup] Quick extract start failed:', err);
      showToast(`❌ 啟動失敗: ${err.message}`);
      statusTitle.textContent = '啟動失敗';
      statusDetailText.textContent = err.message;
      if (statusSpinner) statusSpinner.style.display = 'none';
      progressBarFill.style.background = '#ef4444';
      if (isTargetPlaylist) {
        startAnalyzeBtn.disabled = false;
        if (quickExtractBtn) quickExtractBtn.disabled = false;
      }
    }
  }

  // ==========================================
  // 取消與清除操作
  // ==========================================
  async function cancelTaskFlow() {
    try {
      await chrome.runtime.sendMessage({ action: 'CANCEL_ANALYSIS' });
      showToast('已取消當前任務');
    } catch (err) {
      console.error('Cancel task failed:', err);
    }
  }

  async function clearTaskResultsFlow() {
    try {
      await chrome.runtime.sendMessage({ action: 'CLEAR_TASK_RESULTS' });
      resultsSection.classList.add('hidden');
      showToast('已清除分類結果');
    } catch (err) {
      console.error('Clear results failed:', err);
    }
  }

  // ==========================================
  // 結果渲染 (卡片手風琴與摘要)
  // ==========================================
  function renderResults(categorizedResults, totalVideos, model, openCategories = null) {
    let results = categorizedResults;
    let total = totalVideos;
    let modelName = model;

    // 容錯支援：如果直接傳入 task 物件
    if (categorizedResults && typeof categorizedResults === 'object' && categorizedResults.categorizedResults) {
      results = categorizedResults.categorizedResults;
      total = categorizedResults.totalVideos;
      modelName = categorizedResults.model;
    }

    if (!results || typeof results !== 'object') return;

    const activeCategories = Object.keys(results).filter(cat => Array.isArray(results[cat]) && results[cat].length > 0);
    
    // 計算總影片數
    let computedTotal = 0;
    for (const cat of activeCategories) {
      computedTotal += (results[cat] || []).length;
    }

    const finalTotal = (typeof total === 'number' && !isNaN(total)) ? total : computedTotal;
    statTotalVideos.textContent = finalTotal;
    statCategoryCount.textContent = activeCategories.length;
    statModelUsed.textContent = getProviderShortName(modelName || providerSelect.value);

    // 清空並構建卡片 DOM
    categoriesList.innerHTML = '';

    // 依影片數量由多到少排序
    const sortedCategories = activeCategories.sort((a, b) => {
      if (a === '其他') return 1;
      if (b === '其他') return -1;
      return (results[b] || []).length - (results[a] || []).length;
    });

    const allCategoryNames = Object.keys(results);

    sortedCategories.forEach((catName, index) => {
      const catVideos = results[catName] || [];
      if (!Array.isArray(catVideos) || catVideos.length === 0) return;

      const color = BADGE_COLORS[index % BADGE_COLORS.length];
      const card = createCategoryCard(catName, catVideos, color, allCategoryNames);

      // 若指定要開啟的分類，或是僅有單一分類 (例: 純擷取/單標籤)，自動展開卡片
      if ((openCategories && openCategories.has(catName)) || sortedCategories.length === 1) {
        card.classList.add('open');
      }

      categoriesList.appendChild(card);
    });

    allExpanded = false;
    toggleAllAccordionBtn.textContent = '全部展開';
  }

  function createCategoryCard(categoryName, videos, color, allCategoryNames = []) {
    const card = document.createElement('div');
    card.className = 'category-card';
    card.setAttribute('data-category', categoryName);

    // 辨識當前平台 (Bilibili 收藏夾 vs YouTube 播放清單)
    const isBilibili = (currentDetectedPlatform === 'bilibili') ||
                       (currentCachedTask?.platform === 'bilibili') ||
                       (currentTab?.url && currentTab.url.includes('bilibili.com'));
    const platformLabel = isBilibili ? 'Bilibili' : 'YouTube';
    const actionLabel = isBilibili ? '建立收藏' : '建立清單';
    const openActionLabel = isBilibili ? '開啟收藏' : '開啟清單';

    const header = document.createElement('div');
    header.className = 'category-header';
    header.innerHTML = `
      <div class="category-title-group">
        <span class="category-dot" style="background-color: ${color}"></span>
        <span class="category-name">${escapeHtml(categoryName)}</span>
        <span class="category-badge">${videos.length} 部</span>
      </div>
      <div class="category-header-right">
        <button class="btn-create-playlist" title="在 ${platformLabel} 自動建立此分類${isBilibili ? '收藏夾' : '播放清單'}並加入影片">
          <span>➕ ${actionLabel}</span>
        </button>
        <span class="category-chevron">▶</span>
      </div>
    `;

    // 綁定「建立此清單/收藏」點擊事件 (YouTube: Innertube 原生引擎; Bilibili: FavFolder API 原生引擎)
    const btnCreate = header.querySelector('.btn-create-playlist');
    let createdPlaylistUrl = null;

    btnCreate.addEventListener('click', async (e) => {
      e.stopPropagation(); // 防止觸發手風琴開闔

      // 若已建立過，點擊直接在新分頁開啟該播放清單/收藏夾
      if (createdPlaylistUrl) {
        chrome.tabs.create({ url: createdPlaylistUrl });
        return;
      }

      if (btnCreate.disabled) return;

      if (!currentTab || !currentTab.id) {
        showToast(`⚠️ 未能取得當前 ${platformLabel} 分頁`);
        return;
      }

      btnCreate.disabled = true;
      btnCreate.classList.add('loading');
      btnCreate.innerHTML = `<span>⏳ 建立中 (${videos.length} 部)...</span>`;
      showToast(`🚀 開始在 ${platformLabel} 建立「${categoryName}」...`);

      try {
        const privacy = playlistPrivacySelect ? playlistPrivacySelect.value : 'PRIVATE';
        const videoPayload = isBilibili
          ? videos.map(v => ({ aid: v.aid || '', bvid: v.bvid || v.videoId || '', url: v.url || '', id: v.id || '' }))
          : videos.map(v => v.videoId || v.bvid || v.url || v.id).filter(Boolean);

        const targetFunc = isBilibili ? nativeCreateBilibiliFavFolderInPage : nativeCreatePlaylistInPage;

        // 使用 Chrome Scripting MAIN world 於目標頁面原生執行建立
        const execResults = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          world: 'MAIN',
          func: targetFunc,
          args: [categoryName, privacy, videoPayload]
        });

        const res = execResults?.[0]?.result;

        if (res && res.success) {
          createdPlaylistUrl = res.playlistUrl;
          btnCreate.classList.remove('loading');
          btnCreate.classList.add('success');
          btnCreate.disabled = false;
          btnCreate.innerHTML = `<span>↗️ ${openActionLabel} (${res.addedCount})</span>`;
          btnCreate.title = `點擊在新分頁開啟「${categoryName}」${isBilibili ? '收藏夾' : '播放清單'}`;
          showToast(`🎉 成功在 ${platformLabel} 建立「${categoryName}」(共加入 ${res.addedCount} 部影片)！`);
        } else {
          throw new Error(res?.error || '建立過程發生錯誤');
        }
      } catch (err) {
        console.error('Create playlist/fav error:', err);
        btnCreate.classList.remove('loading');
        btnCreate.disabled = false;
        btnCreate.innerHTML = `<span>➕ ${actionLabel}</span>`;
        showToast(`❌ 建立失敗: ${err.message}`);
      }
    });

    const body = document.createElement('div');
    body.className = 'category-body';

    // 取得所有可用分類名單
    const targetCategories = (allCategoryNames && allCategoryNames.length > 0)
      ? allCategoryNames
      : Object.keys(currentCachedTask?.categorizedResults || {});

    videos.forEach((v, idx) => {
      const item = document.createElement('div');
      item.className = 'video-item';
      
      const durationHtml = (v.duration && v.duration !== 'N/A')
        ? `<span class="video-duration">⏱️ ${escapeHtml(v.duration)}</span>`
        : '';

      // 構建分類切換下拉選項
      let optionsHtml = '';
      targetCategories.forEach(cat => {
        optionsHtml += `<option value="${escapeHtml(cat)}" ${cat === categoryName ? 'selected' : ''}>📁 ${escapeHtml(cat)}</option>`;
      });
      optionsHtml += `<option value="__NEW_CATEGORY__">➕ 新建分類...</option>`;

      item.innerHTML = `
        <div class="video-main">
          <a class="video-title" href="${escapeHtml(v.url)}" target="_blank" title="點擊在分頁開啟: ${escapeHtml(v.title)}">${idx + 1}. ${escapeHtml(v.title)}</a>
          <div class="video-meta">
            <span>👤 ${escapeHtml(v.channelTitle)}</span>
          </div>
        </div>
        <div class="video-right-meta">
          ${durationHtml}
          <select class="video-category-select" title="移至其他分類">
            ${optionsHtml}
          </select>
        </div>
      `;

      // 下拉選單事件綁定
      const selectEl = item.querySelector('.video-category-select');
      if (selectEl) {
        selectEl.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        selectEl.addEventListener('change', (e) => {
          e.stopPropagation();
          handleMoveVideoCategory(v, categoryName, selectEl.value, selectEl);
        });
      }

      // 獨立標題超連結事件綁定
      const titleLink = item.querySelector('.video-title');
      if (titleLink) {
        titleLink.addEventListener('click', (e) => {
          e.preventDefault();
          if (v.url) {
            chrome.tabs.create({ url: v.url });
          }
        });
      }

      body.appendChild(item);
    });

    // 點擊 Header 切換展開 (排除點擊按鈕的情況)
    header.addEventListener('click', (e) => {
      if (e.target.closest('.btn-create-playlist')) return;
      card.classList.toggle('open');
    });

    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  /**
   * 輕量影片分類微調處理函式 (即時遷移 + 自動持久化)
   */
  function handleMoveVideoCategory(video, sourceCategory, selectedValue, selectElement) {
    let targetCategory = selectedValue;

    if (selectedValue === '__NEW_CATEGORY__') {
      const userInput = prompt('請輸入新建分類名稱：');
      if (!userInput || !userInput.trim()) {
        selectElement.value = sourceCategory;
        return;
      }
      targetCategory = userInput.trim();
    }

    if (targetCategory === sourceCategory) {
      selectElement.value = sourceCategory;
      return;
    }

    if (!currentCachedTask || !currentCachedTask.categorizedResults) return;

    const results = currentCachedTask.categorizedResults;

    // 1. 從原分類移除
    const srcList = results[sourceCategory] || [];
    const videoIndex = srcList.findIndex(item => 
      (item.videoId && item.videoId === video.videoId) || 
      (item.url && item.url === video.url) || 
      item.title === video.title
    );
    if (videoIndex !== -1) {
      srcList.splice(videoIndex, 1);
    }

    // 2. 加入目標分類
    if (!results[targetCategory]) {
      results[targetCategory] = [];
    }
    const updatedVideo = { ...video, category: targetCategory };
    results[targetCategory].push(updatedVideo);

    // 3. 記錄當前所有展開的卡片，並自動展開目標分類卡片
    const openCards = new Set();
    document.querySelectorAll('.category-card.open').forEach(c => {
      const name = c.getAttribute('data-category');
      if (name) openCards.add(name);
    });
    openCards.add(targetCategory);

    // 4. 持久化至 chrome.storage.local
    currentCachedTask.categorizedResults = results;
    chrome.storage.local.set({ currentTask: currentCachedTask }, () => {
      console.log(`[Popup] Video moved from "${sourceCategory}" to "${targetCategory}"`);
    });

    // 5. 重新渲染
    renderResults(results, currentCachedTask.totalVideos, currentCachedTask.model, openCards);
    showToast(`已將影片移至「${targetCategory}」`);
  }

  // ==========================================
  // 匯出功能 (Markdown, JSON, CSV) - 支援平台辨識與檔名區分
  // ==========================================
  function getExportFileName(extension) {
    const platform = currentDetectedPlatform || (currentCachedTask?.platform) || 'youtube';
    const isBili = platform === 'bilibili';
    const rawTitle = currentPlaylistTitle?.textContent || (isBili ? 'Bilibili收藏夾' : 'YouTube清單');
    const safeTitle = rawTitle
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 35);

    const prefix = isBili ? 'bilibili_favlist' : 'youtube_playlist';
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    return `${prefix}_${safeTitle}_${dateStr}.${extension}`;
  }

  async function copyAsMarkdown() {
    const task = currentCachedTask;
    if (!task || !task.categorizedResults || Object.keys(task.categorizedResults).length === 0) {
      showToast('⚠️ 目前無分類資料可匯出');
      return;
    }

    const platform = currentDetectedPlatform || task.platform || 'youtube';
    const isBili = platform === 'bilibili';
    const platformIcon = isBili ? '📺' : '🎬';
    const platformLabel = isBili ? 'Bilibili 收藏夾' : 'YouTube 播放清單';

    const dateStr = new Date(task.completedAt || Date.now()).toLocaleString('zh-TW');
    const playlistName = currentPlaylistTitle.textContent;
    const providerName = getProviderDisplayName(providerSelect.value, customModelInput.value.trim());

    let md = `# ${platformIcon} ${platformLabel}分類報表：${playlistName}\n\n`;
    md += `- **平台來源**：${isBili ? 'Bilibili (B站)' : 'YouTube'}\n`;
    md += `- **總影片數**：${task.totalVideos || 0} 部\n`;
    md += `- **分析模型**：${task.model || providerName}\n`;
    md += `- **生成時間**：${dateStr}\n\n`;
    md += `---\n\n`;

    for (const [catName, vList] of Object.entries(task.categorizedResults)) {
      if (!vList || vList.length === 0) continue;
      md += `## 📁 ${catName} (${vList.length} 部)\n\n`;
      vList.forEach((v, idx) => {
        const durText = v.duration && v.duration !== 'N/A' ? ` [${v.duration}]` : '';
        const author = v.channelTitle || (isBili ? '未知UP主' : '未知頻道');
        md += `${idx + 1}. [${v.title}](${v.url}) - *${author}*${durText}\n`;
      });
      md += `\n`;
    }

    try {
      await navigator.clipboard.writeText(md);
      showToast(`📋 已複製 ${isBili ? 'B站' : 'YouTube'} Markdown 報表至剪貼簿！`);
    } catch (err) {
      console.error('複製 Markdown 失敗:', err);
      showToast('❌ 複製失敗，請手動複製');
    }
  }

  function exportAsJson() {
    const task = currentCachedTask;
    if (!task || !task.categorizedResults || Object.keys(task.categorizedResults).length === 0) {
      showToast('⚠️ 目前無分類資料可匯出');
      return;
    }

    const platform = currentDetectedPlatform || task.platform || 'youtube';
    const isBili = platform === 'bilibili';

    const exportData = {
      platform: isBili ? 'bilibili' : 'youtube',
      playlistTitle: currentPlaylistTitle.textContent,
      exportedAt: new Date().toISOString(),
      model: task.model || providerSelect.value,
      totalVideos: task.totalVideos || 0,
      categories: task.categorizedResults
    };

    const fileName = getExportFileName('json');
    const jsonStr = JSON.stringify(exportData, null, 2);
    downloadFile(jsonStr, fileName, 'application/json');
    showToast(`💾 已下載 ${isBili ? 'B站' : 'YouTube'} JSON 檔案 (${fileName})`);
  }

  function exportAsCsv() {
    const task = currentCachedTask;
    if (!task || !task.categorizedResults || Object.keys(task.categorizedResults).length === 0) {
      showToast('⚠️ 目前無分類資料可匯出');
      return;
    }

    const platform = currentDetectedPlatform || task.platform || 'youtube';
    const isBili = platform === 'bilibili';

    let csvContent = '\uFEFF'; // 加入 BOM 防止 Excel 亂碼
    csvContent += isBili
      ? 'BVID,Title,UP,Duration,Category,URL\n'
      : 'VideoId,Title,Channel,Duration,Category,URL\n';

    for (const [catName, vList] of Object.entries(task.categorizedResults)) {
      if (!vList) continue;
      vList.forEach(v => {
        const escapeCsv = (str) => `"${(str || '').replace(/"/g, '""')}"`;
        csvContent += [
          escapeCsv(v.videoId || v.bvid || v.id),
          escapeCsv(v.title),
          escapeCsv(v.channelTitle),
          escapeCsv(v.duration),
          escapeCsv(catName),
          escapeCsv(v.url)
        ].join(',') + '\n';
      });
    }

    const fileName = getExportFileName('csv');
    downloadFile(csvContent, fileName, 'text/csv;charset=utf-8;');
    showToast(`📊 已下載 ${isBili ? 'B站' : 'YouTube'} CSV 檔案 (${fileName})`);
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
  // 檔案匯入功能 (支援 JSON 與 CSV 格式)
  // ==========================================
  function handleFileImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const fileName = file.name.toLowerCase();
        let categorizedResults = {};

        if (fileName.endsWith('.json')) {
          categorizedResults = parseImportedJSON(text);
        } else if (fileName.endsWith('.csv')) {
          categorizedResults = parseImportedCSV(text);
        } else {
          // 嘗試先以 JSON 解析，失敗再以 CSV 解析
          try {
            categorizedResults = parseImportedJSON(text);
          } catch (_) {
            categorizedResults = parseImportedCSV(text);
          }
        }

        const categoryNames = Object.keys(categorizedResults);
        if (categoryNames.length === 0) {
          throw new Error('匯入檔案內無有效之分類或影片資料');
        }

        let totalVideos = 0;
        categoryNames.forEach(cat => {
          totalVideos += (categorizedResults[cat] || []).length;
        });

        if (totalVideos === 0) {
          throw new Error('匯入之分類中沒有任何影片項目');
        }

        const baseTitle = file.name.replace(/\.[^/.]+$/, '');
        const importedTask = {
          status: 'completed',
          progressPercent: 100,
          statusTitle: '檔案匯入成功',
          statusDetail: `已從「${file.name}」匯入 ${totalVideos} 部影片 (${categoryNames.length} 個分類)`,
          playlistUrl: currentTab?.url || '',
          playlistTitle: `匯入清單: ${baseTitle}`,
          totalVideos,
          categorizedResults,
          model: '檔案匯入 (0 Token)',
          completedAt: Date.now()
        };

        // 更新本地快取與全域任務
        chrome.storage.local.set({ currentTask: importedTask }, () => {
          currentCachedTask = importedTask;
          progressSection.classList.add('hidden');
          renderResults(importedTask.categorizedResults, importedTask.totalVideos, importedTask.model);
          resultsSection.classList.remove('hidden');
          showToast(`🎉 成功匯入 ${totalVideos} 部影片 (${categoryNames.length} 個分類)！可直接點擊建立清單！`);
        });

      } catch (err) {
        console.error('File import error:', err);
        showToast(`❌ 匯入失敗: ${err.message}`);
      } finally {
        event.target.value = '';
      }
    };

    reader.onerror = () => {
      showToast('❌ 讀取檔案失敗');
      event.target.value = '';
    };

    reader.readAsText(file, 'UTF-8');
  }

  function parseImportedJSON(jsonString) {
    const data = JSON.parse(jsonString);
    const result = {};

    function normalizeVideo(v, fallbackCat = '其他') {
      const vid = v.videoId || v.id || extractVideoIdFromUrl(v.url) || '';
      return {
        videoId: vid,
        title: v.title || '無標題影片',
        channelTitle: v.channelTitle || v.channel || '未知頻道',
        duration: v.duration || 'N/A',
        url: v.url || (vid ? `https://www.youtube.com/watch?v=${vid}` : ''),
        category: v.category || fallbackCat
      };
    }

    // 格式 1: 標準匯出格式 { playlistTitle, categories: { "Cat1": [ ... ] } }
    if (data.categories && typeof data.categories === 'object' && !Array.isArray(data.categories)) {
      for (const [catName, vList] of Object.entries(data.categories)) {
        if (Array.isArray(vList)) {
          result[catName] = vList.map(v => normalizeVideo(v, catName));
        }
      }
    }
    // 格式 2: 直接是物件分類映射 { "Cat1": [ ... ], "Cat2": [ ... ] }
    else if (typeof data === 'object' && !Array.isArray(data)) {
      for (const [catName, vList] of Object.entries(data)) {
        if (Array.isArray(vList)) {
          result[catName] = vList.map(v => normalizeVideo(v, catName));
        }
      }
    }
    // 格式 3: 扁平陣列 [ { title, category, videoId, ... }, ... ]
    else if (Array.isArray(data)) {
      data.forEach(item => {
        const cat = item.category || '其他';
        if (!result[cat]) result[cat] = [];
        result[cat].push(normalizeVideo(item, cat));
      });
    }

    return result;
  }

  function parseImportedCSV(csvString) {
    const lines = parseCSVRows(csvString);
    if (!lines || lines.length < 2) {
      throw new Error('CSV 檔案內容為空或缺少資料行');
    }

    const header = lines[0].map(h => (h || '').trim().toLowerCase());
    let idIdx = header.findIndex(h => h.includes('id') || h.includes('編號'));
    let titleIdx = header.findIndex(h => h.includes('title') || h.includes('標題') || h.includes('名稱'));
    let channelIdx = header.findIndex(h => h.includes('channel') || h.includes('頻道') || h.includes('作者'));
    let durationIdx = header.findIndex(h => h.includes('duration') || h.includes('時長') || h.includes('時間'));
    let categoryIdx = header.findIndex(h => h.includes('category') || h.includes('分類') || h.includes('標籤'));
    let urlIdx = header.findIndex(h => h.includes('url') || h.includes('網址') || h.includes('連結'));

    // 預設位置容錯 (按照標準匯出順序: Video ID, Title, Channel, Duration, Category, URL)
    if (idIdx === -1 && lines[0].length >= 1) idIdx = 0;
    if (titleIdx === -1 && lines[0].length >= 2) titleIdx = 1;
    if (channelIdx === -1 && lines[0].length >= 3) channelIdx = 2;
    if (durationIdx === -1 && lines[0].length >= 4) durationIdx = 3;
    if (categoryIdx === -1 && lines[0].length >= 5) categoryIdx = 4;
    if (urlIdx === -1 && lines[0].length >= 6) urlIdx = 5;

    const result = {};

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row || row.length === 0 || (row.length === 1 && !row[0].trim())) continue;

      const rawId = idIdx >= 0 ? (row[idIdx] || '').trim() : '';
      const title = titleIdx >= 0 ? (row[titleIdx] || '').trim() : '無標題影片';
      const channel = channelIdx >= 0 ? (row[channelIdx] || '').trim() : '未知頻道';
      const duration = durationIdx >= 0 ? (row[durationIdx] || '').trim() : 'N/A';
      const category = categoryIdx >= 0 && row[categoryIdx]?.trim() ? row[categoryIdx].trim() : '其他';
      const url = urlIdx >= 0 ? (row[urlIdx] || '').trim() : '';

      const videoId = rawId || extractVideoIdFromUrl(url) || '';
      const finalUrl = url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');

      if (!result[category]) {
        result[category] = [];
      }

      result[category].push({
        videoId,
        title: title || '無標題影片',
        channelTitle: channel || '未知頻道',
        duration: duration || 'N/A',
        url: finalUrl,
        category
      });
    }

    return result;
  }

  function parseCSVRows(text) {
    let row = [''];
    const rows = [row];
    let insideQuote = false;
    let i = 0;

    // 移除 UTF-8 BOM
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }

    while (i < text.length) {
      const char = text[i];
      if (char === '"') {
        if (insideQuote && text[i + 1] === '"') {
          row[row.length - 1] += '"';
          i += 2;
          continue;
        }
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        row.push('');
      } else if ((char === '\r' || char === '\n') && !insideQuote) {
        if (char === '\r' && text[i + 1] === '\n') {
          i++;
        }
        if (i < text.length - 1) {
          row = [''];
          rows.push(row);
        }
      } else {
        row[row.length - 1] += char;
      }
      i++;
    }
    return rows;
  }

  function extractVideoIdFromUrl(url) {
    if (!url) return '';
    const match = url.match(/(?:v=|youtu\.be\/|\/embed\/|\/v\/|watch\?v=)([^#&?]+)/);
    return match ? match[1] : '';
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

  function getProviderDisplayName(provider, customModel) {
    if (provider === 'custom') {
      return `自訂模型 (${customModel || '未填寫'})`;
    }
    switch (provider) {
      case 'gemini-3.6-flash': return 'Google Gemini 3.6 Flash';
      case 'gemini-2.5-flash': return 'Google Gemini 2.5 Flash';
      case 'gemini-1.5-flash': return 'Google Gemini 1.5 Flash';
      case 'gemini-1.5-pro': return 'Google Gemini 1.5 Pro';
      case 'gpt-4o-mini': return 'OpenAI GPT-4o mini';
      case 'gpt-4o': return 'OpenAI GPT-4o';
      default: return provider;
    }
  }

  function getProviderShortName(provider, customModel) {
    const target = provider === 'custom' ? (customModel || 'Custom') : (provider || '');
    if (target.includes('純擷取') || target.includes('擷取') || target.toLowerCase().includes('raw')) return '純擷取 (0 Token)';
    if (target.includes('匯入') || target.toLowerCase().includes('import')) return '檔案匯入';
    if (target.toLowerCase().includes('gemini')) return 'Gemini';
    if (target.toLowerCase().includes('gpt') || target.toLowerCase().includes('openai')) return 'OpenAI';
    return target || 'Gemini';
  }
});

/**
 * 注入至 YouTube 頁面原生環境 (MAIN world) 執行的建立播放清單函式
 * 直接透過 YouTube 本地 Innertube Web Client API 建立清單並批次加入影片 (含 SAPISIDHASH 原生認證)
 */
async function nativeCreatePlaylistInPage(categoryName, privacy, videoIds) {
  try {
    // 1. 取得 YouTube 頁面配置 (ytcfg)
    let ytcfg = window.ytcfg;
    if (!ytcfg && typeof window.yt !== 'undefined' && window.yt.config_) {
      ytcfg = {
        get: (key) => window.yt.config_[key] || (window.ytcfg ? window.ytcfg.get(key) : null)
      };
    }

    if (!ytcfg) {
      return { success: false, error: '未能取得 YouTube 頁面配置 (ytcfg)，請確認當前為 YouTube 分頁並重新整理。' };
    }

    const apiKey = ytcfg.get('INNERTUBE_API_KEY');
    const context = ytcfg.get('INNERTUBE_CONTEXT');
    const loggedIn = ytcfg.get('LOGGED_IN');

    // 2. 計算 Google 原生 SAPISIDHASH 認證金鑰
    async function computeSAPISIDHash(origin = 'https://www.youtube.com') {
      function getCookie(name) {
        const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
      }

      const sapisid = getCookie('SAPISID') ||
                      getCookie('__Secure-3PAPISID') ||
                      getCookie('__Secure-1PAPISID') ||
                      getCookie('APISID');

      if (!sapisid) return null;

      const timestamp = Math.floor(Date.now() / 1000);
      const data = `${timestamp} ${sapisid} ${origin}`;
      const msgUint8 = new TextEncoder().encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return `SAPISIDHASH ${timestamp}_${hashHex}`;
    }

    const authHeader = await computeSAPISIDHash('https://www.youtube.com');

    if (!authHeader && loggedIn === false) {
      return { success: false, error: '請先在 YouTube 登入您的 Google 帳號後再建立播放清單！' };
    }

    if (!apiKey || !context) {
      return { success: false, error: '未能讀取 YouTube API 金鑰與 Context，請重新整理 YouTube 頁面後再試。' };
    }

    const privacyStatus = (privacy === 'PUBLIC') ? 'PUBLIC' : (privacy === 'UNLISTED' ? 'UNLISTED' : 'PRIVATE');

    const clientName = context?.client?.clientName || '1';
    const clientVersion = context?.client?.clientVersion || '2.20240101.00.00';
    const authUser = (ytcfg && ytcfg.get('SESSION_INDEX')) || '0';
    const delegatedSessionId = ytcfg && ytcfg.get('DELEGATED_SESSION_ID');
    const visitorData = ytcfg && ytcfg.get('VISITOR_DATA');

    // 構建包含完整 SAPISIDHASH 認證的 Headers
    const reqHeaders = {
      'Content-Type': 'application/json',
      'X-Origin': 'https://www.youtube.com',
      'X-YouTube-Client-Name': String(clientName),
      'X-YouTube-Client-Version': clientVersion,
      'X-Goog-AuthUser': String(authUser)
    };

    if (authHeader) {
      reqHeaders['Authorization'] = authHeader;
    }
    if (delegatedSessionId) {
      reqHeaders['X-Goog-PageId'] = delegatedSessionId;
    }
    if (visitorData) {
      reqHeaders['X-Goog-Visitor-Id'] = visitorData;
    }

    // 3. 建立播放清單並放入第一批影片 (最多 50 部)
    const firstBatch = videoIds.slice(0, 50);
    const createPayload = {
      context: context,
      title: categoryName,
      privacyStatus: privacyStatus,
      videoIds: firstBatch
    };

    console.log('[YT-AI-Classifier:NativeEngine] Sending /youtubei/v1/playlist/create with SAPISIDHASH auth...');

    const response = await fetch(`/youtubei/v1/playlist/create?key=${apiKey}`, {
      method: 'POST',
      credentials: 'include',
      headers: reqHeaders,
      body: JSON.stringify(createPayload)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, error: `YouTube 建立清單回傳錯誤 (HTTP ${response.status}): ${errText}` };
    }

    const data = await response.json();
    const playlistId = data.playlistId;

    if (!playlistId) {
      const alertMsg = data?.actions?.[0]?.openPopupAction?.popup?.notificationActionRenderer?.responseText?.runs?.[0]?.text;
      return { success: false, error: alertMsg || 'YouTube 未回傳建立之播放清單 ID' };
    }

    // 4. 若影片數量大於 50 部，透過 edit_playlist 批次加入其餘影片
    if (videoIds.length > 50) {
      const remaining = videoIds.slice(50);
      const actions = remaining.map(id => ({
        action: 'ACTION_ADD_VIDEO',
        addedVideoId: id
      }));

      for (let i = 0; i < actions.length; i += 50) {
        const chunk = actions.slice(i, i + 50);
        await fetch(`/youtubei/v1/browse/edit_playlist?key=${apiKey}`, {
          method: 'POST',
          credentials: 'include',
          headers: reqHeaders,
          body: JSON.stringify({
            context: context,
            playlistId: playlistId,
            actions: chunk
          })
        }).catch((err) => console.warn('[YT-AI-Classifier:NativeEngine] Edit playlist chunk error:', err));
      }
    }

    return {
      success: true,
      playlistId: playlistId,
      playlistUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      addedCount: videoIds.length,
      categoryName: categoryName
    };
  } catch (err) {
    return { success: false, error: err.message || '執行建立過程發生未預期例外' };
  }
}

/**
 * 注入至 Bilibili 頁面原生環境 (MAIN world) 執行的建立收藏夾函式
 * 透過 Bilibili Web API 建立收藏夾並批次加入影片 (BVID 轉 AID，支援 deal / batch-deal)
 */
async function nativeCreateBilibiliFavFolderInPage(categoryName, privacy, videoIds) {
  try {
    // 1. 取得 CSRF Token (bili_jct)
    const csrfMatch = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/);
    const csrf = csrfMatch ? csrfMatch[1] : '';

    if (!csrf) {
      return { success: false, error: '未能讀取 Bilibili 登入憑證 (bili_jct)，請確認已在 B 站登入帳號並重新整理頁面後再試！' };
    }

    // 2. 建立新收藏夾
    const privacyCode = (privacy === 'PUBLIC') ? 0 : 1;
    const createParams = new URLSearchParams();
    createParams.append('title', categoryName);
    createParams.append('intro', '由 YouTube/Bilibili 智慧分類器自動建立');
    createParams.append('privacy', String(privacyCode));
    createParams.append('csrf', csrf);

    console.log('[Bilibili:NativeEngine] Creating favorite folder:', categoryName);

    const createRes = await fetch('https://api.bilibili.com/x/v3/fav/folder/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/plain, */*'
      },
      credentials: 'include',
      body: createParams.toString()
    });

    if (!createRes.ok) {
      return { success: false, error: `B站建立收藏夾 HTTP 錯誤 (狀態碼 ${createRes.status})` };
    }

    const createData = await createRes.json();
    if (createData.code !== 0 || !createData.data?.id) {
      return { success: false, error: createData.message || `B站建立收藏夾失敗 (錯誤碼 ${createData.code})` };
    }

    const folderId = createData.data.id || createData.data.media_id;
    let userMid = createData.data.mid || '';
    if (!userMid) {
      const midMatch = document.cookie.match(/(?:^|;\s*)DedeUserID=([^;]+)/);
      if (midMatch) userMid = midMatch[1];
    }
    if (!userMid && window.__INITIAL_STATE__ && window.__INITIAL_STATE__.mid) {
      userMid = String(window.__INITIAL_STATE__.mid);
    }

    // 3. 高精度真實 AID 解析器 (支援直接傳入 AID、AV 號或透過官方 View API 獲取真實大整數 AID)
    async function getRealAid(item) {
      if (!item) return null;
      if (typeof item === 'object' && item.aid && /^\d+$/.test(String(item.aid))) {
        return String(item.aid);
      }
      const raw = typeof item === 'object' ? (item.aid || item.bvid || item.videoId || item.url || item.id || '') : String(item);
      const str = String(raw).trim();
      if (/^\d+$/.test(str)) return str;
      const avMatch = str.match(/av(\d+)/i);
      if (avMatch) return avMatch[1];

      const bvMatch = str.match(/(?:BV|bv)([a-zA-Z0-9]{10})/);
      if (bvMatch) {
        const bv = 'BV' + bvMatch[1];
        try {
          const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`, {
            credentials: 'include'
          });
          const viewData = await viewRes.json();
          if (viewData.code === 0 && viewData.data?.aid) {
            return String(viewData.data.aid);
          }
        } catch (_) {}
      }
      return null;
    }

    const aids = [];
    for (const vid of videoIds) {
      const aid = await getRealAid(vid);
      if (aid && /^\d+$/.test(aid)) {
        aids.push(aid);
      }
    }

    console.log(`[Bilibili:NativeEngine] Folder created fid=${folderId}, adding ${aids.length} videos sequentially via deal API (AIDs: ${aids.join(',')})...`);

    // 4. 直接使用穩健的 deal 接口逐一將影片寫入新收藏夾
    async function addVideoToFolder(targetMediaId, aid, csrfToken) {
      const params = new URLSearchParams();
      params.append('rid', aid.toString());        // 影片真實純數字 AID
      params.append('type', '2');                  // 2 代表視頻稿件
      params.append('add_media_ids', targetMediaId.toString()); // 目標收藏夾 ID
      params.append('del_media_ids', '');          // 不從其他清單移除
      params.append('csrf', csrfToken);

      const res = await fetch('https://api.bilibili.com/x/v3/fav/resource/deal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: params.toString(),
        credentials: 'include' // 必備：自動帶上登入 Cookie
      });

      const result = await res.json();
      console.log(`[Bilibili:DealResult] AID: ${aid} ->`, result);
      return result;
    }

    let addedSuccessCount = 0;
    for (let i = 0; i < aids.length; i++) {
      const aid = aids[i];
      try {
        const dealRes = await addVideoToFolder(folderId, aid, csrf);
        if (dealRes && dealRes.code === 0) {
          addedSuccessCount++;
        } else {
          console.warn(`[Bilibili:Deal] (${i + 1}/${aids.length}) AID ${aid} returned code ${dealRes?.code}: ${dealRes?.message}`);
        }
      } catch (err) {
        console.warn(`[Bilibili:Deal] (${i + 1}/${aids.length}) AID ${aid} error:`, err);
      }

      // 800ms 延遲防風控
      if (i < aids.length - 1) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    if (aids.length > 0 && addedSuccessCount === 0) {
      return { success: false, error: '收藏夾已建立，但影片加入過程受 B 站風控或權限限制，請手動確認。' };
    }

    const folderFid = createData.data.fid || folderId;
    const playlistUrl = userMid
      ? `https://space.bilibili.com/${userMid}/favlist?fid=${folderFid}`
      : `https://www.bilibili.com/medialist/play/ml${folderId}`;

    return {
      success: true,
      playlistId: String(folderId),
      playlistUrl: playlistUrl,
      addedCount: addedSuccessCount,
      categoryName: categoryName,
      platform: 'bilibili'
    };
  } catch (err) {
    return { success: false, error: err.message || 'B 站收藏夾建立過程發生異常' };
  }
}
