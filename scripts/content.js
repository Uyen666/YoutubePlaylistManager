/**
 * YouTube 播放清單 AI 分類器 - Content Script (scripts/content.js)
 * 負責在 YouTube 頁面中自動滾動並精準擷取播放清單中的影片資訊
 */

(() => {
  // 防止重複注入
  if (window.__YT_PLAYLIST_SCRAPER_INJECTED__) {
    return;
  }
  window.__YT_PLAYLIST_SCRAPER_INJECTED__ = true;

  console.log('[YT-AI-Classifier] Content script loaded successfully.');

  /**
   * 檢查當前頁面是否為 YouTube 播放清單頁面或包含播放清單的播放頁面
   */
  function isPlaylistPage() {
    const url = window.location.href;
    const hasPlaylistUrl = url.includes('/playlist?list=') || url.includes('&list=') || url.includes('?list=');
    const hasPlaylistDom = !!(
      document.querySelector('ytd-playlist-video-renderer') ||
      document.querySelector('ytd-playlist-panel-video-renderer') ||
      document.querySelector('ytd-playlist-video-list-renderer')
    );
    return hasPlaylistUrl || hasPlaylistDom;
  }

  /**
   * 從 DOM 節點中提取單部影片資料
   * @param {Element} element - ytd-playlist-video-renderer 或 ytd-playlist-panel-video-renderer
   * @returns {Object|null} 影片資訊物件
   */
  /**
   * 從 DOM 節點中提取單部影片資料
   * @param {Element} element - 支援各版本 YouTube 播放清單與影片節點
   * @returns {Object|null} 影片資訊物件
   */
  function extractVideoData(element) {
    try {
      // 1. 尋找標題元素 (相容新舊 YouTube 佈局)
      const titleEl = element.querySelector('a#video-title') ||
                      element.querySelector('#video-title') ||
                      element.querySelector('span#video-title') ||
                      element.querySelector('.yt-lockup-metadata-view-model-wiz__title') ||
                      element.querySelector('h3 a') ||
                      element.querySelector('h3.title-and-badge') ||
                      element.querySelector('a[aria-label][href*="/watch"]');

      if (!titleEl) return null;

      const rawTitle = (titleEl.textContent || titleEl.getAttribute('title') || titleEl.getAttribute('aria-label') || '').trim();
      if (!rawTitle) return null;

      // 過濾已被刪除或設為私人的影片
      const lowerTitle = rawTitle.toLowerCase();
      if (
        lowerTitle === '[deleted video]' ||
        lowerTitle === '[private video]' ||
        rawTitle === '[已刪除的影片]' ||
        rawTitle === '[私人影片]' ||
        rawTitle === '[Deleted video]' ||
        rawTitle === '[Private video]'
      ) {
        return null;
      }

      // 2. 擷取影片連結與 VideoId
      let href = titleEl.getAttribute('href') || '';
      if (!href) {
        const anyLink = element.querySelector('a[href*="/watch?v="]') ||
                        element.querySelector('a#thumbnail') ||
                        element.querySelector('a[href*="/shorts/"]') ||
                        element.querySelector('a[href*="/watch"]');
        if (anyLink) href = anyLink.getAttribute('href') || '';
      }

      let videoId = '';
      if (href) {
        const urlParams = new URLSearchParams(href.includes('?') ? href.split('?')[1] : href);
        videoId = urlParams.get('v') || '';
        if (!videoId) {
          const match = href.match(/(?:\/watch\?v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (match) videoId = match[1];
        }
      }

      // 若拿不到 videoId，以標題的雜湊作為備用唯一鍵
      if (!videoId) {
        videoId = `custom_${Math.abs(hashString(rawTitle))}`;
      }

      // 3. 擷取頻道名稱
      let channelTitle = '未知頻道';
      const channelEl = element.querySelector('ytd-channel-name a') ||
                        element.querySelector('#channel-name a') ||
                        element.querySelector('#byline-container a') ||
                        element.querySelector('#byline a') ||
                        element.querySelector('.ytd-channel-name') ||
                        element.querySelector('.yt-lockup-metadata-view-model-wiz__metadata') ||
                        element.querySelector('#text.ytd-channel-name') ||
                        element.querySelector('#channel-name');
      if (channelEl) {
        const channelText = (channelEl.textContent || '').trim();
        if (channelText) channelTitle = channelText;
      }

      // 4. 擷取片長 (Duration)
      let duration = '';
      const durationEl = element.querySelector('ytd-thumbnail-overlay-time-status-renderer #text') ||
                         element.querySelector('span.ytd-thumbnail-overlay-time-status-renderer') ||
                         element.querySelector('span.badge-shape-wiz__text') ||
                         element.querySelector('.badge-shape-wiz__text') ||
                         element.querySelector('#time-status #text');
      if (durationEl) {
        duration = (durationEl.textContent || '').trim();
      }

      // 5. 組合標準物件
      return {
        videoId,
        title: rawTitle,
        channelTitle,
        duration: duration || 'N/A',
        url: videoId.startsWith('custom_') ? window.location.href : `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: videoId.startsWith('custom_') ? '' : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      };
    } catch (err) {
      console.warn('[YT-AI-Classifier] Error extracting video element:', err);
      return null;
    }
  }

  /**
   * 簡單字串雜湊工具 (Fallback 識別碼)
   */
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  /**
   * 掃描當前 DOM 中的所有影片 (相容公開、不公開、分享清單與最新版 YouTube 結構)
   * @param {Map<string, Object>} videoMap - 已存在的影片 Map
   * @returns {number} 本次新加入的影片數量
   */
  function scrapeVisibleVideos(videoMap) {
    let newlyAdded = 0;
    const selectors = [
      'ytd-playlist-video-renderer',
      'ytd-playlist-panel-video-renderer',
      'ytd-item-section-renderer ytd-playlist-video-renderer',
      'ytd-rich-item-renderer ytd-video-renderer',
      'ytd-video-renderer',
      'ytd-grid-video-renderer',
      'yt-lockup-view-model',
      '#contents > ytd-playlist-video-renderer',
      '#contents > ytd-rich-item-renderer',
      'ytd-playlist-video-list-renderer ytd-playlist-video-renderer'
    ];

    const elements = document.querySelectorAll(selectors.join(', '));

    elements.forEach((el) => {
      const data = extractVideoData(el);
      if (data && data.videoId && !videoMap.has(data.videoId)) {
        videoMap.set(data.videoId, data);
        newlyAdded++;
      }
    });

    return newlyAdded;
  }

  /**
   * 平滑向下滾動並自動擷取清單
   * @param {number} maxItems - 欲擷取的最大影片數量 (0 或負數表示全部)
   * @param {function} onProgress - 進度回呼函式
   * @returns {Promise<Array<Object>>}
   */
  async function autoScrollAndScrape(maxItems = 0, onProgress = null) {
    const videoMap = new Map();
    const targetMax = maxItems > 0 ? maxItems : Infinity;

    // 先做一次初始掃描
    scrapeVisibleVideos(videoMap);
    if (onProgress) {
      onProgress(videoMap.size, targetMax);
    }

    // 若已經達到設定上限，直接返回
    if (videoMap.size >= targetMax) {
      return Array.from(videoMap.values()).slice(0, targetMax);
    }

    let noChangeCount = 0;
    const maxNoChangeTries = 4; // 連續 4 次沒抓到新內容視為載入到底部
    let lastHeight = 0;

    // 尋找滾動容器 (YouTube 播放清單可能是 window 或特定容器如 #contents / #items)
    const playlistPanel = document.querySelector('ytd-playlist-panel-renderer #items') ||
                          document.querySelector('#items.ytd-playlist-panel-renderer');

    const scrollContainer = playlistPanel || null;

    console.log('[YT-AI-Classifier] Starting auto-scroll scraping. Target:', targetMax);
    const scrapeStartTime = Date.now();
    const maxScrapeDurationMs = 15000; // 最多滾動 15 秒，避免背景分頁無限期卡住

    while (videoMap.size < targetMax && noChangeCount < maxNoChangeTries) {
      if (Date.now() - scrapeStartTime > maxScrapeDurationMs) {
        console.warn('[YT-AI-Classifier] Scraping reached max duration (15s). Proceeding with collected videos.');
        break;
      }

      // 執行滾動
      if (scrollContainer) {
        scrollContainer.scrollTop += 1200;
      } else {
        window.scrollBy({ top: 1200, behavior: 'smooth' });
        // 同步直接滾到底
        window.scrollTo(0, document.documentElement.scrollHeight);
      }

      // 等待 DOM 渲染與 YouTube API 非同步請求
      await new Promise((resolve) => setTimeout(resolve, 800));

      const added = scrapeVisibleVideos(videoMap);

      if (onProgress) {
        onProgress(Math.min(videoMap.size, targetMax), targetMax);
      }

      const currentHeight = scrollContainer
        ? scrollContainer.scrollHeight
        : document.documentElement.scrollHeight;

      if (added === 0 && currentHeight === lastHeight) {
        noChangeCount++;
      } else {
        noChangeCount = 0;
      }

      lastHeight = currentHeight;

      // 檢查是否還有加載指示器
      const hasSpinner = !!document.querySelector('ytd-continuation-item-renderer');
      if (!hasSpinner && added === 0 && noChangeCount >= 2) {
        // 沒有 Spinner 且滾動無新內容，已到達清單尾端
        break;
      }
    }

    console.log(`[YT-AI-Classifier] Scraping finished. Total collected: ${videoMap.size} videos.`);
    return Array.from(videoMap.values()).slice(0, targetMax);
  }

  // ==========================================
  // Step 2 DOM 自動化：建立播放清單與批次加入影片 (含 3 大安全防護機制)
  // ==========================================

  /**
   * 安全防護 1: 擬人化隨機非同步延遲 (Randomized Delay)
   * 避免規律時間間隔被 YouTube 行為特徵偵測系統識別
   */
  function randomDelay(minMs = 800, maxMs = 1500) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 安全防護 3: 錯誤與驗證碼立即中斷機制 (Fail-Fast Interceptor)
   * 偵測 429 Too Many Requests、Google CAPTCHA 或異常提示，立即中斷防止帳號風險
   */
  function detectYouTubeRateLimitOrCaptcha() {
    // A. 偵測 Google / reCAPTCHA 驗證碼彈窗或 iframe
    const captchaEl = document.querySelector('iframe[src*="recaptcha"], iframe[src*="captcha"], #captcha-container, .g-recaptcha, #recaptcha');
    if (captchaEl && captchaEl.offsetParent !== null) {
      return '⚠️ 偵測到 YouTube 驗證碼 (CAPTCHA) 彈窗，已緊急中斷自動化，請手動完成驗證！';
    }

    // B. 偵測 YouTube 限制提示 Toast 或通知列
    const toasts = document.querySelectorAll('tp-yt-paper-toast, ytd-notification-action-renderer, yt-notification-action-renderer, #notification');
    for (const toast of toasts) {
      const text = (toast.textContent || '').trim();
      if (
        text.includes('操作過於頻繁') ||
        text.includes('請稍後再試') ||
        text.includes('Too many requests') ||
        text.includes('Try again later') ||
        text.includes('無法將影片加入') ||
        text.includes('The action cannot be performed') ||
        text.includes('429')
      ) {
        return `⚠️ YouTube 提示頻率過高或受限：「${text}」，已安全中斷自動化！`;
      }
    }

    // C. 偵測異常流量阻擋頁面
    if (document.title.includes('Robot') || document.body.innerText.includes('Our systems have detected unusual traffic')) {
      return '⚠️ 偵測到 YouTube 異常流量偵測警告，已立即安全中斷！';
    }

    return null;
  }

  /**
   * 模擬原生滑鼠點擊事件 (支援 Web Components 與 Shadow DOM 穿透)
   */
  function simulateClick(element) {
    if (!element) return false;
    element.focus?.();
    const eventOpts = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    element.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    element.dispatchEvent(new MouseEvent('click', eventOpts));
    if (typeof element.click === 'function') {
      element.click();
    }
    return true;
  }

  /**
   * 非同步等待元素出現 (帶 Timeout 容錯)
   */
  async function waitForElement(selectorFn, timeoutMs = 4000, intervalMs = 200) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const el = selectorFn();
      if (el) return el;
      await sleep(intervalMs);
    }
    return null;
  }

  /**
   * 關閉目前開啟的 YouTube 彈窗或對話框
   */
  async function closeOpenDialogs() {
    const closeBtn = document.querySelector('ytd-add-to-playlist-renderer #close-button button') ||
                     document.querySelector('ytd-add-to-playlist-renderer button[aria-label*="關閉"]') ||
                     document.querySelector('ytd-add-to-playlist-renderer button[aria-label*="Close"]') ||
                     document.querySelector('tp-yt-paper-dialog button#button');
    if (closeBtn) {
      simulateClick(closeBtn);
      await randomDelay(400, 600);
      return;
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await randomDelay(400, 600);
  }

  /**
   * 在頁面中尋找指定 videoId 的影片 DOM 節點
   */
  async function findVideoElement(videoId, title) {
    const selectors = [
      'ytd-playlist-video-renderer',
      'ytd-playlist-panel-video-renderer',
      'ytd-item-section-renderer ytd-playlist-video-renderer',
      '#contents > ytd-playlist-video-renderer'
    ];

    let foundEl = null;
    const elements = document.querySelectorAll(selectors.join(', '));

    for (const el of elements) {
      const link = el.querySelector('a#video-title') || el.querySelector('a#thumbnail') || el.querySelector('a[href*="/watch"]');
      const href = link ? link.getAttribute('href') : '';
      if (videoId && href && href.includes(videoId)) {
        foundEl = el;
        break;
      }
      const titleEl = el.querySelector('#video-title');
      const currentTitle = titleEl ? (titleEl.textContent || '').trim() : '';
      if (title && currentTitle && currentTitle === title.trim()) {
        foundEl = el;
        break;
      }
    }

    // 若當前 DOM 沒找到，嘗試滾動頁面加載
    if (!foundEl) {
      window.scrollBy({ top: 1200, behavior: 'smooth' });
      await randomDelay(800, 1200);
      const retryElements = document.querySelectorAll(selectors.join(', '));
      for (const el of retryElements) {
        const link = el.querySelector('a#video-title') || el.querySelector('a#thumbnail') || el.querySelector('a[href*="/watch"]');
        const href = link ? link.getAttribute('href') : '';
        if (videoId && href && href.includes(videoId)) {
          foundEl = el;
          break;
        }
      }
    }

    return foundEl;
  }

  /**
   * 自動建立 YouTube 播放清單並批次加入分類影片 (嚴密落實 3 大安全防護)
   */
  async function createCategoryPlaylist(categoryName, privacy = 'PRIVATE', videos = [], onProgress = null) {
    if (!videos || videos.length === 0) {
      throw new Error('分類中無影片可加入');
    }

    console.log(`[YT-AI-Classifier:DOM-Automation] Starting creation for "${categoryName}" (${videos.length} videos). Privacy: ${privacy}`);

    let addedCount = 0;
    let failedCount = 0;
    let playlistCreated = false;

    // 安全防護 2: 批次處理冷卻間隔 (每 25 部影片暫停 3~5 秒)
    const BATCH_SIZE = 25;

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];

      // 檢查安全防護 3: 驗證碼或 429 頻率偵測
      const securityIssue = detectYouTubeRateLimitOrCaptcha();
      if (securityIssue) {
        await closeOpenDialogs();
        throw new Error(securityIssue);
      }

      // 檢查安全防護 2: 批次冷卻
      if (i > 0 && i % BATCH_SIZE === 0) {
        const batchCoolDown = Math.floor(Math.random() * 2000) + 3000; // 3000ms ~ 5000ms
        console.log(`[YT-AI-Classifier:Security] Batch limit reached (${i} items). Cooling down for ${batchCoolDown}ms...`);
        if (onProgress) {
          onProgress(i, videos.length, `⏸️ 防護冷卻中 (暫停 ${(batchCoolDown / 1000).toFixed(1)} 秒，避免 YouTube 頻率限制)...`);
        }
        await sleep(batchCoolDown);
      }

      if (onProgress) {
        onProgress(i + 1, videos.length, video.title);
      }

      try {
        await closeOpenDialogs();

        // 1. 尋找影片 DOM 節點
        const videoEl = await findVideoElement(video.videoId, video.title);
        if (!videoEl) {
          console.warn(`[YT-AI-Classifier:DOM-Automation] Video not found in DOM: ${video.title}`);
          failedCount++;
          continue;
        }

        // 2. 平滑滾動至可視區域 (安全防護 1: 擬人化隨機延遲 800~1500ms)
        videoEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await randomDelay(800, 1200);

        // 再次檢查是否有驗證碼彈出
        const check1 = detectYouTubeRateLimitOrCaptcha();
        if (check1) {
          await closeOpenDialogs();
          throw new Error(check1);
        }

        // 3. 點擊影片右側三點選單按鈕
        const menuBtn = videoEl.querySelector('button.yt-icon-button#button') ||
                        videoEl.querySelector('ytd-menu-renderer yt-icon-button#button') ||
                        videoEl.querySelector('yt-icon-button.dropdown-trigger') ||
                        videoEl.querySelector('button[aria-label*="Action"]') ||
                        videoEl.querySelector('button[aria-label*="操作"]') ||
                        videoEl.querySelector('ytd-menu-renderer button');

        if (!menuBtn) {
          console.warn(`[YT-AI-Classifier:DOM-Automation] Menu button not found for: ${video.title}`);
          failedCount++;
          continue;
        }

        simulateClick(menuBtn);
        await randomDelay(800, 1300);

        // 4. 在彈出選單中精準尋找「儲存至播放清單」(嚴格排除「稍後觀看」)
        const saveItem = await waitForElement(() => {
          const items = document.querySelectorAll('ytd-menu-service-item-renderer, ytd-menu-popup-renderer tp-yt-paper-item, ytd-menu-navigation-item-renderer, tp-yt-paper-listbox ytd-menu-service-item-renderer');
          
          for (const item of items) {
            const text = (item.textContent || '').trim();
            
            // 🚨 嚴格排除「稍後觀看」、「加入待播清單」等非目標選單項目！
            if (
              text.includes('稍後觀看') ||
              text.includes('稍后观看') ||
              text.includes('Watch later') ||
              text.includes('Watch Later') ||
              text.includes('後で見る') ||
              text.includes('待播清單') ||
              text.includes('Queue') ||
              text.includes('queue') ||
              text.includes('キュー')
            ) {
              continue;
            }

            // 必須吻合「儲存至播放清單」關鍵字
            if (
              text.includes('儲存至播放清單') ||
              text.includes('儲存到播放清單') ||
              text.includes('儲存至') ||
              text.includes('Save to playlist') ||
              text.includes('Save to...') ||
              text.includes('プレイリストに保存') ||
              text.includes('保存到播放列表') ||
              (text.includes('播放清單') && text.includes('儲存')) ||
              (text.includes('playlist') && text.includes('Save'))
            ) {
              return item;
            }
          }

          // 次要備援：透過圖示判斷 (playlist_add)
          for (const item of items) {
            const text = (item.textContent || '').trim();
            if (text.includes('稍後觀看') || text.includes('Watch later')) continue;
            const svg = item.querySelector('svg, yt-icon');
            if (svg && (svg.innerHTML.includes('M22 13h-4v4h-2v-4') || svg.innerHTML.includes('playlist'))) {
              return item;
            }
          }

          return null;
        }, 3500);

        if (!saveItem) {
          console.warn(`[YT-AI-Classifier:DOM-Automation] "Save to playlist" menu option not found (excluded Watch Later).`);
          await closeOpenDialogs();
          failedCount++;
          continue;
        }

        console.log(`[YT-AI-Classifier:DOM-Automation] Clicking "Save to playlist" menu item: "${saveItem.textContent.trim()}"`);
        simulateClick(saveItem);
        await randomDelay(900, 1400);

        // 5. 等待「儲存至播放清單」對話框彈出
        const dialog = await waitForElement(() => {
          return document.querySelector('ytd-add-to-playlist-renderer, tp-yt-paper-dialog:not([aria-hidden="true"])');
        }, 4000);

        if (!dialog) {
          console.warn(`[YT-AI-Classifier:DOM-Automation] Playlist dialog did not open.`);
          await closeOpenDialogs();
          failedCount++;
          continue;
        }

        // ----------------------------------------------------
        // 分支 A: 第一部影片 -> 建立新播放清單
        // ----------------------------------------------------
        if (!playlistCreated) {
          const existingOption = findPlaylistOptionInDialog(dialog, categoryName);

          if (existingOption) {
            console.log(`[YT-AI-Classifier:DOM-Automation] Found existing playlist "${categoryName}", checking it.`);
            await togglePlaylistCheckbox(existingOption, true);
            playlistCreated = true;
          } else {
            console.log(`[YT-AI-Classifier:DOM-Automation] Creating new playlist with category name: "${categoryName}"...`);

            // 尋找「建立新的播放清單」按鈕 (支援多種 YouTube 結構)
            const createNewBtn = dialog.querySelector('ytd-add-to-playlist-create-renderer button') ||
                                 dialog.querySelector('ytd-compact-link-renderer button') ||
                                 dialog.querySelector('#actions ytd-button-renderer button') ||
                                 dialog.querySelector('button[aria-label*="建立新"]') ||
                                 dialog.querySelector('button[aria-label*="Create new"]') ||
                                 findButtonByText(dialog, ['建立新的播放清單', '建立新播放清單', '新增播放清單', 'Create new playlist', 'New playlist', '新しいプレイリストを作成', '创建新播放列表']);

            if (createNewBtn) {
              simulateClick(createNewBtn);
              await randomDelay(800, 1200);

              // 填寫清單標題
              const nameInput = dialog.querySelector('ytd-add-to-playlist-create-renderer input#input-1') ||
                                dialog.querySelector('tp-yt-paper-input input') ||
                                dialog.querySelector('input[aria-label*="標題"]') ||
                                dialog.querySelector('input[aria-label*="Title"]') ||
                                dialog.querySelector('input[aria-label*="名稱"]') ||
                                dialog.querySelector('input[aria-label*="Name"]') ||
                                dialog.querySelector('input[type="text"]') ||
                                dialog.querySelector('textarea');

              if (nameInput) {
                nameInput.focus();
                nameInput.value = categoryName;
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                await randomDelay(600, 900);

                // 設定隱私度 (若可選)
                const privacyDropdown = dialog.querySelector('tp-yt-paper-dropdown-menu, #privacy-picker, ytd-privacy-dropdown-item-renderer, tp-yt-paper-input-container');
                if (privacyDropdown && privacy !== 'PUBLIC') {
                  simulateClick(privacyDropdown);
                  await randomDelay(500, 800);
                  const privacyOption = document.querySelector(`tp-yt-paper-item[value="${privacy}"], tp-yt-paper-listbox tp-yt-paper-item`);
                  if (privacyOption) simulateClick(privacyOption);
                  await randomDelay(400, 600);
                }

                // 點擊「建立」確認按鈕
                const confirmCreateBtn = dialog.querySelector('ytd-add-to-playlist-create-renderer #create-button button') ||
                                         dialog.querySelector('ytd-button-renderer#create-button button') ||
                                         dialog.querySelector('tp-yt-paper-button#button') ||
                                         findButtonByText(dialog, ['建立', 'Create', '作成', '创建']);

                if (confirmCreateBtn) {
                  simulateClick(confirmCreateBtn);
                  await randomDelay(1400, 2000);
                  playlistCreated = true;
                  console.log(`[YT-AI-Classifier:DOM-Automation] Playlist "${categoryName}" created successfully!`);
                }
              }
            } else {
              console.warn(`[YT-AI-Classifier:DOM-Automation] "Create new playlist" button not found in dialog.`);
            }
          }
        } else {
          // ----------------------------------------------------
          // 分支 B: 後續影片 -> 勾選現有分類清單
          // ----------------------------------------------------
          await randomDelay(600, 900);
          const targetOption = findPlaylistOptionInDialog(dialog, categoryName);

          if (targetOption) {
            await togglePlaylistCheckbox(targetOption, true);
          } else {
            console.warn(`[YT-AI-Classifier:DOM-Automation] Playlist option "${categoryName}" not found in list dialog.`);
          }
        }

        addedCount++;
        await closeOpenDialogs();
        // 安全防護 1: 每次加入完成後隨機等待 800ms ~ 1500ms
        await randomDelay(800, 1500);

      } catch (videoErr) {
        console.error(`[YT-AI-Classifier:DOM-Automation] Error processing video ${video.title}:`, videoErr);
        await closeOpenDialogs();
        failedCount++;

        // 如果是安全防護錯誤，立即向外拋出中斷整個流程
        if (videoErr.message && (videoErr.message.includes('CAPTCHA') || videoErr.message.includes('頻率') || videoErr.message.includes('受限') || videoErr.message.includes('異常'))) {
          throw videoErr;
        }
      }
    }

    return {
      success: addedCount > 0,
      addedCount,
      failedCount,
      categoryName
    };
  }

  function findPlaylistOptionInDialog(dialog, name) {
    const options = dialog.querySelectorAll('ytd-playlist-add-to-option-renderer, tp-yt-paper-checkbox');
    for (const opt of options) {
      const text = (opt.textContent || '').trim();
      if (text.includes(name)) {
        return opt;
      }
    }
    return null;
  }

  async function togglePlaylistCheckbox(optionEl, shouldCheck = true) {
    const checkbox = optionEl.querySelector('#checkbox') ||
                     optionEl.querySelector('tp-yt-paper-checkbox') ||
                     optionEl;

    const isChecked = checkbox.getAttribute('aria-checked') === 'true' || checkbox.checked === true;

    if (shouldCheck && !isChecked) {
      simulateClick(checkbox);
      await sleep(500);
    }
  }

  function findButtonByText(parent, textList) {
    const buttons = parent.querySelectorAll('button, tp-yt-paper-button, [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
      for (const t of textList) {
        if (text.includes(t)) return btn;
      }
    }
    return null;
  }

  // ==========================================
  // 訊息通訊監聽器 (接收來自 Popup 的指令)
  // ==========================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 檢查頁面狀態
    if (request.action === 'CHECK_PAGE') {
      sendResponse({
        success: true,
        isPlaylist: isPlaylistPage(),
        url: window.location.href,
        title: document.title
      });
      return true;
    }

    // 執行播放清單爬蟲
    if (request.action === 'SCRAPE_PLAYLIST') {
      const maxItems = Number(request.maxItems) || 0;

      autoScrollAndScrape(maxItems, (currentCount, target) => {
        try {
          chrome.runtime.sendMessage({
            action: 'SCRAPE_PROGRESS',
            currentCount,
            target
          }).catch(() => {});
        } catch (_) {}
      })
        .then((videos) => {
          if (!videos || videos.length === 0) {
            sendResponse({
              success: false,
              error: '未能從當前頁面擷取到任何影片，請確認是否為 YouTube 播放清單網頁。'
            });
          } else {
            sendResponse({
              success: true,
              count: videos.length,
              videos
            });
          }
        })
        .catch((err) => {
          console.error('[YT-AI-Classifier] Scraping error:', err);
          sendResponse({
            success: false,
            error: err.message || '擷取播放清單過程發生錯誤'
          });
        });

      return true;
    }

    // Step 2: 自動在 YouTube 建立分類播放清單並批次加入影片
    if (request.action === 'CREATE_CATEGORY_PLAYLIST') {
      const { categoryName, privacy, videos } = request;

      createCategoryPlaylist(categoryName, privacy, videos, (current, total, currentTitle) => {
        try {
          chrome.runtime.sendMessage({
            action: 'CREATE_PLAYLIST_PROGRESS',
            categoryName,
            current,
            total,
            currentTitle
          }).catch(() => {});
        } catch (_) {}
      })
        .then((result) => {
          sendResponse(result);
        })
        .catch((err) => {
          console.error('[YT-AI-Classifier] Create playlist error:', err);
          sendResponse({
            success: false,
            error: err.message || '建立播放清單失敗'
          });
        });

      return true;
    }
  });
})();

