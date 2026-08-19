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

  function cleanHtmlTags(str) {
    if (!str) return '';
    return str
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  function formatSecondsToDuration(sec) {
    if (!sec || isNaN(sec)) return 'N/A';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
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
  // 2. Bilibili 適配器 (BilibiliAdapter - 支援 Direct API 與通用 DOM 雙引擎)
  // ==========================================================================
  const BilibiliAdapter = {
    platform: 'bilibili',

    isSupported() {
      const url = window.location.href;
      const isFavlistUrl = url.includes('space.bilibili.com') && (url.includes('/favlist') || url.includes('/channel/collectiondetail') || url.includes('/channel/seriesdetail'));
      const isMedialistUrl = url.includes('bilibili.com/medialist/play/') || url.includes('bilibili.com/list/ml') || url.includes('bilibili.com/video/');
      const hasBiliDom = !!(
        document.querySelector('.fav-video-list') ||
        document.querySelector('.fav-list-main') ||
        document.querySelector('.fav-main-section') ||
        document.querySelector('.favList-content') ||
        document.querySelector('.media-list-wrapper') ||
        document.querySelector('a[href*="/video/BV"]')
      );
      return isFavlistUrl || isMedialistUrl || hasBiliDom;
    },

    getPlaylistTitle() {
      // 1. 空間收藏夾標題
      const titleEl = document.querySelector('.fav-main-title') ||
                      document.querySelector('.fav-name') ||
                      document.querySelector('.cur-list .title') ||
                      document.querySelector('.fav-header .title') ||
                      document.querySelector('.fav-list-main .fav-title') ||
                      document.querySelector('.fav-item.cur .text') ||
                      document.querySelector('.fav-item.active .text');
      if (titleEl) {
        const text = (titleEl.textContent || '').trim();
        if (text) return cleanHtmlTags(text);
      }

      // 2. 媒體播單頁面標題
      const mediaTitleEl = document.querySelector('.media-list-title') ||
                           document.querySelector('.nav-title .title') ||
                           document.querySelector('h1.video-title');
      if (mediaTitleEl) {
        const text = (mediaTitleEl.textContent || '').trim();
        if (text) return cleanHtmlTags(text);
      }

      // 3. Fallback Document Title
      const docTitle = document.title || '';
      return docTitle
        .replace(/_哔哩哔哩_bilibili$/i, '')
        .replace(/的个人空间-哔哩哔哩.*$/i, '')
        .replace(/- 哔哩哔哩.*$/i, '')
        .trim() || 'Bilibili 收藏夾';
    },

    /**
     * 嘗試從當前網址或 DOM 中提取 B 站收藏夾的 media_id / fid
     */
    detectMediaId() {
      const url = window.location.href;

      // 1. URL 中的 fid (例: ?fid=12345678)
      const fidMatch = url.match(/[?&]fid=(\d+)/);
      if (fidMatch) return fidMatch[1];

      // 2. URL 中的 ml (例: /medialist/play/ml12345678)
      const mlMatch = url.match(/\/ml(\d+)/i);
      if (mlMatch) return mlMatch[1];

      // 3. DOM 當前選中項的 data-fid 或連結
      const curFavItem = document.querySelector('.fav-item.cur, .fav-item.active, li.cur, .cur-list');
      if (curFavItem) {
        const dataFid = curFavItem.getAttribute('data-fid') || curFavItem.getAttribute('fid');
        if (dataFid && /^\d+$/.test(dataFid)) return dataFid;

        const linkWithFid = curFavItem.querySelector('a[href*="fid="]');
        if (linkWithFid) {
          const m = linkWithFid.href.match(/[?&]fid=(\d+)/);
          if (m) return m[1];
        }
      }

      // 4. 搜尋頁面上第一個 fid 連結
      const anyFidLink = document.querySelector('a[href*="fid="]');
      if (anyFidLink) {
        const m = anyFidLink.href.match(/[?&]fid=(\d+)/);
        if (m) return m[1];
      }

      return null;
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

    /**
     * 引擎 1: 透過 Bilibili 官方非公開/公開資源 API 直接取得完整清單 (0 DOM 依賴，極速 100% 精準)
     */
    async fetchViaBilibiliAPI(mediaId, maxItems = 0, onProgress = null) {
      const videoMap = new Map();
      let page = 1;
      const pageSize = 20;
      let hasMore = true;
      const targetMax = maxItems > 0 ? maxItems : Infinity;

      console.log(`[BilibiliAdapter] Attempting direct API fetch for mediaId=${mediaId}, target=${targetMax}...`);

      while (hasMore && videoMap.size < targetMax && page <= 50) {
        const apiUrl = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=${page}&ps=${pageSize}&keyword=&order=mtime&type=0&tid=0&platform=web`;

        try {
          const response = await fetch(apiUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json, text/plain, */*'
            }
          });

          if (!response.ok) {
            console.warn(`[BilibiliAdapter] API HTTP ${response.status}`);
            break;
          }

          const resJson = await response.json();
          if (resJson.code !== 0 || !resJson.data || !Array.isArray(resJson.data.medias)) {
            console.warn('[BilibiliAdapter] API returned non-zero code or empty medias:', resJson);
            break;
          }

          const medias = resJson.data.medias;
          if (medias.length === 0) {
            break;
          }

          medias.forEach((item) => {
            const bvid = item.bvid || (item.id ? `av${item.id}` : '');
            if (!bvid || videoMap.has(bvid)) return;

            const title = cleanHtmlTags(item.title || '');
            if (!title || title === '已失效视频' || title === '已删除视频') return;

            const upperName = item.upper?.name || '未知 UP 主';
            const durationText = formatSecondsToDuration(item.duration);
            let thumbnail = item.cover || '';
            if (thumbnail.startsWith('//')) thumbnail = `https:${thumbnail}`;

            videoMap.set(bvid, {
              id: bvid,
              videoId: bvid,
              bvid,
              title,
              channelTitle: upperName,
              duration: durationText,
              url: `https://www.bilibili.com/video/${bvid}`,
              thumbnail,
              platform: 'bilibili'
            });
          });

          if (onProgress) {
            onProgress(videoMap.size, targetMax === Infinity ? (resJson.data.info?.media_count || videoMap.size) : targetMax);
          }

          hasMore = resJson.data.has_more === true && medias.length >= pageSize;
          page++;

          // 輕微延遲防禦風控
          if (hasMore && videoMap.size < targetMax) {
            await sleep(350);
          }
        } catch (err) {
          console.warn('[BilibiliAdapter] API request failed:', err);
          break;
        }
      }

      console.log(`[BilibiliAdapter] API Fetch complete. Total videos: ${videoMap.size}`);
      return Array.from(videoMap.values()).slice(0, targetMax);
    },

    /**
     * 引擎 2: 通用 DOM 鏈結與卡片爬蟲 (備援方案)
     */
    scrapeVisibleVideos(videoMap) {
      let newlyAdded = 0;

      // 搜尋頁面上所有帶有 /video/BV 或 /video/av 的超連結
      const links = document.querySelectorAll(
        'a[href*="/video/BV"], a[href*="/video/av"], a.cover[href*="/video/"], a.title[href*="/video/"]'
      );

      links.forEach((link) => {
        try {
          const href = link.getAttribute('href') || link.href || '';
          const match = href.match(/(BV[a-zA-Z0-9]{10})/i) || href.match(/\/video\/(av\d+)/i);
          if (!match) return;

          const bvid = match[1];
          if (videoMap.has(bvid)) return;

          // 尋找卡片外層容器
          const card = link.closest(
            'li, .small-item, .fav-video-list-item, .bili-video-card, .video-item, .fav-list-item, .space_favList__item, .fav-video-card'
          ) || link.parentElement?.parentElement || link.parentElement || link;

          // 標題提取
          const titleEl = card.querySelector('a.title, .title, .bili-video-card__info--tit, a[title], .video-name, h3, .name') || link;
          let rawTitle = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
          if (!rawTitle) {
            const imgAlt = card.querySelector('img[alt]')?.getAttribute('alt');
            if (imgAlt) rawTitle = imgAlt.trim();
          }
          rawTitle = cleanHtmlTags(rawTitle);

          if (!rawTitle || rawTitle.toLowerCase() === 'deleted' || rawTitle === '已失效视频' || rawTitle === '已删除视频') {
            return;
          }

          // UP主提取
          let channelTitle = '未知 UP 主';
          const upEl = card.querySelector(
            '.up-name, .author, .bili-video-card__info--author, a[href*="space.bilibili.com"], .meta .up-name, .up, .up-info, .name a'
          );
          if (upEl) {
            const upText = (upEl.textContent || '').trim();
            if (upText) channelTitle = cleanHtmlTags(upText);
          }

          // 時長提取
          let duration = '';
          const durationEl = card.querySelector(
            '.length, .duration, .time, .bili-video-card__stats__duration, span.duration, span.time'
          );
          if (durationEl) {
            duration = (durationEl.textContent || '').trim();
          }

          // 封面圖
          let thumbnail = '';
          const imgEl = card.querySelector('img.cover, img[src*="hdslb.com"], img[data-src], img');
          if (imgEl) {
            thumbnail = imgEl.src || imgEl.getAttribute('data-src') || '';
            if (thumbnail.startsWith('//')) thumbnail = `https:${thumbnail}`;
          }

          videoMap.set(bvid, {
            id: bvid,
            videoId: bvid,
            bvid,
            title: rawTitle,
            channelTitle,
            duration: duration || 'N/A',
            url: `https://www.bilibili.com/video/${bvid}`,
            thumbnail,
            platform: 'bilibili'
          });
          newlyAdded++;
        } catch (e) {
          console.warn('[BilibiliAdapter] Error parsing DOM node:', e);
        }
      });

      return newlyAdded;
    },

    async scrapeAllVideos(maxItems = 0, onProgress = null) {
      const targetMax = maxItems > 0 ? maxItems : Infinity;

      // ----------------------------------------------------------------------
      // 策略 1: 優先嘗試直接呼叫 Bilibili 官方 API (極速、零 DOM 依賴、100% 穩定)
      // ----------------------------------------------------------------------
      const mediaId = this.detectMediaId();
      if (mediaId) {
        console.log(`[BilibiliAdapter] Detected mediaId=${mediaId}, running Direct API engine...`);
        const apiVideos = await this.fetchViaBilibiliAPI(mediaId, maxItems, onProgress);
        if (apiVideos && apiVideos.length > 0) {
          return apiVideos;
        }
      }

      // ----------------------------------------------------------------------
      // 策略 2: 若未找到 mediaId 或 API 失敗，使用通用 DOM 翻頁與滾動爬蟲
      // ----------------------------------------------------------------------
      console.log('[BilibiliAdapter] Falling back to Universal DOM scraping engine...');
      const videoMap = new Map();

      // 先等待 DOM 非同步渲染完成 (最多輪詢 3 秒)
      for (let poll = 0; poll < 10; poll++) {
        this.scrapeVisibleVideos(videoMap);
        if (videoMap.size > 0) break;
        await sleep(300);
      }

      if (onProgress) {
        onProgress(videoMap.size, targetMax === Infinity ? 0 : targetMax);
      }

      if (videoMap.size >= targetMax) {
        return Array.from(videoMap.values()).slice(0, targetMax);
      }

      let currentPage = 1;
      const maxPages = 50;
      let consecutiveEmptyPages = 0;

      while (videoMap.size < targetMax && currentPage < maxPages) {
        const nextBtn = document.querySelector('.be-pager-next:not(.be-pager-disabled) a') ||
                        document.querySelector('.be-pager-next:not(.be-pager-disabled)') ||
                        document.querySelector('.vui_page_btn-next:not(.vui_page_btn-disabled)') ||
                        document.querySelector('li.be-pager-next:not(.be-pager-disabled)');

        if (!nextBtn) {
          // 若無下一頁按鈕，向下滾動
          window.scrollTo(0, document.documentElement.scrollHeight);
          window.scrollBy({ top: 1500, behavior: 'smooth' });
          await randomDelay(800, 1200);
          const added = this.scrapeVisibleVideos(videoMap);

          if (onProgress) {
            onProgress(videoMap.size, targetMax === Infinity ? 0 : targetMax);
          }

          if (added === 0) {
            consecutiveEmptyPages++;
            if (consecutiveEmptyPages >= 3) {
              console.log('[BilibiliAdapter] Reached the end of Bilibili favorites DOM.');
              break;
            }
          } else {
            consecutiveEmptyPages = 0;
          }
          continue;
        }

        console.log(`[BilibiliAdapter] DOM clicking page ${currentPage + 1}...`);
        nextBtn.click();
        currentPage++;

        // 🚨 防風控隨機擬人化延遲 (800ms ～ 1500ms)
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

      console.log(`[BilibiliAdapter] DOM Scraping complete! Total: ${videoMap.size} videos.`);
      return Array.from(videoMap.values()).slice(0, targetMax);
    },

    async createCategoryPlaylist(categoryName, privacy, videos, onProgress) {
      try {
        const csrfMatch = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/);
        const csrf = csrfMatch ? csrfMatch[1] : '';

        if (!csrf) {
          return { success: false, error: '未能讀取 Bilibili 登入憑證 (bili_jct)，請先在 B 站登入帳號並重新整理頁面後再試！' };
        }

        const privacyCode = (privacy === 'PUBLIC') ? 0 : 1;
        const createParams = new URLSearchParams();
        createParams.append('title', categoryName);
        createParams.append('intro', '由 YouTube/Bilibili 智慧分類器自動建立');
        createParams.append('privacy', String(privacyCode));
        createParams.append('csrf', csrf);

        const createRes = await fetch('https://api.bilibili.com/x/v3/fav/folder/add', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json, text/plain, */*'
          },
          credentials: 'include',
          body: createParams.toString()
        });

        const createData = await createRes.json();
        if (createData.code !== 0 || !createData.data?.id) {
          return { success: false, error: createData.message || `B站建立收藏夾失敗 (錯誤碼 ${createData.code})` };
        }

        const folderId = createData.data.id;
        const userMid = createData.data.mid || '';

        const BILI_TABLE = 'fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF';
        const BILI_TR = {};
        for (let i = 0; i < 58; i++) {
          BILI_TR[BILI_TABLE[i]] = i;
        }
        const BILI_S = [11, 10, 3, 8, 4, 6];
        const BILI_XOR = 177451812;
        const BILI_ADD = 8728348608;

        function bvidToAid(bvid) {
          if (!bvid) return null;
          if (/^\d+$/.test(bvid)) return parseInt(bvid, 10);
          if (/^av(\d+)$/i.test(bvid)) return parseInt(bvid.match(/^av(\d+)$/i)[1], 10);
          let bvStr = bvid;
          if (!bvStr.startsWith('BV') && !bvStr.startsWith('bv')) bvStr = 'BV' + bvStr;
          if (bvStr.length !== 12) return null;
          let r = 0;
          for (let i = 0; i < 6; i++) {
            r += BILI_TR[bvStr[BILI_S[i]]] * Math.pow(58, i);
          }
          return (r - BILI_ADD) ^ BILI_XOR;
        }

        const aids = [];
        for (const v of (videos || [])) {
          const aid = bvidToAid(v.bvid || v.videoId || v.id || v);
          if (aid && typeof aid === 'number' && !isNaN(aid) && aid > 0) {
            aids.push(aid);
          }
        }

        let addedSuccessCount = 0;
        if (aids.length > 0) {
          const batchSize = 20;
          for (let i = 0; i < aids.length; i += batchSize) {
            const chunk = aids.slice(i, i + batchSize);
            try {
              const batchParams = new URLSearchParams();
              batchParams.append('resources', chunk.map(aid => `${aid}:2`).join(','));
              batchParams.append('add_media_ids', String(folderId));
              batchParams.append('del_media_ids', '');
              batchParams.append('csrf', csrf);

              const batchRes = await fetch('https://api.bilibili.com/x/v3/fav/resource/batch-deal', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Accept': 'application/json, text/plain, */*'
                },
                credentials: 'include',
                body: batchParams.toString()
              });

              const batchData = await batchRes.json();
              if (batchData.code === 0) {
                addedSuccessCount += chunk.length;
              } else {
                for (const singleAid of chunk) {
                  try {
                    const dealParams = new URLSearchParams();
                    dealParams.append('rid', String(singleAid));
                    dealParams.append('type', '2');
                    dealParams.append('add_media_ids', String(folderId));
                    dealParams.append('csrf', csrf);

                    const singleRes = await fetch('https://api.bilibili.com/x/v3/fav/resource/deal', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                      credentials: 'include',
                      body: dealParams.toString()
                    });
                    const singleData = await singleRes.json();
                    if (singleData.code === 0) addedSuccessCount++;
                    await sleep(120);
                  } catch (_) {}
                }
              }
            } catch (err) {
              console.warn('[BilibiliAdapter] Batch error:', err);
            }

            if (onProgress) {
              onProgress(Math.min(i + batchSize, aids.length), aids.length, categoryName);
            }

            if (i + batchSize < aids.length) {
              await sleep(200);
            }
          }
        }

        const playlistUrl = userMid
          ? `https://space.bilibili.com/${userMid}/favlist?fid=${folderId}`
          : `https://www.bilibili.com/medialist/play/ml${folderId}`;

        return {
          success: true,
          playlistId: String(folderId),
          playlistUrl,
          addedCount: addedSuccessCount || aids.length,
          categoryName,
          platform: 'bilibili'
        };
      } catch (err) {
        return { success: false, error: err.message || 'B站收藏夾建立過程發生異常' };
      }
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
