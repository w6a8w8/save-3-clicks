// ==UserScript==
// @name         M365 Copilot Auto Select
// @namespace    https://github.com/w6a8w8
// @version      1.8.5
// @description  Automatically select your preferred model and focus the prompt input in Microsoft 365 Copilot.
// @author       w6a8w8
// @license      MIT
// @homepageURL  https://github.com/w6a8w8/m365-copilot-auto-select
// @supportURL   https://github.com/w6a8w8/m365-copilot-auto-select/issues
// @updateURL    https://raw.githubusercontent.com/w6a8w8/m365-copilot-auto-select/main/m365-copilot-auto-select.user.js
// @downloadURL  https://raw.githubusercontent.com/w6a8w8/m365-copilot-auto-select/main/m365-copilot-auto-select.user.js
// @match        https://copilot.cloud.microsoft/*
// @match        https://m365.cloud.microsoft/chat*
// @noframes
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  const STORAGE_KEY = 'm365_copilot_auto_select_cfg_v1';
  const DEFAULTS = Object.freeze({
    modelPath: ['Think deeper'],
    switcherLabel: 'Think deeper',
    autoSelect: true,
    autoFocus: true,
    debug: false,
  });

  const SUPPORTED_URL_PREFIXES = [
    'https://copilot.cloud.microsoft/',
    'https://m365.cloud.microsoft/chat',
  ];
  const NEW_CHAT_BTN_SELECTOR =
    '[data-testid*="new-chat" i], [data-test-id*="new-chat" i], [aria-label*="New chat" i], [title*="New chat" i]';
  const SWITCHER_SELECTOR =
    'button[aria-haspopup="menu"], button[aria-haspopup="listbox"], [role="button"][aria-haspopup="menu"], [role="button"][aria-haspopup="listbox"]';
  const PROMPT_FIELD_SELECTOR =
    'textarea:not([disabled]), [contenteditable="true"][role="textbox"], [contenteditable="true"], [role="textbox"]:not([aria-disabled="true"])';
  const FORBIDDEN_PROMPT_ANCESTOR_SELECTOR =
    'header, [role="banner"], [role="search"], #search-box';
  const PROMPT_CONTAINER_SELECTOR =
    'form, [role="form"], [class*="chat"], [class*="input"], [class*="composer"]';
  const SEND_BUTTON_SELECTOR =
    'button[aria-label*="Send" i], button[title*="Send" i], button[data-testid*="send" i]';
  const MENU_ROOT_SELECTOR =
    '[role="menu"], [role="listbox"], [data-tabster*="mover"], [class*="popover"], [class*="menu"], :popover-open';
  const MENU_ITEM_SELECTOR =
    '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], button';
  const PARENT_MENU_ITEM_SELECTOR =
    '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]';
  const CHECKMARK_SELECTOR =
    'svg[data-testid*="check"], [data-icon-name*="Check"], [aria-label="Selected" i]';
  const TAKEOVER_PICKER_SELECTOR = `#gptModeSwitcher, ${SWITCHER_SELECTOR}, ${MENU_ROOT_SELECTOR}`;

  const RE_SWITCHER_KEYWORD =
    /\b(model selector|auto|automatic|quick response|think deeper|advanced reasoning|gpt|claude)\b/i;
  const PROMPT_NEGATIVE_TERMS = ['search', 'find', 'filter'];
  const OBSERVER_ATTR_FILTER = [
    'class',
    'style',
    'hidden',
    'disabled',
    'aria-disabled',
    'aria-checked',
    'aria-selected',
    'aria-expanded',
    'aria-hidden',
    'aria-label',
    'title',
    'contenteditable',
  ];

  const RE_WS = /\s+/g;
  const RE_DASHES = /[\u2010-\u2015\u2212-]/g;
  const RE_NON_ALNUM = /[^\p{L}\p{N}]+/gu;
  const MENU_IDS = {
    configure: 'm365-cas-configure',
    runNow: 'm365-cas-run-now',
    autoSelect: 'm365-cas-auto-select',
    autoFocus: 'm365-cas-auto-focus',
    reset: 'm365-cas-reset',
    debug: 'm365-cas-debug',
  };

  let cachedConfig = null;

  const isSupportedUrl = (url) =>
    SUPPORTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));

  function cleanPath(path) {
    if (!Array.isArray(path)) return [...DEFAULTS.modelPath];
    const cleaned = path.map((v) => String(v || '').trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : [...DEFAULTS.modelPath];
  }

  function loadConfig() {
    try {
      const raw = GM_getValue(STORAGE_KEY, null);
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') {
        return {
          modelPath: cleanPath(parsed.modelPath),
          switcherLabel:
            String(parsed.switcherLabel || '').trim() || DEFAULTS.switcherLabel,
          autoSelect:
            typeof parsed.autoSelect === 'boolean' ? parsed.autoSelect : DEFAULTS.autoSelect,
          autoFocus:
            typeof parsed.autoFocus === 'boolean' ? parsed.autoFocus : DEFAULTS.autoFocus,
          debug: typeof parsed.debug === 'boolean' ? parsed.debug : DEFAULTS.debug,
        };
      }
    } catch (_) {}
    return { ...DEFAULTS, modelPath: [...DEFAULTS.modelPath] };
  }

  function getConfig() {
    if (!cachedConfig) cachedConfig = loadConfig();
    return cachedConfig;
  }

  function saveConfig(cfg) {
    cachedConfig = { ...cfg, modelPath: cleanPath(cfg.modelPath) };
    GM_setValue(STORAGE_KEY, cachedConfig);
  }

  let debugEnabled = getConfig().debug;
  const log = (...args) => {
    if (debugEnabled) console.log('[M365 Copilot Auto Select]', ...args);
  };

  const norm = (s) => String(s || '').replace(RE_WS, ' ').trim().toLowerCase();
  const comparable = (s) =>
    norm(s).replace(RE_DASHES, ' ').replace(RE_NON_ALNUM, ' ').replace(RE_WS, ' ').trim();

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      return (
        el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        el.getClientRects().length > 0
      );
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isEditableElement(el) {
    return Boolean(
      el &&
        el !== document.body &&
        el !== document.documentElement &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable ||
          el.getAttribute('role') === 'textbox')
    );
  }

  function safeClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (typeof el.focus === 'function') el.focus({ preventScroll: true });

      const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerover', opts));
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
      }
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerup', opts));
      }
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.click();
      return true;
    } catch (err) {
      log('Click failed:', err);
      return false;
    }
  }

  function dispatchEscape() {
    const target =
      document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : document.body || document.documentElement;
    const init = {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  function sleep(ms, signal) {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const onAbort = () => {
        clearTimeout(id);
        resolve();
      };
      const id = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // rAF-coalesced, self-disconnecting DOM observer with active-only poll fallback
  function waitFor(fn, { root, timeout = 10000, attributes = true, pollInterval = 80, signal } = {}) {
    if (signal?.aborted) return Promise.resolve(null);
    const immediate = fn();
    if (immediate) return Promise.resolve(immediate);

    return new Promise((resolve) => {
      let settled = false;
      let rafId = null;
      let settleTimer = null;
      let pollTimer = null;
      let timer = null;

      const rawRoots = Array.isArray(root) ? root : [root];
      const targets = rawRoots.filter((n) => n && n.isConnected);
      if (targets.length === 0) {
        const fallback = document.body || document.documentElement;
        if (fallback) targets.push(fallback);
      }

      const finish = (val) => {
        if (settled) return;
        settled = true;
        obs.disconnect();
        if (rafId !== null) cancelAnimationFrame(rafId);
        if (timer) clearTimeout(timer);
        if (settleTimer) clearTimeout(settleTimer);
        if (pollTimer) clearInterval(pollTimer);
        signal?.removeEventListener('abort', onAbort);
        resolve(val);
      };

      const onAbort = () => finish(null);

      const check = () => {
        if (settled) return true;
        const res = fn();
        if (res) {
          finish(res);
          return true;
        }
        return false;
      };

      const obs = new MutationObserver(() => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (check()) return;
          if (!settleTimer) {
            settleTimer = setTimeout(() => {
              settleTimer = null;
              check();
            }, 160);
          }
        });
      });

      const obsOpts = {
        childList: true,
        subtree: true,
        attributes,
        ...(attributes ? { attributeFilter: OBSERVER_ATTR_FILTER } : {}),
      };
      for (const target of targets) obs.observe(target, obsOpts);

      if (pollInterval > 0) pollTimer = setInterval(check, pollInterval);
      timer = setTimeout(() => finish(null), timeout);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /*
   * ================================================================
   * COPILOT ELEMENT DETECTION
   * ================================================================
   */

  function getSwitcherText(switcher) {
    if (!switcher) return '';
    return norm(
      [switcher.textContent, switcher.getAttribute('aria-label'), switcher.getAttribute('title')]
        .filter(Boolean)
        .join(' ')
    );
  }

  function findSwitcherButton(expectedLabel = '') {
    const byId = document.getElementById('gptModeSwitcher');
    if (isVisible(byId)) return byId;

    const expected = comparable(expectedLabel);
    for (const el of document.querySelectorAll(SWITCHER_SELECTOR)) {
      if (!isVisible(el)) continue;
      const text = getSwitcherText(el);
      if (
        (expected && comparable(text).includes(expected)) ||
        RE_SWITCHER_KEYWORD.test(text)
      ) {
        return el;
      }
    }
    return null;
  }

  function isConfiguredModelActive(switcher, targetLabel) {
    if (!switcher) return false;
    const expected = comparable(targetLabel);
    if (!expected) return false;

    const visibleText = comparable(switcher.textContent);
    if (visibleText) {
      return visibleText === expected || visibleText.startsWith(`${expected} `);
    }

    const fallbackText = comparable(
      [switcher.getAttribute('aria-label'), switcher.getAttribute('title')]
        .filter(Boolean)
        .join(' ')
    );
    return (
      fallbackText === expected ||
      fallbackText.startsWith(`${expected} `) ||
      fallbackText.endsWith(` ${expected}`)
    );
  }

  function isEligiblePrompt(el) {
    if (
      !el ||
      !el.isConnected ||
      el.disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.getAttribute('contenteditable') === 'false'
    ) {
      return false;
    }
    if (el.tagName === 'INPUT' && el.type === 'search') return false;
    if (el.getAttribute('role') === 'searchbox') return false;
    if (el.closest(FORBIDDEN_PROMPT_ANCESTOR_SELECTOR)) return false;

    const meta = norm(
      [
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.getAttribute('title'),
        el.getAttribute('id'),
      ]
        .filter(Boolean)
        .join(' ')
    );
    return !PROMPT_NEGATIVE_TERMS.some((term) => meta.includes(term));
  }

  function findPromptField() {
    const valid = [];
    for (const el of document.querySelectorAll(PROMPT_FIELD_SELECTOR)) {
      if (isEligiblePrompt(el) && isVisible(el)) valid.push(el);
    }
    if (valid.length <= 1) return valid[0] || null;

    // Prefer an input inside a composer container with a Send button
    let best = valid[0];
    let bestRank = -1;
    for (const el of valid) {
      const container = el.closest(PROMPT_CONTAINER_SELECTOR);
      const rank =
        (container ? 2 : 0) +
        (container && container.querySelector(SEND_BUTTON_SELECTOR) ? 4 : 0) +
        (el.tagName === 'TEXTAREA' || el.getAttribute('role') === 'textbox' ? 1 : 0);
      if (rank > bestRank) {
        bestRank = rank;
        best = el;
      }
    }
    return best;
  }

  function getOpenMenus() {
    const menus = [];
    for (const el of document.querySelectorAll(MENU_ROOT_SELECTOR)) {
      if (isVisible(el) && el.querySelector(MENU_ITEM_SELECTOR)) {
        menus.push(el);
      }
    }
    return menus;
  }

  function getMenuItems(menu) {
    if (!menu) return [];
    const items = [];
    for (const item of menu.querySelectorAll(MENU_ITEM_SELECTOR)) {
      if (!isVisible(item)) continue;
      const parentItem = item.parentElement?.closest(PARENT_MENU_ITEM_SELECTOR);
      if (!parentItem || parentItem === item) items.push(item);
    }
    return items;
  }

  function findMenuItem(menu, label) {
    const target = comparable(label);
    if (!menu || !target) return null;

    let startsWithMatch = null;
    let includesMatch = null;

    for (const item of getMenuItems(menu)) {
      const rawValues = [
        item.getAttribute('aria-label'),
        item.getAttribute('title'),
        item.innerText || item.textContent,
      ];
      for (const raw of rawValues) {
        if (!raw) continue;
        const text = comparable(raw);
        if (!text) continue;
        if (text === target) return item;
        if (!startsWithMatch && text.startsWith(target)) startsWithMatch = item;
        else if (!includesMatch && text.includes(target)) includesMatch = item;
      }
    }
    return startsWithMatch || includesMatch;
  }

  function findLatestMenuWithLabel(label, excludedMenu = null) {
    const menus = getOpenMenus();
    for (let i = menus.length - 1; i >= 0; i--) {
      if (menus[i] !== excludedMenu && findMenuItem(menus[i], label)) {
        return menus[i];
      }
    }
    return null;
  }

  function isMenuItemSelected(item) {
    if (!item) return false;
    return (
      item.getAttribute('aria-checked') === 'true' ||
      item.getAttribute('aria-selected') === 'true' ||
      item.getAttribute('data-checked') === 'true' ||
      isVisible(item.querySelector(CHECKMARK_SELECTOR))
    );
  }

  /*
   * ================================================================
   * MODEL SELECTION & PROMPT AUTO-FOCUS
   * ================================================================
   */

  function placeCaretAtEnd(el) {
    if (!el.isContentEditable) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function focusPromptField(force, signal) {
    const input = await waitFor(findPromptField, { timeout: 10000, signal });
    if (!input || signal?.aborted) return false;

    const applyFocus = () => {
      if (signal?.aborted) return false;
      const target = isVisible(input) ? input : findPromptField();
      if (!target) return false;

      const active = document.activeElement;
      if (
        !force &&
        isEditableElement(active) &&
        active !== target &&
        !target.contains(active)
      ) {
        log('Prompt auto-focus skipped: another editable field is active');
        return false;
      }

      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (typeof target.focus === 'function') target.focus({ preventScroll: true });
      if (document.activeElement !== target && !target.contains(document.activeElement)) {
        target.click();
      }
      placeCaretAtEnd(target);
      return document.activeElement === target || target.contains(document.activeElement);
    };

    applyFocus();
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve(applyFocus()));
    });
  }

  async function openSubmenu(parentItem, previousMenu, nextLabel, signal) {
    const findNext = () => findLatestMenuWithLabel(nextLabel, previousMenu);

    if (!safeClick(parentItem)) return null;
    const opened = await waitFor(findNext, { timeout: 500, signal });
    if (opened || signal.aborted) return opened;

    // Fallback for accessible submenus expecting keyboard navigation
    if (typeof parentItem.focus === 'function') parentItem.focus({ preventScroll: true });
    parentItem.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        code: 'ArrowRight',
        keyCode: 39,
        which: 39,
        bubbles: true,
        cancelable: true,
        composed: true,
      })
    );
    return waitFor(findNext, { timeout: 3500, signal });
  }

  async function applyModelSelection(cfg, signal) {
    const switcher = await waitFor(
      () => {
        const btn = findSwitcherButton(cfg.switcherLabel);
        if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return null;
        return getSwitcherText(btn) ? btn : null;
      },
      { timeout: 10000, signal }
    );
    if (!switcher || signal.aborted) {
      log('Model switcher not found');
      return false;
    }

    // Zero-click early exit if the target model is already active
    if (isConfiguredModelActive(switcher, cfg.switcherLabel)) {
      log('Already on target model:', getSwitcherText(switcher));
      return true;
    }

    if (getOpenMenus().length > 0) {
      dispatchEscape();
      await sleep(80, signal);
      if (signal.aborted) return false;
    }

    if (!safeClick(switcher)) return false;

    let currentMenu = await waitFor(
      () => findLatestMenuWithLabel(cfg.modelPath[0]),
      { timeout: 2500, signal }
    );
    if (!currentMenu || signal.aborted) {
      log('Model menu did not open for:', cfg.modelPath[0]);
      return false;
    }

    for (let i = 0; i < cfg.modelPath.length; i++) {
      if (signal.aborted) return false;
      const label = cfg.modelPath[i];
      const isFinal = i === cfg.modelPath.length - 1;

      const item = await waitFor(() => findMenuItem(currentMenu, label), {
        root: currentMenu,
        timeout: 5000,
        signal,
      });
      if (!item || signal.aborted) {
        log(`Menu item ${i + 1}/${cfg.modelPath.length} not found:`, label);
        return false;
      }

      if (isFinal) {
        if (isMenuItemSelected(item)) {
          dispatchEscape();
          log('Final model already selected:', label);
          return true;
        }
        if (!safeClick(item)) return false;

        await waitFor(
          () => {
            const btn = findSwitcherButton(cfg.switcherLabel);
            return isConfiguredModelActive(btn, cfg.switcherLabel) ? btn : null;
          },
          { timeout: 4000, signal }
        );
        log('Selected model:', cfg.modelPath.join(' -> '));
        return !signal.aborted;
      }

      currentMenu = await openSubmenu(item, currentMenu, cfg.modelPath[i + 1], signal);
      if (!currentMenu || signal.aborted) {
        log('Submenu did not open for:', cfg.modelPath[i + 1]);
        return false;
      }
    }

    return false;
  }

  /*
   * ================================================================
   * RUNNER, USER TAKEOVER & ZERO-IDLE-OVERHEAD TRIGGERS
   * ================================================================
   */

  let activeController = null;
  let activeRunUrl = '';
  let lastRunUrl = '';
  let waitingForVisibility = false;
  let scheduledTimer = null;

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      waitingForVisibility = false;
      run(false);
    }
  };

  async function run(force = false) {
    const runUrl = location.href;
    if (!isSupportedUrl(runUrl)) return;
    if (!force && (lastRunUrl === runUrl || activeRunUrl === runUrl)) return;

    // Defer execution in background or prerendered tabs until visible
    if (!force && document.visibilityState !== 'visible') {
      if (!waitingForVisibility) {
        waitingForVisibility = true;
        document.addEventListener('visibilitychange', onVisibilityChange);
      }
      return;
    }

    if (waitingForVisibility) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      waitingForVisibility = false;
    }

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    activeRunUrl = runUrl;

    const cfg = getConfig();
    debugEnabled = cfg.debug;
    log('Running:', cfg);

    // Abort immediately if the user interacts with the picker or starts typing
    const onUserTakeover = (e) => {
      if (!e.isTrusted) return;
      if (e.type === 'keydown') {
        if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Escape' || e.key === 'Tab') return;
        if (e.target instanceof Element && e.target.closest(PROMPT_FIELD_SELECTOR)) {
          log('Aborted: user started typing');
          controller.abort();
        }
      } else if (e.type === 'pointerdown') {
        if (e.target instanceof Element && e.target.closest(TAKEOVER_PICKER_SELECTOR)) {
          log('Aborted: user interacted with picker');
          controller.abort();
        }
      }
    };

    document.addEventListener('keydown', onUserTakeover, { capture: true, passive: true });
    document.addEventListener('pointerdown', onUserTakeover, { capture: true, passive: true });

    try {
      let completed = true;
      if (force || cfg.autoSelect) {
        completed = await applyModelSelection(cfg, controller.signal);
        if (!completed && !controller.signal.aborted && getOpenMenus().length > 0) {
          dispatchEscape();
        }
      }

      if (!controller.signal.aborted && cfg.autoFocus) {
        await focusPromptField(force, controller.signal);
      }

      if (completed && !controller.signal.aborted && location.href === runUrl) {
        lastRunUrl = runUrl;
      }
    } catch (err) {
      if (!controller.signal.aborted && getOpenMenus().length > 0) dispatchEscape();
      console.error('[M365 Copilot Auto Select] Error:', err);
    } finally {
      document.removeEventListener('keydown', onUserTakeover, true);
      document.removeEventListener('pointerdown', onUserTakeover, true);
      if (activeController === controller) {
        activeController = null;
        activeRunUrl = '';
      }
    }
  }

  function scheduleRun(delay) {
    activeController?.abort();
    lastRunUrl = '';
    activeRunUrl = '';
    clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      run(false);
    }, delay);
  }

  /*
   * ================================================================
   * USERSCRIPT MENU COMMANDS
   * ================================================================
   */

  function registerMenuCommands() {
    const cfg = getConfig();

    GM_registerMenuCommand(
      `Configure model (${cfg.modelPath.join(' -> ')})`,
      () => {
        const current = getConfig();
        const pathInput = prompt(
          'Model menu path (separate submenu levels with |):\n' +
            'Examples: "Think deeper" or "GPT | GPT 5.6 Think deeper"\n' +
            'Tip: Use the exact labels shown in your Copilot UI language.',
          current.modelPath.join(' | ')
        );
        if (pathInput === null) return;

        const switcherInput = prompt(
          'Collapsed switcher label shown after selection:\n' +
            'Examples: "Think deeper" or "GPT 5.6 Think"',
          current.switcherLabel
        );
        if (switcherInput === null) return;

        const newPath = pathInput
          .split(/\r?\n|\|/)
          .map((v) => v.trim())
          .filter(Boolean);
        const newLabel = switcherInput.trim();
        if (newPath.length === 0 || !newLabel) {
          alert('Both fields are required.');
          return;
        }

        saveConfig({ ...current, modelPath: newPath, switcherLabel: newLabel });
        lastRunUrl = '';
        registerMenuCommands();
        run(true);
      },
      { id: MENU_IDS.configure }
    );

    GM_registerMenuCommand(
      'Run now',
      () => run(true),
      { id: MENU_IDS.runNow }
    );

    GM_registerMenuCommand(
      `Auto-select model: ${cfg.autoSelect ? 'ON' : 'OFF'}`,
      () => {
        const next = { ...getConfig(), autoSelect: !getConfig().autoSelect };
        saveConfig(next);
        registerMenuCommands();
        if (next.autoSelect) scheduleRun(100);
      },
      { id: MENU_IDS.autoSelect }
    );

    GM_registerMenuCommand(
      `Auto-focus prompt: ${cfg.autoFocus ? 'ON' : 'OFF'}`,
      () => {
        const next = { ...getConfig(), autoFocus: !getConfig().autoFocus };
        saveConfig(next);
        registerMenuCommands();
      },
      { id: MENU_IDS.autoFocus }
    );

    GM_registerMenuCommand(
      'Reset to defaults',
      () => {
        saveConfig({ ...DEFAULTS, modelPath: [...DEFAULTS.modelPath] });
        debugEnabled = DEFAULTS.debug;
        lastRunUrl = '';
        registerMenuCommands();
        run(true);
      },
      { id: MENU_IDS.reset }
    );

    GM_registerMenuCommand(
      `Debug logging: ${cfg.debug ? 'ON' : 'OFF'}`,
      () => {
        const next = { ...getConfig(), debug: !getConfig().debug };
        debugEnabled = next.debug;
        saveConfig(next);
        registerMenuCommands();
        console.log(`[M365 Copilot Auto Select] Debug logging ${next.debug ? 'enabled' : 'disabled'}`);
      },
      { id: MENU_IDS.debug }
    );
  }

  registerMenuCommands();

  // Zero-idle-overhead SPA route watching
  let prevHref = location.href;
  const onRouteChange = () => {
    if (location.href === prevHref) return;
    prevHref = location.href;
    scheduleRun(250);
  };

  const nav =
    typeof window.navigation !== 'undefined' &&
    typeof window.navigation.addEventListener === 'function'
      ? window.navigation
      : null;

  if (nav) {
    nav.addEventListener('navigatesuccess', onRouteChange);
    nav.addEventListener('currententrychange', onRouteChange);
  } else {
    window.addEventListener('popstate', onRouteChange);
  }

  // Trigger on in-place New Chat clicks that do not change the URL
  document.addEventListener(
    'click',
    (e) => {
      if (e.target instanceof Element && e.target.closest(NEW_CHAT_BTN_SELECTOR)) {
        scheduleRun(200);
      }
    },
    { capture: true, passive: true }
  );

  run(false);
})();