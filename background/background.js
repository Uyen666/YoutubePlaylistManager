/**
 * YouTube 播放清單 AI 分類器 - Background Service Worker (background/background.js)
 * 負責擴充功能生命週期管理與預設設定初始化
 */

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[YT-AI-Classifier] Extension installed/updated. Reason:', details.reason);

  // 初始化預設設定 (若尚未設定過)
  chrome.storage.local.get(['provider', 'categories', 'maxItems'], (result) => {
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

    if (Object.keys(defaultSettings).length > 0) {
      chrome.storage.local.set(defaultSettings, () => {
        console.log('[YT-AI-Classifier] Default settings initialized:', defaultSettings);
      });
    }
  });
});
