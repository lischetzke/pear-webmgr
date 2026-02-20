(function () {
  const $ = (sel) => document.querySelector(sel);

  const els = {
    art: $('#album-art'),
    noArt: $('#no-art'),
    title: $('#title'),
    artist: $('#artist'),
    elapsed: $('#elapsed'),
    duration: $('#duration'),
    progressFill: $('#progress-fill'),
    btnPrev: $('#btn-prev'),
    btnPlay: $('#btn-play'),
    btnNext: $('#btn-next'),
    iconPlay: $('#icon-play'),
    iconPause: $('#icon-pause'),
    volumeSlider: $('#volume-slider'),
    volumeValue: $('#volume-value'),
    queueList: $('#queue-list'),
    tabQueue: $('#tab-queue'),
    tabSearch: $('#tab-search'),
    urlInput: $('#url-input'),
    btnAddUrl: $('#btn-add-url'),
    searchInput: $('#search-input'),
    btnSearch: $('#btn-search'),
    searchResults: $('#search-results'),
  };

  let currentVideoId = null;
  let currentSongTitle = '';
  let currentSongArtist = '';
  let volumeDebounce = null;
  let isUserDraggingVolume = false;
  let queuePollTimer = null;
  let currentQueueIndex = -1;
  let activeTab = 'queue';
  let lastQueueFingerprint = '';

  // --- Helpers ---

  function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  async function post(path) {
    try {
      await fetch(path, { method: 'POST' });
    } catch { /* ignore connectivity errors */ }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // --- YT Music Innertube Response Parsers ---

  /**
   * Collect all musicResponsiveListItemRenderer objects from a deeply nested
   * YouTube Music innertube response. Works for both search and queue responses.
   */
  function collectYTMRenderers(obj, results, depth) {
    if (depth > 20 || !obj || typeof obj !== 'object') return;

    if (obj.musicResponsiveListItemRenderer) {
      results.push(obj.musicResponsiveListItemRenderer);
      return;
    }
    if (obj.playlistPanelVideoRenderer) {
      results.push(obj.playlistPanelVideoRenderer);
      return;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        collectYTMRenderers(obj[i], results, depth + 1);
      }
    } else {
      for (const key of Object.keys(obj)) {
        collectYTMRenderers(obj[key], results, depth + 1);
      }
    }
  }

  function parseYTMRenderer(renderer) {
    const videoId =
      (renderer.playlistItemData && renderer.playlistItemData.videoId) ||
      extractWatchVideoId(renderer) ||
      renderer.videoId || '';

    if (!videoId) return null;

    const title = extractFlexColumnText(renderer, 0) || renderer.title && extractRunsText(renderer.title) || '';
    const artist = extractArtistFromRenderer(renderer);
    const thumbnail = extractRendererThumbnail(renderer);
    const selected = !!renderer.selected;

    return { title, artist, thumbnail, videoId, selected };
  }

  function extractWatchVideoId(renderer) {
    try {
      return renderer.overlay.musicItemThumbnailOverlayRenderer.content
        .musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId;
    } catch { return ''; }
  }

  function extractFlexColumnText(renderer, colIdx) {
    try {
      const col = renderer.flexColumns[colIdx].musicResponsiveListItemFlexColumnRenderer;
      return col.text.runs[0].text || '';
    } catch { return ''; }
  }

  function extractRunsText(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (obj.runs) return obj.runs.map(function (r) { return r.text || ''; }).join('');
    if (obj.simpleText) return obj.simpleText;
    return '';
  }

  function extractArtistFromRenderer(renderer) {
    // Queue items (playlistPanelVideoRenderer) use longBylineText / shortBylineText
    function fromBylineRuns(runs) {
      if (!runs || !runs.length) return '';
      var artistRuns = runs.filter(function (r) {
        try {
          return r.navigationEndpoint.browseEndpoint
            .browseEndpointContextSupportedConfigs
            .browseEndpointContextMusicConfig.pageType === 'MUSIC_PAGE_TYPE_ARTIST';
        } catch { return false; }
      });
      if (artistRuns.length > 0) return artistRuns.map(function (r) { return r.text; }).join(', ');
      return runs[0].text || '';
    }

    try {
      if (renderer.longBylineText && renderer.longBylineText.runs) {
        var a = fromBylineRuns(renderer.longBylineText.runs);
        if (a) return a;
      }
      if (renderer.shortBylineText) return extractRunsText(renderer.shortBylineText);
    } catch {}

    // Search results (musicResponsiveListItemRenderer) use flexColumns
    try {
      var col = renderer.flexColumns[1].musicResponsiveListItemFlexColumnRenderer;
      if (!col || !col.text || !col.text.runs) return '';

      var runs = col.text.runs;
      var a2 = fromBylineRuns(runs);
      if (a2) return a2;

      var meaningful = runs.filter(function (r, i) {
        if (i === 0) return false;
        if (r.text === ' \u2022 ' || r.text === ' und ' || r.text === ' & ') return false;
        if (/^\d+:\d+$/.test(r.text)) return false;
        if (/^\d/.test(r.text) && /Wiedergabe|Aufrufe|views/i.test(r.text)) return false;
        return !!r.navigationEndpoint;
      });
      if (meaningful.length > 0) return meaningful.map(function (r) { return r.text; }).join(', ');
      return '';
    } catch { return ''; }
  }

  function extractRendererThumbnail(renderer) {
    try {
      var thumbs = renderer.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
      if (thumbs && thumbs.length > 0) {
        return (thumbs.length > 1 ? thumbs[1].url : thumbs[0].url) || '';
      }
    } catch {}
    try {
      var thumbs2 = renderer.thumbnail.thumbnails;
      if (thumbs2 && thumbs2.length > 0) return thumbs2[0].url || '';
    } catch {}
    return '';
  }

  /**
   * Parse a YT Music innertube response into normalized track objects.
   * Returns an array of { title, artist, thumbnail, videoId, selected }.
   */
  function parseYTMusicItems(data) {
    var renderers = [];
    collectYTMRenderers(data, renderers, 0);
    return renderers.map(parseYTMRenderer).filter(Boolean);
  }

  /**
   * Also try a simpler flat-array approach for non-innertube responses.
   */
  function findSimpleTrackArray(obj, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 8 || !obj) return null;

    if (Array.isArray(obj)) {
      if (obj.length > 0 && obj[0] && typeof obj[0] === 'object' &&
          (obj[0].videoId || obj[0].title || obj[0].name)) {
        return obj;
      }
      for (var i = 0; i < obj.length; i++) {
        if (obj[i] && typeof obj[i] === 'object') {
          var found = findSimpleTrackArray(obj[i], depth + 1);
          if (found) return found;
        }
      }
      return null;
    }
    if (typeof obj !== 'object') return null;

    var keys = ['items', 'queue', 'tracks', 'results', 'content', 'contents', 'songs'];
    for (var k = 0; k < keys.length; k++) {
      if (obj[keys[k]]) {
        var f = findSimpleTrackArray(obj[keys[k]], depth + 1);
        if (f) return f;
      }
    }
    for (var key in obj) {
      if (keys.indexOf(key) >= 0) continue;
      if (obj[key] && typeof obj[key] === 'object') {
        var f2 = findSimpleTrackArray(obj[key], depth + 1);
        if (f2) return f2;
      }
    }
    return null;
  }

  function normalizeSimpleTrack(item) {
    var artist = item.artist || item.author || '';
    if (!artist && item.artists && Array.isArray(item.artists)) {
      artist = item.artists.map(function (a) { return typeof a === 'string' ? a : a.name || ''; }).join(', ');
    }
    var thumb = item.thumbnail || item.imageSrc || item.thumbnailUrl || '';
    if (!thumb && item.thumbnails && Array.isArray(item.thumbnails) && item.thumbnails.length) {
      thumb = typeof item.thumbnails[0] === 'string' ? item.thumbnails[0] : (item.thumbnails[0].url || '');
    }
    return {
      title: item.title || item.name || '',
      artist: artist,
      thumbnail: thumb,
      videoId: item.videoId || item.id || '',
      selected: !!item.selected,
    };
  }

  /**
   * Parse queue items specifically: handle the two wrapper formats the API uses
   * without recursing into counterpart/secondary renderers.
   */
  function parseQueueItems(data) {
    if (!data || !Array.isArray(data.items) || data.items.length === 0) return [];

    var results = [];
    for (var i = 0; i < data.items.length; i++) {
      var entry = data.items[i];
      var renderer = null;

      if (entry.playlistPanelVideoWrapperRenderer) {
        var w = entry.playlistPanelVideoWrapperRenderer;
        renderer = w.primaryRenderer && w.primaryRenderer.playlistPanelVideoRenderer;
      } else if (entry.playlistPanelVideoRenderer) {
        renderer = entry.playlistPanelVideoRenderer;
      }

      if (renderer) {
        var parsed = parseYTMRenderer(renderer);
        if (parsed) results.push(parsed);
      }
    }
    return results;
  }

  /**
   * Universal parser: try queue-specific format first, then innertube search,
   * then fall back to simple arrays.
   */
  function parseTrackList(data) {
    var queueItems = parseQueueItems(data);
    if (queueItems.length > 0) return queueItems;

    var ytmItems = parseYTMusicItems(data);
    if (ytmItems.length > 0) return ytmItems;

    var simple = findSimpleTrackArray(data);
    if (simple && simple.length > 0) return simple.map(normalizeSimpleTrack);

    return [];
  }

  // --- Player Polling ---

  async function pollSong() {
    try {
      const res = await fetch('/api/v1/song');
      if (res.status === 204) {
        els.title.textContent = '--';
        els.artist.textContent = '--';
        els.art.src = '';
        els.noArt.classList.remove('hidden');
        els.progressFill.style.width = '0%';
        els.elapsed.textContent = '0:00';
        els.duration.textContent = '0:00';
        currentVideoId = null;
        currentSongTitle = '';
        currentSongArtist = '';
        setPlayIcon(true);
        return;
      }

      const song = await res.json();
      els.title.textContent = song.title || '--';
      els.artist.textContent = song.artist || '--';

      if (song.imageSrc) {
        if (song.videoId !== currentVideoId) {
          els.art.src = song.imageSrc;
        }
        els.noArt.classList.add('hidden');
      } else {
        els.art.src = '';
        els.noArt.classList.remove('hidden');
      }

      currentVideoId = song.videoId;
      currentSongTitle = song.title || '';
      currentSongArtist = song.artist || '';

      const duration = song.songDuration || 0;
      const elapsed = song.elapsedSeconds || 0;
      els.elapsed.textContent = formatTime(elapsed);
      els.duration.textContent = formatTime(duration);
      els.progressFill.style.width = duration > 0
        ? (elapsed / duration * 100) + '%'
        : '0%';

      setPlayIcon(song.isPaused !== false);
    } catch { /* silently retry next cycle */ }
  }

  async function pollVolume() {
    if (isUserDraggingVolume) return;
    try {
      const res = await fetch('/api/v1/volume');
      if (!res.ok) return;
      const data = await res.json();
      const vol = Math.round(data.state);
      els.volumeSlider.value = vol;
      els.volumeValue.textContent = vol;
    } catch { /* ignore */ }
  }

  function setPlayIcon(isPaused) {
    if (isPaused) {
      els.iconPlay.classList.remove('hidden');
      els.iconPause.classList.add('hidden');
    } else {
      els.iconPlay.classList.add('hidden');
      els.iconPause.classList.remove('hidden');
    }
  }

  // --- Player Controls ---

  els.btnPlay.addEventListener('click', async () => {
    await post('/api/v1/toggle-play');
    await new Promise(function (r) { setTimeout(r, 300); });
    pollSong();
  });
  els.btnNext.addEventListener('click', async () => {
    await post('/api/v1/next');
    invalidateQueueCache();
    await new Promise(function (r) { setTimeout(r, 500); });
    pollSong();
    fetchQueue();
  });
  els.btnPrev.addEventListener('click', async () => {
    await post('/api/v1/previous');
    invalidateQueueCache();
    await new Promise(function (r) { setTimeout(r, 500); });
    pollSong();
    fetchQueue();
  });

  // --- Volume ---

  els.volumeSlider.addEventListener('mousedown', () => { isUserDraggingVolume = true; });
  els.volumeSlider.addEventListener('touchstart', () => { isUserDraggingVolume = true; }, { passive: true });

  els.volumeSlider.addEventListener('input', () => {
    const target = Number(els.volumeSlider.value);
    els.volumeValue.textContent = target;
    clearTimeout(volumeDebounce);
    volumeDebounce = setTimeout(() => {
      fetch('/api/v1/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: target }),
      }).catch(() => {});
    }, 150);
  });

  function endVolumeDrag() {
    isUserDraggingVolume = false;
  }
  els.volumeSlider.addEventListener('mouseup', endVolumeDrag);
  els.volumeSlider.addEventListener('touchend', endVolumeDrag);

  // --- Tab Switching ---

  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const tab = btn.dataset.tab;
      if (tab === activeTab) return;
      activeTab = tab;

      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      els.tabQueue.classList.toggle('active', tab === 'queue');
      els.tabSearch.classList.toggle('active', tab === 'search');
    });
  });

  // --- Queue Display ---

  async function fetchQueue() {
    try {
      const res = await fetch('/api/v1/queue');
      if (res.status === 204) {
        els.queueList.innerHTML = '<div class="queue-empty">Queue is empty</div>';
        return;
      }
      if (!res.ok) {
        els.queueList.innerHTML = '<div class="queue-empty">Could not load queue</div>';
        return;
      }
      const data = await res.json();
      renderQueue(data);
    } catch (err) {
      console.error('[pear-webmgr] Queue fetch error:', err);
      els.queueList.innerHTML = '<div class="queue-empty">Could not load queue</div>';
    }
  }

  function queueFingerprint(visibleItems, startIdx, activeIdx) {
    var parts = [startIdx, activeIdx];
    for (var i = 0; i < visibleItems.length; i++) {
      parts.push(visibleItems[i].videoId, visibleItems[i].title);
    }
    return parts.join('\t');
  }

  function renderQueue(data) {
    const allItems = parseTrackList(data);
    if (allItems.length === 0) {
      if (lastQueueFingerprint !== '__empty__') {
        lastQueueFingerprint = '__empty__';
        els.queueList.innerHTML = '<div class="queue-empty">Queue is empty</div>';
      }
      return;
    }

    currentQueueIndex = resolveCurrentIndex(data, allItems);

    const startIdx = Math.max(0, currentQueueIndex);
    const visibleItems = allItems.slice(startIdx);

    if (visibleItems.length === 0) {
      if (lastQueueFingerprint !== '__empty__') {
        lastQueueFingerprint = '__empty__';
        els.queueList.innerHTML = '<div class="queue-empty">Queue is empty</div>';
      }
      return;
    }

    var fp = queueFingerprint(visibleItems, startIdx, currentQueueIndex);
    if (fp === lastQueueFingerprint) return;
    lastQueueFingerprint = fp;

    els.queueList.innerHTML = visibleItems.map((item, vi) => {
      const originalIndex = startIdx + vi;
      const isActive = originalIndex === currentQueueIndex;
      const thumb = item.thumbnail || '';
      return `
        <div class="queue-item${isActive ? ' active' : ''}" data-index="${originalIndex}">
          <img class="queue-item-thumb" src="${escapeHtml(thumb)}" alt="">
          <div class="queue-item-info">
            <div class="queue-item-title">${escapeHtml(item.title || 'Unknown')}</div>
            <div class="queue-item-artist">${escapeHtml(item.artist || '')}</div>
          </div>
          <button class="queue-item-remove" data-index="${originalIndex}" title="Remove">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>`;
    }).join('');
  }

  function resolveCurrentIndex(data, items) {
    // 1. selected flag set by the API on the active item
    for (var i = 0; i < items.length; i++) {
      if (items[i].selected) return i;
    }

    // 2. Match by videoId (forward scan -- first match is the playing instance)
    if (currentVideoId) {
      for (var j = 0; j < items.length; j++) {
        if (items[j].videoId === currentVideoId) return j;
      }
    }

    // 3. Fallback: title + artist
    if (currentSongTitle) {
      var normTitle = currentSongTitle.toLowerCase();
      var normArtist = currentSongArtist.toLowerCase();
      for (var k = 0; k < items.length; k++) {
        var it = items[k];
        if ((it.title || '').toLowerCase() === normTitle &&
            (!normArtist || (it.artist || '').toLowerCase() === normArtist)) {
          return k;
        }
      }
    }

    // 4. API-level index hints
    if (typeof data.selectedItemIndex === 'number') return data.selectedItemIndex;
    if (typeof data.currentIndex === 'number') return data.currentIndex;
    if (typeof data.index === 'number') return data.index;

    return -1;
  }

  // --- Queue Remove / Jump ---

  els.queueList.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.queue-item-remove');
    if (removeBtn) {
      e.stopPropagation();
      removeFromQueue(Number(removeBtn.dataset.index));
      return;
    }

    const queueItem = e.target.closest('.queue-item');
    if (queueItem) {
      jumpToQueueIndex(Number(queueItem.dataset.index));
    }
  });

  function invalidateQueueCache() {
    lastQueueFingerprint = '';
  }

  async function removeFromQueue(index) {
    try {
      await fetch('/api/v1/queue/' + index, { method: 'DELETE' });
      invalidateQueueCache();
      await new Promise(function (r) { setTimeout(r, 500); });
      await fetchQueue();
    } catch { /* ignore */ }
  }

  async function jumpToQueueIndex(index) {
    try {
      await fetch('/api/v1/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      invalidateQueueCache();
      await new Promise(function (r) { setTimeout(r, 500); });
      await fetchQueue();
    } catch { /* ignore */ }
  }

  // --- Add to Queue (as next song) ---

  function addToQueuePayload(videoId) {
    return { videoId, insertPosition: 'INSERT_AFTER_CURRENT_VIDEO' };
  }

  function parseVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtube.com') || u.hostname.includes('music.youtube.com')) {
        return u.searchParams.get('v');
      }
      if (u.hostname === 'youtu.be') {
        return u.pathname.slice(1).split('/')[0] || null;
      }
    } catch { /* not a valid URL */ }
    if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) return url.trim();
    return null;
  }

  var urlPlaceholderTimer = null;
  function showUrlPlaceholder(msg, isError) {
    clearTimeout(urlPlaceholderTimer);
    els.urlInput.value = '';
    els.urlInput.placeholder = msg;
    els.urlInput.classList.remove('placeholder-success', 'placeholder-error');
    els.urlInput.classList.add(isError ? 'placeholder-error' : 'placeholder-success');
    urlPlaceholderTimer = setTimeout(function () {
      els.urlInput.placeholder = 'YouTube or YT Music link...';
      els.urlInput.classList.remove('placeholder-success', 'placeholder-error');
    }, 3000);
  }

  els.btnAddUrl.addEventListener('click', addByUrl);
  els.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addByUrl();
  });

  async function addByUrl() {
    const raw = els.urlInput.value.trim();
    if (!raw) return;

    const videoId = parseVideoId(raw);
    if (!videoId) {
      showUrlPlaceholder('Invalid YouTube URL', true);
      return;
    }

    els.btnAddUrl.disabled = true;
    try {
      const res = await fetch('/api/v1/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addToQueuePayload(videoId)),
      });
      if (res.ok || res.status === 204) {
        showUrlPlaceholder('Added as next song');
        invalidateQueueCache();
        await new Promise(function (r) { setTimeout(r, 500); });
        await fetchQueue();
      } else {
        showUrlPlaceholder('Failed to add', true);
      }
    } catch {
      showUrlPlaceholder('Connection error', true);
    } finally {
      els.btnAddUrl.disabled = false;
    }
  }

  // --- Search ---

  els.btnSearch.addEventListener('click', doSearch);
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  async function doSearch() {
    const query = els.searchInput.value.trim();
    if (!query) return;

    els.btnSearch.disabled = true;
    els.searchResults.innerHTML = '<div class="search-loading">Searching...</div>';

    try {
      const res = await fetch('/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        els.searchResults.innerHTML = '<div class="search-loading">Search failed</div>';
        return;
      }

      const data = await res.json();
      renderSearchResults(data);
    } catch (err) {
      console.error('[pear-webmgr] Search error:', err);
      els.searchResults.innerHTML = '<div class="search-loading">Connection error</div>';
    } finally {
      els.btnSearch.disabled = false;
    }
  }

  function renderSearchResults(data) {
    const results = parseTrackList(data).slice(0, 20);
    if (results.length === 0) {
      els.searchResults.innerHTML = '<div class="search-loading">No results found</div>';
      return;
    }

    els.searchResults.innerHTML = results.map(item => {
      const thumb = item.thumbnail || '';
      return `
        <div class="search-item">
          <img class="search-item-thumb" src="${escapeHtml(thumb)}" alt="">
          <div class="search-item-info">
            <div class="search-item-title">${escapeHtml(item.title || 'Unknown')}</div>
            <div class="search-item-artist">${escapeHtml(item.artist || '')}</div>
          </div>
          <button class="search-item-add" data-video-id="${escapeHtml(item.videoId)}" title="Add as next song">+ Add</button>
        </div>`;
    }).join('');
  }

  els.searchResults.addEventListener('click', async (e) => {
    const btn = e.target.closest('.search-item-add');
    if (!btn) return;

    const videoId = btn.dataset.videoId;
    if (!videoId) return;

    btn.disabled = true;
    btn.textContent = '...';
    try {
      const res = await fetch('/api/v1/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addToQueuePayload(videoId)),
      });
      btn.textContent = (res.ok || res.status === 204) ? 'Added' : 'Error';
      invalidateQueueCache();
      await new Promise(function (r) { setTimeout(r, 500); });
      await fetchQueue();
    } catch {
      btn.textContent = 'Error';
    }
    setTimeout(() => {
      btn.textContent = '+ Add';
      btn.disabled = false;
    }, 2000);
  });

  // --- Sync sidebar height to player height ---

  var panelPlayer = document.querySelector('.panel-player');
  var panelSidebar = document.querySelector('.panel-sidebar');

  function syncSidebarHeight() {
    panelSidebar.style.height = panelPlayer.offsetHeight + 'px';
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncSidebarHeight).observe(panelPlayer);
  } else {
    syncSidebarHeight();
    window.addEventListener('resize', syncSidebarHeight);
  }

  // --- Init ---

  pollSong();
  pollVolume();
  fetchQueue();
  setInterval(pollSong, 2000);
  setInterval(pollVolume, 5000);
  queuePollTimer = setInterval(fetchQueue, 3000);
})();
