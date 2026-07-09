/* ==========================================================================
   GeoPulse JavaScript Controller - Fetch, Speech & LocalStorage Web APIs
   ========================================================================== */

// --- Constants & Config ---
const API_URL = '/countries.json';
const LOCAL_STORAGE_FAV_KEY = 'geopulse_favorites';
const LOCAL_STORAGE_SETTINGS_KEY = 'geopulse_settings';

// --- State Management ---
let state = {
  countries: [],
  filteredCountries: [],
  favorites: [],
  settings: {
    theme: 'dark',
    voiceName: '',
    speechRate: 1.0,
    speechPitch: 1.0
  },
  speakingCountryCca3: null, // Tracks currently narrating country
  activeUtterance: null
};

// --- Web Speech API Controller ---
const SpeechController = {
  synth: window.speechSynthesis,
  voices: [],

  init() {
    if (!this.synth) {
      console.warn('Web Speech API is not supported in this browser.');
      showToast('Speech synthesis not supported in this browser', 'error');
      return;
    }

    // Populate voices. Chrome & others load voices asynchronously.
    this.populateVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this.populateVoices();
    }

    // Handle page unload to cancel any running narration
    window.addEventListener('beforeunload', () => {
      this.cancel();
    });
  },

  populateVoices() {
    this.voices = this.synth.getVoices();
    const voiceSelect = document.getElementById('voice-select');
    if (!voiceSelect) return;

    // Save previous selection if any
    const previousSelection = voiceSelect.value || state.settings.voiceName;

    voiceSelect.innerHTML = '';

    // Filter to popular language voices or list all
    this.voices.forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.name;
      option.textContent = `${voice.name} (${voice.lang})`;
      
      if (voice.localService) {
        option.textContent += ' [Local]';
      }
      
      voiceSelect.appendChild(option);
    });

    // Restore selection
    if (previousSelection && this.voices.some(v => v.name === previousSelection)) {
      voiceSelect.value = previousSelection;
      state.settings.voiceName = previousSelection;
    } else if (this.voices.length > 0) {
      // Default to English or first voice
      const defaultVoice = this.voices.find(v => v.lang.startsWith('en')) || this.voices[0];
      voiceSelect.value = defaultVoice.name;
      state.settings.voiceName = defaultVoice.name;
    }
  },

  speak(country) {
    if (!this.synth) return;

    // If currently speaking this exact country, toggle cancel
    if (state.speakingCountryCca3 === country.cca3) {
      this.cancel();
      return;
    }

    // Cancel any current narration first
    this.cancel();

    // Prepare speech text
    const countryName = country.name.common;
    const capital = country.capital && country.capital.length > 0 ? country.capital[0] : 'no official capital';
    const region = country.region;
    const subregion = country.subregion ? `, in the subregion of ${country.subregion}` : '';
    const population = country.population.toLocaleString();
    
    // Languages extraction
    const languages = country.languages 
      ? Object.values(country.languages).join(', ') 
      : 'no official languages registered';

    // Currencies extraction
    const currencies = country.currencies
      ? Object.values(country.currencies).map(c => c.name).join(', ')
      : 'no official currency';

    const speechText = `${countryName}, located in ${region}${subregion}. The capital is ${capital}. It has a population of approximately ${population} people. The primary languages spoken are ${languages}, and the official currency is the ${currencies}.`;

    const utterance = new SpeechSynthesisUtterance(speechText);
    
    // Find selected voice
    if (state.settings.voiceName) {
      const selectedVoice = this.voices.find(v => v.name === state.settings.voiceName);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
    }

    // Set speed and pitch
    utterance.rate = parseFloat(state.settings.speechRate);
    utterance.pitch = parseFloat(state.settings.speechPitch);

    // Event Bindings
    utterance.onstart = () => {
      state.speakingCountryCca3 = country.cca3;
      state.activeUtterance = utterance;
      updateSpeechUI(true, country.name.common);
    };

    utterance.onend = () => {
      if (state.speakingCountryCca3 === country.cca3) {
        state.speakingCountryCca3 = null;
        state.activeUtterance = null;
        updateSpeechUI(false);
      }
    };

    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event);
      if (state.speakingCountryCca3 === country.cca3) {
        state.speakingCountryCca3 = null;
        state.activeUtterance = null;
        updateSpeechUI(false);
      }
    };

    this.synth.speak(utterance);
  },

  cancel() {
    if (!this.synth) return;
    this.synth.cancel();
    state.speakingCountryCca3 = null;
    state.activeUtterance = null;
    updateSpeechUI(false);
  }
};

// --- LocalStorage API Controller ---
const StorageController = {
  loadState() {
    // Load Favorites
    try {
      const savedFavs = localStorage.getItem(LOCAL_STORAGE_FAV_KEY);
      state.favorites = savedFavs ? JSON.parse(savedFavs) : [];
    } catch (e) {
      console.error('Failed to load favorites from LocalStorage:', e);
      state.favorites = [];
    }

    // Load Settings
    try {
      const savedSettings = localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
      if (savedSettings) {
        state.settings = { ...state.settings, ...JSON.parse(savedSettings) };
      }
    } catch (e) {
      console.error('Failed to load settings from LocalStorage:', e);
    }
  },

  saveFavorites() {
    try {
      localStorage.setItem(LOCAL_STORAGE_FAV_KEY, JSON.stringify(state.favorites));
      document.getElementById('stat-favorites').textContent = `${state.favorites.length} Favorite${state.favorites.length === 1 ? '' : 's'}`;
    } catch (e) {
      console.error('Failed to write favorites to LocalStorage:', e);
      showToast('Storage quota exceeded. Unable to save favorites.', 'error');
    }
  },

  saveSettings() {
    try {
      localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (e) {
      console.error('Failed to write settings to LocalStorage:', e);
    }
  }
};

// --- Fetch API Controller ---
const FetchController = {
  async fetchCountries() {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      
      // Store in memory
      state.countries = data;
      state.filteredCountries = [...data];
      
      return data;
    } catch (error) {
      console.error('Failed to fetch country records:', error);
      throw error;
    }
  }
};

// --- UI Renderer & Logic ---

// Apply settings state to DOM elements
function applySettingsUI() {
  // Apply Theme
  document.documentElement.setAttribute('data-theme', state.settings.theme);

  // Set controls initial values
  document.getElementById('rate-range').value = state.settings.speechRate;
  document.getElementById('rate-val').textContent = `${state.settings.speechRate.toFixed(1)}x`;

  document.getElementById('pitch-range').value = state.settings.speechPitch;
  document.getElementById('pitch-val').textContent = state.settings.speechPitch.toFixed(1);
}

// Update the narration status bar and badges (desktop + mobile)
function updateSpeechUI(isSpeaking, countryName = '') {
  const desktopStatus = document.getElementById('narration-status');
  const mobileStatus = document.getElementById('narration-status-mobile');
  const desktopText = document.getElementById('speech-status-text');
  const mobileText = document.getElementById('speech-status-text-mobile');
  const stopButton = document.getElementById('speech-stop-btn');

  const label = isSpeaking ? `Narrating ${countryName}` : 'Speech Idle';

  [desktopStatus, mobileStatus].forEach(el => {
    if (!el) return;
    if (isSpeaking) { el.classList.add('speaking'); } else { el.classList.remove('speaking'); }
  });

  if (desktopText) desktopText.textContent = label;
  if (mobileText) mobileText.textContent = label;
  if (stopButton) {
    if (isSpeaking) { stopButton.removeAttribute('disabled'); } else { stopButton.setAttribute('disabled', 'true'); }
  }

  renderCountryCards();
}

// Show animated Toast Notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  // Determine icon
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'error') iconName = 'alert-triangle';

  toast.innerHTML = `
    <i data-lucide="${iconName}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  // Trigger animation
  setTimeout(() => toast.classList.add('active'), 10);

  // Remove toast after delay
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// Toggle favorites lists
function toggleFavorite(cca3) {
  const index = state.favorites.indexOf(cca3);
  const country = state.countries.find(c => c.cca3 === cca3);
  if (!country) return;

  if (index === -1) {
    state.favorites.push(cca3);
    showToast(`Added ${country.name.common} to Favorite Shelf!`, 'success');
  } else {
    state.favorites.splice(index, 1);
    showToast(`Removed ${country.name.common} from Favorite Shelf`, 'info');
  }

  StorageController.saveFavorites();
  // sync mobile favorites badge
  const mobileFavBadge = document.getElementById('stat-favorites-mobile');
  if (mobileFavBadge) {
    mobileFavBadge.textContent = `${state.favorites.length} Favorite${state.favorites.length === 1 ? '' : 's'}`;
  }
  renderFavoritesShelf();
  renderCountryCards();
}

// Render the country card list
function renderCountryCards() {
  const grid = document.getElementById('countries-grid');
  const countBadge = document.getElementById('showing-count');
  
  if (!grid) return;

  if (state.filteredCountries.length === 0) {
    grid.innerHTML = `
      <div class="loading-state">
        <i data-lucide="compass" style="width: 48px; height: 48px; stroke-width: 1.5; color: var(--text-muted);"></i>
        <p>No countries match your filter criteria.</p>
      </div>
    `;
    countBadge.textContent = '0 Countries';
    lucide.createIcons();
    return;
  }

  countBadge.textContent = `${state.filteredCountries.length} Country${state.filteredCountries.length === 1 ? '' : 'ies'}`;

  let cardsHTML = '';
  state.filteredCountries.forEach(country => {
    const isFav = state.favorites.includes(country.cca3);
    const isSpeaking = state.speakingCountryCca3 === country.cca3;
    const capital = country.capital && country.capital.length > 0 ? country.capital[0] : 'N/A';
    const population = country.population.toLocaleString();

    cardsHTML += `
      <div class="country-card ${isFav ? 'is-favorite' : ''}" data-id="${country.cca3}">
        <div class="card-flag-wrapper" onclick="openDetailsModal('${country.cca3}')">
          <img src="${country.flags.svg || country.flags.png}" alt="Flag of ${country.name.common}" class="card-flag" loading="lazy" onerror="this.onerror=null;this.src='${country.flags.png}'">
        </div>
        
        <button class="card-fav-btn" onclick="event.stopPropagation(); window.toggleFav('${country.cca3}')" aria-label="Favorite ${country.name.common}">
          <i data-lucide="star"></i>
        </button>

        <div class="card-body" onclick="openDetailsModal('${country.cca3}')">
          <h3 class="card-title" title="${country.name.official}">${country.name.common}</h3>
          <div class="card-region">${country.region}</div>
          
          <div class="card-info-list">
            <div class="card-info-item">
              <span>Capital:</span>
              <span>${capital}</span>
            </div>
            <div class="card-info-item">
              <span>Population:</span>
              <span>${population}</span>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <button class="btn-card-action ${isSpeaking ? 'speaking-now' : ''}" onclick="event.stopPropagation(); window.speakCountry('${country.cca3}')">
            <i data-lucide="${isSpeaking ? 'square' : 'volume-2'}"></i>
            <span>${isSpeaking ? 'Stop' : 'Narrate'}</span>
          </button>
          <button class="btn-card-action" onclick="event.stopPropagation(); openDetailsModal('${country.cca3}')">
            <i data-lucide="info"></i>
            <span>Details</span>
          </button>
        </div>
      </div>
    `;
  });

  grid.innerHTML = cardsHTML;
  lucide.createIcons();
}

// Render the Favorites Shelf
function renderFavoritesShelf() {
  const shelf = document.getElementById('favorites-shelf-list');
  if (!shelf) return;

  if (state.favorites.length === 0) {
    shelf.innerHTML = `
      <div class="empty-shelf">
        <i data-lucide="folder-heart"></i>
        <p>No favorites saved yet.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  let shelfHTML = '';
  state.favorites.forEach(cca3 => {
    const country = state.countries.find(c => c.cca3 === cca3);
    if (!country) return;

    shelfHTML += `
      <div class="fav-shelf-item">
        <div class="fav-item-info" onclick="openDetailsModal('${country.cca3}')">
          <span class="fav-item-flag">${country.flags.emoji || '🏳️'}</span>
          <span class="fav-item-name" title="${country.name.common}">${country.name.common}</span>
        </div>
        <button class="btn-shelf-action" onclick="window.toggleFav('${country.cca3}')" aria-label="Remove ${country.name.common}">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
      </div>
    `;
  });

  shelf.innerHTML = shelfHTML;
  lucide.createIcons();
}

// Open detailed country sheet modal
window.openDetailsModal = function(cca3) {
  const country = state.countries.find(c => c.cca3 === cca3);
  if (!country) return;

  const modal = document.getElementById('detail-modal');
  const modalContent = document.getElementById('modal-body-content');
  if (!modal || !modalContent) return;

  const isFav = state.favorites.includes(country.cca3);
  const isSpeaking = state.speakingCountryCca3 === country.cca3;
  const capital = country.capital && country.capital.length > 0 ? country.capital[0] : 'N/A';
  const population = country.population.toLocaleString();
  const subregion = country.subregion || 'N/A';
  const languages = country.languages ? Object.values(country.languages).join(', ') : 'N/A';
  
  // Currencies list formatting
  let currencyStr = 'N/A';
  if (country.currencies) {
    currencyStr = Object.values(country.currencies)
      .map(curr => `${curr.name} (${curr.symbol || ''})`)
      .join(', ');
  }

  modalContent.innerHTML = `
    <div class="modal-hero">
      <img src="${country.flags.svg || country.flags.png}" alt="Flag of ${country.name.common}">
      <div class="modal-hero-overlay">
        <div class="modal-hero-title">
          <h2>${country.name.common}</h2>
          <p>${country.name.official}</p>
        </div>
      </div>
    </div>
    
    <div class="modal-body">
      <div class="modal-section-title">Key Geography</div>
      <div class="modal-grid-stats">
        <div class="modal-stat-box">
          <i data-lucide="globe"></i>
          <div>
            <div class="modal-stat-box-val">${country.region}</div>
            <div class="modal-stat-box-lbl">Region</div>
          </div>
        </div>
        <div class="modal-stat-box">
          <i data-lucide="map-pin"></i>
          <div>
            <div class="modal-stat-box-val">${subregion}</div>
            <div class="modal-stat-box-lbl">Subregion</div>
          </div>
        </div>
      </div>

      <div class="modal-section-title">Demographics & Economy</div>
      <div class="modal-desc-list">
        <div class="modal-desc-row">
          <span>Capital City</span>
          <span>${capital}</span>
        </div>
        <div class="modal-desc-row">
          <span>Total Population</span>
          <span>${population}</span>
        </div>
        <div class="modal-desc-row">
          <span>Official Languages</span>
          <span>${languages}</span>
        </div>
        <div class="modal-desc-row">
          <span>Local Currency</span>
          <span>${currencyStr}</span>
        </div>
        <div class="modal-desc-row">
          <span>Alpha-3 Code</span>
          <span><code>${country.cca3}</code></span>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-card-action ${isSpeaking ? 'speaking-now' : ''}" onclick="window.speakCountry('${country.cca3}')">
          <i data-lucide="${isSpeaking ? 'square' : 'volume-2'}"></i>
          <span>${isSpeaking ? 'Stop Narration' : 'Narrate Facts'}</span>
        </button>
        
        <button class="btn btn-card-action ${isFav ? 'speaking-now' : ''}" onclick="window.toggleFav('${country.cca3}')">
          <i data-lucide="star" style="${isFav ? 'fill: var(--color-warning); stroke: var(--color-warning)' : ''}"></i>
          <span>${isFav ? 'Unfavorite' : 'Favorite'}</span>
        </button>
      </div>

      <div style="margin-top: 16px; text-align: center;">
        <a href="${country.maps.openStreetMaps}" target="_blank" rel="noopener" class="btn" style="text-decoration: none; display: inline-flex; width: 100%; border: 1px solid var(--border-color); background: transparent; color: var(--text-primary);">
          <i data-lucide="map"></i> View on OpenStreetMaps
        </a>
      </div>
    </div>
  `;

  modal.classList.add('active');
  lucide.createIcons();
};

// Close details modal
function closeDetailsModal() {
  const modal = document.getElementById('detail-modal');
  if (modal) {
    modal.classList.remove('active');
  }
}

// --- Global helper triggers (bound to window for onclick triggers) ---
window.toggleFav = (cca3) => {
  toggleFavorite(cca3);
};

window.speakCountry = (cca3) => {
  const country = state.countries.find(c => c.cca3 === cca3);
  if (country) {
    SpeechController.speak(country);
  }
};

// --- Filters, Searches & Sort logic ---
function filterAndSortCountries() {
  const searchInputVal = document.getElementById('search-input').value.toLowerCase().trim();
  const regionVal = document.getElementById('region-select').value;
  const sortVal = document.getElementById('sort-select').value;

  // Filter
  state.filteredCountries = state.countries.filter(country => {
    // Search filter (handles name & capital)
    const matchesSearch = 
      country.name.common.toLowerCase().includes(searchInputVal) || 
      country.name.official.toLowerCase().includes(searchInputVal) ||
      (country.capital && country.capital.some(cap => cap.toLowerCase().includes(searchInputVal)));

    // Region filter
    const matchesRegion = regionVal === 'all' || country.region === regionVal;

    return matchesSearch && matchesRegion;
  });

  // Sort
  state.filteredCountries.sort((a, b) => {
    if (sortVal === 'name-asc') {
      return a.name.common.localeCompare(b.name.common);
    } else if (sortVal === 'name-desc') {
      return b.name.common.localeCompare(a.name.common);
    } else if (sortVal === 'pop-desc') {
      return b.population - a.population;
    } else if (sortVal === 'pop-asc') {
      return a.population - b.population;
    }
    return 0;
  });

  // Update badge UI
  const filterTag = document.getElementById('filter-tag');
  if (regionVal !== 'all') {
    filterTag.textContent = regionVal;
    filterTag.classList.remove('hidden');
  } else {
    filterTag.classList.add('hidden');
  }

  // Update Search Clear Button visibility
  const searchClear = document.getElementById('search-clear');
  if (searchInputVal.length > 0) {
    searchClear.classList.add('visible');
  } else {
    searchClear.classList.remove('visible');
  }

  renderCountryCards();
}

// --- App Event Hookups ---
function setupEventListeners() {
  // Sidebar toggle (mobile)
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarClose = document.getElementById('sidebar-close');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (sidebarToggle) sidebarToggle.addEventListener('click', openSidebar);
  if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

  // About modal
  const aboutBtn = document.getElementById('about-btn');
  const aboutModal = document.getElementById('about-modal');
  const aboutBackdrop = document.getElementById('about-backdrop');
  const aboutClose = document.getElementById('about-modal-close');

  function openAbout() { aboutModal.classList.add('active'); }
  function closeAbout() { aboutModal.classList.remove('active'); }

  if (aboutBtn) aboutBtn.addEventListener('click', openAbout);
  if (aboutClose) aboutClose.addEventListener('click', closeAbout);
  if (aboutBackdrop) aboutBackdrop.addEventListener('click', closeAbout);

  // Theme Toggle
  const themeToggle = document.getElementById('theme-toggle');
  themeToggle.addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.settings.theme);
    StorageController.saveSettings();
    showToast(`Switched to ${state.settings.theme} theme`, 'info');
  });

  // Search & Filter Events
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    filterAndSortCountries();
  });

  const searchClear = document.getElementById('search-clear');
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    filterAndSortCountries();
    searchInput.focus();
  });

  const regionSelect = document.getElementById('region-select');
  regionSelect.addEventListener('change', () => {
    filterAndSortCountries();
  });

  const sortSelect = document.getElementById('sort-select');
  sortSelect.addEventListener('change', () => {
    filterAndSortCountries();
  });

  // Speech Voice Select
  const voiceSelect = document.getElementById('voice-select');
  voiceSelect.addEventListener('change', () => {
    state.settings.voiceName = voiceSelect.value;
    StorageController.saveSettings();
  });

  // Speech Speed (Rate) Range
  const rateRange = document.getElementById('rate-range');
  const rateVal = document.getElementById('rate-val');
  rateRange.addEventListener('input', () => {
    const val = parseFloat(rateRange.value);
    state.settings.speechRate = val;
    rateVal.textContent = `${val.toFixed(1)}x`;
    StorageController.saveSettings();
  });

  // Speech Pitch Range
  const pitchRange = document.getElementById('pitch-range');
  const pitchVal = document.getElementById('pitch-val');
  pitchRange.addEventListener('input', () => {
    const val = parseFloat(pitchRange.value);
    state.settings.speechPitch = val;
    pitchVal.textContent = val.toFixed(1);
    StorageController.saveSettings();
  });

  // Speech Stop Button
  const stopButton = document.getElementById('speech-stop-btn');
  stopButton.addEventListener('click', () => {
    SpeechController.cancel();
    showToast('Speech synthesis canceled', 'info');
  });

  // Modal Closures
  const modalClose = document.getElementById('modal-close');
  modalClose.addEventListener('click', closeDetailsModal);

  const modalBackdrop = document.getElementById('modal-backdrop');
  modalBackdrop.addEventListener('click', closeDetailsModal);

  // ESC key modal closure
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDetailsModal();
      const aboutModal = document.getElementById('about-modal');
      if (aboutModal) aboutModal.classList.remove('active');
      const sidebar = document.getElementById('sidebar');
      const sidebarOverlay = document.getElementById('sidebar-overlay');
      if (sidebar) { sidebar.classList.remove('open'); document.body.style.overflow = ''; }
      if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    }
  });
}

// --- App Initialization ---
async function initApp() {
  // Load settings & favorites from localStorage
  StorageController.loadState();
  applySettingsUI();
  renderFavoritesShelf();

  // Configure Speech API
  SpeechController.init();

  // Listeners
  setupEventListeners();

  // Fetch Country Archive
  try {
    await FetchController.fetchCountries();
    filterAndSortCountries();
    showToast('Global country archive loaded successfully!', 'success');
  } catch (error) {
    const grid = document.getElementById('countries-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="loading-state">
          <i data-lucide="wifi-off" style="width: 48px; height: 48px; stroke-width: 1.5; color: var(--color-danger);"></i>
          <p>Failed to retrieve country archives. Check your connection.</p>
          <button class="btn" style="margin-top:10px; background:var(--color-primary); color:white;" onclick="window.location.reload()">Retry Connection</button>
        </div>
      `;
      lucide.createIcons();
    }
    showToast('API Connection failed. Please reload.', 'error');
  }
}

// Start Application on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});
