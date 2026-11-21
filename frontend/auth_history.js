/**
 * MockShift - Authentication, Per-Account Local History & BYOK Manager
 * 100% Stateless: Uses Google Identity Services for client-side authentication,
 * isolates records per account in browser localStorage, and manages user Gemini API keys.
 */

class MockShiftAuthManager {
  constructor() {
    this.currentUser = null;
    this.tokenClient = null;
    this.isSyncing = false;
    this.init();
  }

  init() {
    this.loadUserFromStorage();
    this.setupUIListeners();
    this.initGoogleIdentity();
    this.updateKeyStatusUI();
    this.updateRecordCountBadge();
    this.updateSyncStatusUI();
    this.updateQuotaBadgeUI();
    this.setupProModalListeners();
  }

  updateRecordCountBadge() {
    const records = this.getPastRecords();
    const countBadge = document.getElementById("past-records-count");
    if (countBadge) countBadge.textContent = records.length;
  }

  // =========================================================================
  // 1. USER AUTHENTICATION & GOOGLE IDENTITY SERVICES
  // =========================================================================
  loadUserFromStorage() {
    try {
      const stored = localStorage.getItem(MockShiftConfig.STORAGE_KEYS.ACTIVE_USER);
      if (stored) {
        this.currentUser = JSON.parse(stored);
      }
    } catch (e) {
      console.warn("Could not load user from localStorage:", e);
    }

    if (!this.currentUser) {
      this.currentUser = {
        id: "guest",
        name: "Guest Student",
        email: "guest@mockshift.local",
        picture: null,
        isGuest: true
      };
    }

    this.renderUserBadge();
    this.updateSyncStatusUI();

    // Trigger cross-device sync on load if active Google user session restored
    if (!this.isGuest()) {
      setTimeout(() => this.syncStudentHistoryWithDrive(true), 1200);
    }
  }

  getActiveUserId() {
    return this.currentUser && this.currentUser.id ? this.currentUser.id : "guest";
  }

  isGuest() {
    return !this.currentUser || Boolean(this.currentUser.isGuest);
  }

  initGoogleIdentity() {
    const clientId = MockShiftConfig.GOOGLE_CLIENT_ID;
    const isConfigured = clientId && !clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID");

    if (!isConfigured) {
      console.info("MockShift: Google Client ID not yet configured. Operating in Guest Mode.");
      this.renderGoogleSignInFallback();
      return;
    }

    if (window.google && window.google.accounts && window.google.accounts.id) {
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => this.handleGoogleCredentialResponse(response),
          auto_select: false,
          cancel_on_tap_outside: true
        });

        const btnContainer = document.getElementById("google-signin-btn-container");
        if (btnContainer) {
          window.google.accounts.id.renderButton(btnContainer, {
            theme: "outline",
            size: "medium",
            type: "standard",
            shape: "pill",
            text: "signin_with",
            logo_alignment: "left"
          });
        }
      } catch (err) {
        console.warn("Google Identity initialization error:", err);
      }
    } else {
      // Retry in 500ms if GSI script is still loading asynchronously
      setTimeout(() => this.initGoogleIdentity(), 500);
    }
  }

  handleGoogleCredentialResponse(response) {
    if (!response || !response.credential) return;

    try {
      // Decode JWT payload (standard base64url decode)
      const base64Url = response.credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(jsonPayload);

      this.currentUser = {
        id: payload.sub,
        name: payload.name || "Student",
        email: payload.email,
        picture: payload.picture,
        isGuest: false
      };

      localStorage.setItem(
        MockShiftConfig.STORAGE_KEYS.ACTIVE_USER,
        JSON.stringify(this.currentUser)
      );

      this.renderUserBadge();
      this.updateRecordCountBadge();
      this.updateSyncStatusUI();
      this.closeAccountModal();

      if (window.MockShiftApp && window.MockShiftApp.showToast) {
        window.MockShiftApp.showToast(`Signed in as ${this.currentUser.name}`, "success");
      }

      // Automatically sync student history with Google Drive appDataFolder
      setTimeout(() => this.syncStudentHistoryWithDrive(true), 600);
    } catch (err) {
      console.error("Failed to decode Google Credential:", err);
      alert("Google Sign-In failed to decode token.");
    }
  }

  signOut() {
    this.currentUser = {
      id: "guest",
      name: "Guest Student",
      email: "guest@mockshift.local",
      picture: null,
      isGuest: true
    };

    localStorage.removeItem(MockShiftConfig.STORAGE_KEYS.ACTIVE_USER);

    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }

    this.renderUserBadge();
    this.updateRecordCountBadge();
    this.updateSyncStatusUI();
    this.closeAccountModal();

    if (window.MockShiftApp && window.MockShiftApp.showToast) {
      window.MockShiftApp.showToast("Signed out. Operating in Guest Mode.", "info");
    }
  }

  renderUserBadge() {
    const badgeAvatar = document.getElementById("header-user-avatar");
    const badgeName = document.getElementById("header-user-name");
    const modalAvatar = document.getElementById("modal-user-avatar");
    const modalName = document.getElementById("modal-user-name");
    const modalEmail = document.getElementById("modal-user-email");
    const signinContainer = document.getElementById("modal-signin-section");
    const userProfileSection = document.getElementById("modal-profile-section");

    if (this.isGuest()) {
      if (badgeAvatar) badgeAvatar.innerHTML = '<i class="fas fa-user-circle"></i>';
      if (badgeName) badgeName.textContent = "Guest";
      if (modalAvatar) modalAvatar.innerHTML = '<i class="fas fa-user-circle" style="font-size: 3rem; color: var(--text-muted);"></i>';
      if (modalName) modalName.textContent = "Guest Student";
      if (modalEmail) modalEmail.textContent = "Guest Mode • Test history saved on this device";
      if (signinContainer) signinContainer.style.display = "block";
      if (userProfileSection) userProfileSection.style.display = "none";
    } else {
      const imgHtml = this.currentUser.picture
        ? `<img src="${this.currentUser.picture}" alt="${this.currentUser.name}" class="avatar-img">`
        : '<i class="fas fa-user-check"></i>';

      if (badgeAvatar) badgeAvatar.innerHTML = imgHtml;
      if (badgeName) badgeName.textContent = this.currentUser.name.split(' ')[0];
      if (modalAvatar) modalAvatar.innerHTML = imgHtml;
      if (modalName) modalName.textContent = this.currentUser.name;
      if (modalEmail) modalEmail.textContent = this.currentUser.email;
      if (signinContainer) signinContainer.style.display = "none";
      if (userProfileSection) userProfileSection.style.display = "block";
    }
  }

  renderGoogleSignInFallback() {
    const noteEl = document.getElementById("gsi-config-note");
    if (noteEl) {
      noteEl.innerHTML = `
        <div class="note-box" style="font-size: 0.8rem; padding: 0.6rem 0.8rem; background: var(--bg-surface); border-radius: var(--radius-sm); border-left: 3px solid var(--accent); margin-top: 0.5rem;">
          <i class="fas fa-info-circle" style="color: var(--accent);"></i>
          <span>Google Sign-In unavailable — using Guest Mode. All test attempts and scores are safely saved on this device!</span>
        </div>
      `;
    }
  }

  // =========================================================================
  // 2. PER-ACCOUNT LOCAL HISTORY
  // =========================================================================
  getHistoryStorageKey() {
    return MockShiftConfig.STORAGE_KEYS.HISTORY_PREFIX + this.getActiveUserId();
  }

  getPastRecords() {
    try {
      const data = localStorage.getItem(this.getHistoryStorageKey());
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn("Error reading past records:", e);
      return [];
    }
  }

  saveExamAttempt(attemptData) {
    try {
      const records = this.getPastRecords();
      const submittedAt = attemptData.submittedAt || attemptData.date || new Date().toISOString();
      const examTitle = attemptData.examTitle || "Competitive Exam Mock";
      const cleanTitle = String(examTitle).replace(/[^a-zA-Z0-9]/g, '_');
      const recordId = attemptData.id || `att_${cleanTitle}_${Date.now()}`;

      const newRecord = {
        id: recordId,
        date: submittedAt,
        submittedAt: submittedAt,
        examTitle: examTitle,
        examMode: attemptData.examMode || "CUSTOM",
        totalScore: Number(attemptData.totalScore || 0),
        maxPossibleScore: Number(attemptData.maxPossibleScore || 0),
        accuracy: Number(attemptData.accuracy || 0),
        totalAttempted: Number(attemptData.totalAttempted || 0),
        totalQuestions: Number(attemptData.totalQuestions || 0),
        avgTimePerQuestion: Number(attemptData.avgTimePerQuestion || 0),
        focusBreaksCount: (attemptData.focusBreaks || []).length,
        buckets: attemptData.buckets || {},
        // Save snapshot of paper and answers so student can re-inspect past performance
        examData: attemptData.examData,
        userAnswers: attemptData.userAnswers,
        timeSpent: attemptData.timeSpent,
        focusBreaks: attemptData.focusBreaks || []
      };

      // Keep up to 100 most recent records per account
      records.unshift(newRecord);
      if (records.length > 100) records.pop();

      localStorage.setItem(this.getHistoryStorageKey(), JSON.stringify(records));
      this.updateRecordCountBadge();

      // Automatically sync student history with Google Drive appDataFolder
      if (!this.isGuest()) {
        setTimeout(() => this.syncStudentHistoryWithDrive(true), 300);
      }

      return newRecord;
    } catch (e) {
      console.error("Failed to save exam attempt to localStorage:", e);
      return null;
    }
  }

  // =========================================================================
  // 2B. TWO-WAY GOOGLE DRIVE APPDATAFOLDER CROSS-DEVICE SYNC
  // =========================================================================
  async syncStudentHistoryWithDrive(silent = true) {
    if (this.isGuest()) {
      this.updateSyncStatusUI();
      return;
    }

    if (this.isSyncing) return;
    this.isSyncing = true;
    this.updateSyncStatusUI();

    try {
      if (!window.MockShiftDrive) {
        console.warn("MockShiftDrive upload manager not available yet.");
        return;
      }

      // 1. Obtain valid access token (silent or interactive)
      const token = await window.MockShiftDrive.getValidToken({ prompt: silent ? "" : "select_account" })
        .catch((err) => {
          if (!silent) {
            console.warn("Google Drive token acquisition:", err);
            if (window.MockShiftApp && window.MockShiftApp.showToast) {
              window.MockShiftApp.showToast(`Drive sign-in note: ${err.message}`, "info");
            }
          }
          return null;
        });

      if (!token) return;

      // 2. Download remote history from Google Drive appDataFolder
      const remoteRecords = await window.MockShiftDrive.loadHistoryFromDrive(token);
      const localRecords = this.getPastRecords();

      // 3. Merge & Deduplicate on unique deterministic attempt ID
      const mergedMap = new Map();

      // Load remote records
      for (const rec of remoteRecords) {
        if (!rec) continue;
        const key = rec.id || `${rec.examTitle}_${rec.submittedAt || rec.date}`;
        rec.id = key;
        rec.submittedAt = rec.submittedAt || rec.date || new Date().toISOString();
        rec.date = rec.date || rec.submittedAt;
        mergedMap.set(key, rec);
      }

      // Merge local records (local attempts take precedence on key collision)
      for (const rec of localRecords) {
        if (!rec) continue;
        const key = rec.id || `${rec.examTitle}_${rec.submittedAt || rec.date}`;
        rec.id = key;
        rec.submittedAt = rec.submittedAt || rec.date || new Date().toISOString();
        rec.date = rec.date || rec.submittedAt;
        mergedMap.set(key, rec);
      }

      // Convert to array and sort newest-first
      const mergedList = Array.from(mergedMap.values());
      mergedList.sort((a, b) => new Date(b.submittedAt || b.date) - new Date(a.submittedAt || a.date));

      // Cap at 100 items
      if (mergedList.length > 100) mergedList.length = 100;

      // 4. Save merged history to localStorage and record sync timestamp
      localStorage.setItem(this.getHistoryStorageKey(), JSON.stringify(mergedList));
      localStorage.setItem(MockShiftConfig.STORAGE_KEYS.LAST_SYNC, new Date().toISOString());

      // 5. Upload merged history to Google Drive appDataFolder
      await window.MockShiftDrive.saveHistoryToDrive(token, mergedList);

      // 6. Update UI and badge counts
      this.updateRecordCountBadge();
      this.renderPastRecordsList();

      if (!silent && window.MockShiftApp && window.MockShiftApp.showToast) {
        window.MockShiftApp.showToast("Test history synced with Google Drive!", "success");
      }
    } catch (err) {
      console.warn("Failed to sync history with Google Drive:", err);
      if (!silent && window.MockShiftApp && window.MockShiftApp.showToast) {
        window.MockShiftApp.showToast(`Sync warning: ${err.message}`, "info");
      }
    } finally {
      this.isSyncing = false;
      this.updateSyncStatusUI();
    }
  }

  updateSyncStatusUI() {
    const drawerStatus = document.getElementById("drawer-sync-status");
    const drawerSyncBtn = document.getElementById("drawer-sync-now-btn");
    const modalStatus = document.getElementById("modal-sync-status");
    const modalSyncBtn = document.getElementById("modal-sync-now-btn");

    const lastSyncIso = localStorage.getItem(MockShiftConfig.STORAGE_KEYS.LAST_SYNC);
    let timeLabel = "";
    if (lastSyncIso) {
      try {
        const diffMs = Date.now() - new Date(lastSyncIso).getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) timeLabel = "Just now";
        else if (diffMins < 60) timeLabel = `${diffMins}m ago`;
        else {
          const diffHours = Math.floor(diffMins / 60);
          timeLabel = `${diffHours}h ago`;
        }
      } catch (e) {
        timeLabel = "";
      }
    }

    const setBarContent = (statusEl, btnEl) => {
      if (!statusEl) return;

      if (this.isGuest()) {
        statusEl.className = "sync-status-pill local";
        statusEl.innerHTML = `
          <i class="fas fa-hdd" style="color: var(--text-muted);"></i>
          <span>💾 Saved locally on this device</span>
        `;
        if (btnEl) btnEl.style.display = "none";
      } else if (this.isSyncing) {
        statusEl.className = "sync-status-pill syncing";
        statusEl.innerHTML = `
          <i class="fas fa-sync fa-spin" style="color: var(--accent);"></i>
          <span>Syncing with Drive...</span>
        `;
        if (btnEl) {
          btnEl.style.display = "inline-flex";
          btnEl.disabled = true;
        }
      } else {
        statusEl.className = "sync-status-pill synced";
        const timeHtml = timeLabel ? `<small style="color: var(--text-muted); margin-left: 4px;">(${timeLabel})</small>` : '';
        statusEl.innerHTML = `
          <i class="fas fa-cloud" style="color: #10b981;"></i>
          <span>☁️ Synced with Google Drive</span>
          ${timeHtml}
        `;
        if (btnEl) {
          btnEl.style.display = "inline-flex";
          btnEl.disabled = false;
        }
      }
    };

    setBarContent(drawerStatus, drawerSyncBtn);
    setBarContent(modalStatus, modalSyncBtn);
  }

  clearHistory() {
    if (confirm(`Are you sure you want to clear all test history for ${this.currentUser.name}?`)) {
      localStorage.removeItem(this.getHistoryStorageKey());
      this.updateRecordCountBadge();
      this.renderPastRecordsList();
      if (window.MockShiftApp && window.MockShiftApp.showToast) {
        window.MockShiftApp.showToast("Test history cleared.", "info");
      }
    }
  }

  renderPastRecordsList() {
    const container = document.getElementById("past-records-list");
    if (!container) return;

    const records = this.getPastRecords();
    const countBadge = document.getElementById("past-records-count");
    if (countBadge) countBadge.textContent = records.length;

    if (records.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
          <i class="fas fa-folder-open" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
          <h4>No past test attempts found</h4>
          <p style="font-size: 0.85rem; margin-top: 0.5rem;">
            Completed exams for <strong>${this.currentUser.name}</strong> will be stored here with score breakdowns and focus break records.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = records.map((rec) => {
      const dateFormatted = new Date(rec.date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });

      const scorePct = rec.maxPossibleScore > 0
        ? Math.max(0, Math.round((rec.totalScore / rec.maxPossibleScore) * 100))
        : 0;

      return `
        <div class="past-record-card">
          <div class="record-header">
            <div>
              <span class="record-mode-badge">${rec.examMode}</span>
              <strong class="record-title">${rec.examTitle}</strong>
              <div class="record-date"><i class="far fa-clock"></i> ${dateFormatted}</div>
            </div>
            <div class="record-score-badge">
              <span class="score-val">${rec.totalScore.toFixed(1)}</span>
              <span class="score-max">/ ${rec.maxPossibleScore.toFixed(0)}</span>
            </div>
          </div>

          <div class="record-stats-grid">
            <div class="stat-pill">
              <span class="lbl">Accuracy</span>
              <span class="val" style="color: ${rec.accuracy >= 70 ? '#10b981' : rec.accuracy >= 50 ? '#f59e0b' : '#ef4444'};">
                ${rec.accuracy.toFixed(1)}%
              </span>
            </div>
            <div class="stat-pill">
              <span class="lbl">Attempted</span>
              <span class="val">${rec.totalAttempted} / ${rec.totalQuestions}</span>
            </div>
            <div class="stat-pill">
              <span class="lbl">Avg Time/Q</span>
              <span class="val">${rec.avgTimePerQuestion}s</span>
            </div>
            <div class="stat-pill">
              <span class="lbl">Focus Breaks</span>
              <span class="val" style="color: ${rec.focusBreaksCount > 0 ? '#f59e0b' : '#10b981'};">
                ${rec.focusBreaksCount}
              </span>
            </div>
          </div>

          <div class="record-actions">
            <button class="btn btn-secondary btn-sm" onclick="window.MockShiftAuth.inspectRecord('${rec.id}')">
              <i class="fas fa-chart-pie"></i> View Analytics & Autopsy
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  inspectRecord(recordId) {
    const records = this.getPastRecords();
    const target = records.find((r) => r.id === recordId);
    if (!target) {
      alert("Record not found.");
      return;
    }

    this.closePastRecordsDrawer();

    if (window.MockShiftAnalytics && window.MockShiftApp) {
      window.MockShiftApp.switchView('analytics');
      window.MockShiftAnalytics.evaluateAndRender(
        target.examData,
        target.userAnswers,
        target.timeSpent,
        target.focusBreaks
      );
    }
  }

  // =========================================================================
  // 3. BRING-YOUR-OWN-KEY (BYOK) GEMINI API KEY MANAGEMENT
  // =========================================================================
  getApiKey() {
    const key = localStorage.getItem(MockShiftConfig.STORAGE_KEYS.API_KEY);
    return (key || "").trim();
  }

  setApiKey(key) {
    const cleaned = (key || "").trim();
    if (cleaned) {
      localStorage.setItem(MockShiftConfig.STORAGE_KEYS.API_KEY, cleaned);
    } else {
      this.clearApiKey();
    }
    this.updateKeyStatusUI();
  }

  clearApiKey() {
    localStorage.removeItem(MockShiftConfig.STORAGE_KEYS.API_KEY);
    this.updateKeyStatusUI();
  }

  async testApiKey(customKey = null) {
    const keyToTest = customKey !== null ? customKey : this.getApiKey();
    const testStatusEl = document.getElementById("key-test-status");
    if (testStatusEl) {
      testStatusEl.innerHTML = '<span style="color: var(--accent);"><i class="fas fa-spinner fa-spin"></i> Validating key with Gemini...</span>';
    }

    try {
      const headers = {};
      if (keyToTest) {
        headers["X-Gemini-Api-Key"] = keyToTest;
      }

      const res = await fetch("/api/verify-key", {
        method: "POST",
        headers: headers
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Validation failed");
      }

      const data = await res.json();
      if (testStatusEl) {
        if (data.warning) {
          testStatusEl.innerHTML = `
            <span style="color: #f59e0b; font-weight: 600;">
              <i class="fas fa-exclamation-triangle"></i> ${data.message}
            </span>
          `;
        } else {
          testStatusEl.innerHTML = `
            <span style="color: #10b981; font-weight: 600;">
              <i class="fas fa-check-circle"></i> ${data.message} (${data.source === 'user_byok' ? 'Personal API Key' : 'Configured Key'})
            </span>
          `;
        }
      }
      return true;
    } catch (err) {
      if (testStatusEl) {
        testStatusEl.innerHTML = `
          <span style="color: var(--danger); font-weight: 600;">
            <i class="fas fa-times-circle"></i> ${err.message}
          </span>
        `;
      }
      return false;
    }
  }

  updateKeyStatusUI() {
    const userKey = this.getApiKey();
    const keyStatusBadge = document.getElementById("header-key-badge");
    const modalKeyInput = document.getElementById("byok-key-input");
    const modalKeyStatus = document.getElementById("byok-status-desc");

    if (modalKeyInput && !modalKeyInput.value && userKey) {
      modalKeyInput.value = userKey;
    }

    if (userKey) {
      const masked = userKey.substring(0, 6) + "..." + userKey.substring(userKey.length - 4);
      if (keyStatusBadge) {
        keyStatusBadge.className = "key-pill active";
        keyStatusBadge.innerHTML = `<i class="fas fa-key"></i> <span>BYOK Active</span>`;
        keyStatusBadge.title = `Using your personal Gemini API Key (${masked})`;
      }
      if (modalKeyStatus) {
        modalKeyStatus.innerHTML = `
          <div style="color: #10b981; font-weight: 600;">
            <i class="fas fa-check-circle"></i> Personal Gemini API Key Active (${masked})
          </div>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">
            Your key stays private on this device and is never stored on our servers.
          </p>
        `;
      }
    } else {
      if (keyStatusBadge) {
        keyStatusBadge.className = "key-pill fallback";
        keyStatusBadge.innerHTML = `<i class="fas fa-key"></i> <span>API Key</span>`;
        keyStatusBadge.title = "No personal key stored";
      }
      if (modalKeyStatus) {
        modalKeyStatus.innerHTML = `
          <div style="color: #f59e0b; font-weight: 600;">
            <i class="fas fa-info-circle"></i> No personal API key saved yet.
          </div>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">
            Enter your personal free key below, or practice with the built-in demo mock papers without an API key.
          </p>
        `;
      }
    }
  }

  // =========================================================================
  // 4. UI LISTENERS & MODAL MANAGEMENT
  // =========================================================================
  setupUIListeners() {
    // Header Account / User button
    const userBtn = document.getElementById("header-user-btn");
    if (userBtn) {
      userBtn.addEventListener("click", () => this.openAccountModal());
    }

    // Modal Close buttons
    // Unified API Key & Account Modal controls
    const modalClose = document.getElementById("account-key-modal-close");
    if (modalClose) {
      modalClose.addEventListener("click", () => this.closeAccountModal());
    }

    const modalBackdrop = document.getElementById("account-key-modal-backdrop");
    if (modalBackdrop) {
      modalBackdrop.addEventListener("click", (e) => {
        if (e.target === modalBackdrop) this.closeAccountModal();
      });
    }

    // Modal internal tabs switching
    const tabKey = document.getElementById("modal-tab-key");
    const tabAccount = document.getElementById("modal-tab-account");
    if (tabKey && tabAccount) {
      tabKey.addEventListener("click", () => this.switchModalTab("key"));
      tabAccount.addEventListener("click", () => this.switchModalTab("account"));
    }

    // Sign Out button
    const signoutBtn = document.getElementById("modal-signout-btn");
    if (signoutBtn) {
      signoutBtn.addEventListener("click", () => this.signOut());
    }

    // Past Records Drawer buttons
    const recordsBtn = document.getElementById("header-records-btn");
    if (recordsBtn) {
      recordsBtn.addEventListener("click", () => this.openPastRecordsDrawer());
    }

    const recordsClose = document.getElementById("past-records-close");
    if (recordsClose) {
      recordsClose.addEventListener("click", () => this.closePastRecordsDrawer());
    }

    const clearHistoryBtn = document.getElementById("clear-history-btn");
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener("click", () => this.clearHistory());
    }

    // Cross-Device Sync Now buttons (Drawer & Modal)
    const handleSyncClick = async (btn) => {
      if (btn) btn.disabled = true;
      await this.syncStudentHistoryWithDrive(false);
      if (btn) btn.disabled = false;
    };

    const drawerSyncBtn = document.getElementById("drawer-sync-now-btn");
    if (drawerSyncBtn) {
      drawerSyncBtn.addEventListener("click", () => handleSyncClick(drawerSyncBtn));
    }

    const modalSyncBtn = document.getElementById("modal-sync-now-btn");
    if (modalSyncBtn) {
      modalSyncBtn.addEventListener("click", () => handleSyncClick(modalSyncBtn));
    }

    // Header BYOK Key Badge button
    const keyBadge = document.getElementById("header-key-badge");
    if (keyBadge) {
      keyBadge.addEventListener("click", () => this.openKeyModal());
    }

    // BYOK Save button
    const saveKeyBtn = document.getElementById("save-byok-key-btn");
    if (saveKeyBtn) {
      saveKeyBtn.addEventListener("click", () => {
        const input = document.getElementById("byok-key-input");
        if (input) {
          const val = input.value.trim();
          this.setApiKey(val);
          if (window.MockShiftApp && window.MockShiftApp.showToast) {
            window.MockShiftApp.showToast(val ? "Gemini API key saved on this device!" : "Gemini API key cleared.", "success");
          }
        }
      });
    }

    // BYOK Test button
    const testKeyBtn = document.getElementById("test-byok-key-btn");
    if (testKeyBtn) {
      testKeyBtn.addEventListener("click", async () => {
        const input = document.getElementById("byok-key-input");
        const val = input ? input.value.trim() : "";
        await this.testApiKey(val);
      });
    }

    // BYOK Clear button
    const clearKeyBtn = document.getElementById("clear-byok-key-btn");
    if (clearKeyBtn) {
      clearKeyBtn.addEventListener("click", () => {
        const input = document.getElementById("byok-key-input");
        if (input) input.value = "";
        this.clearApiKey();
        const testStatusEl = document.getElementById("key-test-status");
        if (testStatusEl) testStatusEl.innerHTML = "";
      });
    }

    // Show/Hide password toggle
    const toggleKeyVisBtn = document.getElementById("toggle-key-visibility-btn");
    if (toggleKeyVisBtn) {
      toggleKeyVisBtn.addEventListener("click", () => {
        const input = document.getElementById("byok-key-input");
        if (input) {
          const isPass = input.type === "password";
          input.type = isPass ? "text" : "password";
          toggleKeyVisBtn.innerHTML = isPass ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
        }
      });
    }
  }

  switchModalTab(tab = "key") {
    const tabKey = document.getElementById("modal-tab-key");
    const tabAccount = document.getElementById("modal-tab-account");
    const contentKey = document.getElementById("modal-tab-content-key");
    const contentAccount = document.getElementById("modal-tab-content-account");

    if (tab === "account") {
      if (tabAccount) tabAccount.classList.add("active");
      if (tabKey) tabKey.classList.remove("active");
      if (contentAccount) contentAccount.style.display = "block";
      if (contentKey) contentKey.style.display = "none";
      this.renderUserBadge();
    } else {
      if (tabKey) tabKey.classList.add("active");
      if (tabAccount) tabAccount.classList.remove("active");
      if (contentKey) contentKey.style.display = "block";
      if (contentAccount) contentAccount.style.display = "none";
      this.updateKeyStatusUI();
    }
  }

  openAccountModal(defaultTab = "account") {
    this.switchModalTab(defaultTab);
    const modal = document.getElementById("account-key-modal-backdrop");
    if (modal) modal.classList.add("open");
  }

  closeAccountModal() {
    const modal = document.getElementById("account-key-modal-backdrop");
    if (modal) modal.classList.remove("open");
  }

  openKeyModal() {
    this.openAccountModal("key");
  }

  closeKeyModal() {
    this.closeAccountModal();
  }

  openPastRecordsDrawer() {
    this.renderPastRecordsList();
    const drawer = document.getElementById("past-records-drawer");
    if (drawer) drawer.classList.add("open");
  }

  closePastRecordsDrawer() {
    const drawer = document.getElementById("past-records-drawer");
    if (drawer) drawer.classList.remove("open");
  }

  // =========================================================================
  // 5. WEEKLY PDF UPLOAD QUOTA & MOCKSHIFT PRO MONETIZATION ENGINE
  // =========================================================================
  getQuotaStatus() {
    // 1. Check if user has active MockShift Pro plan
    if (this.isProUser()) {
      return {
        isPro: true,
        limit: Infinity,
        used: 0,
        remaining: Infinity,
        canUpload: true,
        resetDate: null,
        resetDays: 0
      };
    }

    // 2. Compute rolling 7-day usage
    const key = (MockShiftConfig.STORAGE_KEYS.UPLOAD_QUOTA || "mockshift_upload_quota") + "_" + this.getActiveUserId();
    let timestamps = [];
    try {
      const raw = localStorage.getItem(key);
      if (raw) timestamps = JSON.parse(raw);
      if (!Array.isArray(timestamps)) timestamps = [];
    } catch (e) {
      timestamps = [];
    }

    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    // Filter to last 7 days
    const recentUploads = timestamps.filter(ts => (now - ts) < ONE_WEEK_MS);

    if (recentUploads.length !== timestamps.length) {
      localStorage.setItem(key, JSON.stringify(recentUploads));
    }

    const limit = MockShiftConfig.FREE_UPLOADS_PER_WEEK || 3;
    const used = recentUploads.length;
    const remaining = Math.max(0, limit - used);

    let resetDate = null;
    let resetDays = 0;
    if (used > 0) {
      const oldest = Math.min(...recentUploads);
      resetDate = new Date(oldest + ONE_WEEK_MS);
      resetDays = Math.max(1, Math.ceil((oldest + ONE_WEEK_MS - now) / (24 * 60 * 60 * 1000)));
    }

    return {
      isPro: false,
      limit,
      used,
      remaining,
      canUpload: remaining > 0,
      resetDate,
      resetDays
    };
  }

  recordPdfUpload() {
    if (this.isProUser()) return;
    const key = (MockShiftConfig.STORAGE_KEYS.UPLOAD_QUOTA || "mockshift_upload_quota") + "_" + this.getActiveUserId();
    let timestamps = [];
    try {
      const raw = localStorage.getItem(key);
      if (raw) timestamps = JSON.parse(raw);
      if (!Array.isArray(timestamps)) timestamps = [];
    } catch (e) {
      timestamps = [];
    }

    timestamps.push(Date.now());
    localStorage.setItem(key, JSON.stringify(timestamps));
    this.updateQuotaBadgeUI();
  }

  isProUser() {
    try {
      const key = MockShiftConfig.STORAGE_KEYS.PRO_STATUS || "mockshift_pro_status";
      const raw = localStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.active) {
          if (!data.expiresAt || new Date(data.expiresAt).getTime() > Date.now()) {
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  }

  activatePro(codeOrKey) {
    const clean = String(codeOrKey || "").trim().toUpperCase();
    const VALID_PROMO_CODES = [
      "MOCKSHIFT_PRO",
      "PREMIUM",
      "PRO2026",
      "TOPPER",
      "PROPASS",
      "MOCKSHIFT100",
      "MOCKPRO"
    ];

    const isValid = VALID_PROMO_CODES.includes(clean) || (clean.startsWith("MOCK-") && clean.length >= 8);

    if (isValid) {
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1); // 1-year Pro access
      const proData = {
        active: true,
        plan: "MockShift Pro Annual",
        code: clean,
        activatedAt: new Date().toISOString(),
        expiresAt: expiry.toISOString()
      };
      const key = MockShiftConfig.STORAGE_KEYS.PRO_STATUS || "mockshift_pro_status";
      localStorage.setItem(key, JSON.stringify(proData));
      this.updateQuotaBadgeUI();
      return {
        success: true,
        message: "MockShift Pro activated successfully! Unlimited PDF uploads unlocked."
      };
    }

    return {
      success: false,
      message: "Invalid activation code. Please check your license key or subscribe below."
    };
  }

  updateQuotaBadgeUI() {
    const quota = this.getQuotaStatus();

    // 1. Update Header Pro Pill Button
    const headerProBtn = document.getElementById("header-pro-btn");
    const headerProText = document.getElementById("header-pro-text");
    if (headerProBtn) {
      if (quota.isPro) {
        headerProBtn.className = "btn btn-pro-pill pro-active";
        if (headerProText) headerProText.textContent = "Pro Active";
        headerProBtn.title = "MockShift Pro: Unlimited Uploads Unlocked";
      } else {
        headerProBtn.className = "btn btn-pro-pill";
        if (headerProText) headerProText.textContent = "Upgrade";
        headerProBtn.title = `Weekly Free Uploads: ${quota.used}/${quota.limit} used. Click to upgrade!`;
      }
    }

    // 2. Update Home Screen Quota Tracker Banner
    const trackerBanner = document.getElementById("quota-tracker-banner");
    const trackerIcon = document.getElementById("quota-icon");
    const trackerText = document.getElementById("quota-text");
    const trackerUpgradeBtn = document.getElementById("quota-upgrade-btn");

    if (trackerBanner && trackerText) {
      if (quota.isPro) {
        trackerBanner.className = "quota-tracker-banner pro-active";
        if (trackerIcon) trackerIcon.innerHTML = '<i class="fas fa-crown" style="color: #f59e0b;"></i>';
        trackerText.innerHTML = `<strong>MockShift Pro Active:</strong> Unlimited PDF Question Papers unlocked.`;
        if (trackerUpgradeBtn) {
          trackerUpgradeBtn.textContent = "Pro Benefits";
          trackerUpgradeBtn.className = "btn btn-sm btn-upgrade-pill";
        }
      } else if (!quota.canUpload) {
        trackerBanner.className = "quota-tracker-banner limit-reached";
        if (trackerIcon) trackerIcon.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>';
        trackerText.innerHTML = `Weekly Free Limit Reached (<strong>${quota.used} / ${quota.limit} PDFs used</strong>). Refreshes in <strong>${quota.resetDays} day${quota.resetDays > 1 ? 's' : ''}</strong>.`;
        if (trackerUpgradeBtn) {
          trackerUpgradeBtn.innerHTML = '<i class="fas fa-crown"></i> Unlock Unlimited';
          trackerUpgradeBtn.className = "btn btn-sm btn-upgrade-pill pulse";
        }
      } else {
        trackerBanner.className = "quota-tracker-banner";
        if (trackerIcon) trackerIcon.innerHTML = '<i class="fas fa-bolt" style="color: var(--accent);"></i>';
        trackerText.innerHTML = `Weekly Free Uploads: <strong>${quota.used} / ${quota.limit} Used</strong> (${quota.remaining} remaining this week)`;
        if (trackerUpgradeBtn) {
          trackerUpgradeBtn.innerHTML = '<i class="fas fa-crown"></i> Upgrade to Pro';
          trackerUpgradeBtn.className = "btn btn-sm btn-upgrade-pill";
        }
      }
    }
  }

  setupProModalListeners() {
    // Header Pro Button
    const headerProBtn = document.getElementById("header-pro-btn");
    if (headerProBtn) {
      headerProBtn.addEventListener("click", () => this.openProModal());
    }

    // Quota banner upgrade button
    const quotaUpgradeBtn = document.getElementById("quota-upgrade-btn");
    if (quotaUpgradeBtn) {
      quotaUpgradeBtn.addEventListener("click", () => this.openProModal());
    }

    // Modal close button & backdrop
    const proModalClose = document.getElementById("pro-modal-close");
    if (proModalClose) {
      proModalClose.addEventListener("click", () => this.closeProModal());
    }

    const proBackdrop = document.getElementById("pro-upgrade-modal-backdrop");
    if (proBackdrop) {
      proBackdrop.addEventListener("click", (e) => {
        if (e.target === proBackdrop) this.closeProModal();
      });
    }

    // License key / promo code redemption
    const activateBtn = document.getElementById("pro-activate-btn");
    if (activateBtn) {
      activateBtn.addEventListener("click", () => {
        const input = document.getElementById("pro-license-input");
        const statusEl = document.getElementById("pro-activate-status");
        const code = input ? input.value : "";
        const res = this.activatePro(code);

        if (statusEl) {
          statusEl.style.display = "block";
          if (res.success) {
            statusEl.className = "pro-status-msg success";
            statusEl.innerHTML = `<i class="fas fa-check-circle"></i> ${res.message}`;
            setTimeout(() => this.closeProModal(), 1800);
          } else {
            statusEl.className = "pro-status-msg error";
            statusEl.innerHTML = `<i class="fas fa-times-circle"></i> ${res.message}`;
          }
        }
      });
    }

    // Checkout buttons
    const subscribeMonthlyBtn = document.getElementById("subscribe-monthly-btn");
    if (subscribeMonthlyBtn) {
      subscribeMonthlyBtn.addEventListener("click", () => this.handleSubscribeClick("monthly"));
    }

    const subscribeYearlyBtn = document.getElementById("subscribe-yearly-btn");
    if (subscribeYearlyBtn) {
      subscribeYearlyBtn.addEventListener("click", () => this.handleSubscribeClick("yearly"));
    }
  }

  handleSubscribeClick(plan = "yearly") {
    // Direct payment link or WhatsApp/UPI checkout prompt
    const price = plan === "monthly" ? "₹99/month" : "₹499/year";
    const promptMsg = 
      `MockShift Pro (${price})\n\n` +
      `To complete your upgrade:\n` +
      `1. Send your payment via UPI to: mockshift@upi\n` +
      `2. Or use promo code 'MOCKPRO' below for instant evaluation access!\n\n` +
      `Would you like to copy the UPI ID?`;

    if (confirm(promptMsg)) {
      navigator.clipboard?.writeText("mockshift@upi").catch(() => {});
      if (window.MockShiftApp && window.MockShiftApp.showToast) {
        window.MockShiftApp.showToast("UPI ID (mockshift@upi) copied to clipboard!", "success");
      }
    }
  }

  openProModal(options = {}) {
    const modal = document.getElementById("pro-upgrade-modal-backdrop");
    if (!modal) return;

    const quota = this.getQuotaStatus();
    const alertBox = document.getElementById("pro-modal-quota-alert");
    if (alertBox) {
      if (options.reason === "quota_exceeded" || !quota.canUpload) {
        alertBox.style.display = "block";
        alertBox.innerHTML = `
          <i class="fas fa-exclamation-triangle" style="color: #ef4444; font-size: 1.1rem;"></i>
          <div>
            <strong>Weekly Free Limit Reached (${quota.used} / ${quota.limit} PDFs Used)</strong>
            <div style="font-size: 0.8rem; margin-top: 0.2rem; color: var(--text-muted);">
              Your free quota refreshes on ${quota.resetDate ? quota.resetDate.toLocaleDateString() : 'next week'}. Upgrade to Pro for unlimited uploads right now!
            </div>
          </div>
        `;
      } else if (quota.isPro) {
        alertBox.style.display = "block";
        alertBox.style.borderColor = "rgba(245, 158, 11, 0.4)";
        alertBox.style.background = "rgba(245, 158, 11, 0.08)";
        alertBox.innerHTML = `
          <i class="fas fa-crown" style="color: #f59e0b; font-size: 1.1rem;"></i>
          <div>
            <strong style="color: #f59e0b;">MockShift Pro is Active on this Device</strong>
            <div style="font-size: 0.8rem; margin-top: 0.2rem; color: var(--text-muted);">
              You have unlimited PDF uploads, priority AI model reasoning, and step-by-step mistake autopsies.
            </div>
          </div>
        `;
      } else {
        alertBox.style.display = "none";
      }
    }

    modal.classList.add("open");
  }

  closeProModal() {
    const modal = document.getElementById("pro-upgrade-modal-backdrop");
    if (modal) modal.classList.remove("open");
  }
}

// Global instance exposed on window
window.MockShiftAuth = new MockShiftAuthManager();
