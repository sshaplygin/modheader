const browser = chrome;
const SPECIAL_CHARS = '^$&+?.()|{}[]/'.split('');
const MAX_PROFILES_IN_CLOUD = 50;
const CHROME_VERSION = getChromeVersion();
const EXTRA_REQUEST_HEADERS = new Set(['accept-language', 'accept-encoding', 'referer', 'cookie']);
const EXTRA_RESPONSE_HEADERS = new Set(['set-cookie']);

let currentProfile;
let tabUrls = {};

/**
 * Check whether the current request url pass the given list of filters.
 */
function passFilters_(url, type, filters) {
  if (!filters) {
    return true;
  }
  let allowUrls = false;
  let hasUrlFilters = false;
  let allowTypes = false;
  let hasResourceTypeFilters = false;
  for (let filter of filters) {
    if (filter.enabled) {
      switch (filter.type) {
        case 'urls':
          hasUrlFilters = true;
          if (url.search(filter.urlRegex) == 0) {
            allowUrls = true;
          }
          break;
        case 'types':
          hasResourceTypeFilters = true;
          if (filter.resourceType.indexOf(type) >= 0) {
            allowTypes = true;
          }
          break;
      }
    }
  }
  return (!hasUrlFilters || allowUrls)
    && (!hasResourceTypeFilters || allowTypes);
};

function loadSelectedProfile_() {
  let profile = {
    appendMode: false,
    reqHeaders: [],
    respHeaders: [],
    filters: [],
    createdAt: Date.now(),
  };

  browser.storage.local.get(['profiles', 'selectedProfileIdx'], (items) => {
    let { profiles, selectedProfileIdx } = items;

    if (!profiles || !profiles.length) {
      return;
    }

    // set default selected profile
    let updateSelectedProfileIdx = false;
    if (selectedProfileIdx == -1) {
      selectedProfileIdx = 0;
      updateSelectedProfileIdx = true;
    }

    const selectedProfile = profiles[selectedProfileIdx];

    function filterEnabledHeaders_(headers) {
      let output = [];
      for (let header of headers) {
        // Overrides the header if it is enabled and its name is not empty.
        if (header.enabled && header.name) {
          output.push({ name: header.name, value: header.value });
        }
      }
      return output;
    };

    for (let filter of selectedProfile.filters) {
      if (filter.urlPattern) {
        const urlPattern = filter.urlPattern;
        const joiner = [];

        for (let i = 0; i < urlPattern.length; ++i) {
          let c = urlPattern.charAt(i);
          if (SPECIAL_CHARS.indexOf(c) >= 0) {
            c = '\\' + c;
          } else if (c == '\\') {
            c = '\\\\';
          } else if (c == '*') {
            c = '.*';
          }
          joiner.push(c);
        }
        filter.urlRegex = joiner.join('');
      }

      profile.filters.push(filter);
    }

    profile.appendMode = selectedProfile.appendMode;
    profile.reqHeaders = filterEnabledHeaders_(selectedProfile.reqHeaders);
    profile.respHeaders = filterEnabledHeaders_(selectedProfile.respHeaders);

    if (updateSelectedProfileIdx) {
      browser.storage.local.set({ 'selectedProfileIdx': selectedProfileIdx });
    }
  });

  return profile;
};

function modifyHeader(source, dest) {
  if (!source.length) {
    return;
  }
  // Create an index map so that we can more efficiently override
  // existing header.
  const indexMap = {};
  for (const index in dest) {
    const header = dest[index];
    indexMap[header.name.toLowerCase()] = index;
  }
  for (let header of source) {
    const index = indexMap[header.name.toLowerCase()];
    if (index !== undefined) {
      if (!currentProfile.appendMode) {
        dest[index].value = header.value;
      } else if (currentProfile.appendMode == 'comma') {
        if (dest[index].value) {
          dest[index].value += ',';
        }
        dest[index].value += header.value;
      } else {
        dest[index].value += header.value;
      }
    } else {
      dest.push({ name: header.name, value: header.value });
      indexMap[header.name.toLowerCase()] = dest.length - 1;
    }
  }
};

function modifyRequestHeaderHandler_(details) {
  if (browser.storage.isPaused) {
    return {};
  }

  if (details.type == 'main_frame' && details.url && details.tabId) {
    tabUrls[details.tabId] = details.url;
    browser.storage.activeTabId = details.tabId;
    browser.tabs.get(details.tabId, onTabUpdated);
  }
  if (!browser.storage.lockedTabId
    || browser.storage.lockedTabId == details.tabId) {
    if (currentProfile
      && passFilters_(details.url, details.type, currentProfile.filters)) {
      modifyHeader(currentProfile.reqHeaders, details.requestHeaders);
    }
  }
  return { requestHeaders: details.requestHeaders };
};

function modifyResponseHeaderHandler_(details) {
  if (browser.storage.isPaused) {
    return {};
  }

  if (!browser.storage.lockedTabId
    || browser.storage.lockedTabId == details.tabId) {
    if (currentProfile
      && passFilters_(details.url, details.type, currentProfile.filters)) {
      const serializedOriginalResponseHeaders = JSON.stringify(details.responseHeaders);
      const responseHeaders = JSON.parse(serializedOriginalResponseHeaders);
      modifyHeader(currentProfile.respHeaders, responseHeaders);
      if (JSON.stringify(responseHeaders) != serializedOriginalResponseHeaders) {
        return { responseHeaders: responseHeaders };
      }
    }
  }
};

function getChromeVersion() {
  let pieces = navigator.userAgent.match(/Chrom(?:e|ium)\/([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)/);
  if (pieces == null || pieces.length != 5) {
    return {};
  }

  pieces = pieces.map(piece => parseInt(piece, 10));
  return {
    major: pieces[1],
    minor: pieces[2],
    build: pieces[3],
    patch: pieces[4]
  };
}

function setupHeaderModListener() {
  browser.webRequest.onBeforeSendHeaders.removeListener(modifyRequestHeaderHandler_);
  browser.webRequest.onHeadersReceived.removeListener(modifyResponseHeaderHandler_);

  // Chrome 72+ requires 'extraHeaders' to be added for some headers to be modifiable.
  // Older versions break with it.
  if (currentProfile.reqHeaders.length > 0) {
    let requiresExtraRequestHeaders = false;
    if (CHROME_VERSION.major >= 72) {
      for (let header of currentProfile.reqHeaders) {
        if (EXTRA_REQUEST_HEADERS.has(header.name.toLowerCase())) {
          requiresExtraRequestHeaders = true;
          break;
        }
      }
    }
    browser.webRequest.onBeforeSendHeaders.addListener(
      modifyRequestHeaderHandler_,
      { urls: ["<all_urls>"] },
      requiresExtraRequestHeaders ? ['requestHeaders', 'blocking', 'extraHeaders'] : ['requestHeaders', 'blocking']
    );
  }
  if (currentProfile.respHeaders.length > 0) {
    let requiresExtraResponseHeaders = false;
    if (CHROME_VERSION.major >= 72) {
      for (let header of currentProfile.respHeaders) {
        if (EXTRA_RESPONSE_HEADERS.has(header.name.toLowerCase())) {
          requiresExtraResponseHeaders = true;
          break;
        }
      }
    }
    browser.webRequest.onHeadersReceived.addListener(
      modifyResponseHeaderHandler_,
      { urls: ["<all_urls>"] },
      requiresExtraResponseHeaders ? ['responseHeaders', 'blocking', 'extraHeaders'] : ['responseHeaders', 'blocking']
    );
  }
}

function onTabUpdated(tab) {
  if (!tab.active) {
    return;
  }

  browser.storage.local.set({ currentTabUrl: undefined });
  // Since we don't have access to the "tabs" permission, we may not have
  // access to the url property all the time. So, match it against the URL
  // found during request modification.
  let url = tab.url;
  if (url) {
    tabUrls[tab.id] = url;
  } else {
    url = tabUrls[tab.id];
  }

  browser.storage.local.set({ 'activeTabId': tab.id });

  // Only set the currentTabUrl property if the tab is active and the window
  // is in focus.
  browser.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    browser.storage.local.set({ currentTabUrl: tabs[0].url });

    resetBadgeAndContextMenu();
  });
}

function createContextMenu() {
  browser.storage.local.get(['isPaused'], (items) => {
    let { isPaused } = items;

    if (isPaused) {
      browser.contextMenus.update('pause',
        {
          title: 'Unpause ModHeader',
          contexts: ['browser_action'],
          onclick: () => {
            browser.storage.local.set({ 'isPaused': false });
            resetBadgeAndContextMenu();
          }
        });
      return;
    }

    browser.contextMenus.update('pause',
      {
        title: 'Pause ModHeader',
        contexts: ['browser_action'],
        onclick: () => {
          browser.storage.local.set({ 'isPaused': true });
          resetBadgeAndContextMenu();
        }
      });
  });
}

function resetBadgeAndContextMenu() {
  browser.storage.local.get(['isPaused'], (items) => {
    let { isPaused } = items;

    let iconsPath = 'icon_bw.png';
    let badgeText = '\u275A\u275A';
    let color = '#666';

    if (!isPaused) {
      const numHeaders = (currentProfile.reqHeaders.length + currentProfile.respHeaders.length);
      console.log('numHeaders', numHeaders);
      if (numHeaders == 0) {
        color = '';
        iconsPath = 'icon_bw.png';
        badgeText = '';
      } else {
        badgeText = numHeaders.toString();
        color = '#db4343';
        iconsPath = 'icon.png';
      }
    }

    browser.action.setIcon({ path: iconsPath });
    browser.action.setBadgeText({ text: badgeText });
    if (color) {
      browser.action.setBadgeBackgroundColor({ color: color });
    }

    createContextMenu();
  });
}

function initializeStorage() {
  currentProfile = loadSelectedProfile_();
  setupHeaderModListener();

  browser.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName == 'local' && (changes.profiles || changes.selectedProfileIdx)) {
      currentProfile = loadSelectedProfile_();
    }

    resetBadgeAndContextMenu();
  });

  browser.contextMenus.create({
    id: 'lock',
    title: 'Lock',
    contexts: ['browser_action'],
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    onTabUpdated(tabId);
  });

  browser.tabs.onActivated.addListener((activeInfo) => {
    browser.tabs.get(activeInfo.tabId, onTabUpdated);
  });

  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId == browser.windows.WINDOW_ID_NONE) {
      return;
    }

    browser.windows.get(windowId, { populate: true }, (win) => {
      for (let tab of win.tabs) {
        onTabUpdated(tab);
      }
    });
  });
}

function saveLocalToSyncStorage() {
  browser.storage.local.get(['profiles', 'selectedProfileIdx'], (items) => {
    let { profiles, selectedProfileIdx } = items;

    if (!profiles) {
      return;
    }

    browser.storage.sync.set({ 'profiles': profiles });
    browser.storage.sync.set({ 'selectedProfileIdx': selectedProfileIdx });

    browser.storage.local.set({ 'savedToCloud': true });
  });
}

function saveSyncToLocalStorage() {
}

browser.contextMenus.create({
  id: 'pause',
  title: 'Pause',
  contexts: ['browser_action'],
});

initializeStorage();
resetBadgeAndContextMenu();
