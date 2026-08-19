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
  function extractVideoData(element) {
    try {
      // 1. 尋找標題元素
      const titleEl = element.querySelector('a#video-title') ||
                      element.querySelector('#video-title') ||
                      element.querySelector('span#video-title') ||
                      element.querySelector('.yt-lockup-metadata-view-model-wiz__title');

      if (!titleEl) return null;

      const rawTitle = (titleEl.textContent || titleEl.getAttribute('title') || '').trim();
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
        const thumbLink = element.querySelector('a#thumbnail') || element.querySelector('a[href*="/watch"]');
        if (thumbLink) href = thumbLink.getAttribute('href') || '';
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
   * 掃描當前 DOM 中的所有影片
   * @param {Map<string, Object>} videoMap - 已存在的影片 Map
   * @returns {number} 本次新加入的影片數量
   */
  function scrapeVisibleVideos(videoMap) {
    let newlyAdded = 0;
    const selectors = [
      'ytd-playlist-video-renderer',
      'ytd-playlist-panel-video-renderer',
      'ytd-item-section-renderer ytd-playlist-video-renderer',
      '#contents > ytd-playlist-video-renderer'
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

    while (videoMap.size < targetMax && noChangeCount < maxNoChangeTries) {
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

  /**
   * 訊息通訊監聽器 (接收來自 Popup 的指令)
   */
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
        // 發送即時進度到 Popup (Popup 若關閉或沒監聽則忽略)
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

      // 保持非同步通道開啟
      return true;
    }
  });
})();
