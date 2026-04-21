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
    progressBar: $('#progress-bar'),
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
    btnAddUrlNext: $('#btn-add-url-next'),
    btnAddUrlEnd: $('#btn-add-url-end'),
    searchInput: $('#search-input'),
    btnSearch: $('#btn-search'),
    searchResults: $('#search-results'),
    autoplayToggle: $('#autoplay-toggle'),
  };

  let currentVideoId = null;
  let currentSongTitle = '';
  let currentSongArtist = '';
  let currentSongDuration = 0;
  let currentElapsedSeconds = 0;
  let lastElapsedSampleAt = 0;
  let isSongPlaying = false;
  let volumeDebounce = null;
  let volumeUnlockTimer = null;
  let isUserDraggingVolume = false;
  let queuePollTimer = null;
  let currentQueueIndex = -1;
  let queueItemCount = 0;
  let activeTab = 'queue';
  let lastQueueFingerprint = '';
  let draggingQueueFromIndex = null;
  let dragJustHappenedAt = 0;
  let autoplayEnabled = false;
  let autoplayRunning = false;
  const VOLUME_CONTROL_ENABLED = true;

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

  function cachedImg(url) {
    if (!url) return '';
    return '/img-cache?url=' + encodeURIComponent(url);
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
        els.art.removeAttribute('src');
        els.noArt.classList.remove('hidden');
        els.progressFill.style.width = '0%';
        els.elapsed.textContent = '0:00';
        els.duration.textContent = '0:00';
        currentVideoId = null;
        currentSongTitle = '';
        currentSongArtist = '';
        currentSongDuration = 0;
        currentElapsedSeconds = 0;
        isSongPlaying = false;
        setPlayIcon(true);
        return;
      }

      const song = await res.json();
      els.title.textContent = song.title || '--';
      els.artist.textContent = song.artist || '--';

      if (song.imageSrc) {
        if (song.videoId !== currentVideoId) {
          els.art.src = cachedImg(song.imageSrc);
        }
        els.noArt.classList.add('hidden');
      } else {
        els.art.removeAttribute('src');
        els.noArt.classList.remove('hidden');
      }

      if (song.videoId !== currentVideoId) {
        // New song: reset elapsed tracking to whatever the server reported.
        currentElapsedSeconds = Number(song.elapsedSeconds) || 0;
      }

      currentVideoId = song.videoId;
      currentSongTitle = song.title || '';
      currentSongArtist = song.artist || '';
      currentSongDuration = Number(song.songDuration) || 0;
      isSongPlaying = song.isPaused === false;

      const serverElapsed = Number(song.elapsedSeconds) || 0;
      // Only accept the server sample when it's a real mid-song value.
      // pear-desktop often reports either 0 or the full duration, which would
      // snap the progress back and forth; ignore those and keep our local
      // counter ticking.
      var isSuspiciousSample =
        serverElapsed === 0 ||
        (currentSongDuration > 0 && serverElapsed >= currentSongDuration - 0.5);

      if (!isSuspiciousSample) {
        currentElapsedSeconds = serverElapsed;
      } else if (serverElapsed === 0 && !isSongPlaying && currentElapsedSeconds === 0) {
        currentElapsedSeconds = 0;
      }
      lastElapsedSampleAt = Date.now();

      renderProgress();
      setPlayIcon(!isSongPlaying);

      // Auto-play hook: if the queue is running out, try to keep it going.
      maybeTriggerAutoplay();
    } catch { /* silently retry next cycle */ }
  }

  function renderProgress() {
    const duration = currentSongDuration;
    const elapsed = Math.max(0, Math.min(currentElapsedSeconds, duration || currentElapsedSeconds));
    els.elapsed.textContent = formatTime(elapsed);
    els.duration.textContent = formatTime(duration);
    els.progressFill.style.width = duration > 0
      ? (elapsed / duration * 100) + '%'
      : '0%';
  }

  function tickLocalElapsed() {
    if (!isSongPlaying || !currentSongDuration) return;
    const now = Date.now();
    const delta = (now - lastElapsedSampleAt) / 1000;
    if (delta <= 0) return;
    lastElapsedSampleAt = now;
    currentElapsedSeconds = Math.min(currentSongDuration, currentElapsedSeconds + delta);
    renderProgress();
  }

  async function pollVolume() {
    if (!VOLUME_CONTROL_ENABLED) return;
    if (isUserDraggingVolume) return;
    try {
      const res = await fetch('/api/v1/volume');
      if (!res.ok) return;
      const data = await res.json();
      // pear-desktop falls back to {state:0, isMuted:false} when its volume
      // getter has no data yet. Ignore that sentinel so the slider doesn't
      // snap to 0; only apply 0 when the player is actually muted.
      if (data.state === 0 && !data.isMuted) return;
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

  if (VOLUME_CONTROL_ENABLED) {
    function sendVolume(target) {
      return fetch('/api/v1/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: target }),
      }).catch(() => {});
    }

    els.volumeSlider.addEventListener('pointerdown', () => { isUserDraggingVolume = true; });

    els.volumeSlider.addEventListener('input', () => {
      const target = Number(els.volumeSlider.value);
      els.volumeValue.textContent = target;
      // Mark "user dragging" so the background poll doesn't overwrite the UI
      // mid-interaction, even for keyboard / touch interactions that don't
      // emit pointerdown.
      isUserDraggingVolume = true;
      clearTimeout(volumeDebounce);
      volumeDebounce = setTimeout(() => sendVolume(target), 120);
    });

    els.volumeSlider.addEventListener('change', () => {
      const target = Number(els.volumeSlider.value);
      clearTimeout(volumeDebounce);
      sendVolume(target);
      // Hold the drag-lock long enough for the server to process the POST
      // before the next poll is allowed to overwrite the slider value.
      clearTimeout(volumeUnlockTimer);
      volumeUnlockTimer = setTimeout(() => { isUserDraggingVolume = false; }, 1500);
    });

    function endVolumeDrag() {
      // Release after a brief delay so any in-flight debounce commits before
      // the next pollVolume() is allowed to snap the slider.
      clearTimeout(volumeUnlockTimer);
      volumeUnlockTimer = setTimeout(() => { isUserDraggingVolume = false; }, 1500);
    }
    els.volumeSlider.addEventListener('pointerup', endVolumeDrag);
    els.volumeSlider.addEventListener('pointercancel', endVolumeDrag);
    els.volumeSlider.addEventListener('blur', endVolumeDrag);
  } else {
    // Soft-disable: keep current value visible, but block manual changes.
    els.volumeSlider.disabled = true;
    els.volumeSlider.title = 'Volume control temporarily disabled';
  }

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
    // Don't clobber the DOM while the user has a drag in flight — it would
    // cancel the drag and lose the drop target highlight.
    if (draggingQueueFromIndex !== null) return;
    try {
      const res = await fetch('/api/v1/queue');
      if (res.status === 204) {
        queueItemCount = 0;
        lastQueueFingerprint = '__empty__';
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
      queueItemCount = 0;
      if (lastQueueFingerprint !== '__empty__') {
        lastQueueFingerprint = '__empty__';
        els.queueList.innerHTML = '<div class="queue-empty">Queue is empty</div>';
      }
      return;
    }

    currentQueueIndex = resolveCurrentIndex(data, allItems);
    queueItemCount = allItems.length;

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

    // draggable="false" on interactive children prevents them from starting a
    // drag on the parent (otherwise a mousedown-click on the remove button
    // would kick off a drag and potentially fire a trailing click that wiped
    // the song out).
    els.queueList.innerHTML = visibleItems.map((item, vi) => {
      const originalIndex = startIdx + vi;
      const isActive = originalIndex === currentQueueIndex;
      const thumb = cachedImg(item.thumbnail);
      return `
        <div class="queue-item${isActive ? ' active' : ''}" data-index="${originalIndex}" draggable="true">
          <span class="queue-item-drag-handle" title="Drag to reorder" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path fill="currentColor" d="M8 4h2v2H8V4zm0 7h2v2H8v-2zm0 7h2v2H8v-2zm6-14h2v2h-2V4zm0 7h2v2h-2v-2zm0 7h2v2h-2v-2z"/>
            </svg>
          </span>
          <img class="queue-item-thumb" src="${escapeHtml(thumb)}" alt="" draggable="false">
          <div class="queue-item-info">
            <div class="queue-item-title">${escapeHtml(item.title || 'Unknown')}</div>
            <div class="queue-item-artist">${escapeHtml(item.artist || '')}</div>
          </div>
          <button class="queue-item-remove" data-index="${originalIndex}" data-video-id="${escapeHtml(item.videoId || '')}" title="Remove" draggable="false">
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
    // Any drag — successful, cancelled, or a "click that happened to start a
    // drag" — updates dragJustHappenedAt on dragend. Suppress clicks that fall
    // inside that window, because browsers may still dispatch a click on the
    // original mousedown target after an aborted drag, which used to fire the
    // remove button and delete the dragged song.
    if (Date.now() - dragJustHappenedAt < 400) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }

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

  function clearQueueDragUi() {
    document.querySelectorAll('.queue-item.dragging, .queue-item.drop-target').forEach(function (el) {
      el.classList.remove('dragging', 'drop-target');
    });
  }

  els.queueList.addEventListener('dragstart', (e) => {
    const queueItem = e.target.closest('.queue-item');
    if (!queueItem) {
      e.preventDefault();
      return;
    }
    // Don't initiate a drag when the gesture starts on the remove button.
    if (e.target.closest('.queue-item-remove')) {
      e.preventDefault();
      return;
    }
    draggingQueueFromIndex = Number(queueItem.dataset.index);
    queueItem.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(draggingQueueFromIndex)); } catch {}
    }
  });

  els.queueList.addEventListener('dragover', (e) => {
    if (draggingQueueFromIndex === null) return;
    const queueItem = e.target.closest('.queue-item');
    if (!queueItem) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    document.querySelectorAll('.queue-item.drop-target').forEach(function (el) {
      el.classList.remove('drop-target');
    });
    const targetIndex = Number(queueItem.dataset.index);
    if (targetIndex !== draggingQueueFromIndex) {
      queueItem.classList.add('drop-target');
    }
  });

  els.queueList.addEventListener('drop', async (e) => {
    // Always suppress the default drop behaviour and mark drag-just-happened,
    // even when fromIndex === toIndex, so the click that some browsers emit
    // after a drop can never reach the remove button handler.
    e.preventDefault();
    dragJustHappenedAt = Date.now();

    if (draggingQueueFromIndex === null) return;
    const queueItem = e.target.closest('.queue-item');
    clearQueueDragUi();
    if (!queueItem) {
      draggingQueueFromIndex = null;
      return;
    }

    const toIndex = Number(queueItem.dataset.index);
    const fromIndex = draggingQueueFromIndex;
    draggingQueueFromIndex = null;

    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex) || fromIndex === toIndex) return;
    await moveQueueItem(fromIndex, toIndex);
    // Refresh in case the click-suppression window was the only thing keeping
    // stale UI on screen.
    dragJustHappenedAt = Date.now();
  });

  els.queueList.addEventListener('dragend', () => {
    // dragend fires after successful drops AND cancelled drags. Recording the
    // timestamp here ensures the click suppression window kicks in for every
    // drag gesture, including ones that never fired a drop.
    dragJustHappenedAt = Date.now();
    draggingQueueFromIndex = null;
    clearQueueDragUi();
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

  async function moveQueueItem(fromIndex, toIndex) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex === toIndex) return;

    try {
      const res = await fetch('/api/v1/queue/' + fromIndex, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toIndex: toIndex }),
      });
      if (!res.ok && res.status !== 204) {
        console.warn('[pear-webmgr] Move failed:', res.status, await res.text().catch(() => ''));
      }
      invalidateQueueCache();
      // Give pear-desktop a moment to settle its queue state before we
      // re-render, otherwise we can observe an intermediate state that
      // briefly shows the moved song missing.
      await new Promise(function (r) { setTimeout(r, 600); });
      await fetchQueue();
    } catch (err) {
      console.error('[pear-webmgr] Move error:', err);
    }
  }

  // --- Add to Queue ---

  // pear-desktop's POST /api/v1/queue only accepts the enum insertPosition
  // values INSERT_AT_END / INSERT_AFTER_CURRENT_VIDEO (see AddSongToQueueSchema
  // in pear-desktop). A numeric index would fail validation, which previously
  // broke the "Add end" button silently.
  function addToQueuePayload(videoId, mode) {
    return {
      videoId,
      insertPosition: mode === 'end' ? 'INSERT_AT_END' : 'INSERT_AFTER_CURRENT_VIDEO',
    };
  }

  async function addTrackToQueue(videoId, mode) {
    const res = await fetch('/api/v1/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addToQueuePayload(videoId, mode)),
    });
    return res;
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

  els.btnAddUrlNext.addEventListener('click', () => addByUrl('next'));
  els.btnAddUrlEnd.addEventListener('click', () => addByUrl('end'));
  els.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addByUrl('next');
  });

  async function addByUrl(mode) {
    const raw = els.urlInput.value.trim();
    if (!raw) return;

    const videoId = parseVideoId(raw);
    if (!videoId) {
      showUrlPlaceholder('Invalid YouTube URL', true);
      return;
    }

    els.btnAddUrlNext.disabled = true;
    els.btnAddUrlEnd.disabled = true;
    try {
      const res = await addTrackToQueue(videoId, mode);
      if (res.ok || res.status === 204) {
        showUrlPlaceholder(mode === 'end' ? 'Added to queue end' : 'Added as next song');
        invalidateQueueCache();
        await new Promise(function (r) { setTimeout(r, 500); });
        await fetchQueue();
      } else {
        showUrlPlaceholder('Failed to add', true);
      }
    } catch {
      showUrlPlaceholder('Connection error', true);
    } finally {
      els.btnAddUrlNext.disabled = false;
      els.btnAddUrlEnd.disabled = false;
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
      const thumb = cachedImg(item.thumbnail);
      return `
        <div class="search-item">
          <img class="search-item-thumb" src="${escapeHtml(thumb)}" alt="">
          <div class="search-item-info">
            <div class="search-item-title">${escapeHtml(item.title || 'Unknown')}</div>
            <div class="search-item-artist">${escapeHtml(item.artist || '')}</div>
          </div>
          <div class="search-item-actions">
            <button class="search-item-add search-item-add-next" data-video-id="${escapeHtml(item.videoId)}" title="Add as next song">Add next</button>
            <button class="search-item-add search-item-add-end" data-video-id="${escapeHtml(item.videoId)}" title="Add to end of queue">Add end</button>
          </div>
        </div>`;
    }).join('');
  }

  els.searchResults.addEventListener('click', async (e) => {
    const btn = e.target.closest('.search-item-add-next, .search-item-add-end');
    if (!btn) return;

    const videoId = btn.dataset.videoId;
    if (!videoId) return;
    const isAddEnd = btn.classList.contains('search-item-add-end');

    btn.disabled = true;
    btn.textContent = '...';
    try {
      const res = await addTrackToQueue(videoId, isAddEnd ? 'end' : 'next');
      btn.textContent = (res.ok || res.status === 204) ? 'Added' : 'Error';
      invalidateQueueCache();
      await new Promise(function (r) { setTimeout(r, 500); });
      await fetchQueue();
    } catch {
      btn.textContent = 'Error';
    }
    setTimeout(() => {
      btn.textContent = isAddEnd ? 'Add end' : 'Add next';
      btn.disabled = false;
    }, 2000);
  });

  // --- Progress Bar Seek ---

  els.progressBar.addEventListener('click', async (e) => {
    if (!currentSongDuration || !currentVideoId) return;
    const rect = els.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seconds = Math.round(ratio * currentSongDuration);
    try {
      await fetch('/api/v1/seek-to', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds }),
      });
      // Update local state immediately so the bar doesn't snap back.
      currentElapsedSeconds = seconds;
      lastElapsedSampleAt = Date.now();
      renderProgress();
    } catch { /* ignore */ }
  });

  // --- Autoplay when queue is empty ---

  const AUTOPLAY_STORAGE_KEY = 'pear-webmgr.autoplay';
  try {
    autoplayEnabled = localStorage.getItem(AUTOPLAY_STORAGE_KEY) === '1';
  } catch { autoplayEnabled = false; }
  if (els.autoplayToggle) {
    els.autoplayToggle.checked = autoplayEnabled;
    els.autoplayToggle.addEventListener('change', () => {
      autoplayEnabled = els.autoplayToggle.checked;
      try { localStorage.setItem(AUTOPLAY_STORAGE_KEY, autoplayEnabled ? '1' : '0'); } catch {}
      if (autoplayEnabled) maybeTriggerAutoplay();
    });
  }

  async function maybeTriggerAutoplay() {
    if (!autoplayEnabled || autoplayRunning) return;
    // Only consider autoplay when a song is actually playing or loaded.
    if (!currentVideoId) return;

    // "Empty" here means: the currently playing song is the only thing left
    // (or there is literally nothing queued after it).
    const upcomingCount = queueItemCount - Math.max(0, currentQueueIndex) - 1;
    if (upcomingCount > 0) return;

    autoplayRunning = true;
    try {
      const query = (currentSongArtist || currentSongTitle || '').trim();
      if (!query) return;

      const res = await fetch('/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const results = parseTrackList(data);

      // Pick the first result that isn't the currently playing song to avoid
      // accidentally looping a single track.
      const pick = results.find(function (r) {
        return r.videoId && r.videoId !== currentVideoId;
      });
      if (!pick) return;

      await addTrackToQueue(pick.videoId, 'end');
      invalidateQueueCache();
      await new Promise(function (r) { setTimeout(r, 400); });
      await fetchQueue();
    } catch (err) {
      console.warn('[pear-webmgr] Autoplay failed:', err);
    } finally {
      autoplayRunning = false;
    }
  }

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
  setInterval(tickLocalElapsed, 500);
  queuePollTimer = setInterval(fetchQueue, 3000);
})();
