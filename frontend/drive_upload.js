/**
 * MockShift - Google Drive PDF Upload Manager
 * Uses OAuth 2.0 Token Client with 'https://www.googleapis.com/auth/drive.file' scope
 * to upload PDFs directly to a 'MockShift Papers' folder in the user's Google Drive
 * and then passes the PDF to the MockShift parser pipeline.
 */

class MockShiftDriveUpload {
  constructor() {
    this.tokenClient = null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.folderId = null;
    this.selectedDriveFile = null;
    this.init();
  }

  init() {
    this.setupListeners();
  }

  getValidToken(options = {}) {
    return new Promise((resolve, reject) => {
      // Check if current token in memory is still valid (with 60s buffer)
      if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
        resolve(this.accessToken);
        return;
      }

      const clientId = MockShiftConfig.GOOGLE_CLIENT_ID;
      if (!clientId || clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")) {
        reject(new Error("Google Drive integration is not configured yet. Please use the 'Local File Upload' tab to select your PDF directly."));
        return;
      }

      if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
        reject(new Error("Google Identity Services script is not loaded yet. Please check your internet connection."));
        return;
      }

      try {
        const scopes = MockShiftConfig.COMBINED_DRIVE_SCOPES || 
          `${MockShiftConfig.DRIVE_SCOPE} ${MockShiftConfig.DRIVE_APPDATA_SCOPE}`;

        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: scopes,
          callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
              this.accessToken = tokenResponse.access_token;
              const expiresIn = parseInt(tokenResponse.expires_in || "3600", 10);
              this.tokenExpiresAt = Date.now() + (expiresIn * 1000);
              resolve(this.accessToken);
            } else if (tokenResponse.error) {
              reject(new Error("OAuth Error: " + tokenResponse.error));
            } else {
              reject(new Error("Failed to obtain Google Drive access token."));
            }
          },
          error_callback: (err) => {
            reject(new Error("OAuth Consent Error: " + (err.message || err.type || "Popup closed or blocked")));
          }
        });

        // Request token (triggers Google OAuth consent popup or silent refresh)
        const promptValue = options.prompt !== undefined ? options.prompt : "";
        this.tokenClient.requestAccessToken({ prompt: promptValue });
      } catch (err) {
        reject(err);
      }
    });
  }

  // =========================================================================
  // GOOGLE DRIVE APPDATAFOLDER CROSS-DEVICE SYNC HELPERS
  // =========================================================================

  /**
   * 1. Query Google Drive appDataFolder for existing 'mockshift_history.json'.
   * Returns the matching file ID string or null.
   */
  async findHistoryFileInAppData(accessToken) {
    try {
      const token = accessToken || (await this.getValidToken());
      const filename = MockShiftConfig.HISTORY_SYNC_FILENAME || "mockshift_history.json";
      const q = `name='${filename}' and trashed=false`;
      const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        console.warn(`Query appDataFolder returned status ${res.status}: ${res.statusText}`);
        return null;
      }

      const data = await res.json();
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }
      return null;
    } catch (err) {
      console.warn("findHistoryFileInAppData error:", err);
      return null;
    }
  }

  /**
   * 2. Download and parse student test history from appDataFolder.
   * Gracefully returns [] if file doesn't exist or on error.
   */
  async loadHistoryFromDrive(accessToken) {
    try {
      const token = accessToken || (await this.getValidToken());
      const fileId = await this.findHistoryFileInAppData(token);
      if (!fileId) return [];

      const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        console.warn(`Failed to fetch history file contents: ${res.statusText}`);
        return [];
      }

      const historyData = await res.json();
      return Array.isArray(historyData) ? historyData : [];
    } catch (err) {
      console.warn("loadHistoryFromDrive error:", err);
      return [];
    }
  }

  /**
   * 3. Upload/Update student test history to appDataFolder.
   * If existing fileId found, performs PATCH. Otherwise creates via multipart POST.
   */
  async saveHistoryToDrive(accessToken, historyArray) {
    if (!Array.isArray(historyArray)) {
      throw new Error("historyArray must be an array of test records.");
    }

    const token = accessToken || (await this.getValidToken());
    const fileId = await this.findHistoryFileInAppData(token);
    const filename = MockShiftConfig.HISTORY_SYNC_FILENAME || "mockshift_history.json";
    const payloadJson = JSON.stringify(historyArray);

    if (fileId) {
      // Update existing file in appDataFolder
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
      const res = await fetch(updateUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8"
        },
        body: payloadJson
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Drive history update failed: ${res.status} ${errText}`);
      }

      return await res.json();
    } else {
      // Create new file inside appDataFolder with multipart upload
      const metadata = {
        name: filename,
        parents: ["appDataFolder"],
        mimeType: "application/json"
      };

      const boundary = "-------MockShiftAppDataBoundary" + Math.random().toString(36).substring(2);
      const delimiter = "\r\n--" + boundary + "\r\n";
      const closeDelimiter = "\r\n--" + boundary + "--";

      const multipartRequestBody = new Blob([
        delimiter,
        "Content-Type: application/json; charset=UTF-8\r\n\r\n",
        JSON.stringify(metadata),
        delimiter,
        "Content-Type: application/json; charset=UTF-8\r\n\r\n",
        payloadJson,
        closeDelimiter
      ], { type: `multipart/related; boundary=${boundary}` });

      const createUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name";
      const res = await fetch(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: multipartRequestBody
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Drive history creation failed: ${res.status} ${errText}`);
      }

      return await res.json();
    }
  }

  async getOrCreateDriveFolder(accessToken) {
    if (this.folderId) return this.folderId;

    const folderName = MockShiftConfig.DRIVE_FOLDER_NAME || "MockShift Papers";
    const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;

    const res = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw new Error(`Failed to query Google Drive: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.files && data.files.length > 0) {
      this.folderId = data.files[0].id;
      return this.folderId;
    }

    // Create folder
    const createUrl = "https://www.googleapis.com/drive/v3/files?fields=id,name";
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder"
      })
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create MockShift Papers folder: ${createRes.statusText}`);
    }

    const newFolder = await createRes.json();
    this.folderId = newFolder.id;
    return this.folderId;
  }

  async uploadPdfToDrive(file) {
    this.updateStatus("Connecting to Google Drive with drive.file scope...", true);

    const token = await this.getValidToken();
    this.updateStatus("Finding or creating 'MockShift Papers' folder in Drive...", true);

    const folderId = await this.getOrCreateDriveFolder(token);
    this.updateStatus(`Uploading '${file.name}' to your Google Drive...`, true);

    // Multipart upload
    const metadata = {
      name: file.name,
      parents: [folderId],
      mimeType: "application/pdf"
    };

    const boundary = "-------MockShiftMultipartBoundary" + Math.random().toString(36).substring(2);
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelimiter = "\r\n--" + boundary + "--";

    const fileBuffer = await file.arrayBuffer();
    const metadataString = JSON.stringify(metadata);

    const multipartRequestBody = new Blob([
      delimiter,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      metadataString,
      delimiter,
      "Content-Type: application/pdf\r\n\r\n",
      fileBuffer,
      closeDelimiter
    ], { type: `multipart/related; boundary=${boundary}` });

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: multipartRequestBody
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Drive upload failed: ${uploadRes.status} ${errText}`);
    }

    const uploaded = await uploadRes.json();
    this.updateStatus(
      `Saved to Drive: <a href="${uploaded.webViewLink || '#'}" target="_blank" style="color: var(--accent); text-decoration: underline;">${uploaded.name}</a>`,
      false,
      "success"
    );

    return uploaded;
  }

  updateStatus(message, isSpinning = false, type = "info") {
    const statusEl = document.getElementById("drive-upload-status");
    if (!statusEl) return;

    statusEl.style.display = "block";
    const icon = isSpinning
      ? '<i class="fas fa-spinner fa-spin" style="color: var(--accent);"></i>'
      : type === "success"
      ? '<i class="fas fa-check-circle" style="color: #10b981;"></i>'
      : '<i class="fas fa-info-circle" style="color: var(--accent);"></i>';

    statusEl.innerHTML = `${icon} <span style="margin-left: 0.5rem;">${message}</span>`;
  }

  setupListeners() {
    // Mode switcher tabs (Local File vs Google Drive)
    const tabLocal = document.getElementById("upload-tab-local");
    const tabDrive = document.getElementById("upload-tab-drive");
    const localSection = document.getElementById("local-upload-section");
    const driveSection = document.getElementById("drive-upload-section");

    if (tabLocal && tabDrive && localSection && driveSection) {
      tabLocal.addEventListener("click", () => {
        tabLocal.classList.add("active");
        tabDrive.classList.remove("active");
        localSection.style.display = "block";
        driveSection.style.display = "none";
      });

      tabDrive.addEventListener("click", () => {
        tabDrive.classList.add("active");
        tabLocal.classList.remove("active");
        localSection.style.display = "none";
        driveSection.style.display = "block";
      });
    }

    // Drive File Picker Dropzone
    const driveDropzone = document.getElementById("drive-dropzone");
    const driveInput = document.getElementById("drive-file-input");

    if (driveDropzone && driveInput) {
      driveDropzone.addEventListener("click", () => driveInput.click());

      driveDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        driveDropzone.classList.add("dragover");
      });

      driveDropzone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        driveDropzone.classList.remove("dragover");
      });

      driveDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        driveDropzone.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          this.handleDriveFileSelection(e.dataTransfer.files[0]);
        }
      });

      driveInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleDriveFileSelection(e.target.files[0]);
        }
      });
    }

    // "Upload to Drive & Parse Exam" button
    const driveUploadBtn = document.getElementById("drive-upload-and-parse-btn");
    if (driveUploadBtn) {
      driveUploadBtn.addEventListener("click", async () => {
        if (!this.selectedDriveFile) {
          alert("Please select a PDF file first to upload to Google Drive.");
          return;
        }

        try {
          driveUploadBtn.disabled = true;
          // Step 1: Upload to Google Drive (MockShift Papers folder)
          await this.uploadPdfToDrive(this.selectedDriveFile);

          // Step 2: Pass file directly into MockShift App parser pipeline
          if (window.MockShiftApp) {
            window.MockShiftApp.questionFile = this.selectedDriveFile;
            await window.MockShiftApp.uploadAndParsePDF();
          }
        } catch (err) {
          console.error("Drive upload/parse error:", err);
          this.updateStatus(`Drive error: ${err.message}`, false, "error");
          alert("Drive Upload Error: " + err.message);
        } finally {
          driveUploadBtn.disabled = false;
        }
      });
    }
  }

  handleDriveFileSelection(file) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Please select a valid PDF file.");
      return;
    }

    this.selectedDriveFile = file;
    const driveDropzone = document.getElementById("drive-dropzone");
    if (driveDropzone) {
      driveDropzone.classList.add("has-file");
      let badge = driveDropzone.querySelector(".file-info-badge");
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "file-info-badge";
        driveDropzone.appendChild(badge);
      }
      badge.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    }

    this.updateStatus(`Ready to upload '${file.name}' to your Google Drive and parse questions.`, false);
  }
}

// Global instance exposed on window
window.MockShiftDrive = new MockShiftDriveUpload();
