// ==UserScript==
// @name         Save3Clicks for M365 Copilot
// @namespace    anon.local.Save3Clicks
// @version      1.8.3
// @description  Automatically selects a preferred model and focuses the prompt field in Microsoft 365 Copilot.
// @match        https://copilot.cloud.microsoft/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  "use strict";

  /*
   * ================================================================
   * GUARD AGAINST DUPLICATE INITIALIZATION
   * ================================================================
   */
  if (window.__save3clicks_initialized) {
    return;
  }
  window.__save3clicks_initialized = true;

  /*
   * ================================================================
   * DEFAULT CONFIGURATION
   * ================================================================
   */

  const DEFAULT_MODEL_PATH = ["GPT", "GPT 5.6 Sol Hlubší přemýšlení"];
  const DEFAULT_SWITCHER_LABEL = "GPT 5.6 Sol Think";

  const CHAT_URL_PREFIX = "https://copilot.cloud.microsoft/";

  // Persistent Violentmonkey storage keys.
  const KEY_MODEL_PATH = "modelPath";
  const KEY_SWITCHER_LABEL = "switcherLabel";
  const KEY_SELECTION_ENABLED = "automaticSelectionEnabled";
  const KEY_FOCUS_ENABLED = "autoFocusEnabled";

  const NAVIGATION_DELAY_MS = 600;
  const ELEMENT_TIMEOUT_MS = 10000;
  const PROMPT_TIMEOUT_MS = 15000;
  // Precompute selector strings used by repeated DOM lookups.
  const PROMPT_FIELD_SELECTOR =
    'textarea:not([disabled]), [contenteditable="true"][role="textbox"], [contenteditable="true"], [role="textbox"]:not([aria-disabled="true"])';
  const SWITCHER_SELECTOR =
    'button[aria-haspopup="menu"], button[aria-haspopup="listbox"], [role="button"][aria-haspopup="menu"], [role="button"][aria-haspopup="listbox"]';

  // Internal state.
  let selectionInProgress = false;
  let selectionQueued = false;
  let pendingSelectionTimer = null;
  let pendingFocusTimer = null;
  let lastSuccessfulUrl = null;
  let switcherObserver = null;
  let observedSwitcherRoot = null;
  let pendingSwitcherFrame = null;
  let cachedPromptField = null;
  let cachedModelPath = null;
  let cachedSwitcherLabel = null;

  /*
   * ================================================================
   * CONFIGURATION
   * ================================================================
   */

  function getModelPath() {
    if (cachedModelPath) return [...cachedModelPath];
    const savedPath = GM_getValue(KEY_MODEL_PATH, DEFAULT_MODEL_PATH);
    if (!Array.isArray(savedPath)) {
      cachedModelPath = [...DEFAULT_MODEL_PATH];
      return [...cachedModelPath];
    }
    const cleanedPath = savedPath
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    cachedModelPath =
      cleanedPath.length > 0 ? cleanedPath : [...DEFAULT_MODEL_PATH];
    return [...cachedModelPath];
  }

  function setModelPath(path) {
    const cleanedPath = Array.isArray(path)
      ? path.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    cachedModelPath =
      cleanedPath.length > 0 ? cleanedPath : [...DEFAULT_MODEL_PATH];
    GM_setValue(KEY_MODEL_PATH, cachedModelPath);
  }
  // The collapsed selector text is configured independently from the expanded menu path.
  function getSwitcherLabel() {
    if (cachedSwitcherLabel === null)
      cachedSwitcherLabel =
        String(
          GM_getValue(KEY_SWITCHER_LABEL, DEFAULT_SWITCHER_LABEL) || "",
        ).trim() || DEFAULT_SWITCHER_LABEL;
    return cachedSwitcherLabel;
  }
  function setSwitcherLabel(label) {
    cachedSwitcherLabel = String(label || "").trim() || DEFAULT_SWITCHER_LABEL;
    GM_setValue(KEY_SWITCHER_LABEL, cachedSwitcherLabel);
  }

  function isAutomaticSelectionEnabled() {
    return GM_getValue(KEY_SELECTION_ENABLED, true);
  }

  function setAutomaticSelectionEnabled(enabled) {
    GM_setValue(KEY_SELECTION_ENABLED, Boolean(enabled));
  }

  function isAutoFocusEnabled() {
    return GM_getValue(KEY_FOCUS_ENABLED, true);
  }

  function setAutoFocusEnabled(enabled) {
    GM_setValue(KEY_FOCUS_ENABLED, Boolean(enabled));
  }

  /*
   * ================================================================
   * GENERAL UTILITIES
   * ================================================================
   */

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  function isCopilotChatPage() {
    return location.href.startsWith(CHAT_URL_PREFIX);
  }

  /**
   * Returns the rendered rectangle when an element is visibly rendered.
   * Returning the rectangle lets callers reuse the same layout measurement.
   */
  function getVisibleRect(element) {
    if (!element || !element.isConnected) return null;

    const rectangle = element.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) return null;

    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return null;
    }

    return rectangle;
  }

  function isVisible(element) {
    return getVisibleRect(element) !== null;
  }

  /**
   * Waits until a finder function returns a value.
   * Uses requestAnimationFrame to debounce DOM reads during heavy mutations.
   */
  function waitForElement(finder, timeout = ELEMENT_TIMEOUT_MS) {
    try {
      const immediateResult = finder();
      if (immediateResult) return Promise.resolve(immediateResult);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      let completed = false;
      let timeoutTimer = null;
      let frameRequest = null;

      function cleanup() {
        if (completed) return;
        completed = true;
        if (timeoutTimer !== null) clearTimeout(timeoutTimer);
        if (frameRequest !== null) cancelAnimationFrame(frameRequest);
        observer.disconnect();
      }

      function check() {
        if (completed) return;

        try {
          const result = finder();
          if (result) {
            cleanup();
            resolve(result);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      }

      const observer = new MutationObserver(() => {
        // Schedule at most one DOM check per animation frame. Continuous
        // mutations cannot postpone the check indefinitely.
        if (frameRequest !== null) return;

        frameRequest = requestAnimationFrame(() => {
          frameRequest = null;
          check();
        });
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "aria-expanded",
          "aria-hidden",
          "aria-label",
          "title",
          "style",
          "class",
          "contenteditable",
          "disabled",
        ],
      });

      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for a Copilot interface element"));
      }, timeout);

      // Immediately check the current DOM instead of waiting for another mutation.
      check();
    });
  }

  /**
   * Safe click implementation compatible with Firefox sandboxing.
   * Deliberately tries focus before synthetic clicking.
   */
  function safeClick(element) {
    if (!element) return false;

    try {
      element.scrollIntoView({ block: "nearest", inline: "nearest" });

      // Attempt native focus first as requested.
      if (typeof element.focus === "function") {
        element.focus({ preventScroll: true });
      }

      const commonOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
      };

      element.dispatchEvent(new MouseEvent("mouseover", commonOptions));
      element.dispatchEvent(new MouseEvent("mousemove", commonOptions));
      element.dispatchEvent(new MouseEvent("mousedown", commonOptions));
      element.dispatchEvent(new MouseEvent("mouseup", commonOptions));
      element.click();

      return true;
    } catch (error) {
      console.warn("[Save3Clicks] Click failed:", error);
      return false;
    }
  }

  /*
   * ================================================================
   * PROMPT FIELD DETECTION AND AUTO-FOCUS
   * ================================================================
   */

  function scorePromptCandidate(element) {
    // 1. Cheap structural and semantic checks first to avoid layout thrashing
    if (
      element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      element.getAttribute("contenteditable") === "false"
    ) {
      return -Infinity;
    }

    // Strictly forbid global M365 search boxes to prevent unwanted focus
    if (element.tagName === "INPUT" && element.type === "search")
      return -Infinity;
    if (element.getAttribute("role") === "searchbox") return -Infinity;
    if (
      element.closest('header, [role="banner"], [role="search"], #search-box')
    )
      return -Infinity;

    // 2. Perform the necessary layout and style reads once, after the
    // cheap checks have rejected unsuitable candidates.
    const rectangle = getVisibleRect(element);
    if (!rectangle) return -Infinity;
    const searchableText = normalizeText(
      [
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.getAttribute("id"),
        element.getAttribute("class"),
      ]
        .filter(Boolean)
        .join(" "),
    );

    let score = 0;
    const verticalPosition = rectangle.top / Math.max(window.innerHeight, 1);
    score += verticalPosition * 100;
    score += Math.min(rectangle.width / 10, 100);

    if (element.tagName === "TEXTAREA") score += 80;
    if (element.getAttribute("role") === "textbox") score += 50;
    if (element.isContentEditable) score += 50;

    const positiveTerms = [
      "prompt",
      "message",
      "chat",
      "copilot",
      "ask",
      "type",
      "draft",
      "compose",
      "input",
    ];
    for (const term of positiveTerms) {
      if (searchableText.includes(term)) score += 30;
    }

    const negativeTerms = ["search", "find", "filter"];
    for (const term of negativeTerms) {
      if (searchableText.includes(term)) score -= 150;
    }

    const surroundingContainer = element.closest(
      'form, [role="form"], [class*="chat"], [class*="input"], [class*="composer"]',
    );
    if (surroundingContainer) {
      score += 30;
      const sendControl = surroundingContainer.querySelector(
        [
          'button[aria-label*="Send" i]',
          'button[title*="Send" i]',
          'button[data-testid*="send" i]',
        ].join(", "),
      );
      if (sendControl) score += 100;
    }

    return score;
  }

  function getPromptField() {
    if (!isCopilotChatPage()) return null;

    // Reuse the cached prompt only while it remains connected, visible,
    // enabled, editable, and semantically suitable.
    if (
      cachedPromptField &&
      cachedPromptField.isConnected &&
      Number.isFinite(scorePromptCandidate(cachedPromptField))
    ) {
      return cachedPromptField;
    }

    cachedPromptField = null;

    const candidates = document.querySelectorAll(PROMPT_FIELD_SELECTOR);
    // Only the highest-scoring candidate is needed, so avoid allocating
    // ranking objects and sorting the entire candidate list.
    let bestCandidate = null;
    let bestScore = -Infinity;

    for (const element of candidates) {
      const score = scorePromptCandidate(element);

      if (score > bestScore) {
        bestCandidate = element;
        bestScore = score;
      }
    }

    cachedPromptField = bestCandidate;
    return cachedPromptField;
  }

  function placeCaretAtEnd(element) {
    if (!element.isContentEditable) return;
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function focusPromptField(force = false) {
    if (!isCopilotChatPage()) return false;
    if (!force && !isAutoFocusEnabled()) return false;

    let promptField;
    try {
      promptField = await waitForElement(
        () => getPromptField(),
        PROMPT_TIMEOUT_MS,
      );
    } catch (error) {
      console.warn("[Save3Clicks] Prompt field was not found:", error);
      return false;
    }

    const activeElement = document.activeElement;
    const userIsEditing =
      activeElement &&
      activeElement !== document.body &&
      activeElement !== document.documentElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.isContentEditable ||
        activeElement.getAttribute("role") === "textbox");

    // Do not steal focus if the user is already typing in another valid field
    if (!force && userIsEditing && activeElement !== promptField) {
      console.log(
        "[Save3Clicks] Prompt auto-focus skipped because another editable field is active.",
      );
      return false;
    }

    try {
      promptField.scrollIntoView({ block: "nearest", inline: "nearest" });

      // First, try native focus as mandated
      if (typeof promptField.focus === "function") {
        promptField.focus({ preventScroll: true });
      }

      // If focus failed to take effect, fallback to synthetic click
      if (document.activeElement !== promptField) {
        promptField.click();
      }

      placeCaretAtEnd(promptField);

      // Verify focus on the next animation frame. Copilot may replace
      // the prompt node while completing a render.
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          const currentPrompt = getPromptField() || promptField;
          const currentActiveElement = document.activeElement;
          const anotherEditableIsActive =
            currentActiveElement &&
            currentActiveElement !== document.body &&
            currentActiveElement !== document.documentElement &&
            currentActiveElement !== currentPrompt &&
            (currentActiveElement.tagName === "INPUT" ||
              currentActiveElement.tagName === "TEXTAREA" ||
              currentActiveElement.isContentEditable ||
              currentActiveElement.getAttribute("role") === "textbox");

          // Do not undo a newer user action that occurred after the
          // original focus check.
          if (!force && anotherEditableIsActive) {
            console.log(
              "[Save3Clicks] Delayed prompt focus skipped because another editable field is active.",
            );
            resolve(false);
            return;
          }

          if (currentPrompt && typeof currentPrompt.focus === "function") {
            currentPrompt.focus({ preventScroll: true });
            placeCaretAtEnd(currentPrompt);
          }

          // Some rich-text editors focus a descendant of the selected
          // prompt container, so treat that as a successful focus too.
          const focusedElement = document.activeElement;
          const success = Boolean(
            currentPrompt &&
            (focusedElement === currentPrompt ||
              currentPrompt.contains(focusedElement)),
          );

          if (success) {
            console.log("[Save3Clicks] Prompt field focused successfully.");
          } else {
            console.warn("[Save3Clicks] Prompt focus verification failed.");
          }
          resolve(success);
        });
      });
    } catch (error) {
      console.warn("[Save3Clicks] Prompt focus failed with exception:", error);
      return false;
    }
  }

  function schedulePromptFocus(delay = 100, force = false) {
    if (pendingFocusTimer !== null) {
      clearTimeout(pendingFocusTimer);
    }

    pendingFocusTimer = setTimeout(() => {
      pendingFocusTimer = null;

      // Do not close or disrupt an open model-selection menu.
      if (selectionInProgress && !force) {
        schedulePromptFocus(250);
        return;
      }

      focusPromptField(force).catch((error) => {
        console.warn("[Save3Clicks] Scheduled prompt focus failed:", error);
      });
    }, delay);
  }

  /*
   * ================================================================
   * COPILOT INTERFACE DETECTION
   * ================================================================
   */

  function getSwitcherButton() {
    const currentSwitcher = document.getElementById("gptModeSwitcher");
    if (isVisible(currentSwitcher)) return currentSwitcher;

    const candidates = Array.from(
      document.querySelectorAll(SWITCHER_SELECTOR),
    ).filter(isVisible);

    return (
      candidates.find((candidate) => {
        const searchableText = normalizeText(
          [
            candidate.textContent,
            candidate.getAttribute("aria-label"),
            candidate.getAttribute("title"),
          ]
            .filter(Boolean)
            .join(" "),
        );
        return (
          searchableText.includes("gpt") ||
          searchableText.includes("automatic") ||
          searchableText.includes("automaticky") ||
          searchableText.includes("think deeper") ||
          searchableText.includes("přemýšlení")
        );
      }) || null
    );
  }

  function getSwitcherText(switcher = getSwitcherButton()) {
    if (!switcher) return "";
    return normalizeText(
      [
        switcher.textContent,
        switcher.getAttribute("aria-label"),
        switcher.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  function isConfiguredModelAlreadyActive(switcher = getSwitcherButton()) {
    const expectedSwitcherText = normalizeText(getSwitcherLabel());
    const actualSwitcherText = getSwitcherText(switcher);
    return Boolean(
      switcher &&
      expectedSwitcherText &&
      (actualSwitcherText === expectedSwitcherText ||
        actualSwitcherText.startsWith(`${expectedSwitcherText} `)),
    );
  }

  function isAutomaticModeShown() {
    const switcherText = getSwitcherText();
    return (
      switcherText === "auto" ||
      switcherText.includes("automatic") ||
      switcherText.includes("automaticky")
    );
  }

  /**
   * Returns every visible menu-like floating surface.
   *
   * Microsoft currently renders the second-level model menu in a separate
   * portal. It therefore may not be a descendant of the first menu.
   */
  function getOpenMenus() {
    const selectors = [
      '[role="menu"]',
      '[role="listbox"]',
      '[data-tabster*="mover"]',
      '[class*="popover"]',
      '[class*="menu"]',
    ];

    return Array.from(document.querySelectorAll(selectors.join(", "))).filter(
      (element) => {
        if (!isVisible(element)) return false;

        // Retain only containers that actually contain interactive items.
        return Boolean(
          element.querySelector(
            '[role="menuitem"], ' +
              '[role="menuitemradio"], ' +
              '[role="menuitemcheckbox"], ' +
              '[role="option"], button',
          ),
        );
      },
    );
  }

  /**
   * Returns only top-level interactive items belonging to the supplied menu.
   * This avoids selecting a wrapper or a nested button accidentally.
   */
  function getMenuItems(menu) {
    if (!menu) return [];

    const candidates = Array.from(
      menu.querySelectorAll(
        [
          '[role="menuitem"]',
          '[role="menuitemradio"]',
          '[role="menuitemcheckbox"]',
          '[role="option"]',
          "button",
        ].join(", "),
      ),
    );

    return candidates.filter((item) => {
      if (!isVisible(item)) return false;

      // Exclude buttons nested inside another menu item.
      const parentItem = item.parentElement?.closest(
        '[role="menuitem"], ' +
          '[role="menuitemradio"], ' +
          '[role="menuitemcheckbox"], ' +
          '[role="option"]',
      );

      return !parentItem || parentItem === item;
    });
  }

  /**
   * Extracts both the accessible name and rendered text.
   */
  function getMenuItemText(item) {
    if (!item) return "";

    return normalizeText(
      [
        item.getAttribute("aria-label"),
        item.getAttribute("title"),
        item.innerText,
        item.textContent,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  /**
   * Makes GPT 5.6 and GPT-5.6 equivalent and removes punctuation that can
   * change when Microsoft updates model labels.
   */
  function createComparableText(value) {
    return normalizeText(value)
      .replace(/[\u2010-\u2015\u2212-]/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findMenuItem(menu, label) {
    if (!menu) return null;

    const target = createComparableText(label);
    const items = getMenuItems(menu);

    // Prefer exact matches.
    const exactMatch = items.find((item) => {
      return createComparableText(getMenuItemText(item)) === target;
    });

    if (exactMatch) return exactMatch;

    // Allow descriptions such as "OpenAI" underneath the primary label.
    return (
      items.find((item) => {
        const itemText = createComparableText(getMenuItemText(item));
        return itemText.startsWith(target) || itemText.includes(target);
      }) || null
    );
  }

  function isMenuItemSelected(item) {
    if (!item) return false;
    if (
      item.getAttribute("aria-checked") === "true" ||
      item.getAttribute("aria-selected") === "true" ||
      item.getAttribute("data-checked") === "true"
    ) {
      return true;
    }
    const checkmark = item.querySelector(
      [
        'svg[data-testid*="check"]',
        '[data-icon-name*="Check"]',
        '[aria-label="Selected"]',
        '[aria-label="selected"]',
      ].join(", "),
    );
    return isVisible(checkmark);
  }

  function closeMenus() {
    if (getOpenMenus().length === 0) return;
    const options = {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", options));
    target.dispatchEvent(new KeyboardEvent("keyup", options));
  }

  /*
   * ================================================================
   * MODEL SELECTION
   * ================================================================
   */

  async function openSwitcherMenu(firstLabel) {
    const switcher = await waitForElement(
      () => getSwitcherButton(),
      ELEMENT_TIMEOUT_MS,
    );

    if (isConfiguredModelAlreadyActive(switcher)) {
      throw new Error("CONFIGURED_MODEL_ALREADY_ACTIVE");
    }

    if (getOpenMenus().length > 0) {
      closeMenus();
      await sleep(100);
    }

    if (!safeClick(switcher)) {
      throw new Error("Could not click the model switcher");
    }

    return waitForElement(() => {
      const menus = getOpenMenus();

      // Do not depend on the menu count increasing. Copilot may reuse
      // an existing portal or popover container.
      return (
        [...menus].reverse().find((menu) => findMenuItem(menu, firstLabel)) ||
        null
      );
    }, 2500);
  }

  async function openSubmenu(parentItem, previousMenu, nextLabel) {
    // Identify the submenu by its expected item rather than by counting
    // menu containers. Copilot may reuse an existing portal container.
    const findExpectedSubmenu = () => {
      return (
        [...getOpenMenus()].reverse().find((menu) => {
          return menu !== previousMenu && findMenuItem(menu, nextLabel);
        }) || null
      );
    };

    if (!safeClick(parentItem)) {
      throw new Error(
        `Could not click submenu item: ${getMenuItemText(parentItem)}`,
      );
    }

    try {
      // In the normal case the click opens the submenu immediately.
      return await waitForElement(findExpectedSubmenu, 500);
    } catch (firstError) {
      // Some accessible menu implementations expect keyboard navigation.
      if (typeof parentItem.focus === "function") {
        parentItem.focus({ preventScroll: true });
      }

      parentItem.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          code: "ArrowRight",
          keyCode: 39,
          which: 39,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );

      return waitForElement(findExpectedSubmenu, 4000);
    }
  }

  async function selectConfiguredModel() {
    const modelPath = getModelPath();
    if (modelPath.length === 0) throw new Error("No model path is configured");

    let currentMenu = await openSwitcherMenu(modelPath[0]);

    for (let pathIndex = 0; pathIndex < modelPath.length; pathIndex += 1) {
      const label = modelPath[pathIndex];
      const isFinalItem = pathIndex === modelPath.length - 1;

      console.log(
        `[Save3Clicks] Looking for item ${pathIndex + 1}/${modelPath.length}:`,
        label,
      );
      const item = await waitForElement(
        () => findMenuItem(currentMenu, label),
        6000,
      );

      if (isFinalItem) {
        if (isMenuItemSelected(item)) {
          closeMenus();
          return "already-selected";
        }
        if (!safeClick(item))
          throw new Error(`Could not click final model: ${label}`);
        await waitForElement(
          () => (isConfiguredModelAlreadyActive() ? getSwitcherButton() : null),
          4000,
        );
        return "selected";
      }

      currentMenu = await openSubmenu(
        item,
        currentMenu,
        modelPath[pathIndex + 1],
      );
    }
    throw new Error("The configured model path was not completed");
  }

  async function runSelection(force = false) {
    if (selectionInProgress) {
      selectionQueued = true;
      return "queued";
    }

    if (!isCopilotChatPage()) return "not-a-chat-page";

    if (!force && !isAutomaticSelectionEnabled()) {
      schedulePromptFocus(100);
      return "disabled";
    }

    selectionInProgress = true;
    try {
      await waitForElement(() => getSwitcherButton(), ELEMENT_TIMEOUT_MS);
      await sleep(150);

      if (isConfiguredModelAlreadyActive()) {
        lastSuccessfulUrl = location.href;
        console.log(
          "[Save3Clicks] Configured model is already active:",
          getSwitcherText(),
        );
        schedulePromptFocus(50);
        return "already-selected";
      }

      console.log(
        "[Save3Clicks] Starting selection:",
        getModelPath().join(" -> "),
      );
      const result = await selectConfiguredModel();
      lastSuccessfulUrl = location.href;

      console.log("[Save3Clicks] Selection finished:", result);
      schedulePromptFocus(200);
      return result;
    } catch (error) {
      closeMenus();
      if (
        error instanceof Error &&
        error.message === "CONFIGURED_MODEL_ALREADY_ACTIVE"
      ) {
        lastSuccessfulUrl = location.href;
        console.log(
          "[Save3Clicks] Configured model became active before the menu was opened.",
        );
        schedulePromptFocus(100);
        return "already-selected";
      }

      console.warn("[Save3Clicks] Selection failed:", error);
      schedulePromptFocus(200);
      throw error;
    } finally {
      selectionInProgress = false;
      if (selectionQueued) {
        selectionQueued = false;

        // A successful selection already handled the current URL.
        if (lastSuccessfulUrl !== location.href) {
          scheduleSelection(100);
        }
      }
    }
  }

  function scheduleSelection(delay = NAVIGATION_DELAY_MS) {
    if (!isAutomaticSelectionEnabled()) {
      schedulePromptFocus(delay);
      return;
    }

    if (pendingSelectionTimer !== null) clearTimeout(pendingSelectionTimer);

    pendingSelectionTimer = setTimeout(() => {
      pendingSelectionTimer = null;
      runSelection(false).catch(() => {});
    }, delay);
  }

  /*
   * ================================================================
   * COPILOT NAVIGATION DETECTION
   * ================================================================
   */

  function installHistoryWatcher() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...argumentsList) {
      const result = originalPushState.apply(this, argumentsList);
      window.dispatchEvent(new Event("save3clicks:navigation"));
      return result;
    };

    history.replaceState = function (...argumentsList) {
      const result = originalReplaceState.apply(this, argumentsList);
      window.dispatchEvent(new Event("save3clicks:navigation"));
      return result;
    };

    window.addEventListener("popstate", () => {
      window.dispatchEvent(new Event("save3clicks:navigation"));
    });

    window.addEventListener("save3clicks:navigation", () => {
      lastSuccessfulUrl = null;
      cachedPromptField = null; // Clear cached element on client-side routing
      scheduleSelection();
      setTimeout(() => installSwitcherObserver(), NAVIGATION_DELAY_MS);
    });
  }

  async function installSwitcherObserver() {
    let switcher;
    try {
      switcher = await waitForElement(() => getSwitcherButton(), 15000);
    } catch (error) {
      console.warn(
        "[Save3Clicks] Model switcher was not found during initialization.",
      );
      return;
    }

    const observationRoot = switcher.parentElement || switcher;
    if (
      switcherObserver &&
      observedSwitcherRoot === observationRoot &&
      observationRoot.isConnected
    )
      return;

    // Clean up an observer and animation-frame callback associated with
    // an obsolete switcher subtree before watching the new subtree.
    if (switcherObserver) switcherObserver.disconnect();

    if (pendingSwitcherFrame !== null) {
      cancelAnimationFrame(pendingSwitcherFrame);
      pendingSwitcherFrame = null;
    }

    observedSwitcherRoot = observationRoot;
    switcherObserver = new MutationObserver(() => {
      // Evaluate the switcher state at most once per animation frame.
      if (pendingSwitcherFrame !== null) return;

      pendingSwitcherFrame = requestAnimationFrame(() => {
        pendingSwitcherFrame = null;

        // Ignore a callback left over from an obsolete or detached subtree.
        if (
          !observationRoot.isConnected ||
          observedSwitcherRoot !== observationRoot
        ) {
          return;
        }

        if (isAutomaticModeShown()) {
          lastSuccessfulUrl = null;

          // Mutations caused by the current model-selection operation do not
          // require a second concurrent or queued selection.
          if (!selectionInProgress) {
            scheduleSelection(300);
          }
        }
      });
    });

    switcherObserver.observe(observationRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "aria-expanded"],
    });
  }

  /*
   * ================================================================
   * VIOLENTMONKEY MENU COMMANDS
   * ================================================================
   */

  // Opens one modal with separate fields for the expanded menu path and collapsed selector text.
  function showModelConfigurationDialog() {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:grid;place-items:center";
    const form = document.createElement("form");
    form.style.cssText =
      "width:min(560px,calc(100vw - 32px));background:#fff;color:#111;padding:20px;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:14px system-ui,sans-serif";
    const title = document.createElement("h2");
    title.textContent = "Save3Clicks model configuration";
    title.style.margin = "0 0 16px";
    const pathLabel = document.createElement("label");
    pathLabel.textContent = "Expanded menu path (separate levels with |)";
    pathLabel.style.display = "block";
    const pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.value = getModelPath().join(" | ");
    pathInput.style.cssText =
      "box-sizing:border-box;width:100%;margin:6px 0 14px;padding:8px";
    const switcherLabel = document.createElement("label");
    switcherLabel.textContent = "Collapsed selector text";
    switcherLabel.style.display = "block";
    const switcherInput = document.createElement("input");
    switcherInput.type = "text";
    switcherInput.value = getSwitcherLabel();
    switcherInput.style.cssText =
      "box-sizing:border-box;width:100%;margin:6px 0 18px;padding:8px";
    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.textContent = "Save";
    buttons.append(cancelButton, saveButton);
    form.append(
      title,
      pathLabel,
      pathInput,
      switcherLabel,
      switcherInput,
      buttons,
    );
    overlay.append(form);
    document.body.append(overlay);
    const close = () => overlay.remove();
    cancelButton.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const newPath = pathInput.value
        .split(/\r?\n|\|/)
        .map((value) => value.trim())
        .filter(Boolean);
      const newSwitcherLabel = switcherInput.value.trim();
      if (newPath.length === 0 || !newSwitcherLabel) {
        alert("Both fields are required.");
        return;
      }
      setModelPath(newPath);
      setSwitcherLabel(newSwitcherLabel);
      lastSuccessfulUrl = null;
      close();
      alert(
        `Saved model path:\n${getModelPath().join(" -> ")}\n\nCollapsed selector:\n${getSwitcherLabel()}`,
      );
    });
    pathInput.focus();
  }
  function registerMenuCommands() {
    GM_registerMenuCommand(
      `Configure model: ${getModelPath().join(" -> ")}`,
      showModelConfigurationDialog,
    );

    GM_registerMenuCommand(
      `Toggle automatic selection: ${isAutomaticSelectionEnabled() ? "ON" : "OFF"}`,
      () => {
        const newValue = !isAutomaticSelectionEnabled();
        setAutomaticSelectionEnabled(newValue);
        alert(`Automatic selection is now ${newValue ? "ON" : "OFF"}.`);
        if (newValue) {
          lastSuccessfulUrl = null;
          scheduleSelection(100);
        } else {
          if (pendingSelectionTimer !== null)
            clearTimeout(pendingSelectionTimer);
          pendingSelectionTimer = null;
          schedulePromptFocus(100);
        }
      },
    );

    GM_registerMenuCommand(
      `Toggle prompt auto-focus: ${isAutoFocusEnabled() ? "ON" : "OFF"}`,
      () => {
        const newValue = !isAutoFocusEnabled();
        setAutoFocusEnabled(newValue);
        alert(`Prompt auto-focus is now ${newValue ? "ON" : "OFF"}.`);
        if (newValue) {
          schedulePromptFocus(100);
        }
      },
    );

    GM_registerMenuCommand("Select configured model now", async () => {
      try {
        const result = await runSelection(true);
        alert(
          [
            "Model-selection attempt completed.",
            "",
            `Result: ${result}`,
            `Path: ${getModelPath().join(" -> ")}`,
          ].join("\n"),
        );
      } catch (error) {
        alert(`Model selection failed:\n${error.message}`);
      }
    });

    GM_registerMenuCommand("Focus prompt field now", async () => {
      const focused = await focusPromptField(true);
      if (!focused)
        alert("The Copilot prompt field could not be found or focused.");
    });

    GM_registerMenuCommand("Reset model configuration to default", () => {
      setModelPath(DEFAULT_MODEL_PATH);
      setSwitcherLabel(DEFAULT_SWITCHER_LABEL);
      lastSuccessfulUrl = null;
      alert(
        `Model configuration reset:\n${DEFAULT_MODEL_PATH.join(" -> ")}\n\nCollapsed selector:\n${DEFAULT_SWITCHER_LABEL}`,
      );
    });

    GM_registerMenuCommand("Show current configuration", () => {
      const promptField = getPromptField();
      const focusedElement = document.activeElement;
      const promptIsFocused = Boolean(
        promptField &&
        (focusedElement === promptField ||
          promptField.contains(focusedElement)),
      );

      alert(
        [
          "Save3Clicks configuration",
          "",
          "Version: 1.8.3",
          `Automatic selection: ${isAutomaticSelectionEnabled() ? "ON" : "OFF"}`,
          `Prompt auto-focus: ${isAutoFocusEnabled() ? "ON" : "OFF"}`,
          `Model path: ${getModelPath().join(" -> ")}`,
          `Expected collapsed selector: ${getSwitcherLabel()}`,
          `Current URL: ${location.href}`,
          `Chat page: ${isCopilotChatPage() ? "YES" : "NO"}`,
          `Switcher text: ${getSwitcherText() || "(not found)"}`,
          `Configured model active: ${isConfiguredModelAlreadyActive() ? "YES" : "NO"}`,
          `Prompt field found: ${promptField ? "YES" : "NO"}`,
          `Prompt field focused: ${promptIsFocused ? "YES" : "NO"}`,
          `Last successfully handled URL: ${lastSuccessfulUrl || "(none)"}`,
        ].join("\n"),
      );
    });
  }

  /*
   * ================================================================
   * INITIALIZATION
   * ================================================================
   */

  function initialize() {
    console.log("[Save3Clicks] Initializing version 1.8.3");
    console.log(
      "[Save3Clicks] Configured model path:",
      getModelPath().join(" -> "),
    );

    registerMenuCommands();
    installHistoryWatcher();
    installSwitcherObserver();
    scheduleSelection(500);
  }

  initialize();
})();
