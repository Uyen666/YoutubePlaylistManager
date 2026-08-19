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

    // 核心：監聽 storage 變更以達成背景即時同步
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.currentTask) {
        handleTaskStateUpdate(changes.currentTask.newValue);
      }
    });
  }

  // ==========================================
  // 設定存取 (chrome.storage.local)
  // ==========================================
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['provider', 'customModel', 'apiKey', 'categories', 'maxItems'], (result) => {
        let provider = result.provider || 'gemini-3.6-flash';
        if (provider === 'gemini-2.0-flash') {
          provider = 'gemini-3.6-flash';
          chrome.storage.local.set({ provider: 'gemini-3.6-flash' });
        }

        providerSelect.value = provider;
        if (result.customModel) customModelInput.value = result.customModel;
        if (result.apiKey) apiKeyInput.value = result.apiKey;
        categoriesInput.value = result.categories || DEFAULT_CATEGORIES;
        if (result.maxItems) maxItemsSelect.value = result.maxItems;

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
    // 如果目前沒有正在進行的任務，啟用開始分析按鈕
    if (!currentCachedTask || (currentCachedTask.status !== 'scraping' && currentCachedTask.status !== 'classifying')) {
      startAnalyzeBtn.disabled = false;
    }
    currentPlaylistTitle.textContent = cleanTitle(title);
    currentPlaylistTitle.title = title;
  }

  function setNotPlaylistState(customMsg) {
    isTargetPlaylist = false;
    pageAlert.classList.remove('hidden');
    // 若沒有背景任務進行中，停用按鈕
    if (!currentCachedTask || (currentCachedTask.status !== 'scraping' && currentCachedTask.status !== 'classifying')) {
      startAnalyzeBtn.disabled = true;
    }
    currentPlaylistTitle.textContent = customMsg || '未偵測到 YouTube 播放清單';
  }

  function cleanTitle(title) {
    return title.replace(/ - YouTube$/, '').trim();
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
      progressBarFill.style.background = 'linear-gradient(90deg, var(--accent-indigo), var(--accent-purple), var(--accent-red))';

      statusTitle.textContent = task.statusTitle || '分析進行中...';
      statusDetailText.textContent = task.statusDetail || '正在處理...';
      const percent = Math.min(100, Math.max(0, task.progressPercent || 0));
      progressPercent.textContent = `${percent}%`;
      progressBarFill.style.width = `${percent}%`;

      startAnalyzeBtn.disabled = true;
      if (btnTextSpan) btnTextSpan.textContent = '⏳ AI 分析進行中 (背景運行)...';
    } else if (task.status === 'completed') {
      // 完成狀態：隱藏進度條、直接渲染結果、恢復按鈕
      progressSection.classList.add('hidden');
      renderResults(task.categorizedResults, task.totalVideos, task.model);
      resultsSection.classList.remove('hidden');

      if (isTargetPlaylist) {
        startAnalyzeBtn.disabled = false;
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
  function renderResults(categorizedResults, totalVideos, model) {
    if (!categorizedResults) return;

    const activeCategories = Object.keys(categorizedResults).filter(cat => categorizedResults[cat] && categorizedResults[cat].length > 0);
    
    // 計算總影片數
    let computedTotal = 0;
    for (const cat in categorizedResults) {
      computedTotal += (categorizedResults[cat] || []).length;
    }

    statTotalVideos.textContent = totalVideos || computedTotal;
    statCategoryCount.textContent = activeCategories.length;
    statModelUsed.textContent = getProviderShortName(model || providerSelect.value);

    // 清空並構建卡片 DOM
    categoriesList.innerHTML = '';

    // 依影片數量由多到少排序
    const sortedCategories = Object.keys(categorizedResults).sort((a, b) => {
      if (a === '其他') return 1;
      if (b === '其他') return -1;
      return (categorizedResults[b] || []).length - (categorizedResults[a] || []).length;
    });

    sortedCategories.forEach((catName, index) => {
      const catVideos = categorizedResults[catName] || [];
      if (catVideos.length === 0) return;

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
    const task = currentCachedTask;
    if (!task || !task.categorizedResults || Object.keys(task.categorizedResults).length === 0) {
      showToast('⚠️ 目前無分類資料可匯出');
      return;
    }

    const dateStr = new Date(task.completedAt || Date.now()).toLocaleString('zh-TW');
    const playlistName = currentPlaylistTitle.textContent;
    const providerName = getProviderDisplayName(providerSelect.value, customModelInput.value.trim());

    let md = `# 🎬 YouTube 播放清單分類報表：${playlistName}\n\n`;
    md += `- **總影片數**：${task.totalVideos || 0} 部\n`;
    md += `- **分析模型**：${providerName}\n`;
    md += `- **生成時間**：${dateStr}\n\n`;
    md += `---\n\n`;

    for (const [catName, vList] of Object.entries(task.categorizedResults)) {
      if (!vList || vList.length === 0) continue;
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
    const task = currentCachedTask;
    if (!task || !task.categorizedResults || Object.keys(task.categorizedResults).length === 0) {
      showToast('⚠️ 目前無分類資料可匯出');
      return;
    }

    const exportData = {
      playlistTitle: currentPlaylistTitle.textContent,
      exportedAt: new Date().toISOString(),
      model: task.model || providerSelect.value,
      totalVideos: task.totalVideos || 0,
      categories: task.categorizedResults
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    downloadFile(jsonStr, 'youtube_playlist_categorized.json', 'application/json');
    showToast('💾 已下載 JSON 檔案');
  }

  function exportAsCsv() {
    const task = currentCachedTask;
    if (!task || !task.categorizedResults || Object.keys(task.categorizedResults).length === 0) {
      showToast('⚠️ 目前無分類資料可匯出');
      return;
    }

    let csvContent = '\uFEFF'; // 加入 BOM 防止 Excel 亂碼
    csvContent += 'VideoId,Title,Channel,Duration,Category,URL\n';

    for (const [catName, vList] of Object.entries(task.categorizedResults)) {
      if (!vList) continue;
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
    if (target.toLowerCase().includes('gemini')) return 'Gemini';
    if (target.toLowerCase().includes('gpt') || target.toLowerCase().includes('openai')) return 'OpenAI';
    return target;
  }
});
