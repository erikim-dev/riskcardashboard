// Remove any legacy overlay elements on page load to guarantee no duplicates
    document.addEventListener('DOMContentLoaded', function() {
    // Remove various overlay elements that may have been injected previously,
    // including any rc-click-overlay rectangles (created by older wiring code).
    // Also remove any runtime-inserted inset/exact overlays that start with those ids.
    document.querySelectorAll('.engine-start-overlay, .engine-overlay-button, .partial-dim-overlay, .powered-off-overlay, .powered-off-start-button, .rc-click-overlay, #rc-click-overlays, [id^="rc-click-overlay-"], [id^="inset-overlay-"], [id^="exact-overlay-"]').forEach(el => el.remove());
    // After a short delay, (re)create overlays for all warning lights with larger padding
    // so the invisible hit areas cover the visible warning lights. This will re-apply
    // overlays if they were removed earlier in the page lifecycle.
    setTimeout(() => {
        try {
            if (window.dashboard && typeof window.dashboard.createOverlaysForAllWarningLights === 'function') {
                // clear any existing overlays just in case
                try { document.querySelectorAll('[id^="inset-overlay-"],[id^="exact-overlay-"]').forEach(el=>el.remove()); } catch(e){}
                window.dashboard.createOverlaysForAllWarningLights(16, 8);
            }
        } catch (e) {}
    }, 300);
    // On load, ensure the small '#last-updated' element remains available for data-driven updates
    // and start a separate live clock for the dashboard footer '#main-last-updated'.
    var lastUpdated = document.getElementById('last-updated');
    var mainLastUpdated = document.getElementById('main-last-updated');

    // Start a lightweight live ISO 8601 clock for the main dashboard footer.
    // This shows the current time (ISO 8601, UTC, without milliseconds) and updates every 30s.
    if (mainLastUpdated) {
        const tickMainClock = () => {
            // Use Intl.DateTimeFormat to get accurate Kenya time (Africa/Nairobi)
            // Format parts and build YYYY-MM-DD HH:MM
            try {
                const fmt = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Africa/Nairobi',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', hour12: false
                });
                const parts = fmt.formatToParts(new Date());
                const map = {};
                parts.forEach(p => { if (p.type && p.value) map[p.type] = p.value; });
                const Y = map.year || new Date().getFullYear();
                const M = map.month || '01';
                const D = map.day || '01';
                const h = map.hour || '00';
                const m = map.minute || '00';
                mainLastUpdated.textContent = `${Y}-${M}-${D} ${h}:${m}`;
            } catch (e) {
                // Fallback to manual UTC+3 calculation if Intl is not available
                const now = new Date();
                const kenyaOffsetMinutes = 3 * 60;
                const kenya = new Date(now.getTime() + (kenyaOffsetMinutes + now.getTimezoneOffset()) * 60000);
                const pad = (n) => String(n).padStart(2, '0');
                const Y = kenya.getUTCFullYear();
                const M = pad(kenya.getUTCMonth() + 1);
                const D = pad(kenya.getUTCDate());
                const h = pad(kenya.getUTCHours());
                const m = pad(kenya.getUTCMinutes());
                mainLastUpdated.textContent = `${Y}-${M}-${D} ${h}:${m}`;
            }
        };
        tickMainClock();
        // Refresh every 30 seconds
        setInterval(tickMainClock, 30 * 1000);
    }

    // Login overlay removed: no interactive sign-in required for this build
});
// Helper to build API URLs respecting runtime window.API_BASE (empty string => same-origin)
function apiBase(path) {
    try {
        const base = (typeof window !== 'undefined' && window.API_BASE) ? String(window.API_BASE).replace(/\/+$/, '') : '';
        if (!path) return base || '';
        if (base) return base + (path.startsWith('/') ? path : '/' + path);
        return path.startsWith('/') ? path : '/' + path;
    } catch (e) { return path; }
}
// Single consolidated RiskDashboard controller
class RiskDashboard {
    constructor() {
        this.data = null;
        this.lastDataHash = null;
        this.updateInterval = null;
        this.carDashboardSVG = null;
        this.stylesInjected = false;
        this.acknowledgedAlerts = new Set();
    // backups for service-panel content when blanking in-place
    this._serviceCardBackups = new WeakMap();
    // Engine start/stop state (default: off)
    this.engineActive = false;
    // Gauge hub center aligned to the artwork's round hub (kept constant)
    this.gaugeHubX = 535.38;
    this.gaugeHubY = 307.38;
    // RPM gauge hub (removed - RPM runtime support cleaned)
    // Fuel gauge hub (precise rotation center used by the fuel pointer)
    this.fuelHubX = 712.68;
    this.fuelHubY = 306.38;
    // Temperature gauge hub (matches temp-pointer added in SVG)
    this.tempHubX = 89.88;
    this.tempHubY = 307.22;

        this.controlItemMappings = {
            changeManagement: 'esp-control',
            controlEnvironment: 'engine-control',
            controlWeaknesses: 'temp-control',
            managementInfo: 'bulb-control',
            controlProcesses: 'abs-control',
            bcmResilience: 'srs-control',
            appetiteConsumption: 'fuel-control',
            capacity: 'oil-control',
            seatbelt: 'seatbelt-control'
        };

        this.defaultSvgElementMappings = {
            changeManagement: 'esp-warning-light',
            controlEnvironment: 'engine-warning-light',
            controlWeaknesses: 'temp-warning-light',
            managementInfo: 'bulb-warning-light',
            controlProcesses: 'abs-warning-light',
            bcmResilience: 'srs-warning-light',
            appetiteConsumption: 'fuel-warning-light',
            // optional indicator/headlight mappings (if present in SVG)
            leftIndicator: 'left-indicator-warning-light',
            rightIndicator: 'right-indicator-warning-light',
            headlight: 'headlight-warning-light',
            capacity: 'oil-warning-light'
        };

        // Common alias map for SVG ids that might exist in data files
        this.svgIdAliases = {
            'check-engine-warning-light': 'engine-warning-light'
        };

        this.init();
        // Ensure powered-off CSS is injected immediately, then apply power-state visuals
        try { this._injectPoweredOffNoHoverStyle(); } catch (e) {}
        // Apply power-state visuals immediately (synchronous) so powered-off view appears
        // instantly on page load/refresh without waiting for async init to finish.
        try { this.applyPowerState(); } catch (e) { /* ignore */ }
    }

    // Create an empty, blank service card pane matching the flipped element's size
    showBlankServiceCard() {
        try {
            // If already present, do nothing
            if (document.querySelector('.service-card-independent')) return;

            const target = document.querySelector('.control-environment') || document.querySelector('.car-dashboard-wrapper');
            if (!target) return;

            const rect = target.getBoundingClientRect();

            const pane = document.createElement('aside');
            pane.className = 'service-card-independent';
            pane.setAttribute('role', 'region');
            pane.setAttribute('aria-label', 'Service Card (blank)');
            pane.tabIndex = -1;

            // apply fixed viewport-aligned sizing so it matches the flipped face
            pane.style.position = 'fixed';
            pane.style.left = rect.left + 'px';
            pane.style.top = rect.top + 'px';
            pane.style.width = rect.width + 'px';
            pane.style.height = rect.height + 'px';
            pane.style.zIndex = '10000';
            pane.style.overflow = 'hidden';
            // Ensure the pane is visually empty and does not intercept pointer events
            pane.style.background = 'transparent';
            pane.style.border = 'none';
            pane.style.boxShadow = 'none';
            pane.style.pointerEvents = 'none';

            // inner container for any future content; leave empty for a clean page
            const inner = document.createElement('div');
            inner.className = 'service-card-independent-inner';
            inner.style.height = '100%';
            inner.style.overflow = 'auto';
            pane.appendChild(inner);

            document.body.appendChild(pane);

            // reposition on resize
            const reposition = () => {
                try {
                    const r = (document.querySelector('.control-environment') || document.querySelector('.car-dashboard-wrapper')).getBoundingClientRect();
                    pane.style.left = r.left + 'px'; pane.style.top = r.top + 'px'; pane.style.width = r.width + 'px'; pane.style.height = r.height + 'px';
                } catch (e) {}
            };
            window.addEventListener('resize', reposition);
            pane._repositionRef = reposition;

            requestAnimationFrame(() => { pane.classList.add('visible'); try { pane.focus(); } catch (e) {} });
        } catch (e) { console.warn('showBlankServiceCard failed', e); }
    }

    // Helper to run multiple functions with identical try/catch behavior
    _safeCalls(calls = []) {
        for (let i = 0; i < calls.length; i++) {
            const item = calls[i];
            try {
                if (typeof item === 'function') item();
                else if (Array.isArray(item) && typeof item[0] === 'function') item[0]();
            } catch (e) {
                try { if (Array.isArray(item) && item[1]) console.warn(item[1], e); } catch (e2) {}
            }
        }
    }

    // RPM APIs and runtime pointer removed: setRpmValue and related functions deleted.

    async init() {
        try {
            // Power-off startup removed: do not add `.powered-off` here so callers can
            // install their preferred partial dim later.
            await this.loadData();
            await this.loadCarDashboardSVG();
            // Note: keep any embedded `#speed-pointer` in the SVG so we can use the
            // original artwork. (Previous test flows removed it; end that behavior.)
            // Ensure the embedded pointer (if present) is visible and on top
            try {
                if (this.carDashboardSVG) {
                    const sp = this.carDashboardSVG.querySelector('#speed-pointer');
                    if (sp) {
                        // Move to end of SVG so it renders on top
                        const parent = sp.parentNode || this.carDashboardSVG;
                        parent.appendChild(sp);
                        // Ensure it's not hidden by style
                        sp.style.display = '';
                    }
                }
            } catch (e) { /* ignore */ }
            // Safety: ensure CSS cannot introduce transforms on the speed pointer
            try {
                if (!document.getElementById('speed-pointer-safety-style')) {
                    const st = document.createElement('style');
                    st.id = 'speed-pointer-safety-style';
                    // Do not override transform; only disable pointer-events and CSS transitions
                    st.textContent = '#speed-pointer{pointer-events:none!important;transition:none!important;}';
                    document.head.appendChild(st);
                }
            } catch (e) { /* ignore */ }
            // Ensure key SVG numeric labels are white (override inline fills if necessary)
            try {
                const svg = this.carDashboardSVG;
                if (svg) {
                    const ids = ['percent-dynamic-value','rpm-value','speed-value','digital-display-text'];
                    ids.forEach(id => {
                        try { const n = svg.getElementById ? svg.getElementById(id) : svg.querySelector('#' + id); if (n) { n.setAttribute('fill', '#ffffff'); try { n.style.fill = '#ffffff'; } catch(e){} } } catch (e) {}
                    });
                }
            } catch (e) {}
            // Dimming/powered-off behavior removed: no global dim is applied by default.
            // Wire small auxiliary UI elements (service card) so they are interactive
            try { this.wireServiceCard(); } catch (e) { /* ignore */ }
                try { this.wirePercentHover(); } catch (e) { /* ignore */ }
                try { this.wireGaugeHover(); } catch (e) { /* ignore */ }
            // Inline dim application removed to allow external/alternate dim rules
            // try { this._applyInlineDim(); } catch (e) { /* ignore */ }
            this.attachFileLoader();
            // Attach the compact CSV uploader admin UI (posts to /api/update)
            try { this.attachCsvUploader(); } catch (e) { /* non-fatal */ }
            try { this.wireControlItemPopups(); } catch (e) { /* ignore */ }
            this.updateDashboard();
            // Start a dedicated data watcher that polls the JSON and updates the UI when it changes
            this.startDataWatcher();
            // Dev sliders and controls removed from runtime to avoid redundancy.
            // Previously there were several "speed-test" and "test-speed-slider" bindings here
            // for interactive development. Those have been intentionally removed so the
            // dashboard relies on `data/risk-data.json` and the single Start button.
            // Compute gauge calibration from artwork anchors, snap pointer to zero,
            // then load external data (but don't animate on load so the pointer
            // remains resting at zero until interaction).
            try { this.computeGaugeCalibrationFromRects(); } catch (e) {}
            try { this.snapPointersToZero(); } catch (e) {}
            // hide test UI by default (user requested resting pointer with test hidden)
            try {
                const dev = document.querySelector('.dev-controls'); if (dev) dev.style.display = 'none';
            } catch (e) {}
            try { this.loadRiskData(); } catch (e) {}

            // Wire the simple Start button added to index.html (toggles engine state)
            try {
                const startBtn = document.getElementById('engine-start-btn');
                if (startBtn) {
                    const updateLabel = () => {
                        try { startBtn.textContent = this.engineActive ? 'Stop' : 'Start'; } catch (e) {}
                        try { startBtn.setAttribute('aria-pressed', String(!!this.engineActive)); } catch (e) {}
                    };
                    updateLabel();
                    startBtn.addEventListener('click', (ev) => {
                        ev && ev.preventDefault && ev.preventDefault();
                        this.engineActive = !this.engineActive;
                        updateLabel();
                        try { this.applyPowerState(); } catch (e) {}
                    });
                }
            } catch (e) { /* non-fatal */ }

            // Ensure the current power state visuals are applied immediately on init
            try { this.applyPowerState(); } catch (e) { /* ignore */ }

            // Pause polling when the page is hidden to reduce CPU/timer noise, and
            // ensure the interval is cleared on unload to avoid leaks during debugging.
            try {
                document.addEventListener('visibilitychange', () => {
                    try {
                        if (document.hidden) {
                            if (this.updateInterval) { clearInterval(this.updateInterval); this.updateInterval = null; }
                        } else {
                            this.startRealTimeUpdates();
                        }
                    } catch (e) { console.warn('visibilitychange handler failed', e); }
                });
                window.addEventListener('beforeunload', () => { try { if (this.updateInterval) clearInterval(this.updateInterval); } catch (e) {} });
            } catch (e) { /* non-fatal */ }
        } catch (err) {
            console.error('Initialization failed', err);
            this.data = this.getDefaultData();
            this.updateDashboard();
            // Even on failure, ensure default powered-off state is applied
            try { this._injectPoweredOffNoHoverStyle(); this.applyPowerState(); } catch (e) { /* ignore */ }
        }
    }

    // Wire click handlers for control items to show inline drill-down panels
    wireControlItemPopups() {
        try {
            const data = this.data || {};
            
            // capture instance for inner closures
            const self = this;
            // Handler to close expanded items
            const closeExpandedItems = (excludeItem) => {
                document.querySelectorAll('.control-item.expanded').forEach(item => {
                    if (item !== excludeItem) {
                        const wrapper = item.querySelector('.control-inline-detail');
                        if (wrapper) wrapper.remove();
                        item.classList.remove('focused', 'expanded', 'control-open');
                        const container = item.closest('.control-items');
                        if (container) container.classList.remove('focused');
                        
                        // Reset the status indicator
                        const ind = item.querySelector('.status-indicator');
                        if (ind) {
                            ind.style.width = '';
                            ind.style.height = '';
                            ind.style.boxShadow = '';
                            // Restore original status if stored
                            const orig = item.getAttribute('data-status-original');
                            if (orig) {
                                item.setAttribute('data-status', orig);
                                item.removeAttribute('data-status-original');
                            }
                        }
                    }
                });
                // After closing expanded items, refresh the alert banner so the
                // top-right indicator returns to its default state if no critical
                // alerts remain or were acknowledged by the user actions above.
                try { if (typeof self.updateAlerts === 'function') self.updateAlerts(); } catch (e) {}
            };

            // Add document click listener for outside clicks
            document.addEventListener('click', (e) => {
                const clickedControlItem = e.target.closest('.control-item');
                if (!clickedControlItem) {
                    closeExpandedItems();
                }
            });

            document.querySelectorAll('.control-item').forEach(ci => {
                ci.classList.add('clickable');
                // remove any existing inline detail to avoid duplicates
                const existing = ci.querySelector('.control-inline-detail');
                if (existing) existing.remove();

                const renderDetail = () => {
                    // toggle panel
                        let wrapper = ci.querySelector('.control-inline-detail');
                        if (wrapper) {
                            // closing: remove detail and restore other items
                            try { wrapper.remove(); } catch (e) {}
                            try { ci.classList.remove('focused'); ci.classList.remove('expanded'); const container = ci.closest('.control-items'); if (container) container.classList.remove('focused'); } catch (e) {}
                            try { ci.focus(); } catch (e) {}
                            return;
                        }

                    const id = ci.id || 'control-' + (ci.dataset?.status || Math.random().toString(36).slice(2,8));
                    const name = ci.querySelector('.control-name')?.textContent || id;

                    // find record in data.controlDetails or try fallbacks
                    const normalizedId = id.replace(/[-_\s]+/g, '').toLowerCase();
                    const normalizedName = name.replace(/[-_\s]+/g, '').toLowerCase();
                    let record = null;
                    if (data.controlDetails) record = data.controlDetails[id] || data.controlDetails[normalizedId] || data.controlDetails[normalizedName] || null;
                    if (!record && data.controls) record = data.controls[id] || data.controls[normalizedId] || data.controls[normalizedName] || null;
                    // as last resort, synthesize minimal record from controlSystems/svgElementMappings
                    if (!record && data.controlSystems && data.svgElementMappings) {
                        const mapKey = Object.keys(data.svgElementMappings).find(k => {
                            const v = String(data.svgElementMappings[k] || '').toLowerCase();
                            return v.includes((id || '').toLowerCase()) || v.includes((normalizedName || '').toLowerCase());
                        });
                        if (mapKey) record = { measurement: mapKey, threshold: data.controlSystems[mapKey] || 'n/a', outcome: data.controlSystems[mapKey] || 'n/a' };
                    }

                    wrapper = document.createElement('div');
                    wrapper.className = 'control-inline-detail';
                    wrapper.setAttribute('role','region');
                    // make the inline detail more compact so content shifts up (tighter to header)
                    wrapper.style.marginTop = '0px';
                    wrapper.style.padding = '6px 6px 6px 6px';
                    wrapper.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))';
                    wrapper.style.border = '1px solid rgba(255,255,255,0.04)';
                    wrapper.style.borderRadius = '6px';

                    const grid = document.createElement('div');
                    grid.className = 'control-inline-grid';
                    grid.style.display = 'grid';
                    grid.style.gridTemplateColumns = '1fr';
                    // tighten gaps for a more compact panel
                    grid.style.gap = '2px';

                    const mkRow = (label, val, isOutcome=false) => {
                        const row = document.createElement('div');
                        row.style.display = 'flex';
                        row.style.width = '100%';
                        row.style.alignItems = 'center';
                        row.style.gap = '8px';
                        const l = document.createElement('div');
                        l.style.fontWeight = '700';
                        l.style.color = '#e6eef5';
                        l.style.flex = '1 1 auto';
                        l.textContent = label;
                        const v = document.createElement('div');
                        v.style.color = '#d0d0d0';
                        v.style.flex = '0 0 auto';
                        v.style.minWidth = '6ch';
                        v.style.textAlign = 'right';
                        v.textContent = val || '—';
                        if (isOutcome) {
                            const norm = String(val || '').toLowerCase();
                            let cls = 'outcome-green';
                            if (norm.includes('risk') || norm.includes('red')) cls = 'outcome-red';
                            else if (norm.includes('trigger') || norm.includes('amber') || norm.includes('warn')) cls = 'outcome-amber';
                            const dot = document.createElement('span'); dot.className = `outcome-dot ${cls}`;
                            // If this row is the Overall Outcome, tag the dot so we can style it larger
                            try { if (/overall\s*outcome/i.test(String(label || ''))) dot.classList.add('overall-outcome-dot'); } catch (e) {}
                            v.insertBefore(dot, v.firstChild);
                        }
                        row.appendChild(l); row.appendChild(v); return row;
                    };

                    // No special-case here: let the default record/table rendering handle control details.
                    let handledSpecial = false; // kept for compatibility with older logic; remains false

                    // Build an Overall Outcome row but don't append it yet; we'll append it last so it appears as the final line
                    let overallRow = null;
                    let overallValueForIndicator = null;
                    if (record) {
                        const overallValue = (function() {
                            if (typeof record['Overall Outcome'] !== 'undefined') return record['Overall Outcome'];
                            if (typeof record['overall outcome'] !== 'undefined') return record['overall outcome'];
                            if (typeof record.overallOutcome !== 'undefined') return record.overallOutcome;
                            if (typeof record.outcome !== 'undefined') return record.outcome;
                            if (typeof record.result !== 'undefined') return record.result;
                            if (typeof record.status !== 'undefined') return record.status;
                            return '—';
                        })();
                        overallValueForIndicator = overallValue;
                        overallRow = mkRow('Overall Outcome', overallValue, true);
                    }

                    // Optionally include a small details table if more keys exist
                    if (record && !handledSpecial && Object.keys(record).length > 3) {
                        const details = document.createElement('div'); details.style.marginTop = '8px';
                        const table = document.createElement('table'); table.style.width = '100%'; table.style.borderCollapse = 'collapse';
                        Object.entries(record).forEach(([k,v]) => {
                            const kn = String(k || '').trim().toLowerCase();
                            // skip keys already shown above and any 'overall outcome' variants
                            if (['measurement','threshold','outcome','key','limit','result','status'].includes(kn)) return; // already shown
                            if (kn.replace(/\s+/g,'') === 'overalloutcome') return; // avoid duplicate Overall Outcome
                            const tr = document.createElement('tr');
                            const td1 = document.createElement('td'); td1.style.padding = '6px 8px'; td1.style.fontWeight = '700'; td1.style.width = '40%'; td1.textContent = k;
                            const td2 = document.createElement('td'); td2.style.padding = '6px 8px';
                            // If the key indicates an outcome, prepend a small dot
                            const isOutcomeCell = /outcome$/i.test(String(k || '')) || /outcome/i.test(String(v || ''));
                            if (isOutcomeCell) {
                                const norm = String(v || '').toLowerCase();
                                let cls = 'outcome-green';
                                if (norm.includes('risk') || norm.includes('red')) cls = 'outcome-red';
                                else if (norm.includes('trigger') || norm.includes('amber') || norm.includes('warn')) cls = 'outcome-amber';
                                const dot = document.createElement('span'); dot.className = `outcome-dot ${cls}`;
                                td2.appendChild(dot);
                            }
                            td2.appendChild(document.createTextNode(String(v)));
                            tr.appendChild(td1); tr.appendChild(td2); table.appendChild(tr);
                        });
                        details.appendChild(table); wrapper.appendChild(details);
                        // append Overall Outcome as the final row if present
                        if (overallRow) grid.appendChild(overallRow);
                    }

                    // If there were no detail rows, append the Overall Outcome here so it is still last
                    if (!record || Object.keys(record).length <= 3) {
                        if (overallRow) grid.appendChild(overallRow);
                    }

                    // add grid content into wrapper
                    wrapper.appendChild(grid);

                    // add a small Back button so user can exit focus mode
                    try {
                        const closeBtn = document.createElement('button');
                        closeBtn.type = 'button';
                        closeBtn.className = 'control-inline-close';
                        closeBtn.textContent = 'Back';
                        // squeeze the Back button: smaller padding, font and tighter bottom spacing
                        closeBtn.style.padding = '3px 6px';
                        closeBtn.style.fontSize = '0.68rem';
                        closeBtn.style.borderRadius = '6px';
                        closeBtn.style.display = 'inline-block';
                        closeBtn.style.marginBottom = '4px';
                        closeBtn.style.lineHeight = '1';
                        // ensure the button is clickable even if global rules reduce cursor/pointer
                        closeBtn.style.cursor = 'pointer';
                        closeBtn.style.pointerEvents = 'auto';
                        closeBtn.style.position = 'relative';
                        // keep it above nearby overlays/animations
                        closeBtn.style.zIndex = '90';
                        closeBtn.addEventListener('click', () => {
                            try {
                                wrapper.remove();
                                ci.classList.remove('focused', 'expanded', 'control-open');
                                const container = ci.closest('.control-items');
                                if (container) container.classList.remove('focused');

                                // Reset the status indicator
                                const ind = ci.querySelector('.status-indicator');
                                if (ind) {
                                    ind.style.width = '';
                                    ind.style.height = '';
                                    ind.style.boxShadow = '';
                                    // Restore original status if stored
                                    const orig = ci.getAttribute('data-status-original');
                                    if (orig) {
                                        ci.setAttribute('data-status', orig);
                                        ci.removeAttribute('data-status-original');
                                    }
                                }
                                ci.focus();
                            } catch (e) {}
                        });
                        wrapper.insertBefore(closeBtn, wrapper.firstChild);
                    } catch (e) {}

                    // insert after the header inside the control item
                    const header = ci.querySelector('.control-header');
                    if (header && header.parentNode) header.parentNode.insertBefore(wrapper, header.nextSibling);
                    else ci.appendChild(wrapper);

                    // enable focus-mode & expansion: mark item and container so CSS hides siblings and animates expansion
                    try { ci.classList.add('focused'); ci.classList.add('expanded'); const container = ci.closest('.control-items'); if (container) container.classList.add('focused'); } catch (e) {}

                    // Close on Escape for keyboard users
                    const escHandler = (ev) => { 
                        if (ev.key === 'Escape') { 
                            try { 
                                wrapper.remove();
                                ci.classList.remove('focused', 'expanded', 'control-open');
                                const c = ci.closest('.control-items');
                                if (c) c.classList.remove('focused');
                                
                                // Reset the status indicator
                                const ind = ci.querySelector('.status-indicator');
                                if (ind) {
                                    ind.style.width = '';
                                    ind.style.height = '';
                                    ind.style.boxShadow = '';
                                    // Restore original status if stored
                                    const orig = ci.getAttribute('data-status-original');
                                    if (orig) {
                                        ci.setAttribute('data-status', orig);
                                        ci.removeAttribute('data-status-original');
                                    }
                                }
                                document.removeEventListener('keydown', escHandler);
                                ci.focus();
                            } catch (e) {} 
                        } 
                    };
                    document.addEventListener('keydown', escHandler);

                    // scroll into view slightly to reveal the panel
                    try { wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
                };

                ci.addEventListener('click', (ev) => {
                    // ensure clicks on child anchors/buttons don't double-toggle
                    if (ev.target && (ev.target.closest('a') || ev.target.closest('button'))) return;
                    ev.preventDefault && ev.preventDefault();
                    ev.stopPropagation(); // Prevent the document click handler from firing
                    // Before toggling, check whether the panel is already open
                    const existing = ci.querySelector('.control-inline-detail');
                    if (existing) {
                        // closing: restore indicator size / status
                        try {
                            ci.classList.remove('control-open');
                            const ind = ci.querySelector('.status-indicator');
                            if (ind) {
                                ind.style.width = '';
                                ind.style.height = '';
                                ind.style.boxShadow = '';
                                // restore data-status from data attribute if present
                                const orig = ci.getAttribute('data-status-original');
                                if (orig) ci.setAttribute('data-status', orig);
                            }
                        } catch (e) {}
                        renderDetail();
                        return;
                    }

                    // opening: enlarge indicator and set it to Overall Outcome
                    try {
                        // store original status if not already stored
                        if (!ci.getAttribute('data-status-original')) ci.setAttribute('data-status-original', ci.getAttribute('data-status') || '');
                        ci.classList.add('control-open');
                        const ind = ci.querySelector('.status-indicator');
                        if (ind) {
                            ind.style.width = '18px';
                            ind.style.height = '18px';
                            ind.style.boxShadow = 'var(--glow-blue)';
                            // map overallValueForIndicator to simplified data-status tag
                            if (overallValueForIndicator) {
                                const v = String(overallValueForIndicator).toLowerCase();
                                if (v.includes('risk') || v.includes('red')) ci.setAttribute('data-status', 'at-risk');
                                else if (v.includes('trigger') || v.includes('amber')) ci.setAttribute('data-status', 'at-trigger');
                                else ci.setAttribute('data-status', 'at-target');
                            }
                        }
                    } catch (e) { console.warn('Failed to enlarge indicator', e); }

                    renderDetail();
                });
            });
        } catch (e) { console.warn('wireControlItemPopups (inline) failed', e); }
    }

    // Make the service card clickable and keyboard-operable. Emits 'service-card-open' event.
    wireServiceCard() {
        try {
            const el = document.getElementById('service-card');
            if (!el) return;
            const ce = document.querySelector('.control-environment');
            if (!ce) return;

            // Remove any previously created modal overlay so the large window is not visible
            try { const existingOverlay = document.querySelector('.service-modal-overlay'); if (existingOverlay) existingOverlay.remove(); } catch (e) { /* ignore */ }

            // Do not auto-add blinking at startup; keep the action label visually steady by default.

            // Ensure the action label never causes layout jumps by measuring the widest label
            try {
                const actionEl = el.querySelector('.service-card-action');
                if (actionEl) {
                    const measureTextWidth = (text, refEl) => {
                        const span = document.createElement('span');
                        span.style.visibility = 'hidden';
                        span.style.position = 'absolute';
                        span.style.whiteSpace = 'nowrap';
                        try {
                            const cs = window.getComputedStyle(refEl);
                            span.style.fontFamily = cs.fontFamily;
                            span.style.fontSize = cs.fontSize;
                            span.style.fontWeight = cs.fontWeight;
                            span.style.letterSpacing = cs.letterSpacing;
                        } catch (e) {}
                        span.textContent = text;
                        document.body.appendChild(span);
                        const w = span.offsetWidth;
                        span.remove();
                        return w;
                    };
                    const w1 = measureTextWidth('Open Service Card Status', actionEl);
                    const w2 = measureTextWidth('Return to Main', actionEl);
                    const desired = Math.max(w1, w2) + 12; // padding buffer
                    // Apply a fixed min-width only on larger viewports where space is available.
                    // On small screens we want the label to shrink (CSS handles it via clamp()/flex).
                    try {
                        if (window.matchMedia && window.matchMedia('(min-width: 861px)').matches) {
                            actionEl.style.minWidth = desired + 'px';
                        } else {
                            // clear any previously-set minWidth so CSS can allow shrinking
                            actionEl.style.minWidth = '';
                        }
                    } catch (e) {
                        // fallback: if matchMedia isn't supported, set minWidth conservatively
                        actionEl.style.minWidth = desired + 'px';
                    }
                }
            } catch (e) { /* non-fatal measurement */ }

            const toggleServicePanel = (ev) => {
                if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
                // prefer explicit .service-panel if present, otherwise use the control-items container
                const panel = document.querySelector('.service-panel');
                const container = panel || document.querySelector('.control-items');
                // Toggle a flipped class on the control environment even if the panel DOM was removed.
                const isFlipped = ce.classList.toggle('flipped');

                // Update visibility/accessibility for the physical panel when present
                if (panel) {
                    panel.style.visibility = isFlipped ? 'visible' : 'hidden';
                    panel.style.opacity = isFlipped ? '1' : '0';
                    panel.setAttribute('aria-hidden', String(!isFlipped));
                }

                // update heading text when opened/closed
                const h = ce.querySelector('h4');
                if (h) {
                    if (!ce.dataset._originalTitle) ce.dataset._originalTitle = h.textContent || 'Control Environment Status';
                    h.textContent = isFlipped ? 'SERVICE CARD DETAILS' : (ce.dataset._originalTitle || 'Control Environment Status');
                }

                // Replace the action label in-place when flipped so the element's position and size remain stable.
                try {
                    const actionEl = el.querySelector('.service-card-action');
                    if (actionEl) {
                        if (isFlipped) {
                            // Turn the existing label into a return control (no DOM replacement to avoid layout jump)
                            actionEl.classList.add('service-card-return');
                            actionEl.textContent = 'Return to Main';
                            actionEl.setAttribute('role', 'button');
                            actionEl.setAttribute('aria-label', 'Return to Main');
                            actionEl.onclick = (e) => { e && e.stopPropagation && e.stopPropagation(); toggleServicePanel(e); };
                            // Stop blinking visually by adding the blink-stopped utility class and remove blinking class permanently
                            try { actionEl.classList.add('blink-stopped'); actionEl.classList.remove('blinking'); } catch (e) {}
                            try { actionEl.focus(); } catch (e) {}
                        } else {
                            // restore original label text and semantics
                            actionEl.classList.remove('service-card-return');
                            actionEl.textContent = 'Open Service Card Status';
                            actionEl.setAttribute('role', 'presentation');
                            actionEl.removeAttribute('aria-label');
                            // Remove both blink-stopped and blinking so it stays steady
                            try { actionEl.classList.remove('blink-stopped'); actionEl.classList.remove('blinking'); } catch (e) {}
                            actionEl.onclick = null;
                        }
                    }
                } catch (e) { /* ignore */ }

    // When opened (isFlipped true) ensure blinking is visually stopped by adding blink-stopped
    try { if (isFlipped) { const a = el.querySelector('.service-card-action'); if (a && a.classList && a.classList.contains('blinking')) a.classList.add('blink-stopped'); } } catch (e) {}

                // If a panel exists, focus first list item so keyboard users can see content
                try {
                    if (panel) {
                        const first = panel.querySelector('.service-list li');
                        if (first) first.focus();
                        const content = panel.querySelector('.service-panel-content');
                        if (content) content.scrollTop = 0;
                    }
                } catch (e) { /* ignore */ }

                // When flipped, blank the service-card area in-place; when unflipped, restore it.
                try {
                    if (isFlipped) {
                        try { this.blankServiceCardInPlace(container); } catch (ee) { /* ignore */ }
                    } else {
                        try { this.restoreServiceCardInPlace(container); } catch (ee) { /* ignore */ }
                    }
                } catch (e) { /* non-fatal */ }
            };

            // Close the flipped service card when clicking outside
            const outsideClickHandler = (ev) => {
                try {
                    const panelOpen = ce.classList.contains('flipped');
                    if (!panelOpen) return;
                    const target = ev.target;
                    // If click is inside the service-card or the flipped control-environment, ignore
                    if (!target) return;
                    if (el.contains(target) || ce.contains(target)) return;
                    // otherwise, unflip
                    toggleServicePanel(ev);
                } catch (e) { /* ignore */ }
            };
            document.addEventListener('click', outsideClickHandler);

            // Clicking the overall service card will toggle the flip. The inner return button stops propagation.
            el.addEventListener('click', (ev) => {
                toggleServicePanel(ev);
            });

            // Keyboard activation: Enter / Space toggles. Keep behavior but ensure blinking stays removed.
            el.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
                    ev.preventDefault();
                    toggleServicePanel();
                }
            });
            el.style.cursor = 'pointer';
        } catch (e) {
            console.error('wireServiceCard failed:', e);
        }
    }

    // Show a small data-driven tooltip when hovering the #percent-dynamic-value SVG text
    wirePercentHover() {
        try {
            const ensureStyle = () => {
                if (document.getElementById('srt-tooltip-style')) return;
                const css = `
                .srt-tooltip{position:fixed;z-index:12000;min-width:180px;max-width:320px;padding:8px 10px;background:rgba(10,14,20,0.95);color:#fff;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,0.5);font-family:Inter,system-ui,Arial,sans-serif;font-size:13px;line-height:1.2;opacity:0;visibility:hidden;transition:opacity 160ms ease,transform 160ms ease;transform:translateY(6px);pointer-events:none}
                .srt-tooltip.visible{opacity:1;visibility:visible;transform:translateY(0)}
                .srt-tooltip .srt-title{font-weight:400;margin-bottom:6px}
                .srt-tooltip .srt-list{margin:0;padding-left:18px}
                .srt-tooltip .srt-list li{font-style:italic;margin:3px 0}
                `;
                const st = document.createElement('style'); st.id = 'srt-tooltip-style'; st.textContent = css; document.head.appendChild(st);
            };
            ensureStyle();

            const svgRoot = this.carDashboardSVG;
            let el = null;
            if (svgRoot && typeof svgRoot.getElementById === 'function') el = svgRoot.getElementById('percent-dynamic-value') || svgRoot.querySelector('#percent-dynamic-value');
            if (!el) el = document.getElementById('percent-dynamic-value');
            if (!el) return;

            // create tooltip container
            let tip = document.getElementById('srt-tooltip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'srt-tooltip';
                tip.className = 'srt-tooltip';
                tip.setAttribute('role','dialog');
                tip.setAttribute('aria-hidden','true');
                document.body.appendChild(tip);
            }

            const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]);

            const populate = () => {
                const details = (this.data && this.data.srtDetails) ? this.data.srtDetails : { title: 'SRTS NOT AT-TARGET', items: ['Data Records and Management Risk','Technology Risk','Information Security Cyber Risk','Financial Crime'] };
                const title = escapeHtml(details.title || 'SRTS NOT AT-TARGET');
                const items = (details.items && details.items.length) ? details.items : [];
                const list = items.map(it => `<li>${escapeHtml(it)}</li>`).join('');
                tip.innerHTML = `<div class="srt-title">${title}</div><ul class="srt-list">${list}</ul>`;
            };

            const position = () => {
                try {
                    const r = el.getBoundingClientRect();
                    // ensure tooltip has content/layout measured
                    tip.classList.remove('visible'); tip.style.left = '-9999px'; tip.style.top = '-9999px';
                    populate();
                    const tr = tip.getBoundingClientRect();
                    // prefer above the element
                    let left = Math.round(r.left + (r.width / 2) - (tr.width / 2));
                    let top = Math.round(r.top - tr.height - 8);
                    if (top < 8) top = Math.round(r.bottom + 8);
                    if (left < 8) left = 8;
                    if (left + tr.width > window.innerWidth - 8) left = window.innerWidth - tr.width - 8;
                    tip.style.left = left + 'px'; tip.style.top = top + 'px';
                } catch (e) { /* ignore positioning errors */ }
            };

            let visible = false;
            const show = (ev) => {
                try {
                    populate();
                    position();
                    tip.classList.add('visible');
                    tip.setAttribute('aria-hidden','false');
                    visible = true;
                } catch (e) {}
            };
            const hide = () => {
                try { tip.classList.remove('visible'); tip.setAttribute('aria-hidden','true'); visible = false; } catch (e) {}
            };

            // wire events
            el.addEventListener('mouseenter', show);
            el.addEventListener('mousemove', position);
            el.addEventListener('mouseleave', hide);
            el.addEventListener('focus', show);
            el.addEventListener('blur', hide);

        } catch (e) { console.warn('wirePercentHover failed', e); }
    }

    // Show a small data-driven tooltip when hovering the #gauge-dynamic-value SVG text
    wireGaugeHover() {
        try {
            const ensureStyle = () => {
                if (document.getElementById('srt-tooltip-style')) return;
                const css = `
                .srt-tooltip{position:fixed;z-index:12000;min-width:180px;max-width:320px;padding:8px 10px;background:rgba(10,14,20,0.95);color:#fff;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,0.5);font-family:Inter,system-ui,Arial,sans-serif;font-size:13px;line-height:1.2;opacity:0;visibility:hidden;transition:opacity 160ms ease,transform 160ms ease;transform:translateY(6px);pointer-events:none}
                .srt-tooltip.visible{opacity:1;visibility:visible;transform:translateY(0)}
                .srt-tooltip .srt-title{font-weight:400;margin-bottom:6px}
                .srt-tooltip .srt-list{margin:0;padding-left:18px}
                .srt-tooltip .srt-list li{font-style:italic;margin:3px 0}
                `;
                const st = document.createElement('style'); st.id = 'srt-tooltip-style'; st.textContent = css; document.head.appendChild(st);
            };
            ensureStyle();

            const svgRoot = this.carDashboardSVG;
            let el = null;
            if (svgRoot && typeof svgRoot.getElementById === 'function') el = svgRoot.getElementById('gauge-dynamic-value') || svgRoot.querySelector('#gauge-dynamic-value');
            if (!el) el = document.getElementById('gauge-dynamic-value');
            if (!el) return;

            // create tooltip container
            let tip = document.getElementById('gauge-tooltip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'gauge-tooltip';
                tip.className = 'srt-tooltip';
                tip.setAttribute('role','dialog');
                tip.setAttribute('aria-hidden','true');
                document.body.appendChild(tip);
            }

            const escapeHtml = (s) => String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]);

            const populate = () => {
                const details = (this.data && this.data.gaugeSrtDetails) ? this.data.gaugeSrtDetails : { title: "SRTS With Unmeasured KRI's", items: ['Credit Risk','Legal Risk','Tax Risk'] };
                const title = escapeHtml(details.title || "SRTS With Unmeasured KRI's");
                const items = (details.items && details.items.length) ? details.items : [];
                const list = items.map(it => `<li>${escapeHtml(it)}</li>`).join('');
                tip.innerHTML = `<div class="srt-title">${title}</div><ul class="srt-list">${list}</ul>`;
            };

            const position = () => {
                try {
                    const r = el.getBoundingClientRect();
                    tip.classList.remove('visible'); tip.style.left = '-9999px'; tip.style.top = '-9999px';
                    populate();
                    const tr = tip.getBoundingClientRect();
                    let left = Math.round(r.left + (r.width / 2) - (tr.width / 2));
                    let top = Math.round(r.top - tr.height - 8);
                    if (top < 8) top = Math.round(r.bottom + 8);
                    if (left < 8) left = 8;
                    if (left + tr.width > window.innerWidth - 8) left = window.innerWidth - tr.width - 8;
                    tip.style.left = left + 'px'; tip.style.top = top + 'px';
                } catch (e) { /* ignore positioning errors */ }
            };

            const show = (ev) => { try { populate(); position(); tip.classList.add('visible'); tip.setAttribute('aria-hidden','false'); } catch (e) {} };
            const hide = () => { try { tip.classList.remove('visible'); tip.setAttribute('aria-hidden','true'); } catch (e) {} };

            el.addEventListener('mouseenter', show);
            el.addEventListener('mousemove', position);
            el.addEventListener('mouseleave', hide);
            el.addEventListener('focus', show);
            el.addEventListener('blur', hide);

        } catch (e) { console.warn('wireGaugeHover failed', e); }
    }

    // Special-case behavior for the brake warning light overlay:
    // - Click once: open the Service Card (flip) and animate the 'Governance' item smoothly
    // - Click twice: return to main (unflip)
    wireBrakeOverlayBehavior() {
        try {
            if (!this.carDashboardSVG) return;
            const svg = this.carDashboardSVG;
            const node = (typeof svg.getElementById === 'function') ? svg.getElementById('brake-warning-light') : svg.querySelector('#brake-warning-light');
            if (!node) return;

            // Ensure overlay exists (insert an inset overlay if not present)
            let overlay = null;
            try { overlay = node.querySelector('#inset-overlay-brake-warning-light') || node.querySelector('#exact-overlay-brake-warning-light'); } catch (e) { overlay = null; }
            if (!overlay) {
                try { overlay = this.createInsetRoundedOverlay && this.createInsetRoundedOverlay('brake-warning-light', 12, 6); } catch (e) { overlay = null; }
            }
            if (!overlay) {
                // as a fallback, attach to the group itself
                overlay = node;
            }

            // inject smooth governance pulse CSS if not present
            try {
                if (!document.getElementById('governance-pulse-style')) {
                    const css = `
                    @keyframes governancePulse { 0% { transform: scale(1); box-shadow: none; } 50% { transform: scale(1.08); box-shadow: 0 10px 26px rgba(0,0,0,0.28); } 100% { transform: scale(1); box-shadow: none; } }
                    .governance-anim { animation: governancePulse 900ms cubic-bezier(.2,.9,.2,1); transform-origin: center; }
                    `;
                    const st = document.createElement('style'); st.id = 'governance-pulse-style'; st.textContent = css; document.head.appendChild(st);
                }
            } catch (e) {}

            // Toggle state stored on dashboard instance
            if (typeof this._brakeOverlayOpen === 'undefined') this._brakeOverlayOpen = false;

            const handleClick = (ev) => {
                try {
                    ev && ev.stopPropagation && ev.stopPropagation();
                } catch (e) {}

                const svc = document.getElementById('service-card');
                const ce = document.querySelector('.control-environment');
                if (!svc || !ce) return;

                // If not open, open (click service card) and animate Governance
                if (!this._brakeOverlayOpen) {
                    try { svc.click(); } catch (e) { try { svc.dispatchEvent && svc.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (ee) {} }

                    // wait briefly for the flip & blank content insertion to occur
                    setTimeout(() => {
                        try {
                            // find governance list item in either blanked area or service panel
                            const candidates = Array.from(document.querySelectorAll('.service-card-blank-items li, .service-list li, .service-card-blank-items li'));
                            const gov = candidates.find(li => li && /governance/i.test((li.textContent||'').trim()));
                            if (gov) {
                                // add animation class and remove after animation finishes
                                try {
                                    gov.classList.remove('governance-anim');
                                    // force reflow then add class to restart animation
                                    void gov.offsetWidth;
                                    gov.classList.add('governance-anim');
                                    const cleanup = () => { try { gov.classList.remove('governance-anim'); gov.removeEventListener('animationend', cleanup); } catch (e) {} };
                                    gov.addEventListener('animationend', cleanup);
                                    // safety timeout
                                    setTimeout(cleanup, 1300);
                                } catch (e) {}
                            }
                        } catch (e) {}
                    }, 160);

                    this._brakeOverlayOpen = true;
                    return;
                }

                // Already open -> close (return to main)
                try { svc.click(); } catch (e) { try { svc.dispatchEvent && svc.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (ee) {} }
                this._brakeOverlayOpen = false;
            };

            // Attach handler. If overlay is a rect inside the group, attach to it; otherwise attach to group.
            try {
                if (overlay && overlay !== node) {
                    overlay.style.cursor = 'pointer';
                    try { overlay.onclick = handleClick; } catch (e) { overlay.addEventListener && overlay.addEventListener('click', handleClick); }
                } else {
                    try { node.onclick = handleClick; } catch (e) { try { node.addEventListener && node.addEventListener('click', handleClick); } catch (ee) {} }
                }
            } catch (e) {}

        } catch (e) { console.warn('wireBrakeOverlayBehavior failed', e); }
    }

    // Open a modal and load service-card.html into it (simple, reversible)
    async openServiceCardModal() {
        try {
            // Prevent duplicate overlays
            if (document.querySelector('.service-modal-overlay')) return;
            const resp = await fetch('./service-card.html?t=' + Date.now());
            const text = await resp.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const main = doc.querySelector('.service-card-page');
            if (!main) return;

            const overlay = document.createElement('div');
            overlay.className = 'service-modal-overlay';

            const modal = document.createElement('div');
            modal.className = 'service-modal';
            modal.tabIndex = -1;

            // Clone the content and append
            const clone = main.cloneNode(true);
            modal.appendChild(clone);

            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.textContent = 'Close';
            closeBtn.style.cssText = 'position:absolute;right:12px;top:12px;background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.06);padding:6px 10px;border-radius:6px;cursor:pointer';
            closeBtn.addEventListener('click', () => { overlay.remove(); });
            modal.appendChild(closeBtn);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // focus inside modal for accessibility
            setTimeout(() => { try { modal.focus(); } catch (e) {} }, 60);

            // allow closing overlay with Escape
            const esc = (ev) => { if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); } };
            document.addEventListener('keydown', esc);
        } catch (e) {
            console.warn('openServiceCardModal failed', e);
        }
    }

    // Create a fixed, independent service card pane (not modal) and populate it with a fully detached copy
    async showIndependentServiceCard() {
        try {
            // If already present, do nothing
            if (document.querySelector('.service-card-independent')) return;

            // Obtain source HTML: prefer fetching a standalone file, otherwise serialise an in-DOM .service-panel
            let sourceHtml = '';
            try {
                const res = await fetch('./service-card.html?t=' + Date.now());
                if (res && res.ok) {
                    sourceHtml = await res.text();
                }
            } catch (e) {
                // ignore fetch errors and fall back to in-DOM serialisation
            }

            if (!sourceHtml) {
                const sp = document.querySelector('.service-panel') || document.querySelector('.control-environment');
                if (sp) sourceHtml = sp.outerHTML || sp.innerHTML || '';
            }

            if (!sourceHtml) return;

            // Parse into a temporary container and sanitise thoroughly so the copy is fully detached
            const temp = document.createElement('div');
            temp.innerHTML = sourceHtml;

            try {
                // Remove potentially harmful or linking attributes and elements
                // Remove ids
                temp.querySelectorAll && Array.from(temp.querySelectorAll('[id]')).forEach(n => n.removeAttribute('id'));
                // Remove event attributes (onclick, oninput, etc.) and other referencing attributes
                temp.querySelectorAll && Array.from(temp.querySelectorAll('*')).forEach(node => {
                    // remove attributes that could reference the outer document
                    ['aria-controls', 'for', 'data-target', 'data-controls', 'name', 'role'].forEach(a => { if (node.hasAttribute && node.hasAttribute(a)) node.removeAttribute(a); });
                    // remove inline event handlers
                    Array.from(node.attributes || []).forEach(attr => {
                        if (!attr || !attr.name) return;
                        const n = attr.name.toLowerCase();
                        if (n.startsWith('on')) try { node.removeAttribute(attr.name); } catch (e) {}
                        if (n === 'href' && String(attr.value || '').startsWith('#')) try { node.setAttribute('href', 'javascript:void(0)'); } catch (e) {}
                    });
                });
                // Remove scripts and disable forms
                temp.querySelectorAll && Array.from(temp.querySelectorAll('script')).forEach(s => s.remove());
                temp.querySelectorAll && Array.from(temp.querySelectorAll('form')).forEach(f => { try { f.removeAttribute('action'); f.removeAttribute('name'); } catch (e) {} });
            } catch (e) { /* best-effort sanitise */ }

            // Build the independent pane from serialised HTML to avoid carrying live references
            const pane = document.createElement('aside');
            pane.className = 'service-card-independent';
            pane.setAttribute('role', 'region');
            pane.setAttribute('aria-label', 'Service Card Details');
            pane.tabIndex = -1;

            const close = document.createElement('button');
            close.className = 'service-card-independent-close';
            close.textContent = 'Close';
            close.addEventListener('click', () => { try { pane.remove(); } catch (e) {} });
            pane.appendChild(close);

            const innerWrap = document.createElement('div');
            innerWrap.className = 'service-card-independent-inner';
            innerWrap.innerHTML = temp.innerHTML;
            pane.appendChild(innerWrap);

            document.body.appendChild(pane);
            requestAnimationFrame(() => { pane.classList.add('visible'); try { pane.focus(); } catch (e) {} });
        } catch (e) {
            console.warn('showIndependentServiceCard failed', e);
        }
    }

    // Clear any service-card content from in-DOM panel, modal, or independent pane
    clearServiceCardWindow() {
        try {
            // Clear in-DOM .service-panel if present
            const sp = document.querySelector('.service-panel');
            if (sp) {
                // remove all children to create a clean slate
                while (sp.firstChild) sp.removeChild(sp.firstChild);
                // leave an accessible note that content was cleared
                sp.setAttribute('aria-hidden', 'true');
            }

            // Clear any modal content
            const modal = document.querySelector('.service-modal');
            if (modal) {
                modal.innerHTML = '';
            }

            // Clear independent pane inner content if present
            const pane = document.querySelector('.service-card-independent');
            if (pane) {
                const inner = pane.querySelector('.service-card-independent-inner');
                if (inner) inner.innerHTML = '';
                else pane.innerHTML = '';
            }
        } catch (e) { /* non-fatal */ }
    }

    // Backup and blank the in-DOM service panel area in-place (non-destructive)
    blankServiceCardInPlace(container) {
        try {
            if (!container) return;
            // If already backed up, do nothing
            if (this._serviceCardBackups.has(container)) return;
            // Create a DocumentFragment backup
            const frag = document.createDocumentFragment();
            while (container.firstChild) frag.appendChild(container.firstChild);
            // store aria-hidden and other attributes we may need to restore
            const attrs = {};
            if (container.hasAttribute && container.getAttributeNames) {
                container.getAttributeNames().forEach(n => { attrs[n] = container.getAttribute(n); });
            }
            this._serviceCardBackups.set(container, { frag, attrs });
            // set container to an empty, blank state
            container.innerHTML = '';
            try { container.setAttribute('aria-hidden', 'true'); } catch (e) {}

            // Insert the requested plain list of items just below the SERVICE CARD DETAILS heading
            try {
                const listWrap = document.createElement('div');
                listWrap.className = 'service-card-blank-list';
                listWrap.setAttribute('role', 'document');
                const ul = document.createElement('ul');
                ul.className = 'service-card-blank-items';
                const items = [
                    'Combined Assurance',
                    'DWBs',
                    'Policy Localization',
                    'Mandatory Training',
                    'RCA',
                    'Risk Control',
                    'Risk Reporting',
                    'Governance',
                    'Rewards'
                ];
                items.forEach(text => {
                    const li = document.createElement('li');
                    li.textContent = text;
                    ul.appendChild(li);
                });
                listWrap.appendChild(ul);
                container.appendChild(listWrap);
            } catch (e) { /* non-fatal; leave blank if insertion fails */ }
        } catch (e) { /* ignore */ }
    }

    // Restore previously backed-up service panel content
    restoreServiceCardInPlace(container) {
        try {
            if (!container) return;
            const data = this._serviceCardBackups.get(container);
            if (!data) return;
            // Clear any current children then re-append backup fragment
            while (container.firstChild) container.removeChild(container.firstChild);
            container.appendChild(data.frag);
            // restore attributes
            try {
                Object.entries(data.attrs || {}).forEach(([k, v]) => { try { container.setAttribute(k, v); } catch (e) {} });
            } catch (e) {}
            this._serviceCardBackups.delete(container);
            try { container.removeAttribute('aria-hidden'); } catch (e) {}
        } catch (e) { /* ignore */ }
    }

    hideIndependentServiceCard() {
        try {
            const pane = document.querySelector('.service-card-independent');
            if (!pane) return;
            pane.classList.remove('visible');
            setTimeout(() => { try { pane.remove(); } catch (e) {} }, 300);
        } catch (e) { /* ignore */ }
    }

    attachFileLoader() {
        const input = document.getElementById('data-file-input');
        if (!input) return;
        input.addEventListener('change', async (ev) => {
            const file = ev.target.files && ev.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const json = JSON.parse(text);
                this.data = json;
                this.lastDataHash = JSON.stringify(json);
                // trigger mapping validation and UI update
                if (this.carDashboardSVG) this.validateSvgMappings();
                this.updateDashboard();
                console.log('Loaded local data file into dashboard');
            } catch (e) {
                console.error('Failed to parse local data file', e);
            }
        });
    }

    // Compact in-page CSV uploader: posts multipart/form-data to /api/update
    attachCsvUploader() {
        try {
            // Only add once
            if (document.getElementById('csv-upload-widget')) return;

            // Create a tiny camouflaged floating button in the bottom-right corner
            const widget = document.createElement('div');
            widget.id = 'csv-upload-widget';
            widget.setAttribute('role', 'button');
            widget.setAttribute('tabindex', '0');
            widget.setAttribute('aria-label', 'Admin CSV upload');
            widget.title = 'Admin CSV upload (hidden)';
            // Minimal, low-contrast styling so it camouflages with the dashboard
            Object.assign(widget.style, {
                position: 'fixed',
                right: '12px',
                bottom: '12px',
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.03)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                color: 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                opacity: '0.95',
                border: '1px solid rgba(255,255,255,0.06)',
                transition: 'opacity 160ms ease, transform 160ms ease',
                zIndex: 12000,
                backdropFilter: 'blur(2px)'
            });

            // On hover/focus, make it visible enough to interact
            widget.addEventListener('mouseenter', () => { widget.style.opacity = '0.95'; widget.style.transform = 'scale(1.05)'; });
            // Keep visible for debugging — we'll revert after you confirm the widget is present
            widget.addEventListener('mouseleave', () => { widget.style.opacity = '0.95'; widget.style.transform = 'scale(1)'; });
            widget.addEventListener('focus', () => { widget.style.opacity = '0.95'; });
            widget.addEventListener('blur', () => { widget.style.opacity = '0.95'; });

            // Add a tiny upload icon (SVG) for clarity on hover — otherwise it's camouflaged
            widget.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                    <path d="M12 3v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M8 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M21 21H3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>`;

            // Hidden file input (visually hidden but in DOM for accessibility)
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.csv,text/csv';
            fileInput.id = 'csv-file-input-hidden';
            fileInput.style.position = 'absolute';
            fileInput.style.left = '-9999px';
            fileInput.setAttribute('aria-hidden', 'true');

            // Tiny ephemeral status tooltip element
            const tip = document.createElement('div');
            tip.id = 'csv-upload-tip';
            Object.assign(tip.style, {
                position: 'fixed',
                right: '50px',
                bottom: '18px',
                padding: '6px 8px',
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                fontSize: '11px',
                borderRadius: '6px',
                opacity: '0',
                transition: 'opacity 180ms ease',
                zIndex: 12000,
                pointerEvents: 'none'
            });
            document.body.appendChild(tip);

            // Append to body so it stays above other panels and is always reachable
            document.body.appendChild(widget);
            document.body.appendChild(fileInput);

            const showTip = (text) => {
                try { tip.textContent = text; tip.style.opacity = '1'; setTimeout(() => { tip.style.opacity = '0'; }, 3000); } catch (e) {}
            };

            const doUpload = async (file) => {
                if (!file) { showTip('No file'); return; }
                const fd = new FormData(); fd.append('file', file, file.name);
                widget.style.opacity = '0.6';
                try {
                    const res = await fetch(apiBase('/api/update'), { method: 'POST', body: fd });
                    if (!res.ok) {
                        let txt = '';
                        try { txt = await res.text(); } catch (e) {}
                        console.error('CSV upload failed', res.status, txt);
                        showTip('Upload failed');
                    } else {
                        const j = await res.json().catch(() => null);
                        if (j && j.data) {
                            this.data = j.data;
                            this.lastDataHash = JSON.stringify(this.data);
                            // derive fuel/temp quickly
                            try {
                                const rawNet = this.data && this.data.netLossValue;
                                if (typeof rawNet !== 'undefined' && rawNet !== null) {
                                    const m = String(rawNet).match(/([0-9]+(?:\.[0-9]+)?)\s*M/i);
                                    if (m) {
                                        const millions = parseFloat(m[1]);
                                        if (Number.isFinite(millions)) this.data.fuelValue = Math.max(0, Math.min(200, Math.round(millions)));
                                    }
                                }
                            } catch (e) {}
                            try {
                                const rawT = this.data && (typeof this.data.noOfMaterialIssues !== 'undefined' ? this.data.noOfMaterialIssues : this.data.dynamicValue287);
                                if (typeof rawT !== 'undefined' && rawT !== null) {
                                    const n = Number(String(rawT).toString().replace(/[^0-9.\-]/g, ''));
                                    if (Number.isFinite(n)) this.data.tempValue = Math.max(0, Math.min(25, Math.round(n)));
                                }
                            } catch (e) {}
                            try { if (this.carDashboardSVG) this.validateSvgMappings(); } catch (e) {}
                            try { this.updateDashboard(); } catch (e) {}
                        }
                        showTip((j && j.updated) ? 'Applied' : 'Uploaded');
                    }
                } catch (err) {
                    console.error('Upload error', err);
                    showTip('Upload error');
                } finally {
                    widget.style.opacity = '0.08';
                }
            };

            widget.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
            widget.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });

            fileInput.addEventListener('change', (ev) => {
                const f = ev.target.files && ev.target.files[0];
                if (f) doUpload(f);
                // clear value so the same file can be reselected later
                try { ev.target.value = ''; } catch (e) {}
            });

            // Respect reduced-visibility request: keep low opacity until hovered/focused
            widget.style.opacity = '0.08';

        } catch (e) { console.warn('attachCsvUploader failed', e); }
    }

    async loadData() {
        try {
            // Try live API first (short timeout). If API is unavailable, fall back to local data file.
            const fetchWithTimeout = (url, ms = 1500) => {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), ms);
                return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
            };

            let res = null;
            try {
                // Prefer API endpoint if present on the same host (respect runtime API_BASE)
                res = await fetchWithTimeout(apiBase('/api/data?t=' + Date.now()), 1200);
                if (!res || !res.ok) {
                    // fall back to local file below
                    res = null;
                }
            } catch (e) {
                // API unreachable or timed out; fall back to local file
                res = null;
            }

            if (!res) {
                res = await fetch(`./data/risk-data.json?t=${Date.now()}`);
            }
            let json;
            try {
                json = await res.json();
            } catch (parseErr) {
                console.error('risk-data.json parse failed, keeping previous data', parseErr);
                return false; // don't overwrite existing working data
            }
            const hash = JSON.stringify(json);
            if (hash !== this.lastDataHash) {
                // Allow shorthand mapping in controlSystems: if a value looks like an SVG id (e.g. 'fuel-warning-light'),
                // treat it as an svgElementMappings override and normalize the control status to 'at-target'.
                if (json && json.controlSystems) {
                    json.svgElementMappings = json.svgElementMappings || {};
                    Object.entries(json.controlSystems).forEach(([k, v]) => {
                        if (typeof v === 'string' && /warning-light/i.test(v)) {
                            // Accept forms: "fuel-warning-light", "fuel-warning-light|at-trigger", "fuel-warning-light:at-risk"
                            const parts = v.split(/[:|]/).map(p => p.trim()).filter(Boolean);
                            const idPart = parts[0];
                            const statusPart = parts[1];
                            // move id to mappings
                            json.svgElementMappings[k] = idPart;
                            // Preserve an existing status if present in previous data, or apply provided status.
                            // If no status provided and no previous status exists, default to 'at-trigger' (active)
                            if (statusPart) {
                                json.controlSystems[k] = statusPart;
                            } else if (this.data && this.data.controlSystems && this.data.controlSystems[k]) {
                                json.controlSystems[k] = this.data.controlSystems[k];
                            } else {
                                json.controlSystems[k] = 'at-trigger';
                                console.warn(`migrated mapping for '${k}' without status; defaulting '${k}' -> 'at-trigger'`);
                            }
                        }
                    });
                }
                this.data = json;
                this.lastDataHash = hash;
                    // Ensure derived numeric values are available for pointers when data comes from the watcher
                    try {
                        // Derive fuelValue from netLossValue if present (e.g. "79.80 M")
                        const rawNet = this.data && this.data.netLossValue;
                        if (typeof rawNet !== 'undefined' && rawNet !== null) {
                            const m = String(rawNet).match(/([0-9]+(?:\.[0-9]+)?)\s*M/i);
                            if (m) {
                                const millions = parseFloat(m[1]);
                                if (Number.isFinite(millions)) {
                                    this.data.fuelValue = Math.max(0, Math.min(200, Math.round(millions)));
                                    console.debug('Watcher: derived fuelValue from netLossValue', { millions, fuelValue: this.data.fuelValue });
                                }
                            }
                        }
                        // Derive tempValue from noOfMaterialIssues / dynamicValue287
                        const rawT = this.data && (typeof this.data.noOfMaterialIssues !== 'undefined' ? this.data.noOfMaterialIssues : this.data.dynamicValue287);
                        if (typeof rawT !== 'undefined' && rawT !== null) {
                            const n = Number(String(rawT).toString().replace(/[^0-9.\-]/g, ''));
                            if (Number.isFinite(n)) {
                                this.data.tempValue = Math.max(0, Math.min(25, Math.round(n)));
                                console.debug('Watcher: derived tempValue from dynamicValue287/noOfMaterialIssues', { rawT, tempValue: this.data.tempValue });
                            }
                        }
                    } catch (e) { /* non-fatal */ }
                // Update the small 'Last Updated' display only when the incoming JSON actually changed.
                try {
                    const el = document.getElementById('last-updated');
                    let display = '';
                    if (json && json.metadata && json.metadata.lastUpdated) {
                        const dt = new Date(json.metadata.lastUpdated);
                        if (!isNaN(dt)) {
                            const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const date = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
                            display = `${date} ${time}`;
                        }
                    }
                    if (!display) {
                        const now = new Date();
                        const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const date = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
                        display = `${date} ${time}`;
                    }
                    if (el) el.textContent = display;
                } catch (e) { /* non-fatal */ }
                // If incoming JSON contains netLossValue, use it to drive the fuel gauge (0..200, millions)
                try {
                    const rawNet = this.data && this.data.netLossValue;
                    if (typeof rawNet !== 'undefined' && rawNet !== null) {
                        // Parse value like "79.80 M" as millions
                        const m = String(rawNet).match(/([0-9]+(?:\.[0-9]+)?)\s*M/i);
                        if (m) {
                            const millions = parseFloat(m[1]);
                            if (Number.isFinite(millions)) {
                                // Map 0..200 fuelValue to 0..200M (or scale as needed)
                                // If you want a different scale, adjust below
                                this.data.fuelValue = Math.max(0, Math.min(200, Math.round(millions)));
                                console.debug('Derived fuelValue from netLossValue', { millions, fuelValue: this.data.fuelValue });
                            }
                        }
                    }
                } catch (e) { /* non-fatal */ }
                // If incoming JSON contains dynamicValue287 use it to drive temp pointer (0..20)
                try {
                    // Prefer new key 'noOfMaterialIssues' (user renamed dynamicValue287), fall back to legacy dynamicValue287
                    const rawT = this.data && (typeof this.data.noOfMaterialIssues !== 'undefined' ? this.data.noOfMaterialIssues : this.data.dynamicValue287);
                        if (typeof rawT !== 'undefined' && rawT !== null) {
                            const n = Number(String(rawT).toString().replace(/[^0-9.\-]/g, ''));
                            if (Number.isFinite(n)) {
                                // Map incoming dynamicValue287 into 0..25 range for temperature gauge
                                this.data.tempValue = Math.max(0, Math.min(25, Math.round(n)));
                                console.debug('Derived tempValue from dynamicValue287', { rawT, tempValue: this.data.tempValue });
                            }
                        }
                } catch (e) { /* non-fatal */ }
                // If the SVG is already loaded, re-validate mappings so runtime JSON changes take effect
                if (this.carDashboardSVG) {
                    try { this.validateSvgMappings(); } catch (e) { console.warn('validateSvgMappings failed', e); }
                }
                // Try to load optional gauge override from data/gauge.json and merge gaugeValue if present
                try {
                    const gres = await fetch(`./data/gauge.json?t=${Date.now()}`);
                    if (gres && gres.ok) {
                        const gjson = await gres.json();
                        if (gjson && typeof gjson.gaugeValue !== 'undefined') {
                            this.data.gaugeValue = Number(gjson.gaugeValue);
                            console.debug('Loaded gauge override from data/gauge.json', this.data.gaugeValue);
                        }
                    }
                } catch (e) { /* optional file may not exist */ }
                return true;
            }
            return false;
        } catch (err) {
            console.warn('Could not load data, using default', err);
            if (!this.data) this.data = this.getDefaultData();
            return true;
        }
    }

    getDefaultData() {
        return {
            alerts: [
                'Political unrest in Eastern region affecting operations',
                'Upcoming regulatory audit scheduled for Q2 2025',
                'New government regulations on financial reporting'
            ],
            controlSystems: {
                changeManagement: 'at-target',
                controlEnvironment: 'at-target',
                controlWeaknesses: 'at-risk',
                managementInfo: 'at-target',
                controlProcesses: 'at-target',
                bcmResilience: 'at-risk',
                appetiteConsumption: 'at-trigger',
                capacity: 'at-target',
                
            },
            svgElementMappings: this.defaultSvgElementMappings,
            dashboardElements: {
                mainStatusIndicator: 'main-status-indicator',
                digitalDisplay: 'digital-display-text'
            },
            metadata: { lastUpdated: new Date().toISOString() }
        };
    }

    async loadCarDashboardSVG() {
        try {
            const container = document.getElementById('car-dashboard-svg');
            // If an inline SVG already exists in the container (e.g., file:// usage), use it.
            const existing = container.querySelector('svg');
            if (existing) {
                this.carDashboardSVG = existing;
            } else {
                const res = await fetch('./assets/risk-dashboard.svg');
                const svgText = await res.text();
                container.innerHTML = svgText;
                this.carDashboardSVG = container.querySelector('svg');
            }
            // Validate and normalize svg element mappings against the loaded SVG
            this.validateSvgMappings();
            // Debug: list available SVG ids and current mappings for quick diagnosis
            try {
                const available = Array.from(this.carDashboardSVG.querySelectorAll('[id]')).map(n => n.id);
                const mapTable = Object.entries(this.data.svgElementMappings || {}).map(([k, v]) => ({ system: k, mappedId: v, nodeExists: !!this.carDashboardSVG.getElementById(v) }));
                console.debug('SVG loaded', { availableIdsCount: available.length, mappingsCount: mapTable.length });
            } catch (e) { /* non-fatal */ }
            // Ensure critical mappings exist: prefer exact ids present in the SVG so lights reliably update
            try {
                this.data = this.data || {};
                this.data.svgElementMappings = this.data.svgElementMappings || {};
                this.data.controlSystems = this.data.controlSystems || {};
                const tryEnsure = (key, candidates) => {
                    for (let i = 0; i < candidates.length; i++) {
                        const id = candidates[i];
                        if (this.carDashboardSVG.getElementById(id)) {
                            if (this.data.svgElementMappings[key] !== id) {
                                console.warn(`Ensuring mapping: '${key}' -> '${id}'`);
                                this.data.svgElementMappings[key] = id;
                            }
                            if (!this.data.controlSystems[key] || !/^at-/.test(String(this.data.controlSystems[key]).trim())) {
                                this.data.controlSystems[key] = this.data.controlSystems[key] || 'at-trigger';
                            }
                            return true;
                        }
                    }
                    return false;
                };
                tryEnsure('controlProcesses', ['abs-warning-light', 'abs', 'abs-light']);
                tryEnsure('controlWeaknesses', ['temp-warning-light', 'temp', 'temperature']);
            } catch (e) { console.warn('ensure mappings failed', e); }
            this.validateSvgMappings();
            setTimeout(() => this.updateSVGWarningLights(), 100);
            // Wire clicks on SVG warning lights to open matching right-pane control items
            setTimeout(() => this.wireSvgWarningLightClicks && this.wireSvgWarningLightClicks(), 150);
            // Create tight, invisible overlay for specific warning lights (one-off)
            // Create invisible clickable overlays for all warning-light groups after SVG loads
            setTimeout(() => { try { if (typeof this.createOverlaysForAllWarningLights === 'function') this.createOverlaysForAllWarningLights(6, 6); else {
                        // fallback: explicitly ensure bulb and esp overlays exist
                        try { if (this.createInsetRoundedOverlay) { this.createInsetRoundedOverlay('bulb-warning-light', 6, 6); this.createInsetRoundedOverlay('esp-warning-light', 6, 6); } else if (this.createExactOverlayForId) { this.createExactOverlayForId('bulb-warning-light', 6); this.createExactOverlayForId('esp-warning-light', 6); } } catch (e) {}
            } } catch (e) {} }, 220);
        // Wire special brake overlay behavior shortly after overlays are created
        setTimeout(() => { try { if (typeof this.wireBrakeOverlayBehavior === 'function') this.wireBrakeOverlayBehavior(); } catch (e) {} }, 300);
            // Consolidate repeated post-SVG setup calls
            this._safeCalls([
                [() => this.buildSpeedTickMap(), 'buildSpeedTickMap failed'],
                [() => this.ensureSpeedPointer(), 'ensureSpeedPointer failed'],
                [() => this.createRpmNeedleFresh(), 'createRpmNeedleFresh failed'],
                [() => this.wireRpmTestSlider(), 'wireRpmTestSlider failed'],
                [() => this.wireEngineStartStop(), 'wireEngineStartStop failed'],
                // [() => this.createEngineOverlay(), 'createEngineOverlay failed'],
                [() => this._updatePoweredOffBlocker(), 'update powered-off blocker failed'],
                [() => this._injectPoweredOffNoHoverStyle(), 'inject powered-off stylesheet failed'],
                [() => this._applyInlineDim(), 'apply inline dim failed'],
                [() => this.applyPowerState(), 'applyPowerState failed']
            ]);

            // Auto-calibrate fuel and temperature pointers and apply any stored/pending values
            try {
                try {
                    const okFuel = this.calibrateFuelPointer();
                    console.debug('Auto fuel calibration result:', okFuel);
                } catch (e) { console.warn('Auto fuel calibration failed', e); }
                try {
                    const okTemp = this.calibrateTempPointer();
                    console.debug('Auto temp calibration result:', okTemp);
                } catch (e) { console.warn('Auto temp calibration failed', e); }
                // RPM calibration already performed earlier (deterministic anchors); skip duplicate call here.

                // Apply data values if present, otherwise flush any pending slider values stored on window
                try {
                    if (this.engineActive && this.data && typeof this.data.fuelValue !== 'undefined') {
                        this.updateFuelPointer(this.data.fuelValue);
                    } else if (this.engineActive && typeof window.__pendingFuelValue !== 'undefined' && typeof this.setFuelValue === 'function') {
                        this.setFuelValue(window.__pendingFuelValue);
                        delete window.__pendingFuelValue;
                    } else {
                        // Keep pointer at calibrated zero while off
                        try { if (typeof this._fuelAngle0 === 'number') this.updateFuelPointer(0); } catch (e) {}
                    }
                } catch (e) { console.warn('Applying fuel value failed', e); }

                try {
                    if (this.engineActive && this.data && typeof this.data.tempValue !== 'undefined') {
                        // Ensure pointer is visually at calibrated zero immediately, then animate to current value
                        try {
                            const g = this.carDashboardSVG.querySelector('#temp-pointer');
                            if (g && typeof this._tempAngle0 === 'number') {
                                g.setAttribute('transform', `rotate(${this._tempAngle0} ${this.tempHubX} ${this.tempHubY})`);
                                this._lastTempAngle = this._tempAngle0;
                            }
                        } catch (ee) { /* ignore */ }
                        // schedule animation in next frame so the transition is visible
                        requestAnimationFrame(() => { try { this.updateTempPointer(this.data.tempValue); } catch (e) {} });
                    } else if (this.engineActive && typeof window.__pendingTempValue !== 'undefined' && typeof this.setTempValue === 'function') {
                        this.setTempValue(window.__pendingTempValue);
                        delete window.__pendingTempValue;
                    } else {
                        // No stored or pending value: ensure pointer rests at zero (calibrated zero)
                        try {
                            if (typeof this._tempAngle0 === 'number') {
                                const g = this.carDashboardSVG.querySelector('#temp-pointer');
                                if (g) g.setAttribute('transform', `rotate(${this._tempAngle0} ${this.tempHubX} ${this.tempHubY})`);
                                this._lastTempAngle = this._tempAngle0;
                                // keep at zero while off
                            }
                        } catch (e) { /* ignore */ }
                    }
                } catch (e) { console.warn('Applying temp value failed', e); }
            } catch (e) { /* non-fatal */ }
        } catch (err) {
            console.error('Failed to load SVG', err);
            this.createSVGPlaceholder();
        }
    }

    // Make SVG warning lights clickable: clicking a light opens the matching right-pane control item
    wireSvgWarningLightClicks() {
        try {
            if (!this.carDashboardSVG) return;
            const mappings = (this.data && this.data.svgElementMappings) || this.defaultSvgElementMappings || {};
            // Build reverse lookup from defaultSvgElementMappings -> controlItemMappings when possible
            const reverseDefault = {};
            try {
                Object.entries(this.defaultSvgElementMappings || {}).forEach(([k,v]) => { reverseDefault[v] = k; });
            } catch (e) {}

            Object.entries(mappings).forEach(([sysKey, svgId]) => {
                try {
                    if (!svgId) return;
                    // Some mappings may include modifiers like "id|state" or similar; take before any delimiter
                    const cleanId = String(svgId || '').split(/[|:]/)[0];
                    let node = null;
                    try { node = this.carDashboardSVG.getElementById(cleanId); } catch (e) { node = null; }
                    if (!node) node = this.carDashboardSVG.querySelector('#' + cleanId);
                    if (!node) return;

                    // Make it clearly interactive and ensure it can receive pointer events
                    try { node.style.cursor = 'pointer'; node.style.pointerEvents = 'auto'; node.setAttribute && node.setAttribute('pointer-events', 'auto'); } catch (e) {}

                    // Click handler: determine which control-item to open and trigger its click
                    const handler = (ev) => {
                        try { ev.stopPropagation(); } catch (e) {}
                        // Find control key: prefer mapping by system key, else reverse-default lookup
                        let controlKey = sysKey;
                        if (!this.controlItemMappings[controlKey]) {
                            const possible = reverseDefault[cleanId];
                            if (possible) controlKey = possible;
                        }
                        let controlId = this.controlItemMappings[controlKey];
                        // fallback: guess by svg id name -> replace '-warning-light' with '-control'
                        if (!controlId) {
                            const guessed = cleanId.replace(/-warning-light$/i, '-control');
                            if (document.getElementById(guessed)) controlId = guessed;
                        }

                        // Special-case: some SVG ids use different naming (e.g. 'Traction-Control-Warning-Light')
                        // Map these to the 'brake-control' right-pane item which represents Structure/Traction
                        if (!controlId && /traction/i.test(cleanId)) {
                            if (document.getElementById('brake-control')) controlId = 'brake-control';
                        }

                        if (controlId) {
                            const el = document.getElementById(controlId);
                            if (el) {
                                try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
                                try { el.click(); } catch (e) { /* last resort: dispatch event */
                                    try { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (ee) {}
                                }
                            }
                        }
                    };

                    // Attach handler (use onclick to avoid duplicate listeners on repeated wiring)
                    try { node.onclick = handler; } catch (e) { try { node.addEventListener('click', handler); } catch (ee) {} }
                } catch (e) { /* ignore per-light errors */ }
            });
            // Additionally, wire any SVG elements that look related but aren't in mappings (e.g. Traction-Control-Warning-Light)
            try {
                const all = Array.from(this.carDashboardSVG.querySelectorAll('[id]'));
                all.forEach(node => {
                    try {
                        const nid = String(node.id || '');
                        if (!nid) return;
                        // If this id contains 'traction' or matches the Traction-Control-Warning-Light pattern,
                        // but wasn't part of the configured mappings, map it to the brake-control item.
                        if (/traction/i.test(nid)) {
                            // ensure clickable
                            try { node.style.cursor = 'pointer'; node.style.pointerEvents = 'auto'; node.setAttribute && node.setAttribute('pointer-events', 'auto'); } catch (e) {}
                            const h = (ev) => {
                                try { ev && ev.stopPropagation && ev.stopPropagation(); } catch (e) {}
                                const target = document.getElementById('brake-control');
                                if (target) {
                                    try { target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
                                    try { target.click(); } catch (e) { try { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (ee) {} }
                                }
                            };
                            try { node.onclick = h; } catch (e) { try { node.addEventListener('click', h); } catch (ee) {} }
                        }
                    } catch (e) {}
                });
            } catch (e) {}
        } catch (err) { console.warn('wireSvgWarningLightClicks failed', err); }
    }

    // Compute a tight bounding box for `node` transformed into the root SVG user-space.
    // Collects bbox corners of graphics descendants and maps them via CTM to root coords.
    computeTransformedBBox(node, svgRoot) {
        try {
            if (!node || !svgRoot) return null;
            const svg = svgRoot;
            const pts = [];
            const collect = (el) => {
                try {
                    const bb = el.getBBox();
                    const ctm = el.getCTM();
                    if (!ctm) return;
                    const corners = [
                        { x: bb.x, y: bb.y },
                        { x: bb.x + bb.width, y: bb.y },
                        { x: bb.x, y: bb.y + bb.height },
                        { x: bb.x + bb.width, y: bb.y + bb.height }
                    ];
                    corners.forEach(p => {
                        try {
                            const sp = svg.createSVGPoint(); sp.x = p.x; sp.y = p.y;
                            const t = sp.matrixTransform(ctm);
                            pts.push({ x: t.x, y: t.y });
                        } catch (e) {}
                    });
                } catch (e) { /* ignore */ }
            };

            // include node if graphic and all descendant graphics
            const sel = 'path,circle,rect,ellipse,line,polyline,polygon,image,text';
            const list = Array.from(node.querySelectorAll(sel));
            try { const t = (node.tagName || '').toLowerCase(); if (['path','circle','rect','ellipse','line','polyline','polygon','image','text'].includes(t)) list.unshift(node); } catch (e) {}
            list.forEach(collect);
            if (!pts.length) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            pts.forEach(p => { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; });
            return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
        } catch (e) { return null; }
    }

    // Create an invisible but clickable overlay rect for the SVG group with given id.
    // pad is in SVG user units and expands the tight bbox on all sides.
    createExactOverlayForId(svgId, pad = 0) {
        try {
            if (!this.carDashboardSVG || !svgId) return null;
            const svg = this.carDashboardSVG;
            // resolve element (case-insensitive fallback)
            let node = svg.getElementById(svgId) || svg.querySelector('#' + svgId) || Array.from(svg.querySelectorAll('[id]')).find(n => (n.id || '').toLowerCase() === String(svgId).toLowerCase());
            if (!node) return null;

            // compute tight bbox in root user-space
            const bbox = this.computeTransformedBBox(node, svg);
            if (!bbox) return null;

            // create overlays group if missing
            let g = svg.getElementById('exact-warning-overlays') || svg.querySelector('#exact-warning-overlays');
            if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('id', 'exact-warning-overlays'); svg.appendChild(g); }

            const oid = 'exact-overlay-' + String(svgId).replace(/[^a-z0-9\-_]/gi, '') ;
            // remove existing overlay for id if present
            try { const prev = svg.getElementById(oid); if (prev) prev.remove(); } catch (e) {}

            const x = bbox.x - pad; const y = bbox.y - pad; const w = Math.max(0, bbox.width + pad * 2); const h = Math.max(0, bbox.height + pad * 2);
            if (w <= 0 || h <= 0) return null;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('id', oid);
            rect.setAttribute('x', String(Number(x).toFixed(2)));
            rect.setAttribute('y', String(Number(y).toFixed(2)));
            rect.setAttribute('width', String(Number(w).toFixed(2)));
            rect.setAttribute('height', String(Number(h).toFixed(2)));
            // Make fully invisible but still hit-testable: use no fill/stroke and ensure pointer-events capture
            rect.setAttribute('fill', 'none');
            rect.setAttribute('fill-opacity', '0');
            rect.setAttribute('stroke', 'none');
            rect.setAttribute('opacity', '0');
            rect.setAttribute('pointer-events', 'all');
            rect.style.cursor = 'pointer';
            // clicking the overlay should behave like clicking the underlying node
            const handler = (ev) => { try { ev && ev.stopPropagation && ev.stopPropagation(); try { node.click(); } catch (e) { node.dispatchEvent && node.dispatchEvent(new MouseEvent('click', { bubbles: true })); } } catch (e) {} };
            try { rect.onclick = handler; } catch (e) { try { rect.addEventListener('click', handler); } catch (ee) {} }
            // ensure group captures pointer events for children
            g.setAttribute('pointer-events', 'auto');
            g.appendChild(rect);
            return rect;
        } catch (e) { return null; }
    }

    // Create an invisible rounded-rect overlay inside the warning-light group itself.
    // This uses the group's local bbox so the overlay inherits the group's transform
    // and visually hugs the artwork. rx controls corner radius in user units.
    createInsetRoundedOverlay(svgId, pad = 0, rx = 4) {
        try {
            if (!this.carDashboardSVG || !svgId) return null;
            const svg = this.carDashboardSVG;
            // find group by id (case-insensitive fallback)
            let node = svg.getElementById(svgId) || Array.from(svg.querySelectorAll('[id]')).find(n => (n.id || '').toLowerCase() === String(svgId).toLowerCase());
            if (!node) return null;

            // compute local bbox of the group (getBBox returns in group's own coordinate space)
            let bb;
            try { bb = node.getBBox(); } catch (e) { bb = null; }
            if (!bb) return null;

            // Compute additional padding to include stroke extents and simple filter effects
            let maxStroke = 0;
            let hasFilter = false;
            try {
                const sel = 'path,circle,rect,ellipse,line,polyline,polygon,image,use,text';
                const desc = Array.from(node.querySelectorAll(sel));
                desc.forEach(el => {
                    try {
                        const cs = window.getComputedStyle(el);
                        let sw = 0;
                        if (cs && cs.strokeWidth) sw = parseFloat(cs.strokeWidth) || 0;
                        if (!sw) {
                            const a = el.getAttribute && (el.getAttribute('stroke-width') || el.getAttribute('stroke')); // stroke attr may be present
                            if (a) sw = parseFloat(a) || 0;
                        }
                        if (sw > maxStroke) maxStroke = sw;
                        const f = (el.getAttribute && el.getAttribute('filter')) || (cs && cs.filter && cs.filter !== 'none');
                        if (f) hasFilter = true;
                    } catch (e) {}
                });
            } catch (e) {}

            const strokePad = maxStroke ? (maxStroke / 2) : 0;
            const filterPad = hasFilter ? 4 : 0; // conservative extra for simple shadows/filters
            const effectivePad = Math.max(0, pad || 0, strokePad, filterPad);
            const x = bb.x - effectivePad, y = bb.y - effectivePad, w = Math.max(0, bb.width + effectivePad * 2), h = Math.max(0, bb.height + effectivePad * 2);
            if (w <= 0 || h <= 0) return null;

            // remove existing overlay inside this group if present
            const oid = 'inset-overlay-' + String(svgId).replace(/[^a-z0-9\-_]/gi, '');
            try { const prev = node.querySelector('#' + oid); if (prev) prev.remove(); } catch (e) {}

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('id', oid);
            rect.setAttribute('x', String(Number(x).toFixed(2)));
            rect.setAttribute('y', String(Number(y).toFixed(2)));
            rect.setAttribute('width', String(Number(w).toFixed(2)));
            rect.setAttribute('height', String(Number(h).toFixed(2)));
            rect.setAttribute('rx', String(Number(rx).toFixed(2)));
            rect.setAttribute('ry', String(Number(rx).toFixed(2)));
            // Make fully invisible but still hit-testable: use no fill/stroke and ensure pointer-events capture
            rect.setAttribute('fill', 'none');
            rect.setAttribute('fill-opacity', '0');
            rect.setAttribute('stroke', 'none');
            rect.setAttribute('opacity', '0');
            rect.setAttribute('pointer-events', 'all');
            rect.style.cursor = 'pointer';
            // attach click handler that forwards to the group
            const handler = (ev) => { try { ev && ev.stopPropagation && ev.stopPropagation(); try { node.click(); } catch (e) { node.dispatchEvent && node.dispatchEvent(new MouseEvent('click', { bubbles: true })); } } catch (e) {} };
            try { rect.onclick = handler; } catch (e) { try { rect.addEventListener('click', handler); } catch (ee) {} }

            // insert the rect as the first child so it sits under any decorative overlays within the group
            try { node.insertBefore(rect, node.firstChild); } catch (e) { node.appendChild(rect); }
            return rect;
        } catch (e) { return null; }
    }

    // Create inset rounded overlays for every warning-light group in the loaded SVG.
    // pad and rx are in SVG user units. Overlays are invisible but capture pointer events.
    createOverlaysForAllWarningLights(pad = 6, rx = 6) {
        try {
            if (!this.carDashboardSVG) return 0;
            const svg = this.carDashboardSVG;
            // collect candidate ids that look like warning lights (case-insensitive)
            const all = Array.from(svg.querySelectorAll('[id]')).map(n => n.id).filter(Boolean);
            const seen = new Set();
            const candidates = [];
            all.forEach(id => {
                try {
                    if (/warning-?light$/i.test(id) || /warning-?light/i.test(id) || /-warning-/i.test(id) || /warning/i.test(id)) {
                        const norm = id.toString(); if (!seen.has(norm)) { seen.add(norm); candidates.push(norm); }
                    }
                } catch (e) {}
            });

            // also include any explicit mappings from data.svgElementMappings
            try {
                const maps = (this.data && this.data.svgElementMappings) || {};
                Object.values(maps).forEach(v => { try { if (v && !seen.has(v)) { seen.add(v); candidates.push(v); } } catch (e) {} });
            } catch (e) {}

            let created = 0;
            candidates.forEach(id => {
                try {
                    // prefer inset overlay inside group for accurate transform inheritance
                    if (this.createInsetRoundedOverlay) {
                        const r = this.createInsetRoundedOverlay(id, pad, rx);
                        if (r) created++;
                    } else if (this.createExactOverlayForId) {
                        const r = this.createExactOverlayForId(id, pad);
                        if (r) created++;
                    }
                } catch (e) {}
            });
            return created;
        } catch (e) { return 0; }
    }

    // Build a map of speed numeric -> angle (degrees) by locating tick rects in the SVG.
    // More robust: compute min/max angle from detected ticks and fallback to linear mapping
    // across that detected arc if we don't have every tick. This avoids requiring edits
    // to the SVG while still matching the gauge artwork.
    buildSpeedTickMap() {
        if (!this.carDashboardSVG) return;
        const svg = this.carDashboardSVG;
        let hubX = this.gaugeHubX, hubY = this.gaugeHubY;
    // Keep hub fixed: don't auto-refine hub X/Y to avoid visible pivot shifts
        const tickSelectors = [
            // 0
            'rect[x="432.12"][y="316.26"]',
            // 2
            'rect[x="430.22"][y="300.33"]',
            // 4
            'rect[x="438.76"][y="276.13"]',
            // 6
            'rect[x="441.76"][y="261.1"]',
            // 8
            'rect[x="450.31"][y="244.4"]',
            // 10
            'rect[x="458.83"][y="231.54"]',
            // 12
            'rect[x="471.82"][y="218.73"]',
            // 14
            'rect[x="484.98"][y="209.59"]',
            // 16
            'rect[x="500.82"][y="202.16"]',
            // 18
            'rect[x="517.06"][y="197.92"]',
            // 20
            'rect[x="532.87"][y="196.42"]',
            // 22
            'rect[x="545.58"][y="203.53"]',
            // 24
            'rect[x="559"][y="209.47"]',
            // 26
            'rect[x="577.66"][y="215.2"]',
            // 28
            'rect[x="587.03"][y="226.53"]',
            // 30
            'rect[x="603.81"][y="237.15"]',
            // 32
            'rect[x="607.39"][y="252.25"]',
            // 34
            'rect[x="620.89"][y="266.71"]',
            // 36
            'rect[x="617.35"][y="283.82"]',
            // 38
            'rect[x="626.6"][y="300.33"]',
            // 100
            'rect[x="629.35"][y="311.73"]'
        ];
    // Map tick selectors to percent values (0..100) — 21 selectors -> 0,5,10,...,100
    const scaleValues = Array.from({length: 21}, (_,i) => i * 5);
        const tickAngles = [];
        for (let i = 0; i < tickSelectors.length; i++) {
            const r = svg.querySelector(tickSelectors[i]);
            if (!r) { tickAngles.push(null); continue; }
            try {
                // getBBox returns box center already in user space; do NOT apply CTM again
                const bbox = r.getBBox();
                const cx = bbox.x + bbox.width / 2;
                const cy = bbox.y + bbox.height / 2;
                const dx = cx - hubX, dy = cy - hubY;
                tickAngles.push(Math.atan2(dy, dx) * 180 / Math.PI);
            } catch (e) { tickAngles.push(null); }
        }
        // Always compute endpoint-based dynamic mapping as a fallback
        try {
            // Use the exact zero and 100 tick rects (user-provided selectors)
            const zeroRect = svg.querySelector('rect[x="432.12"][y="316.26"]');
            const maxRect = svg.querySelector('rect[x="629.35"][y="311.73"]');
            if (zeroRect && maxRect) {
                const b0 = zeroRect.getBBox();
                const b1 = maxRect.getBBox();
                const c0x = b0.x + b0.width/2, c0y = b0.y + b0.height/2;
                const c1x = b1.x + b1.width/2, c1y = b1.y + b1.height/2;
                const a0 = Math.atan2(c0y - hubY, c0x - hubX) * 180 / Math.PI;
                let a100 = Math.atan2(c1y - hubY, c1x - hubX) * 180 / Math.PI;
                // unwrap a100 so it's the nearest equivalent relative to a0 (avoid crossing -180/180 seam)
                while (a100 - a0 > 180) a100 -= 360;
                while (a100 - a0 < -180) a100 += 360;
                this._speedAngle0Exact = a0;
                // slope per percentage point (0..100)
                this._speedAngleSlope = (a100 - a0) / 100;
            }
        } catch (e) { /* ignore */ }
        if (tickAngles.some(a => a === null)) {
            // Partial tick map: store what we have and use endpoint linear fallback in valueToAngle
            this.speedTickMap = new Map();
            for (let i = 0; i < scaleValues.length; i++) {
                if (tickAngles[i] !== null) this.speedTickMap.set(scaleValues[i], tickAngles[i]);
            }
            console.warn('buildSpeedTickMap: missing some ticks; using partial map + endpoint linear fallback');
            return;
        }
        this.speedTickMap = new Map();
        for (let i = 0; i < scaleValues.length; i++) {
            this.speedTickMap.set(scaleValues[i], tickAngles[i]);
        }
        for (let s = 1; s <= 100; s += 1) {
            if (this.speedTickMap.has(s)) continue;
            let low = null, high = null;
            for (let v = s - 1; v >= 0; v--) if (this.speedTickMap.has(v)) { low = v; break; }
            for (let v = s + 1; v <= 100; v++) if (this.speedTickMap.has(v)) { high = v; break; }
            if (low !== null && high !== null) {
                const a0 = this.speedTickMap.get(low);
                const a1 = this.speedTickMap.get(high);
                const t = (s - low) / (high - low);
                this.speedTickMap.set(s, a0 + (a1 - a0) * t);
            }
        }
        console.debug('buildSpeedTickMap: explicit tick mapping', { map: this.speedTickMap });
    this._safeCalls([
        [() => this.calibrateZeroTick(), 'calibrateZeroTick failed'],
        [() => this.calibrateMaxTick(), 'calibrateMaxTick failed'],
        [() => this.enforceLeftToRightOrientation(), 'enforceLeftToRightOrientation failed']
    ]);
    // Recompute fine-grained interpolation between 0 and 5 using rect centers (fills 1..4)
    try {
        if (this.carDashboardSVG && this.speedTickMap && this.speedTickMap.has(0) && this.speedTickMap.has(5)) {
            const svg = this.carDashboardSVG;
            const hubX = this.gaugeHubX, hubY = this.gaugeHubY;
            const r0 = svg.querySelector('rect[x="432.12"][y="316.26"]');
            const r5 = svg.querySelector('rect[x="430.22"][y="300.33"]');
            if (r0 && r5) {
                const b0 = r0.getBBox();
                const b5 = r5.getBBox();
                const c0x = b0.x + b0.width/2, c0y = b0.y + b0.height/2;
                const c5x = b5.x + b5.width/2, c5y = b5.y + b5.height/2;
                for (let p = 1; p < 5; p++) {
                    const t = p / 5;
                    const ix = c0x + (c5x - c0x) * t;
                    const iy = c0y + (c5y - c0y) * t;
                    const ang = Math.atan2(iy - hubY, ix - hubX) * 180 / Math.PI;
                    this.speedTickMap.set(p, ang);
                }
            } else {
                // fallback: set 1..4 by angular interpolation between existing 0 and 5
                const a0 = this.speedTickMap.get(0), a5 = this.speedTickMap.get(5);
                for (let p = 1; p < 5; p++) this.speedTickMap.set(p, a0 + (a5 - a0) * (p / 5));
            }
        }
    } catch (e) { console.warn('value 1 midpoint calc failed', e); }
    // Recreate pointer with new hubX if changed or orientation enforced
    this._safeCalls([ [() => this.ensureSpeedPointer(), 'ensureSpeedPointer failed'] ]);
    }

    // Compute angle in degrees between hub center and the center of an element (rect, path, etc.)
    _angleBetween(hubX, hubY, node) {
        if (!node) return 0;
        const bb = node.getBBox();
        const cx = bb.x + bb.width / 2;
        const cy = bb.y + bb.height / 2;
        // SVG Y axis is downwards; use Math.atan2(dy, dx)
        const dx = cx - hubX;
        const dy = cy - hubY;
        const rad = Math.atan2(dy, dx);
        const deg = rad * 180 / Math.PI;
        return deg;
    }

    // Wire the RPM test slider UI (id="rpm-range") to rotate #rpm-pointer between rpm-zero-mark and rpm-100-mark
    wireRpmTestSlider() {
        const svg = this.carDashboardSVG;
        if (!svg) return;
        const slider = document.getElementById('rpm-range');
        const valueLabel = document.getElementById('rpm-value');
        if (!slider) return;
        // Determine hub from our created rpm pointer hub circles
        const hubNode = svg.querySelector('#rpm-pointer circle');
        let hubX = 255.58, hubY = 306.63; // defaults (match SVG values)
        try {
            if (hubNode) {
                hubX = Number(hubNode.getAttribute('cx')) || hubX;
                hubY = Number(hubNode.getAttribute('cy')) || hubY;
            }
        } catch (e) { /* use defaults */ }

        const zeroMark = svg.getElementById('rpm-zero-mark');
        const hundredMark = svg.getElementById('rpm-100-mark');
        if (!zeroMark || !hundredMark) {
            console.warn('RPM marks not found for slider wiring');
            return;
        }
    let angle0 = this._angleBetween(hubX, hubY, zeroMark);
    let angle100 = this._angleBetween(hubX, hubY, hundredMark);
    // Attempt to detect pointer tip and ensure slider increases move the needle visually upwards (clockwise).
    // We will NOT swap the calibrated angles (they are correct per artwork). Instead we detect
    // whether increasing angle moves the tip up; if not, we invert the slider interpolation only.
    // Find the pointer path tip coordinates (best-effort parse of 'd' attribute)
        let tipX = hubX + 100; // fallback to a point to the right of hub
        let tipY = hubY;
        try {
            const pointerPath = svg.querySelector('#rpm-pointer path');
            if (pointerPath) {
                const d = pointerPath.getAttribute('d') || '';
                const nums = d.match(/-?\d+\.?\d*/g);
                if (nums && nums.length >= 6) {
                    // Expecting path like: M x1 y1 L x2 y2 L x3 y3 ... -> take the 3rd point as tip
                    const ix = Math.min(nums.length - 2, 4);
                    tipX = parseFloat(nums[ix]);
                    tipY = parseFloat(nums[ix + 1]);
                }
            }
        } catch (e) { /* ignore, use defaults */ }

        const rotatePointY = (x, y, deg) => {
            const rad = deg * Math.PI / 180;
            const dx = x - hubX, dy = y - hubY;
            const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
            const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
            return hubY + ry;
        };

    // Preserve calibrated angles for 0/50/100 and derive monotonic numeric progression so
    // numeric interpolation maps 0->50->100 without wrapping. We'll adjust by +/-360 as needed.
    const midMark = svg.getElementById('rpm-50-mark');
    let a0 = angle0;
    let a50 = midMark ? this._angleBetween(hubX, hubY, midMark) : (angle0 + angle100) / 2;
    let a100 = angle100;
    // Normalize so a0 < a50 < a100 by adding 360 where necessary
    while (a50 - a0 <= 0) a50 += 360;
    while (a100 - a50 <= 0) a100 += 360;
    this._rpmAngle0 = a0;
    this._rpmAngle50 = a50;
    this._rpmAngle100 = a100;
        // Initialize pointer to zero angle
        const g = svg.querySelector('#rpm-pointer');
        if (g) {
            g.setAttribute('transform', `rotate(${angle0} ${hubX} ${hubY})`);
            this._lastRpmAngle = angle0;
        }

    // Removed local animateTo; use class method animateRpmTo for reusable transition.

        // Slider event
        slider.addEventListener('input', (ev) => {
            const v = Number(ev.target.value || 0);
            if (valueLabel) valueLabel.textContent = String(v);
                // Map 0..100 to piecewise numeric angles in [a0..a100] so pointer never moves past endpoints
                const vNorm = (v / 100);
                let base;
                if (vNorm <= 0.5) {
                    const t = vNorm / 0.5; // 0..1
                    base = a0 + (a50 - a0) * t;
                } else {
                    const t = (vNorm - 0.5) / 0.5; // 0..1
                    base = a50 + (a100 - a50) * t;
                }

                // Candidate targets to avoid 360 wrap issues
                const candidates = [base - 360, base, base + 360];

                // read current numeric angle
                const elem = svg.querySelector('#rpm-pointer');
                let current = (typeof this._lastRpmAngle === 'number') ? this._lastRpmAngle : base;
                try {
                    if (elem) {
                        const t = elem.getAttribute('transform') || '';
                        const m = t.match(/rotate\((-?\d+\.?\d*)\s+/);
                        if (m) current = Number(m[1]);
                    }
                } catch (e) {}

                // choose nearest candidate that lies within [a0, a100], prefer direction of slider
                const inRange = candidates.filter(c => c >= a0 && c <= a100);
                let chosen;
                if (inRange.length) {
                    // pick nearest among in-range
                    chosen = inRange.reduce((a,b) => Math.abs(a - current) <= Math.abs(b - current) ? a : b);
                } else {
                    // no candidate lies directly in range (edge cases) -> clamp base to nearest endpoint
                    chosen = base < a0 ? a0 : (base > a100 ? a100 : base);
                }

                // directional preference: if user increased, avoid choosing a target less than current
                if (v > (this._lastRpmSliderValue || 0)) {
                    if (chosen < current) {
                        // try to find a candidate >= current (within shifted candidates), else clamp to a100
                        const pos = candidates.filter(c => c >= current && c >= a0 && c <= a100).sort((x,y)=>x - y);
                        if (pos.length) chosen = pos[0]; else chosen = Math.min(Math.max(chosen, current), a100);
                    }
                } else if (v < (this._lastRpmSliderValue || 0)) {
                    if (chosen > current) {
                        const neg = candidates.filter(c => c <= current && c >= a0 && c <= a100).sort((x,y)=>y - x);
                        if (neg.length) chosen = neg[0]; else chosen = Math.max(Math.min(chosen, current), a0);
                    }
                }

                // Ensure final clamp
                if (chosen < a0) chosen = a0;
                if (chosen > a100) chosen = a100;

            this.animateRpmTo(chosen, hubX, hubY);
            this._lastRpmSliderValue = v;
        });
    }

    // Update rpm pointer to reflect a percent value (0..100). Smoothly animate and clamp to endpoints.
    setRpmPercent(percent) {
        const svg = this.carDashboardSVG; if (!svg) return;
        const g = svg.querySelector('#rpm-pointer'); if (!g) return;
        const hubNode = svg.querySelector('#rpm-pointer circle');
        let hubX = 255.58, hubY = 306.63;
        try { if (hubNode) { hubX = Number(hubNode.getAttribute('cx')) || hubX; hubY = Number(hubNode.getAttribute('cy')) || hubY; } } catch (e) {}
        const zeroMark = svg.getElementById('rpm-zero-mark');
        const midMark = svg.getElementById('rpm-50-mark');
        const hundredMark = svg.getElementById('rpm-100-mark');
        if (!zeroMark || !hundredMark) return;
        const angle0 = this._angleBetween(hubX, hubY, zeroMark);
        const angle50 = midMark ? this._angleBetween(hubX, hubY, midMark) : (angle0 + this._angleBetween(hubX, hubY, hundredMark)) / 2;
        const angle100 = this._angleBetween(hubX, hubY, hundredMark);

        // Normalize angles so a0 < a50 < a100
        let a0 = angle0, a50 = angle50, a100 = angle100;
        while (a50 - a0 <= 0) a50 += 360;
        while (a100 - a50 <= 0) a100 += 360;

        const v = Math.max(0, Math.min(100, Number(isNaN(percent) ? 0 : percent)));
        const vNorm = v / 100;
        let base = (vNorm <= 0.5)
            ? (a0 + (a50 - a0) * (vNorm / 0.5))
            : (a50 + (a100 - a50) * ((vNorm - 0.5) / 0.5));

        // candidates and choose nearest within [a0, a100]
        const candidates = [base - 360, base, base + 360];
        let current = (typeof this._lastRpmAngle === 'number') ? this._lastRpmAngle : base;
        try {
            const t = g.getAttribute('transform') || '';
            const m = t.match(/rotate\((-?\d+\.?\d*)\s+/);
            if (m) current = Number(m[1]);
        } catch (e) {}

        const inRange = candidates.filter(c => c >= a0 && c <= a100);
        let chosen;
        if (inRange.length) chosen = inRange.reduce((a,b) => Math.abs(a - current) <= Math.abs(b - current) ? a : b);
        else chosen = base < a0 ? a0 : (base > a100 ? a100 : base);

        // clamp
        if (chosen < a0) chosen = a0;
        if (chosen > a100) chosen = a100;

        // animate using animateTo if available (it closes over hubX/hubY in wireRpmTestSlider), else set directly
        try {
            // animateRpmTo(signature: targetAngle, hubX, hubY, options)
            if (typeof this.animateRpmTo === 'function') this.animateRpmTo(chosen, hubX, hubY, { fromZero: false });
            else { g.setAttribute('transform', `rotate(${chosen} ${hubX} ${hubY})`); this._lastRpmAngle = chosen; }
        } catch (e) { g.setAttribute('transform', `rotate(${chosen} ${hubX} ${hubY})`); this._lastRpmAngle = chosen; }
    }

    // Animate RPM pointer to targetAngle around hub (hubX, hubY).
    // options: { fromZero: boolean } - when true, start at calibrated zero then animate to target
    animateRpmTo(targetAngle, hubX, hubY, options = {}) {
        const svg = this.carDashboardSVG; if (!svg) return;
        const el = svg.querySelector('#rpm-pointer'); if (!el) return;
        // determine start angle
        let start = targetAngle;
        try {
            const t = el.getAttribute('transform') || '';
            const m = t.match(/rotate\((-?\d+\.?\d*)\s+/);
            if (m) start = Number(m[1]);
            else if (typeof this._lastRpmAngle === 'number') start = this._lastRpmAngle;
        } catch (e) { if (typeof this._lastRpmAngle === 'number') start = this._lastRpmAngle; }

        // If request is fromZero, snap visually to calibrated zero first (no instant snap due to set)
        if (options.fromZero) {
            try {
                const hubNode = svg.querySelector('#rpm-pointer circle');
                const zeroMark = svg.getElementById('rpm-zero-mark');
                if (hubNode && zeroMark) {
                    const hubCx = Number(hubNode.getAttribute('cx')) || hubX;
                    const hubCy = Number(hubNode.getAttribute('cy')) || hubY;
                    const zeroA = this._angleBetween(hubCx, hubCy, zeroMark);
                    el.setAttribute('transform', `rotate(${zeroA} ${hubCx} ${hubCy})`);
                    start = zeroA;
                    this._lastRpmAngle = zeroA;
                }
            } catch (e) { /* ignore */ }
        }

        // animate
        const dur = 500; // match speed gauge feel
        const t0 = performance.now();
        const step = (now) => {
            const p = Math.min(1, (now - t0) / dur);
            const eased = p < 0.5 ? 2*p*p : -1 + (4 - 2*p)*p;
            const ang = start + (targetAngle - start) * eased;
            el.setAttribute('transform', `rotate(${ang} ${hubX} ${hubY})`);
            if (p < 1) requestAnimationFrame(step);
            else this._lastRpmAngle = targetAngle;
        };
        requestAnimationFrame(step);
    }

    // Ensure gauge value 0 points exactly at the specified tick rectangle (432.12,316.26)
    calibrateZeroTick() {
        if (!this.carDashboardSVG || !this.speedTickMap || !this.speedTickMap.has(0)) return;
        const svg = this.carDashboardSVG;
        const hubX = this.gaugeHubX, hubY = this.gaugeHubY;
        // zero tick in artwork uses cls-18 as per asset
    const zeroRect = svg.querySelector('rect[x="432.12"][y="316.26"]');
        if (!zeroRect) return;
        try {
            const b = zeroRect.getBBox();
            const cx = b.x + b.width/2;
            const cy = b.y + b.height/2;
            const expected = Math.atan2(cy - hubY, cx - hubX) * 180 / Math.PI;
            const current = this.speedTickMap.get(0);
            const delta = expected - current;
            if (Math.abs(delta) > 0.01) {
                const shifted = new Map();
                this.speedTickMap.forEach((ang, k) => shifted.set(k, ang + delta));
                this.speedTickMap = shifted;
                if (this.data && typeof this.data.gaugeValue !== 'undefined') this.updateSpeedPointer(this.data.gaugeValue);
                console.debug('calibrateZeroTick: shift applied', { expected, current, delta });
            }
        } catch (e) { console.warn('calibrateZeroTick error', e); }
    }

    // Ensure gauge value 100 points exactly at the specified max tick rectangle (629.35,311.73)
    calibrateMaxTick() {
        // Ensure we have a partial/full speedTickMap and at least the 100 key
        if (!this.carDashboardSVG || !this.speedTickMap || !this.speedTickMap.has(100)) return;
        const svg = this.carDashboardSVG;
        const hubX = this.gaugeHubX, hubY = this.gaugeHubY;
        // max rect in artwork uses cls-30 per asset
    const rect = svg.querySelector('rect[x="629.35"][y="311.73"]');
        if (!rect) return;
        try {
            const b = rect.getBBox();
            const cx = b.x + b.width/2;
            const cy = b.y + b.height/2;
            const expectedMax = Math.atan2(cy - hubY, cx - hubX) * 180 / Math.PI;
            const a0 = this.speedTickMap.get(0);
            const currentMax = this.speedTickMap.get(100);
            // Ensure zero already calibrated; now scale span exactly
            const currentSpan = currentMax - a0;
            const desiredSpan = expectedMax - a0;
            if (Math.abs(currentSpan) > 0.0001) {
                const scale = desiredSpan / currentSpan;
                if (Math.abs(1 - scale) > 0.0005) { // only if meaningful change
                    const scaled = new Map();
                    this.speedTickMap.forEach((ang, k) => {
                        if (k === 0) scaled.set(k, a0); else scaled.set(k, a0 + (ang - a0) * scale);
                    });
                    scaled.set(100, expectedMax);
                    this.speedTickMap = scaled;
                    if (this.data && typeof this.data.gaugeValue !== 'undefined') this.updateSpeedPointer(this.data.gaugeValue);
                    console.debug('calibrateMaxTick: span scaled', { expectedMax, currentMax, scale, desiredSpan, currentSpan });
                } else if (Math.abs(currentMax - expectedMax) > 0.01) {
                    // Minor snap only
                    this.speedTickMap.set(100, expectedMax);
                }
            }
        } catch (e) { console.warn('calibrateMaxTick error', e); }
    }

    // Make the engine-start-stop <image> inside the loaded SVG clickable and keyboard operable.
    // Toggles this.engineActive boolean, toggles an 'engine-active' class on the image element,
    // and dispatches a CustomEvent 'engine-toggle' on window with detail: { active: boolean }.
    wireEngineStartStop() {
        if (!this.carDashboardSVG) return;
        const img = this.carDashboardSVG.getElementById('engine-start-stop');
        if (!img) return;
        // Make it keyboard focusable and role=button for assistive tech
        try {
            img.setAttribute('tabindex', '0');
            img.setAttribute('role', 'button');
            img.style.cursor = 'pointer';
        } catch (e) { /* ignore */ }

    // initial engine state preserved; do not toggle global powered-off class here
    this.engineActive = !!this.engineActive;
    img.classList.toggle('engine-active', !!this.engineActive);
    try { img.setAttribute('aria-pressed', String(!!this.engineActive)); } catch (e) {}

        const toggle = (ev) => {
            this.engineActive = !this.engineActive;
            img.classList.toggle('engine-active', !!this.engineActive);
            try { img.setAttribute('aria-pressed', String(!!this.engineActive)); } catch (e) {}
            // Dispatch engine-toggle for external listeners; do not apply any global dimming.
            try { window.dispatchEvent(new CustomEvent('engine-toggle', { detail: { active: this.engineActive } })); } catch (e) { /* ignore */ }
            // Apply global power state (on/off)
            try { this.applyPowerState(); } catch (e) { /* ignore */ }
        };

        img.addEventListener('click', toggle);
        img.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
                ev.preventDefault();
                toggle(ev);
            }
        });
    }

    // Create or update a transparent blocker over the dashboard wrapper while powered-off
    _ensurePoweredOffBlocker() {
    // Dimming/blocker removed: return null to indicate no blocker present.
    return null;
    }

    _updatePoweredOffBlocker() { return; }

    // Inject a runtime stylesheet to prevent hover/focus from temporarily undimming
    // the dashboard while .powered-off is present. This keeps the current dim value
    // unchanged and applies at runtime so it survives CSS file reversion.
    _injectPoweredOffNoHoverStyle() {
        // Inject a stylesheet that disables hover/animation and interactions while powered-off,
        // but keeps the engine-start-stop button visible and clickable.
        if (document.getElementById('powered-off-style')) return;
    const css = `
    /* While powered-off, make all visual changes instant: disable transitions and animations */
    body.powered-off * { cursor: default !important; transition: none !important; animation: none !important; }
    body.powered-off .right-panel,
    body.powered-off .alert-panel,
    body.powered-off .control-environment,
    body.powered-off .control-item,
    body.powered-off .service-card { pointer-events: none !important; }
    /* Avoid applying filters to the wrapper so child elements can escape the dim */
    /* body.powered-off .car-dashboard-wrapper { filter: grayscale(0.7) brightness(0.5); } */
    /* Darken the right panel as well when powered off */
    body.powered-off .right-panel { position: relative; filter: grayscale(0.8) brightness(0.35); }
    body.powered-off .right-panel::after { content: ''; position: absolute; inset: 0; background: rgba(0,0,0,0.8); border-radius: inherit; pointer-events: none; z-index: 1; }
    /* Keep SVG interactive only for the engine button */
    body.powered-off #car-dashboard-svg svg *:not(#engine-start-stop) { pointer-events: none !important; }
    body.powered-off #car-dashboard-svg #engine-start-stop { pointer-events: auto !important; }
    /* Keep the HTML engine start button visible and above the overlay */
    body.powered-off .dashboard-start-button,
    body.powered-off #engine-start-btn { position: relative; z-index: 5 !important; pointer-events: auto !important; cursor: pointer !important; opacity: 1 !important; filter: none !important; transform: none !important; }
    body.powered-off #car-dashboard-svg *:not(#engine-start-stop) { transition: none !important; }
    /* Ensure the HTML overlay button stays clickable and shows pointer even when off */
    /* Neutralize hover/focus visual pops while off */
    body.powered-off .control-item:hover,
    body.powered-off .control-item:focus,
    body.powered-off .service-card:hover,
    body.powered-off .service-card:focus,
    body.powered-off .dashboard-start-button:hover { transform: none !important; box-shadow: none !important; }
    /* Stop blinking/animations while off */
    body.powered-off .warning-blink,
    body.powered-off .alert-critical.blinking,
    body.powered-off .service-card-action.blinking { animation: none !important; }
    /* Visual-only overlay when off */
    .powered-off-overlay { position:absolute; inset:0; z-index:2; pointer-events:none; background: radial-gradient(120% 80% at 50% 50%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.9) 78%); }
    `;
        const style = document.createElement('style');
        style.id = 'powered-off-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // Freeze key containers by converting them to fixed positioned elements with inline bounds
    _freezePoweredOffContainers() {
        try {
            if (!this._frozenContainers) this._frozenContainers = new Map();
            const freezeOne = (sel, zIndex) => {
                try {
                    const el = document.querySelector(sel);
                    if (!el || this._frozenContainers.has(el)) return;
                    const r = el.getBoundingClientRect();
                    this._frozenContainers.set(el, el.getAttribute('style') || '');
                    el.style.position = 'fixed';
                    el.style.left = r.left + 'px';
                    el.style.top = r.top + 'px';
                    el.style.width = r.width + 'px';
                    el.style.height = r.height + 'px';
                    el.style.margin = '0';
                    // disable transitions/animations inline to prevent any undimming animation
                    el.style.transition = 'none';
                    el.style.animation = 'none';
                    el.style.pointerEvents = 'auto';
                    if (zIndex) el.style.zIndex = zIndex;
                } catch (e) { /* best-effort */ }
            };
            freezeOne('.dashboard-container', '1');
            freezeOne('.main-dashboard', '1');
            freezeOne('.car-dashboard-wrapper', '2');
            freezeOne('.right-panel', '3');
        } catch (e) { /* ignore */ }
    }

    _unfreezePoweredOffContainers() {
        try {
            if (!this._frozenContainers) return;
            for (const [el, prev] of this._frozenContainers.entries()) {
                try {
                    if (prev) el.setAttribute('style', prev);
                    else el.removeAttribute('style');
                } catch (e) {}
            }
            this._frozenContainers.clear();
        } catch (e) { /* ignore */ }
    }

    // Apply inline styles to SVG descendants to ensure the powered-off dim is enforced
    // This uses element.style to apply !important-like behavior by setting properties directly
    // and re-applying them while powered-off. It avoids changing stylesheet files.
    _applyInlineDim() { return; }

    // Create an absolutely-positioned HTML overlay for the engine-start-stop image so it
    // remains fully visible and interactive even when the embedded SVG/SVG filters are dimmed.
    // The overlay mirrors the SVG button position and size and sits above the powered-off overlay.
    createEngineOverlay() {
        // Fully disabled: forcibly remove any overlays that may have been left in DOM
        try {
            document.querySelectorAll('.engine-start-overlay').forEach(el => el.remove());
        } catch (e) {}
        return null;
    }

    // Create a partial dim overlay over the dashboard wrapper that leaves the engine
    // start area visually clear and interactive. The overlay is a positioned DIV with
    // a CSS radial-gradient mask that creates a transparent 'hole' around the engine
    // coordinates (in pixels relative to the wrapper). We compute the hole position
    // from the embedded SVG engine-start-stop image bbox when possible.
    _createPartialDimOverlay() {
        try {
            const host = document.querySelector('.car-dashboard-wrapper');
            if (!host) return null;
            // Remove existing partial overlay
            host.querySelectorAll('.partial-dim-overlay, .engine-overlay-button').forEach(el => el.remove());

            // Find SVG image bbox for engine-start-stop
            let holeX = null, holeY = null, holeR = 36; // fallback radius
            try {
                const svg = this.carDashboardSVG;
                if (svg) {
                    const img = svg.getElementById('engine-start-stop');
                    if (img) {
                        const bb = img.getBBox();
                        // Convert SVG coordinates to host pixel coordinates by using boundingClientRect of the SVG container
                        const svgNode = document.getElementById('car-dashboard-svg');
                        if (svgNode) {
                            const svgRect = svgNode.getBoundingClientRect();
                            // SVG viewBox units map to rendered SVG size; approximate using ratio
                            const imgRect = img.getBoundingClientRect ? img.getBoundingClientRect() : null;
                            if (imgRect) {
                                holeX = imgRect.left + imgRect.width / 2 - host.getBoundingClientRect().left;
                                holeY = imgRect.top + imgRect.height / 2 - host.getBoundingClientRect().top;
                                holeR = Math.max( Math.max(imgRect.width, imgRect.height) / 2, 18 );
                            } else {
                                // Fallback: use SVG bbox and scale relative to container
                                const svgBox = svg.getBBox();
                                const svgEl = host.querySelector('svg');
                                if (svgEl) {
                                    const elRect = svgEl.getBoundingClientRect();
                                    const sx = elRect.width / svgBox.width;
                                    const sy = elRect.height / svgBox.height;
                                    const cx = bb.x + bb.width / 2;
                                    const cy = bb.y + bb.height / 2;
                                    holeX = (cx - svgBox.x) * sx + elRect.left - host.getBoundingClientRect().left;
                                    holeY = (cy - svgBox.y) * sy + elRect.top - host.getBoundingClientRect().top;
                                    holeR = Math.max(bb.width * sx, bb.height * sy) / 2;
                                }
                            }
                        }
                    }
                }
            } catch (e) { /* best effort */ }

            // If we couldn't compute exact hole coordinates, fallback to placing the hole near bottom-right area
            const hostRect = host.getBoundingClientRect();
            if (holeX === null || holeY === null) {
                holeX = hostRect.width - 80;
                holeY = hostRect.height - 80;
                holeR = 28;
            }

            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'partial-dim-overlay';
            overlay.setAttribute('aria-hidden', 'true');
            overlay.style.position = 'absolute';
            overlay.style.inset = '0';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '2';
            // Create a radial-gradient that is transparent in center (the hole) and dark around
            const cx = Math.round(holeX);
            const cy = Math.round(holeY);
            const r = Math.round(holeR + 16); // add some comfortable padding
            // Use background with circle at position (cx px cy px)
            overlay.style.background = `radial-gradient(circle at ${cx}px ${cy}px, rgba(0,0,0,0) ${Math.max(r-24,6)}px, rgba(0,0,0,0.55) ${r}px, rgba(0,0,0,0.85) 100%)`;

            // Add no transition so the dim appears instantly and without perceptible animation
            overlay.style.transition = 'none';
            overlay.style.opacity = '1';

            // Append overlay to host immediately (instant/imperceptible change)
            host.appendChild(overlay);
            // Create an overlayed HTML engine button to ensure clickability (but only if HTML button missing)
            try {
                const existingBtn = document.getElementById('engine-start-btn');
                if (!existingBtn) {
                    const btn = document.createElement('button');
                    btn.className = 'engine-overlay-button';
                    btn.setAttribute('aria-label', 'Start');
                    btn.style.position = 'absolute';
                    btn.style.left = (cx - holeR) + 'px';
                    btn.style.top = (cy - holeR) + 'px';
                    btn.style.width = (holeR*2) + 'px';
                    btn.style.height = (holeR*2) + 'px';
                    btn.style.border = 'none';
                    btn.style.background = 'transparent';
                    btn.style.zIndex = '3';
                    btn.style.cursor = 'pointer';
                    btn.style.pointerEvents = 'auto';
                    btn.addEventListener('click', (e) => { try { const svgImg = this.carDashboardSVG && this.carDashboardSVG.getElementById('engine-start-stop'); this._toggleEngineFromOverlay(btn, svgImg); } catch (ee) {} });
                    host.appendChild(btn);
                }
            } catch (e) {}

            // overlay applied instantly (no fade)
            return overlay;
        } catch (e) { return null; }
    }

    _removePartialDimOverlay() {
        try {
            const host = document.querySelector('.car-dashboard-wrapper');
            if (!host) return;
            host.querySelectorAll('.partial-dim-overlay, .engine-overlay-button').forEach(el => el.remove());
        } catch (e) {}
    }

    _toggleEngineFromOverlay(overlay, svgImg) {
        this.engineActive = !this.engineActive;
    try { if (svgImg) svgImg.classList.toggle('engine-active', !!this.engineActive); } catch (e) {}
    try { if (svgImg) svgImg.setAttribute('aria-pressed', String(!!this.engineActive)); } catch (e) {}
    try { overlay.setAttribute('aria-pressed', String(!!this.engineActive)); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('engine-toggle', { detail: { active: this.engineActive } })); } catch (e) {}
    try { this.applyPowerState(); } catch (e) {}
    }

    // Enforce that value 0 appears on the left and value 100 on the right.
    // In standard SVG coordinate system, left-of-center tick usually yields a larger positive or negative angle depending on orientation.
    // We'll simply check the x positions of the 0 and 100 tick centers and ensure the angle ordering matches increasing value moving rightwards.
    enforceLeftToRightOrientation() {
        if (!this.carDashboardSVG || !this.speedTickMap) return;
        const a0 = this.speedTickMap.get(0);
        const a100 = this.speedTickMap.get(100);
        if (typeof a0 !== 'number' || typeof a40 !== 'number') return;
        // Determine geometric left/right via tick rect centers
        try {
            const zeroRect = this.carDashboardSVG.querySelector('rect[x="432.12"][y="316.26"]');
            const maxRect = this.carDashboardSVG.querySelector('rect[x="629.35"][y="311.73"]');
            if (zeroRect && maxRect) {
                const b0 = zeroRect.getBBox(); const b1 = maxRect.getBBox();
                const leftIsZero = (b0.x + b0.width/2) < (b1.x + b1.width/2);
                // We want angle progression (value increases → pointer rotates from left tick toward right tick).
                // If current mapping rotates the opposite way (monotonic direction wrong), invert span around a0.
                const increasingMovesRight = a100 < a0; // typical if angles decrease when moving right
                if (leftIsZero && !increasingMovesRight) {
                    const inverted = new Map();
                    this.speedTickMap.forEach((ang, k) => {
                        if (k === 0) inverted.set(k, a0); else inverted.set(k, a0 - (ang - a0));
                    });
                    this.speedTickMap = inverted;
                    if (this.data && typeof this.data.gaugeValue !== 'undefined') this.updateSpeedPointer(this.data.gaugeValue);
                    console.debug('enforceLeftToRightOrientation: inverted mapping so angles decrease with value', { a0Original: a0, newA100: this.speedTickMap.get(100) });
                }
            }
        } catch (e) { console.warn('enforceLeftToRightOrientation error', e); }
    }

    // Validate svgElementMappings (from data) against the loaded SVG and normalize ids
    validateSvgMappings() {
        if (!this.data) return;
        // canonical key aliases to accept many naming variants from JSON
        const keyAliases = {
            'plantesting': 'seatbelt',
            'seatbelt': 'seatbelt',
            'leftindicator': 'leftIndicator',
            'rightindicator': 'rightIndicator',
            'headlight': 'headlight',
            'appetiteconsumption': 'appetiteConsumption',
            'appetite': 'appetiteConsumption',
            'changemanagement': 'changeManagement',
            'controlenvironment': 'controlEnvironment',
            'controlweaknesses': 'controlWeaknesses',
            'managementinfo': 'managementInfo',
            'controlprocesses': 'controlProcesses',
            'bcmresilience': 'bcmResilience',
            'capacity': 'capacity'
        };

        // helper to normalize key tokens (remove spaces/underscores and lowercase)
        const normKey = k => String(k || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

        // migrate controlSystems keys to canonical keys
        const oldControls = Object.assign({}, this.data.controlSystems || {});
        const newControls = {};
        Object.keys(oldControls).forEach(k => {
            const nk = normKey(k);
            const canonical = keyAliases[nk] || k;
            // prefer earliest value if collision
            if (newControls[canonical] === undefined) newControls[canonical] = oldControls[k];
            else console.debug('validateSvgMappings: controlSystems collision', { canonical, from: k });
        });
        this.data.controlSystems = newControls;

        // migrate svgElementMappings keys to canonical keys
        const oldMaps = Object.assign({}, this.data.svgElementMappings || {});
        const newMaps = {};
        Object.keys(oldMaps).forEach(k => {
            const nk = normKey(k);
            const canonical = keyAliases[nk] || k;
            if (!newMaps[canonical]) newMaps[canonical] = oldMaps[k];
            else console.debug('validateSvgMappings: svgElementMappings collision', { canonical, from: k });
        });
        this.data.svgElementMappings = newMaps;

        console.debug('validateSvgMappings: normalized controlSystems and svgElementMappings', { controlSystems: this.data.controlSystems, svgElementMappings: this.data.svgElementMappings });
        if (!this.carDashboardSVG || !this.data) return;
        const mappings = this.data.svgElementMappings || this.defaultSvgElementMappings;
        // Normalize any alternate keys to canonical keys (support PlanTesting -> seatbelt), case-insensitive
        const normalizeKeyAlias = (obj, aliasPattern, canonical) => {
            if (!obj) return;
            const found = Object.keys(obj).find(k => k.toLowerCase() === aliasPattern.toLowerCase());
            if (found && !obj[canonical]) {
                obj[canonical] = obj[found];
                delete obj[found];
                console.warn(`Normalized key '${found}' -> '${canonical}'`);
            }
        };
        normalizeKeyAlias(mappings, 'PlanTesting', 'seatbelt');
        normalizeKeyAlias(this.data.controlSystems, 'PlanTesting', 'seatbelt');
        const reverse = {};
        Object.entries(mappings).forEach(([system, svgId]) => {
            const resolved = this.resolveSvgId(svgId);
            const node = this.carDashboardSVG.getElementById(resolved || svgId);
            if (node) {
                // update mapping if resolution changed
                if (resolved && resolved !== svgId) {
                    mappings[system] = resolved;
                    console.warn(`svg mapping: '${system}' remapped '${svgId}' -> '${resolved}'`);
                }
                // track reverse mapping for duplicate detection
                const idKey = mappings[system];
                reverse[idKey] = (reverse[idKey] || 0) + 1;
            } else {
                // fallback to default if available
                const def = this.defaultSvgElementMappings[system];
                if (def && this.carDashboardSVG.getElementById(def)) {
                    mappings[system] = def;
                    reverse[def] = (reverse[def] || 0) + 1;
                    console.warn(`svg mapping: '${system}' missing '${svgId}', falling back to default '${def}'`);
                } else {
                    console.warn(`svg mapping: '${system}' -> '${svgId}' not found in SVG`);
                }
            }
        });
        // warn on duplicate mappings to same svg id
        Object.entries(reverse).forEach(([id, count]) => {
            if (count > 1) console.warn(`svg mapping: ${count} systems map to the same SVG id '${id}'`);
        });
        // persist any changes back onto data so future updates use resolved ids
        this.data.svgElementMappings = mappings;
    }

    updateSVGWarningLights() {
        if (!this.carDashboardSVG || !this.data) return;

        // If the engine is not active, avoid applying live colors which can cause a brief blink
        // during startup. Instead enforce the neutral powered-off visuals and skip the rest.
        if (!this.engineActive) {
            try {
                // enforce synchronously (with retries internally) and return early
                this.enforcePoweredOffSvgVisuals({ attempts: 6, delay: 140 }).catch(() => {});
            } catch (e) { /* ignore */ }
            return;
        }

        const statusColors = {
            'at-target': '#333333',
                'at-trigger': '#FFBF00',
                // read CSS variable for at-risk if available, else fallback
                'at-risk': (getComputedStyle(document.documentElement).getPropertyValue('--status-red') || '#D2222D').trim()
        };

    const mappings = this.data.svgElementMappings || this.defaultSvgElementMappings;
    // Precompute summary flags used later for indicators/headlight logic
    const anyAtRisk = Object.values(this.data.controlSystems || {}).some(raw => this.normalizeStatus(raw) === 'at-risk');
    const anyAtTrigger = Object.values(this.data.controlSystems || {}).some(raw => this.normalizeStatus(raw) === 'at-trigger');
    // allAtRisk true when we have at least one control and every control is at-risk
    const controlVals = Object.values(this.data.controlSystems || {});
    const allAtRisk = (controlVals.length > 0) && controlVals.every(raw => this.normalizeStatus(raw) === 'at-risk');

    // Resolve headlight id early so we can exclude it from the generic per-node pass
    const headlightMappingEarly = (this.data.svgElementMappings && this.data.svgElementMappings.headlight) || 'headlight-warning-light';
    const headlightResolvedIdEarly = this.resolveSvgId(headlightMappingEarly) || headlightMappingEarly;

    // Helper: determine whether an indicator (by resolved svg id) should be active based on
    // indicatorConditions and stressSituations in the JSON. Conditions may include 'allAtRisk'
    // or named stress flags like 'upcomingAudit'.
    const indicatorShouldActivate = (resolvedId) => {
        try {
            const conditions = (this.data.indicatorConditions && this.data.indicatorConditions[resolvedId]) || [];
            if (!Array.isArray(conditions) || !conditions.length) return false;
            // If any condition is satisfied, activate
            for (const cond of conditions) {
                if (cond === 'allAtRisk' && allAtRisk) return true;
                if (this.data.stressSituations && this.data.stressSituations[cond]) return true;
            }
            return false;
        } catch (e) { return false; }
    };

    // Build reverse mapping: svgId (resolved) -> [systems...]
    const reverse = {};
    Object.entries(mappings).forEach(([system, svgId]) => {
        // canonicalize known aliases to ledger keys used in data.controlSystems
        const sysNorm = String(system || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        const canonicalSystem = (sysNorm === 'plantesting') ? 'seatbelt' : system;
        const resolved = this.resolveSvgId(svgId) || svgId;
        if (!reverse[resolved]) reverse[resolved] = [];
        reverse[resolved].push(canonicalSystem);
    });

    // For each unique svg id, compute aggregated status from its systems and update the node once
    Object.entries(reverse).forEach(([resolvedId, systems]) => {
        // do not update the headlight in the generic pass — it is handled separately below
        if (resolvedId === headlightResolvedIdEarly) return;
        const node = this.carDashboardSVG.getElementById(resolvedId);
        if (!node) {
            // attempt substring fallback using first system token
            const sysToken = String(systems[0]).split(/(?=[A-Z])|[-_]/).pop();
            const found = Array.from(this.carDashboardSVG.querySelectorAll('[id]')).map(n => n.id).find(id => id.toLowerCase().includes(sysToken.toLowerCase()));
            if (found) {
                console.warn(`Remapped via token fallback: '${systems.join(',')}' -> '${found}'`);
                this.data.svgElementMappings = this.data.svgElementMappings || {};
                systems.forEach(s => this.data.svgElementMappings[s] = found);
            }
        }
        const effectiveStatus = systems.reduce((acc, system) => {
            const raw = this.data.controlSystems?.[system];
            const s = this.normalizeStatus(raw);
            // order of precedence: at-risk > at-trigger > at-target
            if (s === 'at-risk') return 'at-risk';
            if (s === 'at-trigger' && acc !== 'at-risk') return 'at-trigger';
            return acc;
        }, 'at-target');

        const color = statusColors[effectiveStatus] || statusColors['at-target'];
        const targetNode = this.carDashboardSVG.getElementById(resolvedId);
        if (!targetNode) return;

        // debug for temperature/abs nodes
        if (resolvedId && /temp-?warning-?light|temperature/i.test(resolvedId)) {
            console.debug('DBG temp-node update', { resolvedId, systems, effectiveStatus });
        }
        if (resolvedId && /abs-?warning-?light|abs/i.test(resolvedId)) {
            console.debug('DBG abs-node update', { resolvedId, systems, effectiveStatus });
        }

        targetNode.classList.remove('warning-blink');
        targetNode.style.filter = '';
        if (effectiveStatus !== 'at-target') {
            targetNode.style.filter = `drop-shadow(0 0 8px ${color})`;
            if (effectiveStatus === 'at-risk') targetNode.classList.add('warning-blink');
        }
        const shapes = targetNode.querySelectorAll('path, circle, rect, polygon, image');
        const hasVector = Array.from(shapes).some(s => /^(path|circle|rect|polygon)$/i.test(s.tagName));
        if (hasVector) {
            shapes.forEach(s => { if (/image/i.test(s.tagName)) return; s.setAttribute('fill', color); s.style.fill = color; });
        } else {
            // Only images inside this node: inject overlay indicator so color + glow visible
            this.ensureOverlayIndicator(targetNode, resolvedId, color, effectiveStatus);
        }
    });

        // Derived parking light: turn on when all mapped systems are in 'at-risk'
        try {
            const parkingNode = this.carDashboardSVG.getElementById('Traction-Control-Warning-Light');
            if (parkingNode) {
                const allAtRisk = Object.entries(mappings).every(([system]) => this.normalizeStatus(this.data.controlSystems[system]) === 'at-risk');
                const pColor = allAtRisk ? statusColors['at-risk'] : statusColors['at-target'];

                parkingNode.classList.remove('warning-blink');
                parkingNode.style.filter = '';
                if (allAtRisk) {
                    parkingNode.style.filter = `drop-shadow(0 0 8px ${pColor})`;
                    parkingNode.classList.add('warning-blink');
                }

                const pShapes = parkingNode.querySelectorAll('path, circle, rect, polygon');
                pShapes.forEach(s => {
                    s.setAttribute('fill', pColor);
                    s.style.fill = pColor;
                });
            }
        } catch (e) {
            // non-fatal if parking node isn't present
            console.warn('Parking light update failed', e);
        }

        this.updateDashboardStatus();

        // Indicators/headlight behavior per alerts: compute an overall alert severity
        try {
            const alerts = Array.isArray(this.data.alerts) ? this.data.alerts : [];
            // Determine highest severity among alerts: at-risk > at-trigger > none
            let overallAlert = null; // null | 'at-trigger' | 'at-risk'
            alerts.forEach(a => {
                const st = this.normalizeStatus(a.status || a);
                if (st === 'at-risk') overallAlert = 'at-risk';
                else if (st === 'at-trigger' && overallAlert !== 'at-risk') overallAlert = 'at-trigger';
            });

            // Resolve specific mapped IDs (prefer explicit mappings from data)
            const headlightMapping = (this.data.svgElementMappings && this.data.svgElementMappings.headlight) || 'headlight-warning-light';
            const leftMapping = (this.data.svgElementMappings && this.data.svgElementMappings.leftIndicator) || 'left-indicator-warning-light';
            const rightMapping = (this.data.svgElementMappings && this.data.svgElementMappings.rightIndicator) || 'right-indicator-warning-light';

            const headlightId = this.resolveSvgId(headlightMapping) || headlightMapping;
            const leftId = this.resolveSvgId(leftMapping) || leftMapping;
            const rightId = this.resolveSvgId(rightMapping) || rightMapping;

            // Headlight: controlled by indicatorConditions or allAtRisk; otherwise neutral
            const headlightNode = this.carDashboardSVG.getElementById(headlightId);
            if (headlightNode) {
                // Headlight is steady amber when its conditions are active; do not blink.
                headlightNode.classList.remove('warning-blink');
                headlightNode.style.filter = '';
                let color = '#333333';
                const activate = indicatorShouldActivate(headlightId);
                if (activate) {
                    color = '#FFBF00'; // amber steady
                    // no blinking for headlight; keep steady amber
                }
                const shapes = headlightNode.querySelectorAll('path, circle, rect, polygon');
                shapes.forEach(p => { p.setAttribute('fill', color); p.style.fill = color; });
            }

            // Indicators: left/right blink green when any at-risk; otherwise gray and steady
            const isRisk = overallAlert === 'at-risk';
            const indicatorColor = isRisk ? '#18b618' : '#333333';

            [leftId, rightId].forEach(id => {
                const node = this.carDashboardSVG.getElementById(id);
                if (!node) return;
                // determine whether this indicator should be active via indicatorConditions
                const activate = indicatorShouldActivate(id);
                const shapes = node.querySelectorAll('path, circle, rect, polygon');
                const fillColor = activate ? '#18b618' : '#333333';
                shapes.forEach(p => { p.setAttribute('fill', fillColor); p.style.fill = fillColor; });
                // Blink whenever active (regardless of severity). Glow only on isRisk.
                if (activate) node.classList.add('warning-blink'); else node.classList.remove('warning-blink');
                if (activate && isRisk) {
                    try { node.style.filter = `drop-shadow(0 0 8px ${fillColor})`; } catch (e) {}
                } else {
                    try { node.style.filter = ''; } catch (e) {}
                }
            });

            console.debug('DBG indicator/headlight updated', { overallAlert, headlightId, leftId, rightId, isRisk });
        } catch (e) {
            console.warn('Indicator/headlight update failed', e);
        }

        // Explicit fallback: ensure appetiteConsumption (fuel) always updates
        try {
            const appRaw = this.data.controlSystems?.appetiteConsumption;
            const appStatus = this.normalizeStatus(appRaw);
            const appColor = statusColors[appStatus] || statusColors['at-target'];
            const fuelMapping = (this.data.svgElementMappings && this.data.svgElementMappings.appetiteConsumption) || 'fuel-warning-light';
            const fuelId = this.resolveSvgId(fuelMapping) || 'fuel-warning-light';
            const fuelNode = this.carDashboardSVG.getElementById(fuelId);
            if (fuelNode) {
                fuelNode.classList.remove('warning-blink');
                fuelNode.style.filter = '';
                if (appStatus !== 'at-target') {
                    fuelNode.style.filter = `drop-shadow(0 0 8px ${appColor})`;
                    if (appStatus === 'at-risk') fuelNode.classList.add('warning-blink');
                }
                const fShapes = fuelNode.querySelectorAll('path, circle, rect, polygon, image');
                const fHasVector = Array.from(fShapes).some(s => /^(path|circle|rect|polygon)$/i.test(s.tagName));
                if (fHasVector) {
                    fShapes.forEach(s => { if (/image/i.test(s.tagName)) return; s.setAttribute('fill', appColor); s.style.fill = appColor; });
                } else {
                    this.ensureOverlayIndicator(fuelNode, fuelId, appColor, appStatus);
                }
                console.debug('DBG appetiteConsumption explicit update', { appRaw, appStatus, fuelMapping, fuelId, nodeExists: true });
            } else {
                console.debug('DBG appetiteConsumption explicit update', { appRaw, appStatus, fuelMapping, fuelId, nodeExists: false });
            }
        } catch (e) {
            console.warn('Failed explicit appetiteConsumption fuel update', e);
        }

        // Explicit fallback: ensure seatbelt (PlanTesting) always updates
        try {
            const seatRaw = this.data.controlSystems?.seatbelt ?? this.data.controlSystems?.PlanTesting;
            const seatStatus = (seatRaw && String(seatRaw).trim().toLowerCase()) === 'no' ? 'at-risk' : 'at-target';
            const seatColor = statusColors[seatStatus] || statusColors['at-target'];
            const seatId = (this.data.svgElementMappings && (this.data.svgElementMappings.seatbelt || this.data.svgElementMappings.PlanTesting)) || 'seatbelt-warning-light';
            const seatResolved = this.resolveSvgId(seatId) || seatId;
            const seatNode = this.carDashboardSVG.getElementById(seatResolved);
            if (seatNode) {
                seatNode.classList.remove('warning-blink');
                seatNode.style.filter = '';
                if (seatStatus !== 'at-target') {
                    seatNode.style.filter = `drop-shadow(0 0 8px ${seatColor})`;
                    if (seatStatus === 'at-risk') seatNode.classList.add('warning-blink');
                }
                const sShapes = seatNode.querySelectorAll('path, circle, rect, polygon, image');
                const sHasVector = Array.from(sShapes).some(s => /^(path|circle|rect|polygon)$/i.test(s.tagName));
                if (sHasVector) {
                    sShapes.forEach(s => { if (/image/i.test(s.tagName)) return; s.setAttribute('fill', seatColor); s.style.fill = seatColor; });
                } else {
                    this.ensureOverlayIndicator(seatNode, seatResolved, seatColor, seatStatus);
                }
                console.debug('DBG seatbelt explicit update', { seatRaw, seatStatus, seatId, seatResolved, nodeExists: true });
            } else {
                console.debug('DBG seatbelt explicit update', { seatRaw, seatStatus, seatId, seatResolved, nodeExists: false });
            }
        } catch (e) {
            console.warn('Failed explicit seatbelt update', e);
        }
    // refresh debug panel
    try { /* renderStatusPanel removed */ } catch (e) { /* non-fatal */ }
    }

    // Create or update an overlay circle used when a warning light group only contains <image> elements
    ensureOverlayIndicator(node, baseId, color, status) {
        if (!node) return;
        const overlayId = `${baseId}-status-overlay`;
        let overlay = node.querySelector(`#${overlayId}`);
        if (!overlay) {
            overlay = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            overlay.setAttribute('id', overlayId);
            // Derive center and radius from node's bbox
            let cx = 0, cy = 0, r = 10;
            try {
                const bb = node.getBBox();
                cx = bb.x + bb.width / 2;
                cy = bb.y + bb.height / 2;
                r = Math.min(bb.width, bb.height) / 2 * 0.55 || 10;
            } catch (e) { /* ignore */ }
            overlay.setAttribute('cx', cx.toFixed(2));
            overlay.setAttribute('cy', cy.toFixed(2));
            overlay.setAttribute('r', r.toFixed(2));
            overlay.setAttribute('pointer-events', 'none');
            // Ensure overlay sits above images
            node.appendChild(overlay);
        }
        // sync overlay color and visibility
        try { overlay.setAttribute('fill', color); overlay.style.fill = color; } catch (e) {}
        }

    // When the system is powered off we want every warning-light group to visually appear neutral.
    // This helper enforces a flat fill (#333333) and clears any glow/blink. It retries a few times
    // because the SVG or data may not be available immediately at startup.
    enforcePoweredOffSvgVisuals(opts = {}) {
        const attempts = Number(opts.attempts || 5);
        const delay = Number(opts.delay || 120);
        const targetFill = '#333333';
        const tryOnce = () => {
            if (!this.carDashboardSVG) return false;
            // select groups by id pattern or class name
            const candidates = Array.from(this.carDashboardSVG.querySelectorAll('[id]'))
                .filter(n => String(n.id || '').toLowerCase().endsWith('-warning-light') || String(n.className && n.className.baseVal || n.className || '').toLowerCase().includes('warning-light'));
            if (!candidates.length) return false;
            candidates.forEach(node => {
                try {
                    node.classList.remove('warning-blink');
                    node.style.filter = '';
                    // update child shapes
                    const shapes = node.querySelectorAll('path, circle, rect, polygon, image');
                    if (shapes && shapes.length) {
                        shapes.forEach(s => {
                            try {
                                if (/image/i.test(s.tagName)) return; // leave images alone
                                s.setAttribute('fill', targetFill);
                                s.style.fill = targetFill;
                            } catch (e) {}
                        });
                    } else {
                        // ensure overlay exists and is colored
                        try { this.ensureOverlayIndicator(node, node.id || 'unknown', targetFill, 'at-target'); } catch (e) {}
                    }
                } catch (e) { /* ignore individual node errors */ }
            });
            return true;
        };

        let attempt = 0;
        const run = () => {
            attempt += 1;
            const ok = tryOnce();
            if (ok) return Promise.resolve(true);
            if (attempt >= attempts) return Promise.resolve(false);
            return new Promise(resolve => setTimeout(() => resolve(run()), delay));
        };
        return run();
    }
    

    updateDashboardStatus() {
        if (!this.carDashboardSVG) return;

        const counts = { 'at-target': 0, 'at-trigger': 0, 'at-risk': 0 };
    Object.values(this.data.controlSystems || {}).forEach(raw => { const s = this.normalizeStatus(raw); if (counts[s] !== undefined) counts[s]++; });

        const main = this.carDashboardSVG.getElementById(this.data.dashboardElements?.mainStatusIndicator || 'main-status-indicator');
        if (main) {
            main.classList.remove('warning-blink');
            if (counts['at-risk'] > 0) {
                main.setAttribute('fill', '#D2222D'); main.style.fill = '#D2222D'; main.classList.add('warning-blink');
            } else if (counts['at-trigger'] > 0) {
                main.setAttribute('fill', '#FFBF00'); main.style.fill = '#FFBF00';
            } else {
                main.setAttribute('fill', '#00C853'); main.style.fill = '#00C853';
            }
        }

        const display = this.carDashboardSVG.getElementById(this.data.dashboardElements?.digitalDisplay || 'digital-display-text');
        if (display) {
            display.classList.remove('warning-blink');
            if (counts['at-risk'] > 0) {
                display.textContent = 'HIGH RISK'; display.setAttribute('fill', '#D2222D'); display.style.fill = '#D2222D'; display.classList.add('warning-blink');
            } else if (counts['at-trigger'] > 0) {
                display.textContent = 'MEDIUM RISK'; display.setAttribute('fill', '#FFBF00'); display.style.fill = '#FFBF00';
            } else {
                display.textContent = 'LOW RISK'; display.setAttribute('fill', '#00C853'); display.style.fill = '#00C853';
            }
        }
    }

    updateAlerts() {
        const list = document.getElementById('alert-list');
        if (!list || !this.data) return;
        list.innerHTML = '';
        // Support structured alerts: { id, message, status }
        const alerts = Array.isArray(this.data.alerts) ? this.data.alerts : [];
        // Determine highest-severity alert first (at-risk > at-trigger)
        let highest = null; // will hold the alert object
        alerts.forEach(a => {
            const status = this.normalizeStatus((typeof a === 'string') ? a : (a.status || a.state || 'at-trigger'));
            if (!highest && status) highest = { alert: a, status };
            else if (highest && highest.status !== 'at-risk' && status === 'at-risk') highest = { alert: a, status };
            else if (!highest && status === 'at-trigger') highest = { alert: a, status };
        });

        // Build list excluding the banner alert, then sort by severity so at-risk alerts appear first
        const highestId = (highest && highest.alert && typeof highest.alert === 'object') ? highest.alert.id : null;
        const highestMsg = (highest && (typeof highest.alert === 'string' ? highest.alert : (highest.alert.message || '')));
        const remaining = alerts.filter(a => {
            const aId = (a && typeof a === 'object') ? a.id : null;
            const aMsg = (typeof a === 'string') ? a : (a.message || '');
            if (highest) {
                if (aId && highestId && aId === highestId) return false;
                if (aMsg && highestMsg && aMsg.trim() === highestMsg.trim()) return false;
            }
            return true;
        });

        const severity = (a) => {
            const st = this.normalizeStatus((typeof a === 'string') ? a : (a.status || a.state || ''));
            if (st === 'at-risk') return 2;
            if (st === 'at-trigger') return 1;
            return 0;
        };

        remaining.sort((a, b) => severity(b) - severity(a));
        const toRender = remaining.slice(0, 4);

        let highestMessage = '';
        let highestStatus = null;
        if (highest) {
            highestMessage = (typeof highest.alert === 'string') ? highest.alert : (highest.alert.message || '');
            highestStatus = highest.status;
        }

        toRender.forEach(a => {
            const msg = (typeof a === 'string') ? a : (a.message || JSON.stringify(a));
            const stRaw = (typeof a === 'string') ? a : (a.status || a.state || 'at-trigger');
            const status = this.normalizeStatus(stRaw);
            const d = document.createElement('div');
            d.className = 'alert-item';
            d.setAttribute('data-status', status);
            d.textContent = msg;
            // if at-risk and not acknowledged yet, add blinking class and click handler
            if (status === 'at-risk') {
                const id = (a && typeof a === 'object' && a.id) ? a.id : msg;
                if (!this.acknowledgedAlerts.has(id)) d.classList.add('blinking');
                d.addEventListener('click', () => {
                    this.acknowledgedAlerts.add(id);
                    d.classList.remove('blinking');
                });
            }
            list.appendChild(d);
        });

        const critical = document.querySelector('.alert-critical');
        const alertMsgSpan = critical ? critical.querySelector('.alert-message') : null;
        if (critical) {
            // Banner: if highest is at-risk and not acknowledged, make banner blink; clicking acknowledges
            if (highestMessage) {
                const display = String(highestMessage).replace(/^\s*⚠️\s*/u, '');
                if (alertMsgSpan) alertMsgSpan.textContent = display;
                const highestId = (highest && highest.alert && typeof highest.alert === 'object') ? highest.alert.id : highestMessage;
                if (highest && highest.status === 'at-risk' && !this.acknowledgedAlerts.has(highestId)) {
                    critical.classList.add('blinking');
                } else {
                    critical.classList.remove('blinking');
                }
                // clicking banner acknowledges
                critical.onclick = () => { this.acknowledgedAlerts.add(highestId); critical.classList.remove('blinking'); };
            } else {
                critical.classList.remove('blinking');
                if (alertMsgSpan) alertMsgSpan.textContent = 'No critical alerts';
            }
        }
    }

    updateControlSystems() {
        Object.entries(this.data.controlSystems || {}).forEach(([system, rawStatus]) => {
            // Special handling for seatbelt / PlanTesting: accept 'yes'/'no' and map to statuses
            const keyNorm = String(system).trim().toLowerCase();
            let status = this.normalizeStatus(rawStatus);
            if (keyNorm === 'seatbelt' || keyNorm === 'plantesting') {
                const s = (rawStatus && String(rawStatus).trim().toLowerCase()) === 'no' ? 'at-risk' : 'at-target';
                status = s;
                // update the textual indicator for plan testing
                const pt = document.getElementById('plan-testing-value');
                if (pt) {
                    pt.textContent = (s === 'at-target') ? 'Yes' : 'No';
                    pt.style.color = (s === 'at-target') ? '#ccc' : '#D2222D';
                }
            }
            // lookup UI element: support PlanTesting key mapping to the same control id
            const mappingKey = (String(system).trim().toLowerCase() === 'plantesting') ? 'seatbelt' : system;
            const el = document.getElementById(this.controlItemMappings[mappingKey]);
            if (el) el.setAttribute('data-status', status);
        });
        // Also refresh any right-panel static text from data.rightPanel if present
        try { this.updateRightPanelText(); } catch (e) { /* non-fatal */ }
    }

    // Populate right-panel control names and status text from data.rightPanel when provided
    updateRightPanelText() {
        try {
            const rp = this.data && this.data.rightPanel;
            if (!rp) return;
            Object.entries(rp).forEach(([id, info]) => {
                try {
                    const el = document.getElementById(id);
                    if (!el) return;
                    const nameEl = el.querySelector('.control-name');
                    const statusEl = el.querySelector('.control-status');
                    if (info.name && nameEl) nameEl.textContent = info.name;
                    if (info.status && statusEl) {
                        // Keep the status-light span inside the status text if present
                        const light = statusEl.querySelector('.status-light');
                        statusEl.textContent = info.status + ' ';
                        if (light) statusEl.appendChild(light);
                    }
                } catch (e) { /* ignore per-control failures */ }
            });
        } catch (e) { /* non-fatal */ }
    }

    updateTimestamp() {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const el = document.getElementById('last-updated');
    if (el) el.textContent = `${date} ${time}`;
    // Note: do NOT sync this data-driven last-updated into the main dashboard footer.
    // The footer shows a live ISO 8601 clock (updated separately) per user request.
    }

    updateDashboard() {
        this.updateAlerts();
        this.updateControlSystems();
        this.updateSVGWarningLights();
    // Resolve speed gauge numeric value from data: prefer KRIs (may be a string like "46.31%"),
    // fall back to numeric gaugeValue. Normalize to Number for consistent pointer mapping.
    let gaugeRaw = (typeof this.data?.KRIs !== 'undefined') ? this.data.KRIs : ((typeof this.data?.gaugeValue !== 'undefined') ? this.data.gaugeValue : 0);
    let gaugeNumeric = this._parsePercentValue(gaugeRaw);
        try {
            // Always update the speed pointer from data so the visual matches the
            // incoming numeric value. If an animation is currently running we avoid
            // snapping and let that animation finish to preserve smoothness.
            if (!(this._speedAnim && this._speedAnim.cancelled === false)) {
                this.updateSpeedPointer(gaugeNumeric);
            } else {
                console.debug('Skipping immediate speed pointer update during active animation');
            }
        } catch (e) { /* non-fatal */ }
        const digital = document.getElementById('speed-gauge-value');
    if (digital) digital.textContent = gaugeNumeric.toFixed(2) + '%';
        if (this.carDashboardSVG) {
            const gaugeText = this.carDashboardSVG.getElementById('gauge-dynamic-value');
            if (gaugeText) gaugeText.textContent = this.engineActive ? (gaugeNumeric.toFixed(2) + '%') : '';
            const percentText = this.carDashboardSVG.getElementById('percent-dynamic-value');
            if (percentText) {
                    // Display and drive RPM needle from SRT (authoritative for RPM). Accept percent strings like "15%".
                    if (typeof this.data?.SRT !== 'undefined') {
                        const srtNum = this._parsePercentValue(this.data.SRT);
                        percentText.textContent = srtNum.toFixed(2) + '%';
                        // reflect SRT on rpm pointer dynamically
                        try { if (typeof this.setRpmPercent === 'function') this.setRpmPercent(srtNum); } catch (e) { console.warn('setRpmPercent error', e); }
                        // update any HTML rpm label if present
                        try { const rpmLabel = document.getElementById('rpm-value'); if (rpmLabel) rpmLabel.textContent = srtNum.toFixed(2) + '%'; } catch (e) {}
                    } else {
                        percentText.textContent = '';
                        try { if (typeof this.setRpmToZero === 'function') this.setRpmToZero(); } catch (e) { /* ignore */ }
                    }
            }
            const dyn287 = this.carDashboardSVG.getElementById('dynamic-value-287');
            if (dyn287) {
                // Prefer new key 'noOfMaterialIssues', fall back to legacy 'dynamicValue287'
                const v287 = (typeof this.data?.noOfMaterialIssues !== 'undefined') ? this.data.noOfMaterialIssues : this.data?.dynamicValue287;
                dyn287.textContent = (this.engineActive && typeof v287 !== 'undefined') ? String(v287) : '';
            }
            const dyn285 = this.carDashboardSVG.getElementById('dynamic-value-285');
            if (dyn285) {
                // Prefer new key 'appetiteConsumption', fall back to legacy 'dynamicValue285'
                const v285 = (typeof this.data?.appetiteConsumption !== 'undefined') ? this.data.appetiteConsumption : this.data?.dynamicValue285;
                dyn285.textContent = (this.engineActive && typeof v285 !== 'undefined') ? String(v285) : '';
            }
            const ytdEvents = this.carDashboardSVG.getElementById('ytd-risk-events');
            if (ytdEvents) {
                ytdEvents.textContent = (this.engineActive && typeof this.data?.ytdRiskEvents !== 'undefined') ? ('YTD Risk Events: ' + this.data.ytdRiskEvents) : '';
            }
            const mtdEvents = this.carDashboardSVG.getElementById('MTD-Risk-Events');
            if (mtdEvents) {
                // Accept either new camelCase key (mtdRiskEvents) or legacy key 'MTD Risk Events' from data files
                const mtdVal = (typeof this.data?.mtdRiskEvents !== 'undefined') ? this.data.mtdRiskEvents
                    : (typeof this.data?.['MTD Risk Events'] !== 'undefined' ? this.data['MTD Risk Events'] : undefined);
                mtdEvents.textContent = (this.engineActive && typeof mtdVal !== 'undefined') ? ('MTD Risk Events: ' + mtdVal) : '';
            }
            const grossLoss = this.carDashboardSVG.getElementById('gross-loss-value');
            if (grossLoss) {
                grossLoss.textContent = (this.engineActive && typeof this.data?.grossLossValue !== 'undefined') ? ('Gross Loss: ' + this.data.grossLossValue) : '';
            }
            const netLoss = this.carDashboardSVG.getElementById('net-loss-value');
            if (netLoss) {
                netLoss.textContent = (this.engineActive && typeof this.data?.netLossValue !== 'undefined') ? ('Net Loss: ' + this.data.netLossValue) : '';
            }
            const issuesOpen = this.carDashboardSVG.getElementById('issues-open-value');
            if (issuesOpen) {
                issuesOpen.textContent = (this.engineActive && typeof this.data?.issuesOpenValue !== 'undefined') ? ('Issues Open: ' + this.data.issuesOpenValue) : '';
            }
            // Ensure fuel & temperature pointers reflect the latest data values.
            // Use the setter helpers which perform calibration and smooth animation.
            try {
                if (typeof this.data?.fuelValue !== 'undefined') {
                    this.setFuelValue(this.data.fuelValue);
                }
                if (typeof this.data?.tempValue !== 'undefined') {
                    this.setTempValue(this.data.tempValue);
                }
            } catch (e) { /* non-fatal */ }
        }
    // Do not refresh the small '#last-updated' here; it is updated only when the JSON changes.
    }

    // Helper: parse percent strings like "46.31%" or numeric inputs into Number 0..100
    _parsePercentValue(raw) {
        if (typeof raw === 'number') return Number(raw);
        if (!raw) return 0;
        try {
            const s = String(raw).trim();
            const cleaned = s.replace('%', '').trim();
            const n = Number(cleaned);
            return Number.isFinite(n) ? n : 0;
        } catch (e) { return 0; }
    }

    startRealTimeUpdates() {
        if (this.updateInterval) clearInterval(this.updateInterval);
        this.updateInterval = setInterval(async () => {
            const changed = await this.loadData();
            if (changed) { this.updateDashboard(); console.log('Data updated'); }
        }, 5000);
    }

    // More robust watcher that focuses on detecting changes to data/risk-data.json and
    // updating the small last-updated label plus the dashboard when new data arrives.
    startDataWatcher(pollMs = 5000) {
        if (this._dataWatcherInterval) clearInterval(this._dataWatcherInterval);
        this._dataWatcherInterval = setInterval(async () => {
            try {
                // Prefer the live API endpoint if available (short timeout), otherwise fall back to the local file
                const fetchWithTimeout = (url, ms = 1500) => {
                    const controller = new AbortController();
                    const id = setTimeout(() => controller.abort(), ms);
                    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
                };

                let res = null;
                try {
                    res = await fetchWithTimeout(apiBase('/api/data?t=' + Date.now()), 1200);
                    if (!res || !res.ok) res = null;
                } catch (e) { res = null; }

                if (!res) {
                    try {
                        res = await fetch(`./data/risk-data.json?t=${Date.now()}`);
                        if (!res || !res.ok) return;
                    } catch (e) { return; }
                }

                const json = await res.json();
                const hash = JSON.stringify(json);
                if (hash !== this.lastDataHash) {
                    this.data = json;
                    this.lastDataHash = hash;
                    // update the small last-updated display using metadata if available
                    try {
                        const el = document.getElementById('last-updated');
                        let display = '';
                        if (json && json.metadata && json.metadata.lastUpdated) {
                            const dt = new Date(json.metadata.lastUpdated);
                            if (!isNaN(dt)) {
                                const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                const date = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                display = `${date} ${time}`;
                            }
                        }
                        if (!display) {
                            const now = new Date();
                            const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const date = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
                            display = `${date} ${time}`;
                        }
                        if (el) el.textContent = display;
                    } catch (e) { /* non-fatal */ }
                    // Apply the new data to the UI
                    try { this.updateDashboard(); } catch (e) { console.warn('updateDashboard after data watcher change failed', e); }
                    console.log('Data watcher: new data loaded');
                }
            } catch (e) { /* ignore transient network errors */ }
        }, pollMs);
    }

    // Normalize status strings from external data so synonyms are accepted.
    // Accepts values like 'trigger', 'at-trigger', 'risk', 'at-risk', 'target', 'at-target'
    normalizeStatus(raw) {
    if (raw === null || raw === undefined) return 'at-target';
    const s = String(raw).trim().toLowerCase();
    // normalize spaces/underscores to dashes and remove stray punctuation
    const normalized = s.replace(/[_\s]+/g, '-').replace(/[^a-z0-9\-]/g, '');

    // substring matching is tolerant: accepts 'at trigger', 'trigger', 'AT-TRIGGER', etc.
    if (normalized.includes('risk')) return 'at-risk';
    if (normalized.includes('trigger') || normalized === 't' || normalized.includes('warn') || normalized.includes('warning')) return 'at-trigger';
    if (normalized.includes('target') || normalized === 'ok' || normalized.includes('normal')) return 'at-target';

    // fallback
    return 'at-target';
    }

    // Resolve an SVG id from a candidate id using aliases or simple substring matching
    resolveSvgId(candidateId) {
        if (!candidateId || !this.carDashboardSVG) return candidateId;
        // alias map
        if (this.svgIdAliases && this.svgIdAliases[candidateId]) return this.svgIdAliases[candidateId];
        // direct existence
    if (this.carDashboardSVG.getElementById(candidateId)) return candidateId;
    // case-insensitive direct match
    const allIds = Array.from(this.carDashboardSVG.querySelectorAll('[id]')).map(n => n.id);
    const lower = candidateId.toLowerCase();
    const exactCI = allIds.find(id => id.toLowerCase() === lower);
    if (exactCI) return exactCI;
    // substring fallback: pick a meaningful token (avoid generic words like 'light' or 'warning')
    const tokens = String(candidateId).split(/[-_]/).map(t => t.trim()).filter(Boolean);
    const generic = new Set(['light', 'warning', 'warninglight', 'warn', 'indicator']);
    let token = tokens.find(t => !generic.has(t.toLowerCase()));
    if (!token) token = tokens[0] || tokens.pop();
        const all = this.carDashboardSVG.querySelectorAll('[id]');
            for (let i = 0; i < all.length; i++) {
                const id = all[i].id || '';
                if (id.toLowerCase().includes(token.toLowerCase())) return id;
            }
            console.debug('resolveSvgId: could not resolve', { candidateId, token, availableIds: allIds.slice(0,30) });
    // not found
    return null;
    }

    createSVGPlaceholder() {
        const container = document.getElementById('car-dashboard-svg');
        if (!container) return;
        container.innerHTML = `
            <svg viewBox="0 0 800 600" style="width:100%;height:100%">
                <rect width="800" height="600" fill="#1a1a1a"/>
                <text x="400" y="300" fill="#fff" text-anchor="middle">Dashboard Loading...</text>
                <g id="srs-warning-light"><circle cx="100" cy="100" r="20" fill="#333"/></g>
                <circle id="main-status-indicator" cx="400" cy="400" r="30" fill="#333"/>
                <text id="digital-display-text" x="400" y="500" fill="#fff" text-anchor="middle">LOADING</text>
            </svg>`;
    this.carDashboardSVG = container.querySelector('svg');
    // compute a small horizontal offset so the pointer hub aligns with the image center
    if (this.computePointerDxFromImage) this.computePointerDxFromImage();
    }

    // Map a numeric gauge value (0..100) to rotation angle in degrees.
    // Preference order: explicit speedTickMap -> artwork _gaugeCal -> endpoint slope (_speedAngle0Exact/_speedAngleSlope) -> default fallback
    valueToAngle(value) {
        const v = Math.max(0, Math.min(100, Number(value) || 0));
        // 1) Prefer explicit tick map when available for per-tick accuracy
        if (this.speedTickMap && this.speedTickMap.size > 1) {
            const speeds = Array.from(this.speedTickMap.keys()).sort((a,b)=>a-b);
            if (this.speedTickMap.has(v)) return this.speedTickMap.get(v);
            // extrapolate above last tick using last two known ticks
            if (v > speeds[speeds.length-1]) {
                const lastTick = speeds[speeds.length-1];
                const secondLastTick = speeds[speeds.length-2];
                const lastAngle = this.speedTickMap.get(lastTick);
                const secondLastAngle = this.speedTickMap.get(secondLastTick);
                const anglePerUnit = (lastAngle - secondLastAngle) / (lastTick - secondLastTick);
                return lastAngle + (anglePerUnit * (v - lastTick));
            }
            // interpolate between neighbor ticks
            let low = speeds[0], high = speeds[speeds.length-1];
            for (let i=0;i<speeds.length-1;i++){
                if (v > speeds[i] && v < speeds[i+1]) { low = speeds[i]; high = speeds[i+1]; break; }
            }
            const a0 = this.speedTickMap.get(low); const a1 = this.speedTickMap.get(high);
            const t = (v - low) / (high - low);
            return a0 + (a1 - a0) * t;
        }

        // 2) If we have a gauge calibration computed from artwork anchors, use it
        if (this._gaugeCal && typeof this._gaugeCal.angle0 === 'number' && typeof this._gaugeCal.angle100 === 'number') {
            const a0 = this._gaugeCal.angle0;
            const a100 = this._gaugeCal.angle100;
            // choose the shortest/well-oriented delta (avoid +/-360 wrap) that moves the needle visually upward for small positive steps
            const rawDelta = a100 - a0;
            const candidates = [rawDelta, rawDelta + 360, rawDelta - 360];
            const smallT = 0.02; const rad = (deg) => deg * Math.PI / 180; const yAt = (angleDeg) => Math.sin(rad(angleDeg));
            const baseY = yAt(a0);
            let best = candidates[0]; let bestUp = null;
            for (const d of candidates) {
                const ang = a0 + d * smallT;
                const y = yAt(ang);
                const up = (y < baseY);
                if (bestUp === null) { bestUp = up; best = d; }
                else if (up && !bestUp) { bestUp = up; best = d; }
            }
            const chosenDelta = best;
            return a0 + chosenDelta * (v / 100);
        }

        // 3) Use dynamic linear mapping from calibrated endpoints if available (computed from exact 0 and 100 rects)
        if (typeof this._speedAngle0Exact === 'number' && typeof this._speedAngleSlope === 'number') {
            return this._speedAngle0Exact + this._speedAngleSlope * v;
        }

        // 4) fallback linear mapping based on observed default transforms
        const angle0 = -9.98;  // default anchor
        const angle100 = -80.01;  // default anchor
        return angle0 + ((v / 100) * (angle100 - angle0));
    }

    // RPM runtime support removed. Related UI and APIs were cleaned from index.html and data.

    // --- Fuel pointer support ---
    calibrateFuelPointer(zeroRectSelector = 'rect.cls-18[x="711.38"][y="246.7"]', maxRectSelector = 'rect.cls-6[x="761.36"][y="304.85"]') {
        if (!this.carDashboardSVG) return false;
        try {
            const svg = this.carDashboardSVG;
            let r0 = svg.querySelector(zeroRectSelector);
            let r1 = svg.querySelector(maxRectSelector);
            // If the exact selectors don't match (SVG edited/optimized), try heuristics:
            if (!r0 || !r1) {
                try {
                    // try find rects near the fuel hub on the right-hand side
                    const rects = Array.from(svg.querySelectorAll('rect'));
                    if (!r0) {
                        r0 = rects.find(r => {
                            const x = Number(r.getAttribute('x')) || 0;
                            const y = Number(r.getAttribute('y')) || 0;
                            return x > (this.fuelHubX - 40) && x < (this.fuelHubX + 40) && y < (this.fuelHubY + 20) && y > (this.fuelHubY - 80);
                        }) || r0;
                    }
                    if (!r1) {
                        r1 = rects.find(r => {
                            const x = Number(r.getAttribute('x')) || 0;
                            const y = Number(r.getAttribute('y')) || 0;
                            return x > (this.fuelHubX + 40) && y > (this.fuelHubY - 20) && y < (this.fuelHubY + 80);
                        }) || r1;
                    }
                } catch (e) { /* ignore heuristic failures */ }
            }
            if (!r0 || !r1) {
                // Could not find explicit anchors; don't fail hard — fall back to a conservative default
                // Attempt to derive a0 from the current fuel-pointer transform if available
                try {
                    const g = svg.querySelector('#fuel-pointer');
                    if (g) {
                        const t = g.getAttribute('transform') || g.getAttribute('style') || '';
                        const m = (t || '').toString().match(/rotate\(([-0-9\.]+)\s+([0-9\.\-]+)\s+([0-9\.\-]+)\)/);
                        const a0 = m ? Number(m[1]) : -90; // default guess
                        const a200 = a0 + 120; // reasonable sweep
                        this._fuelAngle0 = a0;
                        this._fuelAngle200 = a200;
                        this._fuelAngleSlope = (a200 - a0) / 200;
                        console.debug('calibrateFuelPointer: fallback calibration applied', { a0: this._fuelAngle0, a200: this._fuelAngle200, slope: this._fuelAngleSlope });
                        // Ensure pointer rests at calibrated zero
                        try { if (g) g.setAttribute('transform', `rotate(${this._fuelAngle0} ${this.fuelHubX} ${this.fuelHubY})`); } catch (e) {}
                        return true;
                    }
                } catch (e) { /* ignore fallback errors */ }
                return false;
            }
            const b0 = r0.getBBox();
            const b1 = r1.getBBox();
            const c0x = b0.x + b0.width/2, c0y = b0.y + b0.height/2;
            const c1x = b1.x + b1.width/2, c1y = b1.y + b1.height/2;
            const a0 = Math.atan2(c0y - this.fuelHubY, c0x - this.fuelHubX) * 180 / Math.PI;
            const a200 = Math.atan2(c1y - this.fuelHubY, c1x - this.fuelHubX) * 180 / Math.PI;
            this._fuelAngle0 = a0;
            this._fuelAngle200 = a200;
            this._fuelAngleSlope = (a200 - a0) / 200;
            console.debug('calibrateFuelPointer', { a0, a200, slope: this._fuelAngleSlope });
            // Immediately apply zero-angle so pointer rests at calibrated zero
            try {
                const g = svg.querySelector('#fuel-pointer');
                if (g) {
                    try { g.style.transformOrigin = `${this.fuelHubX}px ${this.fuelHubY}px`; g.style.transition = 'transform 0s'; g.style.transform = `rotate(${a0}deg)`; } catch (e) {}
                    g.setAttribute('transform', `rotate(${a0} ${this.fuelHubX} ${this.fuelHubY})`);
                }
            } catch (e) { /* non-fatal */ }
            return true;
        } catch (e) { console.warn('calibrateFuelPointer failed', e); return false; }
    }

    updateFuelPointer(value) {
        if (!this.carDashboardSVG) return;
        const g = this.carDashboardSVG.querySelector('#fuel-pointer');
        if (!g) return;
        if (typeof this._fuelAngleSlope !== 'number') {
            // attempt auto-calibration with default selectors
            const ok = this.calibrateFuelPointer();
            if (!ok && typeof this._fuelAngleSlope !== 'number') {
                // final fallback: derive a usable mapping so the pointer can move
                try {
                    // If we have a stored last angle, use it as a0; otherwise pick a sensible default
                    const curTransform = g.getAttribute('transform') || '';
                    const m = (curTransform || '').toString().match(/rotate\(([-0-9\.]+)\s+([0-9\.\-]+)\s+([0-9\.\-]+)\)/);
                    const a0 = m ? Number(m[1]) : -90;
                    const a200 = a0 + 120;
                    this._fuelAngle0 = a0; this._fuelAngle200 = a200; this._fuelAngleSlope = (a200 - a0) / 200;
                    console.debug('updateFuelPointer: applied fallback calibration', { a0, a200, slope: this._fuelAngleSlope });
                } catch (e) { return; }
            }
        }
        const v = Math.max(0, Math.min(200, Number(value) || 0));
        const angle = this._fuelAngle0 + this._fuelAngleSlope * v;
        // smoothing via style.transform
        try { g.style.transformOrigin = `${this.fuelHubX}px ${this.fuelHubY}px`; g.style.transition = 'transform .35s cubic-bezier(.38,.01,.22,1)'; g.style.transform = `rotate(${angle}deg)`; } catch (e) {}
        g.setAttribute('transform', `rotate(${angle} ${this.fuelHubX} ${this.fuelHubY})`);
        this._lastFuelValue = v;
    }

    setFuelValue(val) {
        if (!this.data) this.data = {};
        const num = Number(val);
        if (!Number.isFinite(num)) return;
        this.data.fuelValue = Math.max(0, Math.min(200, num));
        try { this.updateFuelPointer(this.data.fuelValue); } catch (e) {}
    }

    // --- Temperature pointer support ---
    calibrateTempPointer() {
        if (!this.carDashboardSVG) return false;
        try {
            const svg = this.carDashboardSVG;
            // Use exact zero point from base64 image at 30.12,306.02
            const r0 = svg.querySelector('image[transform="translate(30.12 306.02) scale(.24)"]');
            // Use exact max point (40) from rect at 88.68,247.39
            const r1 = svg.querySelector('rect[x="88.68"][y="247.39"]');
            if (!r0 || !r1) return false;
            // Compute center for the zero marker robustly.
            let c0x, c0y;
            try {
                // Preferred: getBBox should return correct user-space bbox for the image
                const b0 = r0.getBBox();
                c0x = b0.x + b0.width / 2;
                c0y = b0.y + b0.height / 2;
            } catch (e) {
                // Fallback: parse transform and use image width/height with scale
                const t = r0.getAttribute('transform') || '';
                // match translate(x y) and scale(s)
                const translateMatch = t.match(/translate\(([^)]+)\)/);
                const scaleMatch = t.match(/scale\(([^)]+)\)/);
                let tx = 0, ty = 0, s = 1;
                if (translateMatch) {
                    const parts = translateMatch[1].trim().split(/[ ,]+/).map(parseFloat);
                    tx = Number(parts[0]) || 0; ty = Number(parts[1]) || 0;
                }
                if (scaleMatch) {
                    s = Number(scaleMatch[1]) || 1;
                }
                const w = Number(r0.getAttribute('width')) || 0;
                const h = Number(r0.getAttribute('height')) || 0;
                // Matches how other pointers compute displayed center: translate + (width*scale)/2
                c0x = tx + (w * s) / 2;
                c0y = ty + (h * s) / 2;
            }
            const b1 = r1.getBBox();
            const c1x = b1.x + b1.width / 2, c1y = b1.y + b1.height / 2;

            // If an explicit '2' tick exists (user provided), prefer mapping from tick-2 and tick-25
            const r2 = svg.querySelector('rect[x="34.28"][y="295.77"]');
            if (r2) {
                try {
                    const b2 = r2.getBBox();
                    const c2x = b2.x + b2.width/2, c2y = b2.y + b2.height/2;
                    const a2 = Math.atan2(c2y - this.tempHubY, c2x - this.tempHubX) * 180 / Math.PI;
                    const a25 = Math.atan2(c1y - this.tempHubY, c1x - this.tempHubX) * 180 / Math.PI;
                    // slope per unit between 2 and 25
                    const slopePerUnit = (a25 - a2) / (25 - 2);
                    const a0 = a2 - slopePerUnit * 2;
                    this._tempAngle0 = a0;
                    this._tempAngle25 = a25;
                    this._tempAngleSlope = (a25 - a0) / 25;
                    console.debug('calibrateTempPointer (from 2 & 25)', { a0, a2, a25, slope: this._tempAngleSlope, c0x, c0y, c2x, c2y, c1x, c1y, hubX: this.tempHubX, hubY: this.tempHubY });
                } catch (e) {
                    // fallback to using image-derived zero and 25
                    const a0 = Math.atan2(c0y - this.tempHubY, c0x - this.tempHubX) * 180 / Math.PI;
                    const a25 = Math.atan2(c1y - this.tempHubY, c1x - this.tempHubX) * 180 / Math.PI;
                    this._tempAngle0 = a0;
                    this._tempAngle25 = a25;
                    this._tempAngleSlope = (a25 - a0) / 25;
                    console.debug('calibrateTempPointer (fallback image)', { a0, a25, slope: this._tempAngleSlope, c0x, c0y, c1x, c1y, hubX: this.tempHubX, hubY: this.tempHubY });
                }
            } else {
                // No tick-2; use image-derived zero and 25
                const a0 = Math.atan2(c0y - this.tempHubY, c0x - this.tempHubX) * 180 / Math.PI;
                const a25 = Math.atan2(c1y - this.tempHubY, c1x - this.tempHubX) * 180 / Math.PI;
                this._tempAngle0 = a0;
                this._tempAngle25 = a25;
                this._tempAngleSlope = (a25 - a0) / 25;
                console.debug('calibrateTempPointer (image only)', { a0, a25, slope: this._tempAngleSlope, c0x, c0y, c1x, c1y, hubX: this.tempHubX, hubY: this.tempHubY });
            }

            // Immediately set the temp-pointer to the calibrated zero angle so it rests there
            try {
                const g = svg.querySelector('#temp-pointer');
                if (g) {
                    // initialize continuity state to avoid wrap/jump on first render
                    this._lastTempAngle = a0;
                    // set attribute transform only: avoid CSS transforms which use screen-space and
                    // can cause visual jumps when combined with SVG attribute transforms.
                    g.setAttribute('transform', `rotate(${a0} ${this.tempHubX} ${this.tempHubY})`);
                }
            } catch (e) { /* non-fatal */ }
            return true;
        } catch (e) { console.warn('calibrateTempPointer failed', e); return false; }
    }

    updateTempPointer(value) {
        if (!this.carDashboardSVG) return;
        const g = this.carDashboardSVG.querySelector('#temp-pointer');
        if (!g) return;
        if (typeof this._tempAngleSlope !== 'number') {
            // attempt auto-calibration with default selectors
            this.calibrateTempPointer();
            if (typeof this._tempAngleSlope !== 'number') return;
        }
    // Map input range 0..25 to calculated angle range
    const v = Math.max(0, Math.min(25, Number(value) || 0));
    const rawAngle = this._tempAngle0 + (this._tempAngleSlope * v);
        // Choose the nearest equivalent angle to the previous angle to avoid wrap/jump (account for +/-360 multiples)
        let targetAngle = rawAngle;
        if (typeof this._lastTempAngle === 'number') {
            const candidates = [rawAngle, rawAngle + 360, rawAngle - 360];
            let best = candidates[0];
            let bestDelta = Math.abs(candidates[0] - this._lastTempAngle);
            for (let i = 1; i < candidates.length; i++) {
                const d = Math.abs(candidates[i] - this._lastTempAngle);
                if (d < bestDelta) { best = candidates[i]; bestDelta = d; }
            }
            targetAngle = best;
        }

        // Animate attribute-based rotation smoothly to avoid jumps caused by CSS vs SVG transform spaces.
        const hubX = this.tempHubX, hubY = this.tempHubY;
        const duration = 350;
        const start = performance.now();
        const from = (typeof this._lastTempAngle === 'number') ? this._lastTempAngle : targetAngle;
        const to = targetAngle;
        // cancel any running temp animation
        if (this._tempAnim && this._tempAnim.cancel) this._tempAnim.cancelled = true;
        const anim = { cancelled: false };
        this._tempAnim = anim;
        const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
        const step = (now) => {
            if (anim.cancelled) return;
            const tnorm = Math.min(1, (now - start) / duration);
            const u = easeOutCubic(tnorm);
            const cur = from + (to - from) * u;
            g.setAttribute('transform', `rotate(${cur} ${hubX} ${hubY})`);
            if (tnorm < 1) requestAnimationFrame(step); else {
                this._lastTempAngle = to;
            }
        };
        requestAnimationFrame(step);
        this._lastTempValue = v;
    }

    setTempValue(val) {
        if (!this.data) this.data = {};
        const num = Number(val);
        if (!Number.isFinite(num)) return;
        this.data.tempValue = Math.max(0, Math.min(25, num));
        try { this.updateTempPointer(this.data.tempValue); } catch (e) {}
    }

    // (rpm API removed)

    // Compute horizontal offset (in SVG user units) so the pointer hub x aligns with
    // the center of the dashboard image. This keeps edits non-destructive: we only
    // apply a runtime translate to the existing `#speed-pointer` group.
    computePointerDxFromImage() {
        if (!this.carDashboardSVG) { this.pointerDx = 0; return; }
        // Prefer aligning to the known tick rect (class cls-3) at x=532.87,y=196.42
        let centerX = null;
        try {
            const rects = Array.from(this.carDashboardSVG.querySelectorAll('rect.cls-3'));
            for (const r of rects) {
                const rx = Number(r.getAttribute('x'));
                const ry = Number(r.getAttribute('y'));
                const rw = Number(r.getAttribute('width')) || 0;
                if (!Number.isFinite(rx) || !Number.isFinite(ry)) continue;
                // match this specific rect (tolerance to avoid float formatting issues)
                if (Math.abs(rx - 532.87) < 0.6 && Math.abs(ry - 196.42) < 0.6) {
                    centerX = rx + rw / 2;
                    break;
                }
            }
        } catch (e) {
            centerX = null;
        }

        // fallback: compute from the dashboard image center (previous behavior)
        if (centerX === null) {
            const img = this.carDashboardSVG.querySelector('image[transform*="translate(431.64 196.82) scale(.24)"]') || this.carDashboardSVG.querySelector('image');
            if (!img) { this.pointerDx = 0; return; }
            const w = Number(img.getAttribute('width')) || 0;
            const transform = img.getAttribute('transform') || '';
            let tx = 0, s = 1;
            const translateMatch = transform.match(/translate\(([^)]+)\)/);
            if (translateMatch) {
                const parts = translateMatch[1].trim().split(/[\s,]+/).map(Number);
                tx = parts[0] || 0;
            }
            const scaleMatch = transform.match(/scale\(([^)]+)\)/);
            if (scaleMatch) {
                const parts = scaleMatch[1].trim().split(/[\s,]+/).map(Number);
                s = parts[0] || 1;
            }
            centerX = tx + s * (w / 2);
        }

        const hubX = 535.38; // hub x used by the artwork / rotation center
        this.pointerDx = Number((centerX - hubX).toFixed(2));
        // reapply current pointer state so the translate takes effect immediately
        const g = this.carDashboardSVG.querySelector('#speed-pointer');
        if (g) {
            const cur = (this.data && typeof this.data.gaugeValue !== 'undefined') ? this.data.gaugeValue : 0;
            // reapply translate then rotate
            // store pointerDx for transform composition
            const dx = this.pointerDx || 0;
            try { g.setAttribute('transform', `translate(${dx} 0) rotate(0 ${this.gaugeHubX} ${this.gaugeHubY})`); } catch (e) {}
            this.updateSpeedPointer(cur);
        }
    }

    // Compute gauge calibration from two anchor rects embedded in the SVG.
    // Expects two rects (zeroRect and maxRect) with class 'cls-3' at positions
    // provided by the user. We'll compute their centers and derive the angles
    // relative to the pointer hub so value->angle interpolation can be linear.
    computeGaugeCalibrationFromRects() {
        try {
            if (!this.carDashboardSVG) return;
            // The artwork contains small rects near the ticks. We'll try to find
            // two rects that look like the anchors the user specified. Use a
            // heuristic: rects whose width/height are small and located roughly
            // in the right half of the dashboard (speed gauge area).
            const rects = Array.from(this.carDashboardSVG.querySelectorAll('rect'));
            if (!rects.length) return;
            // User-specified anchors (approximate) from request
            const zeroApprox = { x: 432.12, y: 316.26 };
            const maxApprox = { x: 629.35, y: 311.73 };
            const findClosest = (pts) => {
                let best = null; let bestD = Infinity;
                for (const r of rects) {
                    const rx = Number(r.getAttribute('x')) || 0;
                    const ry = Number(r.getAttribute('y')) || 0;
                    const rw = Number(r.getAttribute('width')) || 0;
                    const rh = Number(r.getAttribute('height')) || 0;
                    const cx = rx + rw / 2; const cy = ry + rh / 2;
                    const d = Math.hypot(cx - pts.x, cy - pts.y);
                    if (d < bestD) { bestD = d; best = {el: r, cx, cy, rw, rh}; }
                }
                return best;
            };
            const z = findClosest(zeroApprox);
            const m = findClosest(maxApprox);
            if (!z || !m) return;
            // Compute angles (degrees) from hub to these centers
            const hubX = this.gaugeHubX; const hubY = this.gaugeHubY;
            const angleFromHub = (cx, cy) => {
                // atan2 returns radians; convert to degrees and normalize so 0 is to the right
                const rad = Math.atan2(cy - hubY, cx - hubX);
                return rad * 180 / Math.PI;
            };
            const angle0 = angleFromHub(z.cx, z.cy);
            const angle100 = angleFromHub(m.cx, m.cy);
            // Store calibration: value 0 => angle0, value 100 => angle100
            this._gaugeCal = { angle0, angle100 };
        } catch (e) { /* ignore */ }
    }

    // Map a gauge numeric value (0..100) to an angle using calibration computed
    // from the artwork. Falls back to linear -90..+90 if calibration missing.
    valueToAngle(value) {
        const v = Math.max(0, Math.min(100, Number(value) || 0));
        if (this._gaugeCal && typeof this._gaugeCal.angle0 === 'number' && typeof this._gaugeCal.angle100 === 'number') {
            const a0 = this._gaugeCal.angle0;
            const a100 = this._gaugeCal.angle100;
            const t = v / 100;
            // We want the needle to move 'upwards' (visual y decreases) when
            // value increases from zero. There are two angular paths between
            // a0 and a40 (delta and delta +/- 360). Choose the one whose
            // small-step moves the needle tip upward.
            const rad = (deg) => deg * Math.PI / 180;
            const hubX = this.gaugeHubX, hubY = this.gaugeHubY;
            const yAt = (angleDeg) => Math.sin(rad(angleDeg)); // unit-radius y (relative to hub)
            const rawDelta = a100 - a0;
            // candidate deltas: rawDelta, rawDelta+360, rawDelta-360
            const candidates = [rawDelta, rawDelta + 360, rawDelta - 360];
            // evaluate which candidate produces an upward movement for a small t
            const smallT = 0.02; // small fraction of full range
            const baseY = yAt(a0);
            let best = candidates[0];
            let bestUp = null;
            for (const d of candidates) {
                const ang = a0 + d * smallT;
                const y = yAt(ang);
                const up = (y < baseY); // true if moved upward (y decreased)
                if (bestUp === null) { bestUp = up; best = d; }
                else if (up && !bestUp) { bestUp = up; best = d; }
            }
            const chosenDelta = best;
            return a0 + chosenDelta * t;
        }
        // fallback
        // fallback: prefer the visual upward movement from -90 towards +90
        const a0f = -90, a100f = 90;
        const rawDelta = a100f - a0f;
        const candidates = [rawDelta, rawDelta + 360, rawDelta - 360];
        const smallT = 0.02; const rad = (deg) => deg * Math.PI / 180; const yAt = (angleDeg) => Math.sin(rad(angleDeg));
        const baseY = yAt(a0f);
        let best = candidates[0]; let bestUp = null;
        for (const d of candidates) {
            const ang = a0f + d * smallT; const y = yAt(ang); const up = (y < baseY);
            if (bestUp === null) { bestUp = up; best = d; } else if (up && !bestUp) { bestUp = up; best = d; }
        }
        return a0f + best * (v / 100);
    }

    // Load the external risk-data.json and set the gauge value from its `gaugeValue` property.
    async loadRiskData() {
        try {
            const resp = await fetch('data/risk-data.json?t=' + Date.now());
            if (!resp.ok) return;
            const json = await resp.json();
                if (json && typeof json.gaugeValue !== 'undefined') {
                // Store the value but do NOT animate on initial load; the pointer
                // should remain resting at zero until the system/engine is started
                // or until the user interacts. Animation will occur on subsequent
                // calls to setGaugeValue or when animatePointersToCurrent() is used.
                try {
                    if (!this.data) this.data = {};
                    // Accept percent strings like "46.31%" or numeric values.
                    let gv = json.gaugeValue;
                    if (typeof gv === 'string') {
                        const cleaned = gv.replace('%', '').trim();
                        const num = Number(cleaned);
                        this.data.gaugeValue = isFinite(num) ? Math.max(0, Math.min(100, num)) : 0;
                    } else {
                        this.data.gaugeValue = Math.max(0, Math.min(100, Number(gv) || 0));
                    }
                    // update any dynamic text immediately
                    if (this.carDashboardSVG) {
                        const gaugeText = this.carDashboardSVG.getElementById('gauge-dynamic-value');
                        if (gaugeText) {
                                    gaugeText.textContent = Number(this.data.gaugeValue).toFixed(2) + '%';
                                    gaugeText.style.display = 'none';
                                }
                    }
                } catch (e) {}
            }
        } catch (e) { /* ignore */ }
    }

    // Rotate the pointer group with id 'speed-pointer' around the hub (535.38,307.38)
    updateSpeedPointer(value) {
        try {
            if (!this.carDashboardSVG) return;
            const g = this.carDashboardSVG.querySelector('#speed-pointer');
            if (!g) return;
            const v = Math.max(0, Math.min(100, Number(value) || 0));
            // map using calibrated mapping (falls back to linear if missing)
            const target = this.valueToAngle(v);
            // Debug: expose numeric and computed angle for verification
            try { console.debug('updateSpeedPointer', { value: v, angle: target }); } catch (e) {}
            const hubX = this.gaugeHubX, hubY = this.gaugeHubY;
            // Apply pointerDx translate if present by composing transforms
            const dx = this.pointerDx || 0;
            // If there's no previous angle, snap there immediately
            if (typeof this._lastPointerAngle !== 'number') {
                g.setAttribute('transform', `translate(${dx} 0) rotate(${target} ${hubX} ${hubY})`);
                this._lastPointerAngle = target;
                return;
            }
            // animate from last to target
            const from = this._lastPointerAngle;
            let to = target;
            // choose shortest equivalent to avoid wrapping
            const candidates = [to, to + 360, to - 360];
            to = candidates.reduce((best, cur) => Math.abs(cur - from) < Math.abs(best - from) ? cur : best, candidates[0]);
            if (this._speedAnim && this._speedAnim.cancel) this._speedAnim.cancelled = true;
            const anim = { cancelled: false }; this._speedAnim = anim;
            const start = performance.now(); const dur = 900;
            const ease = x => 1 - Math.pow(1 - x, 3);
            const step = (now) => {
                if (anim.cancelled) return;
                const t = Math.min(1, (now - start) / dur);
                const u = ease(t);
                const cur = from + (to - from) * u;
                g.setAttribute('transform', `translate(${dx} 0) rotate(${cur} ${hubX} ${hubY})`);
                if (t < 1) requestAnimationFrame(step); else this._lastPointerAngle = to;
            };
            requestAnimationFrame(step);
        } catch (e) { /* ignore */ }
    }

    // Force-set the speed pointer angle for value (0..40) immediately, regardless of engine state or ongoing animations.
    forceRotateSpeedPointer(value) {
        try {
            if (!this.carDashboardSVG) return;
            const g = this.carDashboardSVG.querySelector('#speed-pointer');
            if (!g) return;
            const v = Math.max(0, Math.min(100, Number(value) || 0));
            const target = this.valueToAngle(v);
            const hubX = this.gaugeHubX, hubY = this.gaugeHubY;
            const dx = this.pointerDx || 0;
            if (this._speedAnim && this._speedAnim.cancel) this._speedAnim.cancelled = true;
            g.setAttribute('transform', `translate(${dx} 0) rotate(${target} ${hubX} ${hubY})`);
            this._lastPointerAngle = target;
            this._lastGaugeValue = v;
        } catch (e) { /* ignore */ }
    }

    ensureSpeedPointer() {
        try {
            if (!this.carDashboardSVG) return;
            const g = this.carDashboardSVG.querySelector('#speed-pointer');
            if (g) return g;
            // If the artwork doesn't include the group (unlikely), do nothing here.
            return null;
        } catch (e) { return null; }
    }

    setGaugeValue(val) {
        if (!this.data) this.data = {};
        const num = Number(val);
        if (!Number.isFinite(num)) return;
    this.data.gaugeValue = Math.max(0, Math.min(100, num));
        // Update numeric display but keep it hidden when the engine is off
        if (this.carDashboardSVG) {
            const gaugeText = this.carDashboardSVG.getElementById('gauge-dynamic-value');
            if (gaugeText) {
                gaugeText.textContent = Number(this.data.gaugeValue).toFixed(2) + '%';
                try {
                    gaugeText.style.display = this.engineActive ? '' : 'none';
                } catch (e) {}
            }
        }
        // Only animate the pointer when engine is active
        if (this.engineActive) {
            try { this.updateSpeedPointer(this.data.gaugeValue); } catch (e) { /* non-fatal */ }
        }
        // Try to persist the single value back to data/risk-data.json via local dev server
        try {
            // best-effort: don't block or throw if server not running
            fetch((window.location.protocol === 'file:' ? 'http://localhost:3000' : '') + '/updateGauge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gaugeValue: this.data.gaugeValue + '%' })
            }).then(resp => resp.json().catch(() => null)).then(() => {/* ignore */}).catch(() => {/* ignore */});
        } catch (e) { /* ignore */ }
    }

    // Apply the global power state by toggling a class on <body> and syncing the button aria.
    applyPowerState() {
        try {
            document.body.classList.toggle('powered-off', !this.engineActive);
            const img = this.carDashboardSVG && this.carDashboardSVG.getElementById('engine-start-stop');
            if (img) {
                try { img.setAttribute('aria-pressed', String(!!this.engineActive)); } catch (e) {}
                try { img.classList.toggle('engine-active', !!this.engineActive); } catch (e) {}
            }
            // Manage powered-off visual overlay
            const host = document.querySelector('.car-dashboard-wrapper');
            if (host) {
                // Remove any legacy overlays that create a heavy dark background or duplicate start buttons.
                try {
                    host.querySelectorAll('.powered-off-overlay, .engine-start-overlay, .powered-off-start-button').forEach(el => el.remove());
                } catch (e) {}

                if (!this.engineActive) {
                    // Snap pointers to zero when turning off
                    this.snapPointersToZero();
                    // Ensure all pointers are visually at their calibrated zero
                    try { this.forceRotateSpeedPointer(0); } catch (e) {}
                    try { if (typeof this._fuelAngle0 === 'number') this.updateFuelPointer(0); } catch (e) {}
                    try { if (typeof this._tempAngle0 === 'number') this.updateTempPointer(0); } catch (e) {}
                    // RPM to zero
                    try { if (typeof this.setRpmToZero === 'function') this.setRpmToZero(); } catch (e) {}
                    // create a partial dim overlay that leaves the engine area clear
                    try { this._createPartialDimOverlay(); } catch (e) {}
                    // freeze containers to prevent layout shifts; make change instant
                    try { this._freezePoweredOffContainers(); } catch (e) {}
                } else {
                    // Remove the partial dim overlay when powering on
                    try { this._removePartialDimOverlay(); } catch (e) {}
                    // unfreeze containers to restore normal layout
                    try { this._unfreezePoweredOffContainers(); } catch (e) {}
                    // When turning on, animate to current data values
                    this.animatePointersToCurrent();
                    // RPM animate to current percent, if present
                    try {
                        const pv = (typeof this.data?.percentValue !== 'undefined') ? Number(this.data.percentValue) : null;
                        if (pv !== null && typeof this.setRpmPercent === 'function') this.setRpmPercent(pv);
                    } catch (e) { /* ignore */ }
                }
                // Reflect text fields immediately on power toggle
                try { this.updateDashboard(); } catch (e) { /* ignore */ }

                // When engine is off, set all control items to at-target and add status-forced-off
                try {
                    const items = Array.from(document.querySelectorAll('.control-item'));
                    if (!this.engineActive) {
                        items.forEach(el => {
                            el.setAttribute('data-status', 'at-target');
                            el.classList.add('status-forced-off');
                        });
                    } else {
                        // When engine is on, restore actual status from data and remove status-forced-off
                        Object.entries(this.data.controlSystems || {}).forEach(([system, rawStatus]) => {
                            const keyNorm = String(system).trim().toLowerCase();
                            let status = this.normalizeStatus(rawStatus);
                            if (keyNorm === 'seatbelt' || keyNorm === 'plantesting') {
                                const s = (rawStatus && String(rawStatus).trim().toLowerCase()) === 'no' ? 'at-risk' : 'at-target';
                                status = s;
                            }
                            const mappingKey = (String(system).trim().toLowerCase() === 'plantesting') ? 'seatbelt' : system;
                            const el = document.getElementById(this.controlItemMappings[mappingKey]);
                            if (el) {
                                el.setAttribute('data-status', status);
                                el.classList.remove('status-forced-off');
                            }
                        });
                    }
                } catch (e) { /* non-fatal */ }
                // Ensure SVG visuals reflect power state: when off, force all warning lights to neutral #333333;
                // when on, restore colors from data via updateSVGWarningLights(). Use a retry helper in case SVG
                // hasn't loaded yet.
                try {
                    if (!this.engineActive) {
                        // try to enforce powered-off visuals with retries
                        try { this.enforcePoweredOffSvgVisuals(); } catch (e) { /* ignore */ }
                    } else {
                        try { this.updateSVGWarningLights(); } catch (e) { /* ignore */ }
                    }
                } catch (e) { /* non-fatal */ }
            }
        } catch (e) { /* ignore */ }
    }

    // Set all pointers to calibrated zero positions
    snapPointersToZero() {
        try {
            // Speed
            if (this.carDashboardSVG) {
                const g = this.carDashboardSVG.querySelector('#speed-pointer');
                const a0 = this.valueToAngle(0);
                if (g) {
                    // preserve any pointerDx translate when snapping to zero
                    const dx = this.pointerDx || 0;
                    g.setAttribute('transform', `translate(${dx} 0) rotate(${a0} ${this.gaugeHubX} ${this.gaugeHubY})`);
                    // Reset animation continuity so next animate starts from zero
                    this._lastPointerAngle = a0;
                    this._lastGaugeValue = 0;
                }
            }
            // Fuel
            if (typeof this._fuelAngle0 === 'number') this.updateFuelPointer(0);
            // Temp
            if (this.carDashboardSVG) {
                const tp = this.carDashboardSVG.querySelector('#temp-pointer');
                if (tp && typeof this._tempAngle0 === 'number') {
                    tp.setAttribute('transform', `rotate(${this._tempAngle0} ${this.tempHubX} ${this.tempHubY})`);
                    this._lastTempAngle = this._tempAngle0;
                }
            }
        } catch (e) { /* ignore */ }
    }

    // Back-compat alias for earlier code paths
    setGaugeToZero() { try { this.snapPointersToZero(); } catch (e) { /* ignore */ } }

    // Animate pointers to their current data values when powering on
    animatePointersToCurrent() {
        try {
            // Prefer KRIs (authoritative for speed) and fall back to gaugeValue
            const rawK = (typeof this.data?.KRIs !== 'undefined') ? this.data.KRIs : ((typeof this.data?.gaugeValue !== 'undefined') ? this.data.gaugeValue : 0);
            const kNum = this._parsePercentValue(rawK);
            try { const gaugeText = this.carDashboardSVG && this.carDashboardSVG.getElementById('gauge-dynamic-value'); if (gaugeText) gaugeText.style.display = ''; } catch (e) {}
            this.updateSpeedPointer(kNum);
        } catch (e) { /* ignore */ }
        try {
            if (typeof this.data?.fuelValue !== 'undefined') this.updateFuelPointer(this.data.fuelValue);
        } catch (e) { /* ignore */ }
        try {
            if (typeof this.data?.tempValue !== 'undefined') this.updateTempPointer(this.data.tempValue);
        } catch (e) { /* ignore */ }
        // Ensure RPM animates to SRT when present
        try {
            if (this.carDashboardSVG && typeof this.data?.SRT !== 'undefined' && typeof this.setRpmPercent === 'function') {
                const srt = this._parsePercentValue(this.data.SRT);
                this.setRpmPercent(srt);
                try { const rpmLabel = document.getElementById('rpm-value'); if (rpmLabel) rpmLabel.textContent = this.engineActive ? (srt.toFixed(2) + '%') : ''; } catch (e) {}
            }
        } catch (e) { /* ignore */ }
    }

    // RPM: snap to zero immediately
    setRpmToZero() {
        const svg = this.carDashboardSVG; if (!svg) return;
        const el = svg.querySelector('#rpm-pointer'); if (!el) return;
        try {
            const hubNode = svg.querySelector('#rpm-pointer circle');
            let hubX = 255.58, hubY = 306.63;
            if (hubNode) { hubX = Number(hubNode.getAttribute('cx')) || hubX; hubY = Number(hubNode.getAttribute('cy')) || hubY; }
            const zeroMark = svg.getElementById('rpm-zero-mark');
            if (zeroMark) {
                const a0 = this._angleBetween(hubX, hubY, zeroMark);
                el.setAttribute('transform', `rotate(${a0} ${hubX} ${hubY})`);
                this._lastRpmAngle = a0;
            }
        } catch (e) { /* ignore */ }
    }

    // RPM subsystem removed: runtime pointer and APIs intentionally deleted

    // RPM pointer subsystem removed. Dynamic RPM pointer and APIs have been deleted per request.

    // RPM subsystem removed completely per request
}

(function boot() {
    const start = () => {
        const dashboard = new RiskDashboard();
        window.dashboard = dashboard;
        try { if (window.dashboard && typeof window.dashboard.setRpmToZero === 'function') window.dashboard.setRpmToZero(); } catch (e) {}
        window.setGauge = v => dashboard.setGaugeValue(v);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();