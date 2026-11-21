/**
 * MockShift - Global Configuration
 * 
 * Instructions:
 * 1. To enable Google Sign-In and Google Drive PDF Upload, replace the placeholder
 *    GOOGLE_CLIENT_ID below with your Web Client ID from Google Cloud Console:
 *    https://console.cloud.google.com/apis/credentials
 * 2. Ensure your Authorized JavaScript origins include:
 *    - http://localhost:8000
 *    - http://127.0.0.1:8000
 * 3. Enable the "Google Drive API" in your Google Cloud Project.
 */

const MockShiftConfig = {
  APP_NAME: "MockShift",
  VERSION: "1.2.0",
  // Replace this with your Google Cloud OAuth 2.0 Web Client ID
  GOOGLE_CLIENT_ID: "883181084975-3bmcdjin71se808oivd489m1mo5nph8h.apps.googleusercontent.com",
  API_BASE_URL: window.location.origin,
  DRIVE_SCOPE: "https://www.googleapis.com/auth/drive.file",
  DRIVE_APPDATA_SCOPE: "https://www.googleapis.com/auth/drive.appdata",
  COMBINED_DRIVE_SCOPES: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata",
  HISTORY_SYNC_FILENAME: "mockshift_history.json",
  DRIVE_FOLDER_NAME: "MockShift Papers",
  FREE_UPLOADS_PER_WEEK: 3,
  PRO_PRICING: {
    monthly: "₹99",
    yearly: "₹499"
  },
  STORAGE_KEYS: {
    THEME: "mockshift_theme",
    API_KEY: "mockshift_gemini_api_key",
    ACTIVE_USER: "mockshift_active_user",
    ACTIVE_SESSION: "mockshift_active_cbt_session",
    HISTORY_PREFIX: "mockshift_history_",
    LAST_SYNC: "mockshift_last_drive_sync",
    PRO_STATUS: "mockshift_pro_status",
    UPLOAD_QUOTA: "mockshift_upload_quota"
  }
};

window.MockShiftConfig = MockShiftConfig;
