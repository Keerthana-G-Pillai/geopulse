/* ==========================================================================
   GeoPulse — Client-side Web APIs Application
   APIs Used: Fetch API, Web Speech API, LocalStorage API
   Data Source: RestCountries (https://restcountries.com/v3.1/all)
   ========================================================================== */

// ── Constants ────────────────────────────────────────────────────────────────
const API_PROXY_URL = '/api/v3.1/all?fields=name,capital,region,subregion,population,flags,languages,currencies,cca3,maps';
const API_LOCAL_URL = '/countries.json'; // fallback
const LS_FAV_KEY      = 'geopulse_favorites';
const LS_SETTINGS_KEY = 'geopulse_settings';

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  countries: [],
  filtered: [],
  favorites: [],          // array of cca3 strings
  settings: {
    theme: 'dark',
    voiceName: '',
    speechRate: 1.0,
    speechPitch: 1.0
  },
  speakingCca3: null
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function updateFavBadges() {
  const count = state.favorites.length;
  const label = `${count} Favourite${count === 1 ? '' : 's'}`;
  ['stat-favorites', 'stat-favorites-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-triangle' : 'info';
  toast.innerHTML = `<i data-lucide="${icon}"></i><span>${message}</span>`;
  container.appendChild(toast);
  lucide.createIcons();
  setTimeout(() => toast.classList.add('active'), 10);
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── LocalStorage API ──────────────────────────────────────────────────────────
const StorageController = {
  load() {
    try {
      const favs = localStorage.getItem(LS_FAV_KEY);
      state.favorites = favs ? JSON.parse(favs) : [];
    } catch { state.favorites = []; }

    try {
      const saved = localStorage.getItem(LS_SETTINGS_KEY);
      if (saved) state.settings = { ...state.settings, ...JSON.parse(saved) };
    } catch { /* keep defaults */ }
  },

  saveFavs() {
    try {
      localStorage.setItem(LS_FAV_KEY, JSON.stringify(state.favorites));
      updateFavBadges();
    } catch {
      showToast('Storage quota exceeded.', 'error');
    }
  },

  saveSettings() {
    try {
      localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(state.settings));
    } catch { /* silent */ }
  }
};

// ── Fetch API ─────────────────────────────────────────────────────────────────
const FetchController = {
  async fetchCountries() {
    // 1. Try Vite proxy → RestCountries live API
    try {
      const res  = await fetch(API_PROXY_URL);
      const text = await res.text();
      if (res.ok && !text.trim().startsWith('<')) {
        const data = JSON.parse(text);
        state.countries = data;
        state.filtered  = [...data];
        return data;
      }
    } catch (e) {
      console.warn('Live API unavailable, using local data.', e.message);
    }

    // 2. Fallback to bundled local JSON — always works offline
    try {
      const res  = await fetch(API_LOCAL_URL);
      const data = await res.json();
      state.countries = data;
      state.filtered  = [...data];
      return data;
    } catch (e) {
      console.error('Local JSON also failed:', e.message);
      throw e; // only throw if BOTH fail
    }
  }
};

// ── Web Speech API ────────────────────────────────────────────────────────────
const SpeechController = {
  synth: window.speechSynthesis,
  voices: [],

  init() {
    if (!this.synth) { showToast('Speech not supported in this browser.', 'error'); return; }
    this.loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this.loadVoices();
    }
    window.addEventListener('beforeunload', () => this.cancel());
  },

  loadVoices() {
    this.voices = this.synth.getVoices();
    const sel = document.getElementById('voice-select');
    if (!sel || !this.voices.length) return;
    const prev = sel.value || state.settings.voiceName;
    sel.innerHTML = '';
    this.voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})${v.localService ? ' [Local]' : ''}`;
      sel.appendChild(opt);
    });
    const target = this.voices.find(v => v.name === prev)
      || this.voices.find(v => v.lang.startsWith('en'))
      || this.voices[0];
    if (target) { sel.value = target.name; state.settings.voiceName = target.name; }
  },

  speak(country) {
    if (!this.synth) return;
    if (state.speakingCca3 === country.cca3) { this.cancel(); return; }
    this.cancel();

    const name       = country.name.common;
    const capital    = country.capital?.[0] ?? 'no official capital';
    const region     = country.region;
    const sub        = country.subregion ? `, in ${country.subregion}` : '';
    const pop        = country.population.toLocaleString();
    const langs      = country.languages ? Object.values(country.languages).join(', ') : 'none';
    const currencies = country.currencies ? Object.values(country.currencies).map(c => c.name).join(', ') : 'none';

    const text = `${name}, located in ${region}${sub}. Capital: ${capital}. Population: approximately ${pop}. Languages: ${langs}. Currency: ${currencies}.`;

    const utt = new SpeechSynthesisUtterance(text);
    const voice = this.voices.find(v => v.name === state.settings.voiceName);
    if (voice) utt.voice = voice;
    utt.rate  = parseFloat(state.settings.speechRate);
    utt.pitch = parseFloat(state.settings.speechPitch);

    utt.onstart = () => { state.speakingCca3 = country.cca3; updateSpeechUI(true, name); };
    utt.onend   = () => { state.speakingCca3 = null; updateSpeechUI(false); };
    utt.onerror = () => { state.speakingCca3 = null; updateSpeechUI(false); };

    this.synth.speak(utt);
  },

  cancel() {
    if (!this.synth) return;
    this.synth.cancel();
    state.speakingCca3 = null;
    updateSpeechUI(false);
  }
};

// ── UI Helpers ────────────────────────────────────────────────────────────────
function applySettingsUI() {
  document.documentElement.setAttribute('data-theme', state.settings.theme);
  document.getElementById('rate-range').value   = state.settings.speechRate;
  document.getElementById('rate-val').textContent = `${Number(state.settings.speechRate).toFixed(1)}x`;
  document.getElementById('pitch-range').value  = state.settings.speechPitch;
  document.getElementById('pitch-val').textContent = Number(state.settings.speechPitch).toFixed(1);
}

function updateSpeechUI(isSpeaking, name = '') {
  const label = isSpeaking ? `Narrating ${name}` : 'Speech Idle';
  ['narration-status', 'narration-status-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('speaking', isSpeaking);
  });
  ['speech-status-text', 'speech-status-text-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
  const btn = document.getElementById('speech-stop-btn');
  if (btn) btn.disabled = !isSpeaking;
  renderCards();
}

// ── Favorites ─────────────────────────────────────────────────────────────────
function toggleFavorite(cca3) {
  const country = state.countries.find(c => c.cca3 === cca3);
  if (!country) return;
  const idx = state.favorites.indexOf(cca3);
  if (idx === -1) {
    state.favorites.push(cca3);
    showToast(`Added ${country.name.common} to Favourites!`, 'success');
  } else {
    state.favorites.splice(idx, 1);
    showToast(`Removed ${country.name.common} from Favourites.`, 'info');
  }
  StorageController.saveFavs();
  renderFavShelf();
  renderCards();
}

window.toggleFav     = (cca3) => toggleFavorite(cca3);
window.speakCountry  = (cca3) => { const c = state.countries.find(x => x.cca3 === cca3); if (c) SpeechController.speak(c); };

// ── Render: Country Cards ─────────────────────────────────────────────────────
function renderCards() {
  const grid  = document.getElementById('countries-grid');
  const badge = document.getElementById('showing-count');
  if (!grid) return;

  if (state.filtered.length === 0) {
    grid.innerHTML = `
      <div class="loading-state">
        <i data-lucide="compass" style="width:48px;height:48px;stroke-width:1.5;color:var(--text-muted)"></i>
        <p>No countries match your search.</p>
      </div>`;
    if (badge) badge.textContent = '0 Countries';
    lucide.createIcons();
    return;
  }

  if (badge) badge.textContent = `${state.filtered.length} Countr${state.filtered.length === 1 ? 'y' : 'ies'}`;

  grid.innerHTML = state.filtered.map(country => {
    const isFav      = state.favorites.includes(country.cca3);
    const isSpeaking = state.speakingCca3 === country.cca3;
    const capital    = country.capital?.[0] ?? 'N/A';
    const pop        = country.population.toLocaleString();
    const flagSrc    = country.flags?.svg || country.flags?.png || '';
    const flagFallback = country.flags?.png || '';

    return `
      <div class="country-card ${isFav ? 'is-favorite' : ''}" data-id="${country.cca3}">
        <div class="card-flag-wrapper" onclick="openDetailsModal('${country.cca3}')">
          <img src="${flagSrc}" alt="Flag of ${country.name.common}" class="card-flag" loading="lazy"
               onerror="this.onerror=null;this.src='${flagFallback}'">
        </div>
        <button class="card-fav-btn" onclick="event.stopPropagation();window.toggleFav('${country.cca3}')"
                aria-label="${isFav ? 'Remove from' : 'Add to'} favourites">
          <i data-lucide="star"></i>
        </button>
        <div class="card-body" onclick="openDetailsModal('${country.cca3}')">
          <h3 class="card-title" title="${country.name.official}">${country.name.common}</h3>
          <div class="card-region">${country.region}</div>
          <div class="card-info-list">
            <div class="card-info-item"><span>Capital</span><span>${capital}</span></div>
            <div class="card-info-item"><span>Population</span><span>${pop}</span></div>
          </div>
        </div>
        <div class="card-footer">
          <button class="btn-card-action ${isSpeaking ? 'speaking-now' : ''}"
                  onclick="event.stopPropagation();window.speakCountry('${country.cca3}')">
            <i data-lucide="${isSpeaking ? 'square' : 'volume-2'}"></i>
            <span>${isSpeaking ? 'Stop' : 'Narrate'}</span>
          </button>
          <button class="btn-card-action" onclick="event.stopPropagation();openDetailsModal('${country.cca3}')">
            <i data-lucide="info"></i><span>Details</span>
          </button>
        </div>
      </div>`;
  }).join('');

  lucide.createIcons();
}

// ── Render: Favourites Shelf ──────────────────────────────────────────────────
function renderFavShelf() {
  const shelf = document.getElementById('favorites-shelf-list');
  if (!shelf) return;

  if (state.favorites.length === 0) {
    shelf.innerHTML = `
      <div class="empty-shelf">
        <i data-lucide="folder-heart"></i>
        <p>No favourites saved yet.</p>
      </div>`;
    lucide.createIcons();
    return;
  }

  shelf.innerHTML = state.favorites.map(cca3 => {
    const c = state.countries.find(x => x.cca3 === cca3);
    if (!c) return '';
    return `
      <div class="fav-shelf-item">
        <div class="fav-item-info" onclick="openDetailsModal('${c.cca3}')">
          <span class="fav-item-flag">${c.flags?.emoji || '🏳️'}</span>
          <span class="fav-item-name" title="${c.name.common}">${c.name.common}</span>
        </div>
        <button class="btn-shelf-action" onclick="window.toggleFav('${c.cca3}')" aria-label="Remove ${c.name.common}">
          <i data-lucide="trash-2" style="width:14px;height:14px"></i>
        </button>
      </div>`;
  }).join('');

  lucide.createIcons();
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
window.openDetailsModal = function(cca3) {
  const country = state.countries.find(c => c.cca3 === cca3);
  if (!country) return;
  const modal   = document.getElementById('detail-modal');
  const content = document.getElementById('modal-body-content');
  if (!modal || !content) return;

  const isFav      = state.favorites.includes(cca3);
  const isSpeaking = state.speakingCca3 === cca3;
  const capital    = country.capital?.[0] ?? 'N/A';
  const subregion  = country.subregion || 'N/A';
  const languages  = country.languages ? Object.values(country.languages).join(', ') : 'N/A';
  const currencies = country.currencies
    ? Object.values(country.currencies).map(c => `${c.name}${c.symbol ? ` (${c.symbol})` : ''}`).join(', ')
    : 'N/A';
  const flagSrc    = country.flags?.svg || country.flags?.png || '';
  const mapUrl     = country.maps?.openStreetMaps || '#';

  content.innerHTML = `
    <div class="modal-hero">
      <img src="${flagSrc}" alt="Flag of ${country.name.common}"
           onerror="this.onerror=null;this.src='${country.flags?.png || ''}'">
      <div class="modal-hero-overlay">
        <div class="modal-hero-title">
          <h2>${country.name.common}</h2>
          <p>${country.name.official}</p>
        </div>
      </div>
    </div>
    <div class="modal-body">
      <div class="modal-section-title">Geography</div>
      <div class="modal-grid-stats">
        <div class="modal-stat-box">
          <i data-lucide="globe"></i>
          <div><div class="modal-stat-box-val">${country.region}</div><div class="modal-stat-box-lbl">Region</div></div>
        </div>
        <div class="modal-stat-box">
          <i data-lucide="map-pin"></i>
          <div><div class="modal-stat-box-val">${subregion}</div><div class="modal-stat-box-lbl">Subregion</div></div>
        </div>
      </div>
      <div class="modal-section-title">Demographics & Economy</div>
      <div class="modal-desc-list">
        <div class="modal-desc-row"><span>Capital</span><span>${capital}</span></div>
        <div class="modal-desc-row"><span>Population</span><span>${country.population.toLocaleString()}</span></div>
        <div class="modal-desc-row"><span>Languages</span><span>${languages}</span></div>
        <div class="modal-desc-row"><span>Currency</span><span>${currencies}</span></div>
        <div class="modal-desc-row"><span>Code</span><span><code>${country.cca3}</code></span></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-card-action ${isSpeaking ? 'speaking-now' : ''}"
                onclick="window.speakCountry('${cca3}')">
          <i data-lucide="${isSpeaking ? 'square' : 'volume-2'}"></i>
          <span>${isSpeaking ? 'Stop' : 'Narrate'}</span>
        </button>
        <button class="btn btn-card-action ${isFav ? 'speaking-now' : ''}"
                onclick="window.toggleFav('${cca3}')">
          <i data-lucide="star" ${isFav ? 'style="fill:var(--color-warning);stroke:var(--color-warning)"' : ''}></i>
          <span>${isFav ? 'Unfavourite' : 'Favourite'}</span>
        </button>
      </div>
      <a href="${mapUrl}" target="_blank" rel="noopener" class="btn btn-map-link">
        <i data-lucide="map"></i> View on OpenStreetMap
      </a>
    </div>`;

  modal.classList.add('active');
  lucide.createIcons();
};

function closeDetailsModal() {
  document.getElementById('detail-modal')?.classList.remove('active');
}

// ── Filter & Sort ─────────────────────────────────────────────────────────────
function filterAndSort() {
  const query  = document.getElementById('search-input').value.toLowerCase().trim();
  const region = document.getElementById('region-select').value;
  const sort   = document.getElementById('sort-select').value;

  state.filtered = state.countries.filter(c => {
    const matchSearch =
      !query ||
      c.name.common.toLowerCase().includes(query) ||
      c.name.official.toLowerCase().includes(query) ||
      (c.capital && c.capital.some(cap => cap.toLowerCase().includes(query)));
    const matchRegion = region === 'all' || c.region === region;
    return matchSearch && matchRegion;
  });

  state.filtered.sort((a, b) => {
    switch (sort) {
      case 'name-asc':  return a.name.common.localeCompare(b.name.common);
      case 'name-desc': return b.name.common.localeCompare(a.name.common);
      case 'pop-desc':  return b.population - a.population;
      case 'pop-asc':   return a.population - b.population;
      default: return 0;
    }
  });

  // Filter tag badge
  const tag = document.getElementById('filter-tag');
  if (tag) { tag.textContent = region; tag.classList.toggle('hidden', region === 'all'); }

  // Clear button
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.toggle('visible', query.length > 0);

  renderCards();
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
  // Mobile sidebar
  const sidebar        = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  function openSidebar()  { sidebar?.classList.add('open'); sidebarOverlay?.classList.add('active'); document.body.style.overflow = 'hidden'; }
  function closeSidebar() { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; }

  document.getElementById('sidebar-toggle')?.addEventListener('click', openSidebar);
  document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);
  sidebarOverlay?.addEventListener('click', closeSidebar);

  // About modal
  const aboutModal = document.getElementById('about-modal');
  document.getElementById('about-btn')?.addEventListener('click', () => aboutModal?.classList.add('active'));
  document.getElementById('about-modal-close')?.addEventListener('click', () => aboutModal?.classList.remove('active'));
  document.getElementById('about-backdrop')?.addEventListener('click', () => aboutModal?.classList.remove('active'));

  // Theme
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.settings.theme);
    StorageController.saveSettings();
    showToast(`Switched to ${state.settings.theme} theme.`, 'info');
  });

  // Search
  const searchInput = document.getElementById('search-input');
  searchInput?.addEventListener('input', filterAndSort);
  document.getElementById('search-clear')?.addEventListener('click', () => {
    if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    filterAndSort();
  });

  // Dropdowns
  document.getElementById('region-select')?.addEventListener('change', filterAndSort);
  document.getElementById('sort-select')?.addEventListener('change', filterAndSort);

  // Speech controls
  document.getElementById('voice-select')?.addEventListener('change', e => {
    state.settings.voiceName = e.target.value;
    StorageController.saveSettings();
  });

  const rateRange = document.getElementById('rate-range');
  const rateVal   = document.getElementById('rate-val');
  rateRange?.addEventListener('input', () => {
    state.settings.speechRate = parseFloat(rateRange.value);
    if (rateVal) rateVal.textContent = `${Number(state.settings.speechRate).toFixed(1)}x`;
    StorageController.saveSettings();
  });

  const pitchRange = document.getElementById('pitch-range');
  const pitchVal   = document.getElementById('pitch-val');
  pitchRange?.addEventListener('input', () => {
    state.settings.speechPitch = parseFloat(pitchRange.value);
    if (pitchVal) pitchVal.textContent = Number(state.settings.speechPitch).toFixed(1);
    StorageController.saveSettings();
  });

  document.getElementById('speech-stop-btn')?.addEventListener('click', () => {
    SpeechController.cancel();
    showToast('Narration stopped.', 'info');
  });

  // Detail modal close
  document.getElementById('modal-close')?.addEventListener('click', closeDetailsModal);
  document.getElementById('modal-backdrop')?.addEventListener('click', closeDetailsModal);

  // ESC closes everything
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeDetailsModal();
    aboutModal?.classList.remove('active');
    closeSidebar();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initApp() {
  StorageController.load();
  applySettingsUI();
  updateFavBadges();
  renderFavShelf();
  SpeechController.init();
  setupEventListeners();

  try {
    await FetchController.fetchCountries();
    filterAndSort();
    showToast(`Loaded ${state.countries.length} countries.`, 'success');
  } catch (err) {
    console.error('fetchCountries failed completely:', err);
    const grid = document.getElementById('countries-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="loading-state">
          <i data-lucide="wifi-off" style="width:48px;height:48px;stroke-width:1.5;color:var(--color-danger)"></i>
          <p>Could not load country data.<br><small style="color:var(--text-muted)">${err.message}</small></p>
          <button class="btn" style="margin-top:12px;background:var(--color-primary);color:#fff"
                  onclick="location.reload()">Retry</button>
        </div>`;
      lucide.createIcons();
    }
    showToast('Failed to load data. Please retry.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', initApp);
