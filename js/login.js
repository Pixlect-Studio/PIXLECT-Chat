/* =====================================================================
   PIXLECT Sign In — js/login.js  ·  PIXLECT Chat
   Adapted from the PIXLECT remap client used across PIXLECT apps.
   Canonical account host: www.account.pixlect-studios.com

   Domain discovery is authoritative: the PIXLECT registry decides
   which origins may open the account portal. There is no local login
   or demo account fallback.
   ===================================================================== */
(function () {
  'use strict';

  const CONFIG = {
    appName: 'PIXLECT Chat',
    authServerDomain: 'https://www.account.pixlect-studios.com/domain.json',
    loginUrl: 'https://www.account.pixlect-studios.com/index.html',
    storageKey: 'pixlectchat:pixlect_user',
    popupWidth: 520,
    popupHeight: 680,
    discoveryTimeoutMs: 5000
  };

  const listeners = new Set();
  let currentUser = null;
  let isAuthorized = false;
  let discoveryAttempted = false;
  let authPopup = null;
  let popupChecker = null;

  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || CONFIG.discoveryTimeoutMs);
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .finally(() => clearTimeout(timer));
  }

  async function readDomain(url) {
    try {
      const res = await fetchWithTimeout(url, {
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit'
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data && typeof data === 'object' ? data : null;
    } catch (err) {
      console.warn('[pixlect] domain discovery unavailable:', url, err.message || err.name);
      return null;
    }
  }

  function originPatternMatches(entry, origin) {
    const value = String(entry || '').trim();
    if (!value) return false;
    if (value === '*') return true;
    const pattern = value.replace(/\/$/, '');
    const hosts = [origin, location.host];
    if (!pattern.includes('*')) return hosts.indexOf(pattern) !== -1;
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const matcher = new RegExp('^' + escaped + '$');
    return hosts.some((host) => matcher.test(host));
  }

  function originAllowed(data) {
    if (!data) return false;
    const allowed = data.allowedOrigins;
    if (allowed === undefined || allowed === null) return true;
    if (!Array.isArray(allowed)) return false;
    return allowed.some((entry) => originPatternMatches(entry, location.origin));
  }

  async function checkAuthorization() {
    discoveryAttempted = true;
    if (location.protocol === 'file:') {
      isAuthorized = false;
      return;
    }
    const remote = await readDomain(CONFIG.authServerDomain);
    isAuthorized = originAllowed(remote);
  }

  function setButtonState(state, reason) {
    const btn = document.getElementById('pixlect-login');
    if (!btn) return;
    if (state === 'disabled') {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.title = reason || 'Sign-in unavailable';
      btn.style.opacity = '0.55';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
      btn.title = 'Sign in with PIXLECT';
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
  }

  function reflectAuthState() {
    document.documentElement.dataset.auth = currentUser ? 'in' : 'out';
  }

  function normalizeUser(user) {
    if (!user || typeof user !== 'object') return null;
    const username = String(user.username || user.name || '').trim().slice(0, 32);
    const uid = String(user.uid || user.id || '').trim();
    if (!username || !uid) return null;
    const icon = user.icon && typeof user.icon === 'object' ? user.icon : {};
    return {
      username: username,
      uid: uid,
      icon: {
        bg: typeof icon.bg === 'string' && icon.bg ? icon.bg : '#38bdf8',
        emoji: typeof icon.emoji === 'string' && icon.emoji ? icon.emoji : '👤'
      }
    };
  }

  function closePopup() {
    if (authPopup && !authPopup.closed) {
      try { authPopup.close(); } catch (_) {}
    }
    authPopup = null;
    if (popupChecker) {
      clearInterval(popupChecker);
      popupChecker = null;
    }
  }

  function isTrustedOrigin(origin) {
    if (!origin || origin === 'null') return false;
    try {
      const host = new URL(origin).hostname.toLowerCase();
      return host === 'www.account.pixlect-studios.com' || host === 'account.pixlect-studios.com';
    } catch (_) {
      return false;
    }
  }

  function reportAuthProblem(message) {
    try {
      window.dispatchEvent(new CustomEvent('pixlect:auth-error', { detail: { message: message } }));
    } catch (_) {}
    try { alert(message); } catch (_) {}
  }

  function openLogin() {
    if (!isAuthorized) {
      reportAuthProblem('PIXLECT sign-in is not authorized for this site yet. Serve it from localhost:8000 or a registered PIXLECT origin.');
      return;
    }

    const popupUrl = CONFIG.loginUrl
      + '?app=' + encodeURIComponent(CONFIG.appName)
      + '&mode=popup&origin=' + encodeURIComponent(location.origin);

    const w = CONFIG.popupWidth;
    const h = CONFIG.popupHeight;
    const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);

    const popup = window.open(popupUrl, 'PixlectSignIn',
      'width=' + w + ',height=' + h + ',left=' + Math.round(left) + ',top=' + Math.round(top)
      + ',menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');

    if (!popup || popup.closed) {
      reportAuthProblem('Your browser blocked the PIXLECT sign-in window. Allow popups for this site and try again.');
      return;
    }

    authPopup = popup;
    try { popup.focus(); } catch (_) {}
    if (popupChecker) clearInterval(popupChecker);
    popupChecker = setInterval(() => {
      if (!authPopup || authPopup.closed) {
        clearInterval(popupChecker);
        popupChecker = null;
        authPopup = null;
      }
    }, 500);
  }

  function setUser(user) {
    currentUser = user || null;
    try {
      if (currentUser) localStorage.setItem(CONFIG.storageKey, JSON.stringify(currentUser));
      else localStorage.removeItem(CONFIG.storageKey);
    } catch (err) {
      console.warn('[pixlect] could not persist session:', err);
    }
    reflectAuthState();
    renderUser();
    listeners.forEach((fn) => {
      try { fn(currentUser); } catch (_) {}
    });
  }

  function logout() {
    setUser(null);
    try {
      window.postMessage({ type: 'PIXLECT_SIGNOUT', app: CONFIG.appName }, location.origin);
    } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function renderUser() {
    const btn = document.getElementById('pixlect-login');
    const slot = document.getElementById('authSlot');

    if (currentUser) {
      if (btn) btn.hidden = true;
      if (!slot) return;
      const initial = currentUser.username ? currentUser.username.charAt(0).toUpperCase() : '?';
      slot.innerHTML = [
        '<div class="pixlect-user-badge">',
        '  <span class="pixlect-user-avatar" style="background:' + escapeHtml(currentUser.icon.bg) + '22;border:1px solid ' + escapeHtml(currentUser.icon.bg) + '55;color:' + escapeHtml(currentUser.icon.bg) + '">' + escapeHtml(initial) + '</span>',
        '  <span class="pixlect-user-meta"><strong>' + escapeHtml(currentUser.username) + '</strong><small>PIXLECT Account</small></span>',
        '  <button type="button" id="pixlect-logout" class="pixlect-user-out">Sign out</button>',
        '</div>'
      ].join('');
      const out = document.getElementById('pixlect-logout');
      if (out) out.onclick = logout;
    } else {
      if (btn) btn.hidden = false;
      if (slot) slot.innerHTML = '';
    }
  }

  function bindButton() {
    const btn = document.getElementById('pixlect-login');
    if (!btn || btn.dataset.pixlectBound === '1') return;
    btn.dataset.pixlectBound = '1';
    btn.addEventListener('click', openLogin);
  }

  function watchButtons() {
    bindButton();
    if (document.body && window.MutationObserver) {
      new MutationObserver(bindButton).observe(document.body, { childList: true, subtree: true });
    }
  }

  async function init() {
    watchButtons();
    await checkAuthorization();
    setButtonState(isAuthorized ? 'enabled' : 'disabled',
      isAuthorized ? null : 'PIXLECT sign-in is not configured for this origin');
    renderUser();
    window.dispatchEvent(new CustomEvent('pixlect:ready', {
      detail: { authorized: isAuthorized, attempted: discoveryAttempted }
    }));
  }

  function restoreSession() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      const saved = raw ? normalizeUser(JSON.parse(raw)) : null;
      if (saved) setUser(saved);
    } catch (err) {
      console.warn('[pixlect] could not restore session:', err);
    }
    reflectAuthState();
    renderUser();
  }

  window.addEventListener('message', (event) => {
    if (!event.data || !isTrustedOrigin(event.origin)) return;
    if (authPopup && event.source && event.source !== authPopup) return;
    if (event.data.type !== 'PIXLECT_AUTH_SUCCESS' && event.data.type !== 'PIXLECT_AUTH') return;
    if (event.data.status && event.data.status !== 'success') return;
    const clean = normalizeUser(event.data.user);
    if (!clean) return;
    setUser(clean);
    closePopup();
  });

  window.PixlectAuth = {
    config: CONFIG,
    get user() { return currentUser; },
    get authorized() { return isAuthorized; },
    get discoveryAttempted() { return discoveryAttempted; },
    login: openLogin,
    logout: logout,
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      if (currentUser) fn(currentUser);
      return () => listeners.delete(fn);
    }
  };

  restoreSession();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();