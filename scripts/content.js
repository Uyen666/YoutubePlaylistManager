/**
 * YouTube & Bilibili 播放清單/收藏夾 AI 分類器 - Content Script (scripts/content.js)
 * 採用 Adapter Pattern 適配器架構，支援 YouTube 與 Bilibili 雙平台影片擷取與自動化
 */

(() => {
  // 防止重複注入
  if (window.__YT_BILIBILI_SCRAPER_INJECTED__) {
    return;
  }
  window.__YT_BILIBILI_SCRAPER_INJECTED__ = true;

  console.log('[YT-Bili-AI-Classifier] Content script initialized.');

  // ==========================================================================
  // 通用輔助工具函式
  // ==========================================================================
  function randomDelay(minMs = 800, maxMs = 1500) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  // ==========================================================================
  // 1. YouTube 適配器 (YouTubeAdapter)
  // ==========================================================================
  const YouTubeAdapter = {
    platform: 'youtube',

    isSupported() {
      const url = window.location.href;
      const hasPlaylistUrl = url.includes('/playlist?list=') || url.includes('&list=') || url.includes('?list=');
      const hasPlaylistDom = !!(
        document.querySelector('ytd-playlist-video-renderer') ||
        document.querySelector('ytd-playlist-panel-video-renderer') ||
        document.querySelector('ytd-playlist-video-list-renderer')
      );
      return hasPlaylistUrl || hasPlaylistDom;
    },

    getPlaylistTitle() {
      const headerTitle = document.querySelector('ytd-playlist-header-renderer h1') ||
                          document.querySelector('#header-description h3') ||
                          document.querySelector('yt-dynamic-sizing-formatted-string#text');
      if (headerTitle) {
        const text = (headerTitle.textContent || '').trim();
        if (text) return text;
      }

      const panelTitle = document.querySelector('ytd-playlist-panel-renderer .title') ||
                         document.querySelector('#playlist .title');
      if (panelTitle) {
        const text = (panelTitle.textContent || '').trim();
        if (text) return text;
      }

      const docTitle = document.title || '';
      return docTitle.replace(/ - YouTube$/, '').trim() || 'YouTube 播放清單';
    },

    detectTotalCount() {
      try {
        const statsElements = document.querySelectorAll(
          'ytd-playlist-header-renderer .metadata-stats, ytd-playlist-header-renderer yt-formatted-string, #stats yt-formatted-string, .byline-item'
        );
        for (const el of statsElements) {
          const text = el.textContent || '';
          const match = text.match(/([\d,]+)\s*(?:部影片|videos?|個項目)/i);
          if (match) {
            const num = parseInt(match[1].replace(/,/g, ''), 10);
            if (!isNaN(num) && num > 0) return num;
          }
        }

        const panelIndexEl = document.querySelector('ytd-playlist-panel-renderer .index-message-wrapper') ||
                             document.querySelector('ytd-playlist-panel-renderer #publisher-container span');
        if (panelIndexEl) {
          const text = panelIndexEl.textContent || '';
          const match = text.match(/\/\s*([\d,]+)/);
          if (match) {
            const num = parseInt(match[1].replace(/,/g, ''), 10);
            if (!isNaN(num) && num > 0) return num;
          }
        }
      } catch (_) {}
      return null;
    },

    extractVideoData(element) {
      try {
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

        const lowerTitle = rawTitle.toLowerCase();
        if (
          lowerTitle === '[deleted video]' ||
          lowerTitle === '[private video]' ||
          rawTitle === '[已刪除的影片]' ||
          rawTitle === '[私人影片]'
        ) {
          return null;
        }

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

        if (!videoId) {
          videoId = `custom_${Math.abs(hashString(rawTitle))}`;
        }

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

        let duration = '';
        const durationEl = element.querySelector('ytd-thumbnail-overlay-time-status-renderer #text') ||
                           element.querySelector('span.ytd-thumbnail-overlay-time-status-renderer') ||
                           element.querySelector('span.badge-shape-wiz__text') ||
                           element.querySelector('.badge-shape-wiz__text') ||
                           element.querySelector('#time-status #text');
        if (durationEl) {
          duration = (durationEl.textContent || '').trim();
        }

        return {
          id: videoId,
          videoId,
          title: rawTitle,
          channelTitle,
          duration: duration || 'N/A',
          url: videoId.startsWith('custom_') ? window.location.href : `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail: videoId.startsWith('custom_') ? '' : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          platform: 'youtube'
        };
      } catch (err) {
        console.warn('[YouTubeAdapter] Error extracting video item:', err);
        return null;
      }
    },

    scrapeVisibleVideos(videoMap) {
      let newlyAdded = 0;
      const isWatchPage = window.location.pathname.includes('/watch');
      let elements = [];

      if (isWatchPage) {
        const panel = document.querySelector('ytd-playlist-panel-renderer #items') ||
                      document.querySelector('ytd-playlist-panel-renderer') ||
                      document.querySelector('#playlist #items');
        if (panel) {
          elements = Array.from(panel.querySelectorAll('ytd-playlist-panel-video-renderer'));
        }
      } else {
        const container = document.querySelector('ytd-playlist-video-list-renderer #contents') ||
                          document.querySelector('ytd-playlist-video-list-renderer') ||
                          document.querySelector('#contents.ytd-playlist-video-list-renderer') ||
                          document.querySelector('ytd-browse[page-subtype="playlist"] #contents');
        if (container) {
          elements = Array.from(container.querySelectorAll('ytd-playlist-video-renderer, ytd-item-section-renderer ytd-playlist-video-renderer, yt-lockup-view-model'));
        } else {
          elements = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));
        }
      }

      elements.forEach((el) => {
        const data = this.extractVideoData(el);
        if (data && data.videoId && !videoMap.has(data.videoId)) {
          videoMap.set(data.videoId, data);
          newlyAdded++;
        }
      });

      return newlyAdded;
    },

    async scrapeAllVideos(maxItems = 0, onProgress = null) {
      const videoMap = new Map();
      const detectedTotal = this.detectTotalCount();
      const targetMax = maxItems > 0 ? maxItems : (detectedTotal || Infinity);

      this.scrapeVisibleVideos(videoMap);
      if (onProgress) {
        onProgress(videoMap.size, targetMax === Infinity ? 0 : targetMax);
      }

      if (videoMap.size >= targetMax) {
        return Array.from(videoMap.values()).slice(0, targetMax);
      }

      let noChangeCount = 0;
      const maxNoChangeTries = 6;
      let lastVideoCount = videoMap.size;
      let lastProgressTime = Date.now();

      const isWatchPage = window.location.pathname.includes('/watch');
      const playlistPanel = document.querySelector('ytd-playlist-panel-renderer #items') ||
                            document.querySelector('#items.ytd-playlist-panel-renderer');
      const scrollContainer = isWatchPage ? playlistPanel : null;

      console.log('[YouTubeAdapter] Starting auto-scroll scraping. Target:', targetMax);
      const scrapeStartTime = Date.now();
      const absoluteMaxDurationMs = 180000;
      const inactivityTimeoutMs = 15000;

      while (videoMap.size < targetMax) {
        if (Date.now() - scrapeStartTime > absoluteMaxDurationMs) {
          console.warn('[YouTubeAdapter] Reached max duration (3m).');
          break;
        }

        if (Date.now() - lastProgressTime > inactivityTimeoutMs && noChangeCount >= maxNoChangeTries) {
          console.log('[YouTubeAdapter] Finished scraping after inactivity timeout.');
          break;
        }

        const continuationItem = document.querySelector('ytd-continuation-item-renderer');
        if (continuationItem && typeof continuationItem.scrollIntoView === 'function') {
          continuationItem.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }

        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        } else {
          window.scrollTo(0, document.documentElement.scrollHeight);
          window.scrollBy({ top: 1500, behavior: 'smooth' });
        }

        const waitTime = noChangeCount > 0 ? 1000 : 700;
        await new Promise((resolve) => setTimeout(resolve, waitTime));

        this.scrapeVisibleVideos(videoMap);

        if (videoMap.size > lastVideoCount) {
          lastProgressTime = Date.now();
          lastVideoCount = videoMap.size;
          noChangeCount = 0;
        } else {
          noChangeCount++;
          if (!scrollContainer) {
            window.scrollBy(0, -250);
            await new Promise(r => setTimeout(r, 200));
            window.scrollTo(0, document.documentElement.scrollHeight);
          }
        }

        if (onProgress) {
          onProgress(videoMap.size, targetMax === Infinity ? 0 : targetMax);
        }
      }

      console.log(`[YouTubeAdapter] Scraping complete! Total: ${videoMap.size} videos.`);
      return Array.from(videoMap.values()).slice(0, targetMax);
    },

    async createCategoryPlaylist(categoryName, privacy, videos, onProgress) {
      return { success: false, message: '請透過 popup.js 的 nativeCreatePlaylistInPage 進行 YouTube 原生建立' };
    }
  };

  // ==========================================================================
  // 2. Bilibili 適配器 (BilibiliAdapter)
  // ==========================================================================
  const BilibiliAdapter = {
    platform: 'bilibili',

    isSupported() {
      const url = window.location.href;
      const isFavlistUrl = url.includes('space.bilibili.com') && url.includes('/favlist');
      const isMedialistUrl = url.includes('bilibili.com/medialist/play/') || url.includes('bilibili.com/list/ml');
      const hasBiliDom = !!(
        document.querySelector('.fav-video-list') ||
        document.querySelector('.fav-list-main') ||
        document.querySelector('.fav-main-section') ||
        document.querySelector('.media-list-wrapper')
      );
      return isFavlistUrl || isMedialistUrl || hasBiliDom;
    },

    getPlaylistTitle() {
      const titleEl = document.querySelector('.fav-main-title') ||
                      document.querySelector('.fav-name') ||
                      document.querySelector('.cur-list .title') ||
                      document.querySelector('.fav-header .title') ||
                      document.querySelector('.fav-list-main .fav-title');
      if (titleEl) {
        const text = (titleEl.textContent || '').trim();
        if (text) return text;
      }

      const mediaTitleEl = document.querySelector('.media-list-title') ||
                           document.querySelector('.nav-title .title') ||
                           document.querySelector('h1.video-title');
      if (mediaTitleEl) {
        const text = (mediaTitleEl.textContent || '').trim();
        if (text) return text;
      }

      const docTitle = document.title || '';
      return docTitle
        .replace(/_哔哩哔哩_bilibili$/i, '')
        .replace(/的个人空间-哔哩哔哩.*$/i, '')
        .replace(/- 哔哩哔哩.*$/i, '')
        .trim() || 'Bilibili 收藏夾';
    },

    detectTotalCount() {
      try {
        const countEl = document.querySelector('.fav-header .num') ||
                        document.querySelector('.fav-header .count') ||
                        document.querySelector('.fav-info .meta-item') ||
                        document.querySelector('.be-pager-total');
        if (countEl) {
          const text = countEl.textContent || '';
          const match = text.match(/([\d,]+)\s*(?:条|个|部)/i) || text.match(/共\s*([\d,]+)\s*条/i);
          if (match) {
            const num = parseInt(match[1].replace(/,/g, ''), 10);
            if (!isNaN(num) && num > 0) return num;
          }
        }
      } catch (_) {}
      return null;
    },

    extractVideoData(element) {
      try {
        const titleEl = element.querySelector('a.title') ||
                        element.querySelector('.title a') ||
                        element.querySelector('.title') ||
                        element.querySelector('.video-name') ||
                        element.querySelector('a[href*="/video/BV"]');

        if (!titleEl) return null;

        const rawTitle = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
        if (!rawTitle) return null;

        let href = titleEl.getAttribute('href') || '';
        if (!href) {
          const anyLink = element.querySelector('a.cover') ||
                          element.querySelector('a[href*="/video/BV"]') ||
                          element.querySelector('a');
          if (anyLink) href = anyLink.getAttribute('href') || '';
        }

        let bvid = '';
        if (href) {
          const match = href.match(/(BV[a-zA-Z0-9]{10})/i);
          if (match) bvid = match[1];
        }

        if (!bvid) {
          bvid = `bili_${Math.abs(hashString(rawTitle))}`;
        }

        let channelTitle = '未知 UP 主';
        const upEl = element.querySelector('.meta .up-name') ||
                     element.querySelector('.author') ||
                     element.querySelector('.up-name a') ||
                     element.querySelector('.up-name') ||
                     element.querySelector('a.up-name') ||
                     element.querySelector('.meta .up') ||
                     element.querySelector('.up-info');
        if (upEl) {
          const upText = (upEl.textContent || '').trim();
          if (upText) channelTitle = upText;
        }

        let duration = '';
        const durationEl = element.querySelector('.meta .length') ||
                           element.querySelector('.length') ||
                           element.querySelector('span.time') ||
                           element.querySelector('span.duration') ||
                           element.querySelector('.duration');
        if (durationEl) {
          duration = (durationEl.textContent || '').trim();
        }

        let thumbnail = '';
        const imgEl = element.querySelector('img.cover') ||
                      element.querySelector('img[src*="hdslb.com"]') ||
                      element.querySelector('img');
        if (imgEl) {
          thumbnail = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
          if (thumbnail.startsWith('//')) thumbnail = `https:${thumbnail}`;
        }

        const fullUrl = bvid.startsWith('bili_')
          ? window.location.href
          : `https://www.bilibili.com/video/${bvid}`;

        return {
          id: bvid,
          videoId: bvid,
          bvid,
          title: rawTitle,
          channelTitle,
          duration: duration || 'N/A',
          url: fullUrl,
          thumbnail,
          platform: 'bilibili'
        };
      } catch (err) {
        console.warn('[BilibiliAdapter] Error extracting video item:', err);
        return null;
      }
    },

    scrapeVisibleVideos(videoMap) {
      let newlyAdded = 0;
      const selectors = [
        '.fav-video-list li',
        '.fav-video-list .small-item',
        '.fav-list-main .fav-video-list-item',
        '.fav-video-list-item',
        'li.small-item',
        '.media-list-wrapper .video-item',
        '#playlist-list .video-item'
      ];

      const elements = document.querySelectorAll(selectors.join(', '));

      elements.forEach((el) => {
        const data = this.extractVideoData(el);
        if (data && data.videoId && !videoMap.has(data.videoId)) {
          videoMap.set(data.videoId, data);
          newlyAdded++;
        }
      });

      return newlyAdded;
    },

    async scrapeAllVideos(maxItems = 0, onProgress = null) {
      const videoMap = new Map();
      const detectedTotal = this.detectTotalCount();
      const targetMax = maxItems > 0 ? maxItems : (detectedTotal || Infinity);

      console.log('[BilibiliAdapter] Starting Bilibili favorites scraping. Target:', targetMax);

      this.scrapeVisibleVideos(videoMap);
      if (onProgress) {
        onProgress(videoMap.size, targetMax === Infinity ? 0 : targetMax);
      }

      if (videoMap.size >= targetMax) {
        return Array.from(videoMap.values()).slice(0, targetMax);
      }

      let currentPage = 1;
      const maxPages = 100;
      let consecutiveEmptyPages = 0;

      while (videoMap.size < targetMax && currentPage < maxPages) {
        const nextBtn = document.querySelector('.be-pager-next:not(.be-pager-disabled) a') ||
                        document.querySelector('.be-pager-next:not(.be-pager-disabled)') ||
                        document.querySelector('.vui_page_btn-next:not(.vui_page_btn-disabled)') ||
                        document.querySelector('li.be-pager-next:not(.be-pager-disabled)');

        if (!nextBtn) {
          window.scrollTo(0, document.documentElement.scrollHeight);
          await randomDelay(800, 1200);
          const added = this.scrapeVisibleVideos(videoMap);

          if (onProgress) {
            onProgress(videoMap.size, targetMax === Infinity ? 0 : targetMax);
          }

          if (added === 0) {
            consecutiveEmptyPages++;
            if (consecutiveEmptyPages >= 3) {
              console.log('[BilibiliAdapter] Reached the end of Bilibili favorites list.');
              break;
            }
          } else {
            consecutiveEmptyPages = 0;
          }
          continue;
        }

        console.log(`[BilibiliAdapter] Navigating to page ${currentPage + 1}...`);
        nextBtn.click();
        currentPage++;

        // 防風控隨機擬人化延遲 (800ms ～ 1500ms)
        await randomDelay(800, 1500);

        const added = this.scrapeVisibleVideos(videoMap);
        if (onProgress) {
          onProgress(videoMap.size, targetMax === Infinity ? 0 : targetMax);
        }

        if (added === 0) {
          consecutiveEmptyPages++;
          if (consecutiveEmptyPages >= 3) {
            break;
          }
        } else {
          consecutiveEmptyPages = 0;
        }
      }

      console.log(`[BilibiliAdapter] Scraping complete! Total collected: ${videoMap.size} videos.`);
      return Array.from(videoMap.values()).slice(0, targetMax);
    },

    async createCategoryPlaylist(categoryName, privacy, videos, onProgress) {
      return {
        success: false,
        message: 'Bilibili 暫不支援自動在帳號建立新收藏夾，建議使用「匯出 JSON / CSV / Markdown」進行分類備份與管理！'
      };
    }
  };

  // ==========================================================================
  // 3. 適配器調度器 (AdapterDispatcher)
  // ==========================================================================
  function getActiveAdapter() {
    const host = window.location.hostname;
    if (host.includes('bilibili.com')) {
      return BilibiliAdapter;
    }
    if (host.includes('youtube.com')) {
      return YouTubeAdapter;
    }
    return null;
  }

  // ==========================================================================
  // 4. 訊息通訊監聽器 (Chrome Runtime Message Listener)
  // ==========================================================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const adapter = getActiveAdapter();

    // 檢查頁面是否受支援
    if (request.action === 'CHECK_PAGE') {
      if (adapter && adapter.isSupported()) {
        const title = adapter.getPlaylistTitle();
        sendResponse({
          isPlaylist: true,
          platform: adapter.platform,
          title
        });
      } else {
        sendResponse({
          isPlaylist: false,
          platform: adapter ? adapter.platform : 'unknown'
        });
      }
      return true;
    }

    // 取得頁面資訊
    if (request.action === 'GET_PAGE_INFO') {
      if (adapter && adapter.isSupported()) {
        sendResponse({
          isPlaylist: true,
          platform: adapter.platform,
          title: adapter.getPlaylistTitle(),
          totalVideos: adapter.detectTotalCount ? adapter.detectTotalCount() : null
        });
      } else {
        sendResponse({ isPlaylist: false });
      }
      return true;
    }

    // 擷取播放清單/收藏夾影片
    if (request.action === 'SCRAPE_PLAYLIST') {
      if (!adapter || !adapter.isSupported()) {
        sendResponse({
          success: false,
          error: '當前網頁不是受支援的 YouTube 播放清單或 Bilibili 收藏夾網頁。'
        });
        return true;
      }

      const maxItems = Number(request.maxItems) || 0;

      adapter.scrapeAllVideos(maxItems, (currentCount, target) => {
        try {
          chrome.runtime.sendMessage({
            action: 'SCRAPE_PROGRESS',
            currentCount,
            target,
            platform: adapter.platform
          }).catch(() => {});
        } catch (_) {}
      })
        .then((videos) => {
          if (!videos || videos.length === 0) {
            sendResponse({
              success: false,
              error: `未能從當前 ${adapter.platform === 'bilibili' ? 'Bilibili 收藏夾' : 'YouTube 播放清單'} 擷取到任何影片。`
            });
          } else {
            sendResponse({
              success: true,
              platform: adapter.platform,
              count: videos.length,
              videos
            });
          }
        })
        .catch((err) => {
          console.error(`[${adapter.platform}] Scraping error:`, err);
          sendResponse({
            success: false,
            error: err.message || '擷取過程發生錯誤'
          });
        });

      return true;
    }

    // 建立播放清單 (YouTube)
    if (request.action === 'CREATE_CATEGORY_PLAYLIST') {
      if (!adapter) {
        sendResponse({ success: false, error: '未識別當前平台' });
        return true;
      }

      const { categoryName, privacy, videos } = request;
      adapter.createCategoryPlaylist(categoryName, privacy, videos, (current, total, currentTitle) => {
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
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));

      return true;
    }
  });
})();
