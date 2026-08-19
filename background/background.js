/**
 * YouTube 播放清單 AI 分類器 - Background Service Worker (background/background.js)
 * 核心責任：
 * 1. 生命週期管理與預設值初始化
 * 2. 獨立背景任務執行引擎 (即使 Popup 關閉依然能持續爬蟲與呼叫 LLM)
 * 3. 狀態持久化 (chrome.storage.local)，杜絕重複呼叫與 Token 浪費
 */

// ==========================================
// 初始化擴充功能預設設定
// ==========================================
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[YT-AI-Classifier:Background] Extension installed/updated. Reason:', details.reason);

  chrome.storage.local.get(['provider', 'categories', 'maxItems', 'currentTask'], (result) => {
    const defaultSettings = {};

    if (!result.provider || result.provider === 'gemini-2.0-flash') {
      defaultSettings.provider = 'gemini-3.6-flash';
    }

    if (!result.categories) {
      defaultSettings.categories = '程式開發, 投資理財, 流行音樂, 遊戲動漫, 生活雜談, 其他';
    }

    if (!result.maxItems) {
      defaultSettings.maxItems = '100';
    }

    if (!result.privacy) {
      defaultSettings.privacy = 'PRIVATE';
    }

    // 初始化任務狀態為 idle
    if (!result.currentTask) {
      defaultSettings.currentTask = {
        status: 'idle', // 'idle' | 'scraping' | 'classifying' | 'completed' | 'error'
        progressPercent: 0,
        statusTitle: '',
        statusDetail: '',
        playlistUrl: '',
        playlistTitle: '',
        totalVideos: 0,
        categorizedResults: {},
        updatedAt: Date.now()
      };
    }

    if (Object.keys(defaultSettings).length > 0) {
      chrome.storage.local.set(defaultSettings, () => {
        console.log('[YT-AI-Classifier:Background] Default settings & state initialized:', defaultSettings);
      });
    }
  });
});

// ==========================================
// 背景訊息通訊監聽器
// ==========================================
let isTaskRunning = false;
let currentCancelToken = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_ANALYSIS') {
    handleStartAnalysis(request)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // 保持非同步通道開啟
  }

  if (request.action === 'CANCEL_ANALYSIS') {
    currentCancelToken = true;
    isTaskRunning = false;
    updateTaskState({
      status: 'idle',
      statusTitle: '任務已取消',
      statusDetail: '已手動取消分析流程',
      progressPercent: 0
    });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'CLEAR_TASK_RESULTS') {
    updateTaskState({
      status: 'idle',
      statusTitle: '',
      statusDetail: '',
      progressPercent: 0,
      categorizedResults: {},
      totalVideos: 0
    });
    sendResponse({ success: true });
    return true;
  }

  // 監聽來自 content script 的即時滾動進度
  if (request.action === 'SCRAPE_PROGRESS' && isTaskRunning) {
    const current = request.currentCount || 0;
    const target = request.target || 0;
    const targetText = target === Infinity ? '全部' : target;
    const percent = Math.min(40, Math.round((current / (target === Infinity ? current + 20 : target)) * 40));
    updateTaskState({
      status: 'scraping',
      progressPercent: percent,
      statusTitle: '步驟 1/2: 正在滾動網頁擷取影片...',
      statusDetail: `已發現 ${current} 部影片 (目標: ${targetText})`
    });
  }
});

/**
 * 輔助更新 chrome.storage.local 中的 currentTask 狀態
 */
async function updateTaskState(partialState) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['currentTask'], (result) => {
      const currentTask = result.currentTask || {};
      const updated = {
        ...currentTask,
        ...partialState,
        updatedAt: Date.now()
      };
      chrome.storage.local.set({ currentTask: updated }, () => {
        resolve(updated);
      });
    });
  });
}

/**
 * 背景核心流程：擷取 DOM ➔ 批次 LLM 智慧分類 ➔ 持久化儲存
 */
async function handleStartAnalysis(params) {
  const { tabId, playlistUrl, playlistTitle, maxItems, categories, provider, customModel, apiKey } = params;

  // 1. 防重入鎖定：若已經在執行中，直接拒絕再次觸發以節省 Token
  if (isTaskRunning) {
    console.warn('[YT-AI-Classifier:Background] Task already running, ignoring duplicate request.');
    return { success: false, message: '已有任務在進行中，請等待完成' };
  }

  isTaskRunning = true;
  currentCancelToken = false;

  const effectiveModel = provider === 'custom' ? (customModel || 'gemini-3.6-flash') : provider;

  await updateTaskState({
    status: 'scraping',
    playlistUrl,
    playlistTitle,
    progressPercent: 5,
    statusTitle: '步驟 1/2: 正在擷取播放清單...',
    statusDetail: '啟動自動滾動爬蟲...',
    categorizedResults: {},
    totalVideos: 0,
    model: effectiveModel,
    error: null
  });

  try {
    // ----------------------------------------------------
    // 階段 1: 呼叫 Content Script 執行自動滾動擷取
    // ----------------------------------------------------
    console.log(`[YT-AI-Classifier:Background] Scraping tabId=${tabId}, maxItems=${maxItems}`);
    const scrapeRes = await chrome.tabs.sendMessage(tabId, {
      action: 'SCRAPE_PLAYLIST',
      maxItems: Number(maxItems) || 0
    });

    if (currentCancelToken) throw new Error('任務已被使用者取消');

    if (!scrapeRes || !scrapeRes.success || !scrapeRes.videos || scrapeRes.videos.length === 0) {
      throw new Error(scrapeRes?.error || '未能擷取到任何影片，請確認播放清單是否有內容');
    }

    const scrapedVideos = scrapeRes.videos;
    console.log(`[YT-AI-Classifier:Background] Scraped ${scrapedVideos.length} videos.`);

    await updateTaskState({
      status: 'classifying',
      progressPercent: 40,
      totalVideos: scrapedVideos.length,
      statusTitle: '步驟 1/2: 網頁擷取完成！',
      statusDetail: `共擷取 ${scrapedVideos.length} 部影片，準備進行 AI 分類...`
    });

    // ----------------------------------------------------
    // 階段 2: 批次呼叫 LLM 進行智慧分類
    // ----------------------------------------------------
    const categorizedVideos = await classifyVideosWithLLM(
      scrapedVideos,
      categories,
      effectiveModel,
      apiKey,
      async (batchIndex, totalBatches, percent) => {
        if (currentCancelToken) return;
        const currentPercent = 40 + Math.round(percent * 0.55);
        await updateTaskState({
          status: 'classifying',
          progressPercent: currentPercent,
          statusTitle: `步驟 2/2: AI 分類中 (批次 ${batchIndex}/${totalBatches})...`,
          statusDetail: `正在使用 ${getProviderDisplayName(provider, customModel)} 分析影片內容...`
        });
      }
    );

    if (currentCancelToken) throw new Error('任務已被使用者取消');

    // ----------------------------------------------------
    // 階段 3: 整理分類並完成儲存
    // ----------------------------------------------------
    const categorizedResults = {};
    categories.forEach(cat => {
      categorizedResults[cat] = [];
    });

    categorizedVideos.forEach(v => {
      const cat = v.category || '其他';
      if (!categorizedResults[cat]) categorizedResults[cat] = [];
      categorizedResults[cat].push(v);
    });

    await updateTaskState({
      status: 'completed',
      progressPercent: 100,
      statusTitle: '分類完成！',
      statusDetail: `已成功分類 ${scrapedVideos.length} 部影片`,
      categorizedVideos,
      categorizedResults,
      totalVideos: scrapedVideos.length,
      model: effectiveModel,
      completedAt: Date.now()
    });

    console.log('[YT-AI-Classifier:Background] Classification completed and saved to storage.');
    return { success: true };

  } catch (err) {
    console.error('[YT-AI-Classifier:Background] Task Error:', err);
    await updateTaskState({
      status: 'error',
      statusTitle: '發生錯誤',
      statusDetail: err.message,
      error: err.message
    });
    return { success: false, error: err.message };
  } finally {
    isTaskRunning = false;
  }
}

// ==========================================
// LLM 分類引擎 (支援批次、指數退避與多層次容錯解析)
// ==========================================
async function classifyVideosWithLLM(videos, categories, model, apiKey, onBatchProgress) {
  const BATCH_SIZE = 25; // 每批 25 部影片
  const totalBatches = Math.ceil(videos.length / BATCH_SIZE);
  const results = [];

  for (let i = 0; i < totalBatches; i++) {
    if (currentCancelToken) throw new Error('任務已被使用者取消');

    const batchStart = i * BATCH_SIZE;
    const batchVideos = videos.slice(batchStart, batchStart + BATCH_SIZE);

    if (onBatchProgress) {
      await onBatchProgress(i + 1, totalBatches, (i / totalBatches) * 100);
    }

    const simplifiedList = batchVideos.map(v => ({
      id: v.videoId,
      title: v.title,
      channel: v.channelTitle
    }));

    const classifiedBatch = await classifySingleBatchWithRetry(
      simplifiedList,
      categories,
      model,
      apiKey
    );

    const classifiedMapById = new Map();
    const classifiedMapByTitle = new Map();

    if (Array.isArray(classifiedBatch)) {
      classifiedBatch.forEach((item) => {
        if (!item) return;
        const assignedCat = findBestMatchingCategory(item.category, categories);
        const keyId = item.id || item.videoId || item.video_id;
        if (keyId) {
          classifiedMapById.set(String(keyId).trim(), assignedCat);
        }
        if (item.title) {
          classifiedMapByTitle.set(item.title.trim().toLowerCase(), assignedCat);
        }
      });
    }

    batchVideos.forEach((v, index) => {
      let assignedCat = null;

      // 優先 1: Video ID 比對
      if (v.videoId && classifiedMapById.has(String(v.videoId).trim())) {
        assignedCat = classifiedMapById.get(String(v.videoId).trim());
      }

      // 優先 2: 標題完全/模糊比對
      if (!assignedCat && v.title && classifiedMapByTitle.has(v.title.trim().toLowerCase())) {
        assignedCat = classifiedMapByTitle.get(v.title.trim().toLowerCase());
      }

      // 優先 3: 依回傳陣列的順序 Index 映射 (防止 LLM 竄改 ID 或未回傳 ID)
      if (!assignedCat && Array.isArray(classifiedBatch) && classifiedBatch[index]) {
        const itemAtIdx = classifiedBatch[index];
        if (itemAtIdx && itemAtIdx.category) {
          assignedCat = findBestMatchingCategory(itemAtIdx.category, categories);
        }
      }

      // 最終備援：若真的無法比對才落入「其他」
      if (!assignedCat) {
        assignedCat = '其他';
      }

      results.push({
        ...v,
        category: assignedCat
      });
    });
  }

  if (onBatchProgress) {
    await onBatchProgress(totalBatches, totalBatches, 100);
  }

  return results;
}

/**
 * 具備指數退避重試的單一批次分類函式
 */
async function classifySingleBatchWithRetry(items, categories, model, apiKey, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (currentCancelToken) throw new Error('任務已被使用者取消');

    try {
      if (attempt > 0) {
        const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`[YT-AI-Classifier:Background] Retrying API request (Attempt ${attempt}/${maxRetries}) after ${Math.round(delayMs)}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }

      const isGemini = model.toLowerCase().includes('gemini');
      if (isGemini) {
        return await callGeminiAPI(items, categories, model, apiKey);
      } else {
        return await callOpenAIAPI(items, categories, model, apiKey);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[YT-AI-Classifier:Background] API Attempt ${attempt + 1} failed:`, err.message);
      // 如果是 API Key 錯誤 (401, 403)，不要重試，直接拋出
      if (err.message.includes('API_KEY_INVALID') || err.message.includes('401') || err.message.includes('403') || err.message.includes('quota') || err.message.includes('no longer available')) {
        throw err;
      }
    }
  }

  if (lastError) {
    throw new Error(`AI 分類失敗 (${lastError.message})，請檢查 API Key 或網路連線`);
  }

  return items.map(it => ({ id: it.id, category: '其他' }));
}

/**
 * 智慧分類比對函式 (支援模糊比對、容錯與大小寫忽略)
 */
function findBestMatchingCategory(rawCat, categories) {
  if (!rawCat || typeof rawCat !== 'string') return '其他';
  const cleanRaw = rawCat.trim().replace(/^[\d\.\-\s、：:•#*]+/g, '').trim();

  // 1. 完全比對
  if (categories.includes(cleanRaw)) return cleanRaw;

  // 2. 忽略大小寫比對
  const lowerRaw = cleanRaw.toLowerCase();
  for (const cat of categories) {
    if (cat.toLowerCase() === lowerRaw) return cat;
  }

  // 3. 包含比對
  for (const cat of categories) {
    if (cat === '其他') continue;
    const lowerCat = cat.toLowerCase();
    if (lowerRaw.includes(lowerCat) || lowerCat.includes(lowerRaw)) {
      return cat;
    }
  }

  // 4. 清除 emoji 與特殊符號後比對
  const strippedRaw = cleanRaw.replace(/[^\w\u4e00-\u9fa5]/g, '').toLowerCase();
  if (strippedRaw) {
    for (const cat of categories) {
      if (cat === '其他') continue;
      const strippedCat = cat.replace(/[^\w\u4e00-\u9fa5]/g, '').toLowerCase();
      if (strippedCat && (strippedRaw.includes(strippedCat) || strippedCat.includes(strippedRaw))) {
        return cat;
      }
    }
  }

  return '其他';
}

/**
 * 具備 15 秒超時自動中斷機制的 fetch 封裝 (避免 API 伺服器掛起無回應)
 */
async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`API 伺服器連線超時 (${timeoutMs / 1000} 秒未回應)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 呼叫 Google Gemini API (支援 Structured Output JSON Schema)
 */
async function callGeminiAPI(items, categories, model, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const promptText = `
你是一位精準的 YouTube 影片主題分類專家。
你的任務是仔細閱讀待分類清單中每部影片的「標題 (title)」與「頻道名稱 (channel)」，將每部影片【積極且精準】地歸類至以下指定分類標籤之一。

【指定可選分類標籤】：
${categories.map(c => `• ${c}`).join('\n')}

【分類重要指引】：
1. 積極語意關聯：請深入分析影片標題中的關鍵字、主題、技術詞彙、活動類型或頻道專長，並選取最相符的分類標籤。
2. 優先使用具體標籤：請盡最大努力歸入具體分類（例如：「程式開發」、「投資理財」、「流行音樂」等）。
3. 「其他」使用限制：只有在影片資訊極度匱乏、標題亂碼、或完全無法與任何具體分類產生關聯時，才可選擇「其他」。請避免隨意將影片歸入「其他」。
4. 必須嚴格使用【指定可選分類標籤】中完全一模一樣的字串名稱作為 category。

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
      responseSchema: {
        type: 'OBJECT',
        properties: {
          results: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                category: {
                  type: 'STRING',
                  enum: categories
                }
              },
              required: ['id', 'category']
            }
          }
        },
        required: ['results']
      },
      temperature: 0.1
    }
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  }, 15000);

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    const errorMsg = errorJson?.error?.message || `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`Gemini API 呼叫失敗: ${errorMsg}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini API 未回傳有效內容，可能受到安全原則限制');
  }

  return safeParseClassificationJSON(rawText);
}

/**
 * 呼叫 OpenAI API
 */
async function callOpenAIAPI(items, categories, model, apiKey) {
  const endpoint = 'https://api.openai.com/v1/chat/completions';

  const systemPrompt = `你是一位精準的 YouTube 影片主題分類專家。
你的任務是仔細閱讀待分類清單中每部影片的「標題 (title)」與「頻道名稱 (channel)」，將每部影片【積極且精準】地歸類至以下指定分類之一：${categories.join(', ')}。
【分類原則】：
1. 請積極分析影片語意與主題，優先歸入具體分類，切勿隨意使用「其他」。
2. 只有在標題完全無意義或與所有分類毫無關聯時才填入「其他」。
3. 必須回傳 JSON 物件，格式為: {"results": [{"id": "...", "category": "..."}]}`;

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

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  }, 15000);

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
 * 安全解析 LLM 回傳的 JSON (支援前後雜訊過濾與正則備援)
 */
function safeParseClassificationJSON(raw) {
  if (!raw || typeof raw !== 'string') return [];
  let clean = raw.trim();

  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const firstBrace = clean.indexOf('{');
  const firstBracket = clean.indexOf('[');
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    const lastBrace = clean.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.substring(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1) {
    const lastBracket = clean.lastIndexOf(']');
    if (lastBracket !== -1 && lastBracket > firstBracket) {
      clean = clean.substring(firstBracket, lastBracket + 1);
    }
  }

  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.results && Array.isArray(parsed.results)) return parsed.results;
    if (parsed.videos && Array.isArray(parsed.videos)) return parsed.videos;
    if (parsed.items && Array.isArray(parsed.items)) return parsed.items;
    if (parsed.data && Array.isArray(parsed.data)) return parsed.data;
    for (const key in parsed) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
    return [];
  } catch (err) {
    console.warn('[YT-AI-Classifier:Background] JSON parse error, trying regex:', err, clean);
    const matches = [];
    const regex = /\{[^{}]*"category"\s*:\s*"([^"]+)"[^{}]*\}/g;
    let match;
    while ((match = regex.exec(clean)) !== null) {
      try {
        const item = JSON.parse(match[0]);
        matches.push(item);
      } catch (_) {}
    }
    return matches;
  }
}

function getProviderDisplayName(provider, customModel) {
  if (provider === 'custom') return `自訂模型 (${customModel || '未填寫'})`;
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
