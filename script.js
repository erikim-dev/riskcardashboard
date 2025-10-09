// Remove any legacy overlay elements on page load to guarantee no duplicates
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.engine-start-overlay, .engine-overlay-button, .partial-dim-overlay, .powered-off-overlay, .powered-off-start-button').forEach(el => el.remove());
    // On load, sync main dashboard Last Updated if both elements exist
    var lastUpdated = document.getElementById('last-updated');
    var mainLastUpdated = document.getElementById('main-last-updated');
    if (lastUpdated && mainLastUpdated) {
        mainLastUpdated.textContent = lastUpdated.textContent;
        // Observe changes to #last-updated and sync
        var observer = new MutationObserver(function() {
            mainLastUpdated.textContent = lastUpdated.textContent;
        });
        observer.observe(lastUpdated, { childList: true, subtree: true });
    }
});
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
            // Inline dim application removed to allow external/alternate dim rules
            // try { this._applyInlineDim(); } catch (e) { /* ignore */ }
            this.attachFileLoader();
            try { this.wireControlItemPopups(); } catch (e) { /* ignore */ }
            this.updateDashboard();
            this.startRealTimeUpdates();
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
            document.querySelectorAll('.control-item').forEach(ci => {
                ci.classList.add('clickable');
                // remove any existing inline detail to avoid duplicates
                const existing = ci.querySelector('.control-inline-detail');
                if (existing) existing.remove();

                const renderDetail = () => {
                    // toggle panel
                    let wrapper = ci.querySelector('.control-inline-detail');
                    if (wrapper) { wrapper.remove(); return; }

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
                    wrapper.style.marginTop = '8px';
                    wrapper.style.padding = '8px';
                    wrapper.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))';
                    wrapper.style.border = '1px solid rgba(255,255,255,0.04)';
                    wrapper.style.borderRadius = '6px';

                    const grid = document.createElement('div');
                    grid.className = 'control-inline-grid';
                    grid.style.display = 'grid';
                    grid.style.gridTemplateColumns = '1fr';
                    grid.style.gap = '6px';

                    const mkRow = (label, val) => {
                        const row = document.createElement('div');
                        row.style.display = 'flex';
                        row.style.justifyContent = 'space-between';
                        row.style.gap = '8px';
                        const l = document.createElement('div'); l.style.fontWeight = '700'; l.style.color = '#e6eef5'; l.textContent = label;
                        const v = document.createElement('div'); v.style.color = '#d0d0d0'; v.textContent = val || '—';
                        row.appendChild(l); row.appendChild(v); return row;
                    };

                    if (record) {
                        // For Change Management (esp-control) and Control Weaknesses (temp-control)
                        // we must never display the Outcome row
                        if ((ci.id || '').toString() === 'esp-control' || (ci.id || '').toString() === 'temp-control' || (ci.id || '').toString() === 'bulb-control') {
                            // intentionally skip outcome display for esp-control, temp-control and bulb-control
                        } else {
                            // Determine label: use 'Overall Outcome' for key controls, otherwise 'Outcome'
                            const specialOverall = ['engine-control','fuel-control'];
                            const outcomeLabel = specialOverall.includes((ci.id || '').toString()) ? 'Overall Outcome' : 'Outcome';
                            grid.appendChild(mkRow(outcomeLabel, record.outcome || record.result || record.status || '—'));
                        }
                    } else {
                        // If there's no record, show nothing (suppress placeholders)
                    }

                    // Optionally include a small details table if more keys exist
                    if (record && Object.keys(record).length > 3) {
                        const details = document.createElement('div'); details.style.marginTop = '8px';
                        const table = document.createElement('table'); table.style.width = '100%'; table.style.borderCollapse = 'collapse';
                        Object.entries(record).forEach(([k,v]) => {
                            if (['measurement','threshold','outcome','key','limit','result','status'].includes(k)) return; // already shown
                            const tr = document.createElement('tr');
                            const td1 = document.createElement('td'); td1.style.padding = '6px 8px'; td1.style.fontWeight = '700'; td1.style.width = '40%'; td1.textContent = k;
                            const td2 = document.createElement('td'); td2.style.padding = '6px 8px'; td2.textContent = v;
                            tr.appendChild(td1); tr.appendChild(td2); table.appendChild(tr);
                        });
                        details.appendChild(table); wrapper.appendChild(details);
                    }

                    wrapper.appendChild(grid);

                    // insert after the header inside the control item
                    const header = ci.querySelector('.control-header');
                    if (header && header.parentNode) header.parentNode.insertBefore(wrapper, header.nextSibling);
                    else ci.appendChild(wrapper);
                    // scroll into view slightly to reveal the panel
                    try { wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
                };

                ci.addEventListener('click', (ev) => {
                    // ensure clicks on child anchors/buttons don't double-toggle
                    if (ev.target && (ev.target.closest('a') || ev.target.closest('button'))) return;
                    ev.preventDefault && ev.preventDefault();
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

            // Start with blinking state so the 'Open Service Card Status' draws attention
            try {
                const initialAction = el.querySelector('.service-card-action');
                if (initialAction && !initialAction.classList.contains('blinking')) initialAction.classList.add('blinking');
            } catch (e) { /* ignore */ }

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

                // Replace the action label with a return button when flipped; restore when unflipped.
                try {
                    const actionEl = el.querySelector('.service-card-action');
                    if (isFlipped) {
                        // create a focused, accessible return button
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'service-card-action service-card-return';
                        btn.textContent = 'Return to Main';
                        btn.setAttribute('aria-label', 'Return to Main');
                        // copy computed sizing from the original action element so the button matches visually
                        try {
                            if (actionEl) {
                                const cs = window.getComputedStyle(actionEl);
                                if (cs.fontSize) btn.style.fontSize = cs.fontSize;
                                if (cs.paddingTop && cs.paddingRight) btn.style.padding = `${cs.paddingTop} ${cs.paddingRight}`;
                                if (cs.lineHeight) btn.style.lineHeight = cs.lineHeight;
                                if (cs.minWidth) btn.style.minWidth = cs.minWidth;
                            }
                        } catch (e) {}
                        // Clicking the button should unflip (use stopPropagation to avoid double toggles)
                        btn.addEventListener('click', (e) => { e.stopPropagation(); toggleServicePanel(e); });
                        // Replace existing element (if present) or append
                        if (actionEl && actionEl.parentNode) actionEl.parentNode.replaceChild(btn, actionEl);
                        else el.querySelector('.service-card-inner')?.appendChild(btn);
                        try { btn.focus(); } catch (e) {}
                    } else {
                        // restore the original label text element (non-blinking)
                        const div = document.createElement('div');
                        div.className = 'service-card-action';
                        div.textContent = 'Open Service Card Status';
                        div.setAttribute('role', 'presentation');
            if (actionEl && actionEl.parentNode) actionEl.parentNode.replaceChild(div, actionEl);
                        else el.querySelector('.service-card-inner')?.appendChild(div);
                    }
                } catch (e) { /* ignore */ }

        // When opened (isFlipped true) ensure blinking is removed from any action elements
        try { if (isFlipped) { const a = el.querySelector('.service-card-action'); if (a && a.classList && a.classList.contains('blinking')) a.classList.remove('blinking'); } } catch (e) {}

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

    async loadData() {
        try {
            const res = await fetch(`./data/risk-data.json?t=${Date.now()}`);
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
                    const rawT = this.data && this.data.dynamicValue287;
                    if (typeof rawT !== 'undefined' && rawT !== null) {
                        const n = Number(String(rawT).toString().replace(/[^0-9.\-]/g, ''));
                        if (Number.isFinite(n)) {
                            this.data.tempValue = Math.max(0, Math.min(20, Math.round(n)));
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
            'rect.cls-3[x="432.12"][y="316.26"]',
            // 2
            'rect.cls-3[x="430.22"][y="300.33"]',
            // 4
            'rect.cls-3[x="438.76"][y="276.13"]',
            // 6
            'rect.cls-3[x="441.76"][y="261.1"]',
            // 8
            'rect.cls-3[x="450.31"][y="244.4"]',
            // 10
            'rect.cls-3[x="458.83"][y="231.54"]',
            // 12
            'rect.cls-3[x="471.82"][y="218.73"]',
            // 14
            'rect.cls-3[x="484.98"][y="209.59"]',
            // 16
            'rect.cls-3[x="500.82"][y="202.16"]',
            // 18
            'rect.cls-3[x="517.06"][y="197.92"]',
            // 20
            'rect.cls-3[x="532.87"][y="196.42"]',
            // 22
            'rect.cls-3[x="545.58"][y="203.53"]',
            // 24
            'rect.cls-3[x="559"][y="209.47"]',
            // 26
            'rect.cls-3[x="577.66"][y="215.2"]',
            // 28
            'rect.cls-3[x="587.03"][y="226.53"]',
            // 30
            'rect.cls-3[x="603.81"][y="237.15"]',
            // 32
            'rect.cls-3[x="607.39"][y="252.25"]',
            // 34
            'rect.cls-3[x="620.89"][y="266.71"]',
            // 36
            'rect.cls-3[x="617.35"][y="283.82"]',
            // 38
            'rect.cls-3[x="626.6"][y="300.33"]',
            // 40
            'rect.cls-3[x="629.35"][y="311.73"]'
        ];
        const scaleValues = [0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40];
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
            const zeroRect = svg.querySelector('rect.cls-3[x="432.12"][y="316.26"]');
            const maxRect = svg.querySelector('rect.cls-3[x="629.35"][y="311.73"]');
            if (zeroRect && maxRect) {
                const b0 = zeroRect.getBBox();
                const b1 = maxRect.getBBox();
                const c0x = b0.x + b0.width/2, c0y = b0.y + b0.height/2;
                const c1x = b1.x + b1.width/2, c1y = b1.y + b1.height/2;
                const a0 = Math.atan2(c0y - hubY, c0x - hubX) * 180 / Math.PI;
                let a40 = Math.atan2(c1y - hubY, c1x - hubX) * 180 / Math.PI;
                // unwrap a40 so it's the nearest equivalent relative to a0 (avoid crossing -180/180 seam)
                while (a40 - a0 > 180) a40 -= 360;
                while (a40 - a0 < -180) a40 += 360;
                this._speedAngle0Exact = a0;
                this._speedAngleSlope = (a40 - a0) / 40;
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
        for (let s = 1; s < 40; s += 1) {
            if (this.speedTickMap.has(s)) continue;
            let low = null, high = null;
            for (let v = s - 1; v >= 0; v--) if (this.speedTickMap.has(v)) { low = v; break; }
            for (let v = s + 1; v <= 40; v++) if (this.speedTickMap.has(v)) { high = v; break; }
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
    // Recompute precise midpoint angle for value 1 using actual tick rect centers to ensure it's exactly between 0 and 2
    try {
        if (this.carDashboardSVG && this.speedTickMap && this.speedTickMap.has(0) && this.speedTickMap.has(2)) {
            const svg = this.carDashboardSVG;
            const hubX = this.gaugeHubX, hubY = this.gaugeHubY;
            const r0 = svg.querySelector('rect.cls-3[x="432.12"][y="316.26"]');
            const r2 = svg.querySelector('rect.cls-3[x="430.22"][y="300.33"]');
            if (r0 && r2) {
                const b0 = r0.getBBox();
                const b2 = r2.getBBox();
                const c0x = b0.x + b0.width/2, c0y = b0.y + b0.height/2;
                const c2x = b2.x + b2.width/2, c2y = b2.y + b2.height/2;
                // Midpoint in Cartesian space, then convert to angle; this is more geometrically accurate than averaging angles if arc not perfectly linear
                const midX = (c0x + c2x)/2;
                const midY = (c0y + c2y)/2;
                const angle1 = Math.atan2(midY - hubY, midX - hubX) * 180 / Math.PI;
                this.speedTickMap.set(1, angle1);
                console.debug('Set angle for value 1 (geometric midpoint)', { angle1, angle0: this.speedTickMap.get(0), angle2: this.speedTickMap.get(2) });
            } else if (!this.speedTickMap.has(1)) {
                // fallback to pure angular midpoint if rects missing
                const a0 = this.speedTickMap.get(0), a2 = this.speedTickMap.get(2);
                this.speedTickMap.set(1, a0 + (a2 - a0)/2);
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
        const zeroRect = svg.querySelector('rect.cls-3[x="432.12"][y="316.26"]');
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

    // Ensure gauge value 40 points exactly at the specified max tick rectangle (629.35,311.73)
    calibrateMaxTick() {
        if (!this.carDashboardSVG || !this.speedTickMap || !this.speedTickMap.has(40)) return;
        const svg = this.carDashboardSVG;
        const hubX = this.gaugeHubX, hubY = this.gaugeHubY;
        const rect = svg.querySelector('rect.cls-3[x="629.35"][y="311.73"]');
        if (!rect) return;
        try {
            const b = rect.getBBox();
            const cx = b.x + b.width/2;
            const cy = b.y + b.height/2;
            const expectedMax = Math.atan2(cy - hubY, cx - hubX) * 180 / Math.PI;
            const a0 = this.speedTickMap.get(0);
            const currentMax = this.speedTickMap.get(40);
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
                    scaled.set(40, expectedMax);
                    this.speedTickMap = scaled;
                    if (this.data && typeof this.data.gaugeValue !== 'undefined') this.updateSpeedPointer(this.data.gaugeValue);
                    console.debug('calibrateMaxTick: span scaled', { expectedMax, currentMax, scale, desiredSpan, currentSpan });
                } else if (Math.abs(currentMax - expectedMax) > 0.01) {
                    // Minor snap only
                    this.speedTickMap.set(40, expectedMax);
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

    // Enforce that value 0 appears on the left and value 40 on the right.
    // In standard SVG coordinate system, left-of-center tick usually yields a larger positive or negative angle depending on orientation.
    // We'll simply check the x positions of the 0 and 40 tick centers and ensure the angle ordering matches increasing value moving rightwards.
    enforceLeftToRightOrientation() {
        if (!this.carDashboardSVG || !this.speedTickMap) return;
        const a0 = this.speedTickMap.get(0);
        const a40 = this.speedTickMap.get(40);
        if (typeof a0 !== 'number' || typeof a40 !== 'number') return;
        // Determine geometric left/right via tick rect centers
        try {
            const zeroRect = this.carDashboardSVG.querySelector('rect.cls-3[x="432.12"][y="316.26"]');
            const maxRect = this.carDashboardSVG.querySelector('rect.cls-3[x="629.35"][y="311.73"]');
            if (zeroRect && maxRect) {
                const b0 = zeroRect.getBBox(); const b1 = maxRect.getBBox();
                const leftIsZero = (b0.x + b0.width/2) < (b1.x + b1.width/2);
                // We want angle progression (value increases → pointer rotates from left tick toward right tick).
                // If current mapping rotates the opposite way (monotonic direction wrong), invert span around a0.
                const increasingMovesRight = a40 < a0; // typical if angles decrease when moving right
                if (leftIsZero && !increasingMovesRight) {
                    const inverted = new Map();
                    this.speedTickMap.forEach((ang, k) => {
                        if (k === 0) inverted.set(k, a0); else inverted.set(k, a0 - (ang - a0));
                    });
                    this.speedTickMap = inverted;
                    if (this.data && typeof this.data.gaugeValue !== 'undefined') this.updateSpeedPointer(this.data.gaugeValue);
                    console.debug('enforceLeftToRightOrientation: inverted mapping so angles decrease with value', { a0Original: a0, newA40: this.speedTickMap.get(40) });
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
            const parkingNode = this.carDashboardSVG.getElementById('parking-warning-light');
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

            // Headlight: amber when any alert at-trigger or at-risk, otherwise gray
            const headlightNode = this.carDashboardSVG.getElementById(headlightId);
            if (headlightNode) {
                const color = overallAlert ? '#FFBF00' : '#333333';
                headlightNode.classList.remove('warning-blink');
                headlightNode.style.filter = '';
                const shapes = headlightNode.querySelectorAll('path, circle, rect, polygon');
                shapes.forEach(p => { p.setAttribute('fill', color); p.style.fill = color; });
            }

            // Indicators: left/right blink green when any at-risk; otherwise gray and steady
            const isRisk = overallAlert === 'at-risk';
            const indicatorColor = isRisk ? '#18b618' : '#333333';

            [leftId, rightId].forEach(id => {
                const node = this.carDashboardSVG.getElementById(id);
                if (!node) return;
                const shapes = node.querySelectorAll('path, circle, rect, polygon');
                shapes.forEach(p => { p.setAttribute('fill', indicatorColor); p.style.fill = indicatorColor; });
                node.classList.toggle('warning-blink', isRisk);
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
        overlay.setAttribute('fill', color);
        overlay.style.fill = color;
        overlay.style.filter = (status !== 'at-target') ? `drop-shadow(0 0 6px ${color})` : '';
        overlay.classList.toggle('warning-blink', status === 'at-risk');
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
    }

    updateTimestamp() {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const el = document.getElementById('last-updated');
    if (el) el.textContent = `${date} ${time}`;
    // Sync to main dashboard footer
    const mainLastUpdated = document.getElementById('main-last-updated');
    if (mainLastUpdated) mainLastUpdated.textContent = el ? el.textContent : `${date} ${time}`;
    }

    updateDashboard() {
        this.updateAlerts();
        this.updateControlSystems();
        this.updateSVGWarningLights();
    const gaugeValue = (typeof this.data?.SRT !== 'undefined') ? this.data.SRT : ((typeof this.data?.gaugeValue !== 'undefined') ? this.data.gaugeValue : 0);
        try {
            if (!this.engineActive) {
                // car off: always force pointer to zero, even if animation is running
                this.setGaugeToZero();
                if (this._speedAnim && this._speedAnim.cancelled === false) {
                    this._speedAnim.cancelled = true;
                }
            } else {
                // If a speed animation is currently running, avoid overriding it with an immediate set
                if (!(this._speedAnim && this._speedAnim.cancelled === false)) {
                    this.updateSpeedPointer(gaugeValue);
                } else {
                    console.debug('Skipping immediate speed pointer update during initial sweep');
                }
            }
        } catch (e) { /* non-fatal */ }
        const digital = document.getElementById('speed-gauge-value');
        if (digital) digital.textContent = this.engineActive ? gaugeValue : '';
        if (this.carDashboardSVG) {
            const gaugeText = this.carDashboardSVG.getElementById('gauge-dynamic-value');
            if (gaugeText) gaugeText.textContent = this.engineActive ? gaugeValue : '';
            const percentText = this.carDashboardSVG.getElementById('percent-dynamic-value');
            if (percentText) {
                if (this.engineActive && typeof this.data?.percentValue !== 'undefined') {
                    percentText.textContent = this.data.percentValue + '%';
                    // reflect percentValue on rpm pointer dynamically (engine on)
                    try { if (typeof this.setRpmPercent === 'function') this.setRpmPercent(Number(this.data.percentValue)); } catch (e) { console.warn('setRpmPercent error', e); }
                } else {
                    percentText.textContent = '';
                    // keep rpm at zero while off
                    try { if (typeof this.setRpmToZero === 'function') this.setRpmToZero(); } catch (e) { /* ignore */ }
                }
            }
            const dyn287 = this.carDashboardSVG.getElementById('dynamic-value-287');
            if (dyn287) {
                dyn287.textContent = (this.engineActive && typeof this.data?.dynamicValue287 !== 'undefined') ? this.data.dynamicValue287 : '';
            }
            const dyn285 = this.carDashboardSVG.getElementById('dynamic-value-285');
            if (dyn285) {
                dyn285.textContent = (this.engineActive && typeof this.data?.dynamicValue285 !== 'undefined') ? this.data.dynamicValue285 : '';
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
        }
        this.updateTimestamp();
    }

    startRealTimeUpdates() {
        if (this.updateInterval) clearInterval(this.updateInterval);
        this.updateInterval = setInterval(async () => {
            const changed = await this.loadData();
            if (changed) { this.updateDashboard(); console.log('Data updated'); }
        }, 5000);
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

    // Map a numeric gauge value (0..40) to rotation angle in degrees.
    valueToAngle(value) {
        const v = Math.max(0, Math.min(40, Number(value) || 0));
        // Prefer explicit tick map when available for per-tick accuracy
        if (this.speedTickMap && this.speedTickMap.size > 1) {
            const speeds = Array.from(this.speedTickMap.keys()).sort((a,b)=>a-b);
            // exact match
            if (this.speedTickMap.has(v)) return this.speedTickMap.get(v);
            // find neighbors
            let low = speeds[0], high = speeds[speeds.length-1];
            for (let i=0;i<speeds.length-1;i++){
                if (v > speeds[i] && v < speeds[i+1]) { low = speeds[i]; high = speeds[i+1]; break; }
            }
            const a0 = this.speedTickMap.get(low); const a1 = this.speedTickMap.get(high);
            const t = (v - low) / (high - low);
            return a0 + (a1 - a0) * t;
        }
        // Otherwise, use dynamic linear mapping from calibrated endpoints (0 and 40) if available
        if (typeof this._speedAngle0Exact === 'number' && typeof this._speedAngleSlope === 'number') {
            return this._speedAngle0Exact + this._speedAngleSlope * v;
        }
        // fallback linear mapping 0 -> -90deg, 40 -> +90deg
        return -90 + (v / 40) * 180;
    }

    // RPM runtime support removed. Related UI and APIs were cleaned from index.html and data.

    // --- Fuel pointer support ---
    calibrateFuelPointer(zeroRectSelector = 'rect.cls-18[x="711.38"][y="246.7"]', maxRectSelector = 'rect.cls-6[x="761.36"][y="304.85"]') {
        if (!this.carDashboardSVG) return false;
        try {
            const svg = this.carDashboardSVG;
            const r0 = svg.querySelector(zeroRectSelector);
            const r1 = svg.querySelector(maxRectSelector);
            if (!r0 || !r1) return false;
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
            this.calibrateFuelPointer();
            if (typeof this._fuelAngleSlope !== 'number') return;
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
    calibrateTempPointer(zeroRectSelector = 'image[transform="translate(30.12 306.02) scale(.24)"]', maxRectSelector = 'rect.cls-24[x="88.68"][y="247.39"]') {
        if (!this.carDashboardSVG) return false;
        try {
            const svg = this.carDashboardSVG;
            // Try exact selector first, then a tolerant search
            let r0 = svg.querySelector(zeroRectSelector);
            if (!r0) {
                const imgs = Array.from(svg.querySelectorAll('image'));
                r0 = imgs.find(img => {
                    const t = img.getAttribute('transform') || '';
                    return t.includes('30.12') && t.includes('306.02') && (img.getAttribute('width') === '48' || img.getAttribute('height') === '11');
                });
            }
            const r1 = svg.querySelector(maxRectSelector);
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

            // If an explicit '2' tick exists (user provided), prefer mapping from tick-2 and tick-20
            const r2 = svg.querySelector('rect.cls-18[x="34.28"][y="295.77"]');
            if (r2) {
                try {
                    const b2 = r2.getBBox();
                    const c2x = b2.x + b2.width/2, c2y = b2.y + b2.height/2;
                    const a2 = Math.atan2(c2y - this.tempHubY, c2x - this.tempHubX) * 180 / Math.PI;
                    const a20 = Math.atan2(c1y - this.tempHubY, c1x - this.tempHubX) * 180 / Math.PI;
                    // slope per unit between 2 and 20
                    const slope = (a20 - a2) / (20 - 2);
                    const a0 = a2 - slope * 2;
                    this._tempAngle0 = a0;
                    this._tempAngle20 = a20;
                    this._tempAngleSlope = (a20 - a0) / 20;
                    console.debug('calibrateTempPointer (from 2 & 20)', { a0, a2, a20, slope: this._tempAngleSlope, c0x, c0y, c2x, c2y, c1x, c1y, hubX: this.tempHubX, hubY: this.tempHubY });
                } catch (e) {
                    // fallback to using image-derived zero and 20
                    const a0 = Math.atan2(c0y - this.tempHubY, c0x - this.tempHubX) * 180 / Math.PI;
                    const a20 = Math.atan2(c1y - this.tempHubY, c1x - this.tempHubX) * 180 / Math.PI;
                    this._tempAngle0 = a0;
                    this._tempAngle20 = a20;
                    this._tempAngleSlope = (a20 - a0) / 20;
                    console.debug('calibrateTempPointer (fallback image)', { a0, a20, slope: this._tempAngleSlope, c0x, c0y, c1x, c1y, hubX: this.tempHubX, hubY: this.tempHubY });
                }
            } else {
                // No tick-2; use image-derived zero and 20
                const a0 = Math.atan2(c0y - this.tempHubY, c0x - this.tempHubX) * 180 / Math.PI;
                const a20 = Math.atan2(c1y - this.tempHubY, c1x - this.tempHubX) * 180 / Math.PI;
                this._tempAngle0 = a0;
                this._tempAngle20 = a20;
                this._tempAngleSlope = (a20 - a0) / 20;
                console.debug('calibrateTempPointer (image only)', { a0, a20, slope: this._tempAngleSlope, c0x, c0y, c1x, c1y, hubX: this.tempHubX, hubY: this.tempHubY });
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
        const v = Math.max(0, Math.min(20, Number(value) || 0));
        const rawAngle = this._tempAngle0 + this._tempAngleSlope * v;
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
        this.data.tempValue = Math.max(0, Math.min(20, num));
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
                    this.data.gaugeValue = Math.max(0, Math.min(40, Number(json.gaugeValue) || 0));
                    // update any dynamic text immediately
                    if (this.carDashboardSVG) {
                        const gaugeText = this.carDashboardSVG.getElementById('gauge-dynamic-value');
                        if (gaugeText) {
                            gaugeText.textContent = this.data.gaugeValue;
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
            const v = Math.max(0, Math.min(40, Number(value) || 0));
            // map using calibrated mapping (falls back to linear if missing)
            const target = this.valueToAngle(v);
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
            const v = Math.max(0, Math.min(40, Number(value) || 0));
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
        this.data.gaugeValue = Math.max(0, Math.min(40, num));
        // Update numeric display but keep it hidden when the engine is off
        if (this.carDashboardSVG) {
            const gaugeText = this.carDashboardSVG.getElementById('gauge-dynamic-value');
            if (gaugeText) {
                gaugeText.textContent = this.data.gaugeValue;
                try {
                    gaugeText.style.display = this.engineActive ? '' : 'none';
                } catch (e) {}
            }
        }
        // Only animate the pointer when engine is active
        if (this.engineActive) {
            try { this.updateSpeedPointer(this.data.gaugeValue); } catch (e) { /* non-fatal */ }
        }
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
            const gv = (typeof this.data?.gaugeValue !== 'undefined') ? this.data.gaugeValue : 0;
            try { const gaugeText = this.carDashboardSVG && this.carDashboardSVG.getElementById('gauge-dynamic-value'); if (gaugeText) gaugeText.style.display = ''; } catch (e) {}
            this.updateSpeedPointer(gv);
        } catch (e) { /* ignore */ }
        try {
            if (typeof this.data?.fuelValue !== 'undefined') this.updateFuelPointer(this.data.fuelValue);
        } catch (e) { /* ignore */ }
        try {
            if (typeof this.data?.tempValue !== 'undefined') this.updateTempPointer(this.data.tempValue);
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