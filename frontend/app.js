/**
 * MockShift - Core Computer-Based Test (CBT) Application Engine
 * 100% Stateless backend compatible, auto-save to localStorage, crash recovery,
 * lockdown mode, KaTeX math rendering, and 5-state palette state machine.
 */

class MockShiftCBT {
  constructor() {
    this.currentView = 'upload'; // 'upload', 'editor', 'cbt', 'analytics'
    this.examMode = 'CAT'; // 'CAT', 'GATE', 'JEE', 'CUSTOM'
    this.examPaper = null;

    // Exam runtime state
    this.currentSectionIndex = 0;
    this.currentQuestionIndex = 0;
    this.userAnswers = {}; // { [qId]: string }
    this.markedForReview = {}; // { [qId]: boolean }
    this.visitedQuestions = {}; // { [qId]: boolean }
    this.questionTimeSpent = {}; // { [qId]: seconds }
    this.questionActiveStartTime = 0;

    // Timers
    this.totalTimeLeft = 0;
    this.sectionTimeLeft = 0;
    this.timerInterval = null;
    this.sectionTimerInterval = null;

    // Lockdown & Focus breaks
    this.lockdownEnabled = true;
    this.focusBreaks = [];
    this.blurTimestamp = null;
    this.isExamActive = false;

    // Dual files
    this.questionFile = null;
    this.answerKeyFile = null;

    this.init();
  }

  init() {
    this.setupThemeToggle();
    this.setupHeaderActions();
    this.setupDiagramZoom();
    this.setupUploadScreen();
    this.setupLockdownListeners();
    this.setupKeyboardShortcuts();
    this.setupNumpad();
    this.setupAutopsyModal();
    this.checkSessionRecovery();
  }

  setupDiagramZoom() {
    const zoomBtn = document.getElementById('cbt-image-zoom-btn');
    const qImg = document.getElementById('cbt-question-image');
    const modal = document.getElementById('image-zoom-modal');
    const zoomImg = document.getElementById('image-zoom-img');
    const closeBtn = document.getElementById('image-zoom-close');

    const openZoom = (src) => {
      const targetSrc = src || (qImg ? qImg.src : null);
      if (targetSrc && modal && zoomImg) {
        zoomImg.src = targetSrc;
        modal.style.display = 'flex';
      }
    };

    const closeZoom = () => {
      if (modal) modal.style.display = 'none';
    };

    if (zoomBtn) zoomBtn.addEventListener('click', () => openZoom());
    if (qImg) qImg.addEventListener('click', () => openZoom());
    if (closeBtn) closeBtn.addEventListener('click', closeZoom);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target === closeBtn) closeZoom();
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
        closeZoom();
      }
    });

    // Make zoom available globally for autopsy modal images
    window.MockShiftZoomImage = openZoom;

    // Remove diagram from a question in pre-exam quick editor
    window.MockShiftRemoveDiagram = (qid) => {
      if (this.currentExam && this.currentExam.questions) {
        const targetQ = this.currentExam.questions.find(q => q.id === qid);
        if (targetQ) {
          targetQ.image_data = null;
          targetQ.has_image = false;
          targetQ.image_bbox = null;
          const previewEl = document.getElementById(`edit-diagram-wrap-${qid}`);
          if (previewEl) previewEl.remove();
        }
      }
    };
  }

  setupHeaderActions() {
    // Fullscreen Toggle
    const fsBtn = document.getElementById('fullscreen-toggle-btn');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
          fsBtn.innerHTML = '<i class="fas fa-compress"></i> <span class="btn-text">Exit Fullscreen</span>';
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
          fsBtn.innerHTML = '<i class="fas fa-expand"></i> <span class="btn-text">Fullscreen</span>';
        }
      });
    }

    // Mobile Palette Drawer Toggle
    const mobilePaletteBtn = document.getElementById('mobile-palette-toggle');
    const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
    const sidebar = document.getElementById('cbt-sidebar');
    const mobileHeader = document.getElementById('sidebar-mobile-header');

    if (mobilePaletteBtn && sidebar) {
      mobilePaletteBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (mobileHeader) mobileHeader.style.display = 'flex';
      });
    }

    if (sidebarCloseBtn && sidebar) {
      sidebarCloseBtn.addEventListener('click', () => {
        sidebar.classList.remove('open');
      });
    }
  }

  // =========================================================================
  // THEME & VIEW NAVIGATION
  // =========================================================================
  setupThemeToggle() {
    const themeBtn = document.getElementById('theme-toggle-btn');
    const savedTheme = localStorage.getItem('mockshift_theme') || 'dark';

    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      if (themeBtn) themeBtn.innerHTML = '<i class="fas fa-moon"></i>';
    } else {
      document.body.classList.remove('light-mode');
      if (themeBtn) themeBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('light-mode');
        localStorage.setItem('mockshift_theme', isLight ? 'light' : 'dark');
        themeBtn.innerHTML = isLight ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
      });
    }
  }

  switchView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.view-container').forEach((el) => el.classList.remove('active'));
    const target = document.getElementById(`${viewName}-screen`);
    if (target) target.classList.add('active');

    // Header CBT exam info, timer & submit button
    const headerCbtInfo = document.getElementById('header-cbt-info');
    const headerTitle = document.getElementById('header-cbt-exam-title');
    const headerSubmitBtn = document.getElementById('header-submit-btn');
    const headerKeyBadge = document.getElementById('header-key-badge');
    const headerRecordsBtn = document.getElementById('header-records-btn');

    if (viewName === 'cbt') {
      if (headerCbtInfo) {
        headerCbtInfo.style.display = 'flex';
        if (headerTitle) {
          headerTitle.textContent = (this.examPaper && this.examPaper.exam_title) || 'CBT Mock Examination';
        }
      }
      if (headerSubmitBtn) {
        headerSubmitBtn.style.display = 'inline-flex';
        headerSubmitBtn.onclick = () => {
          if (confirm('Are you sure you want to end the test and generate your post-test intelligence analytics?')) {
            this.submitExam();
          }
        };
      }
      if (headerKeyBadge) headerKeyBadge.style.display = 'none';
      if (headerRecordsBtn) headerRecordsBtn.style.display = 'none';
    } else {
      if (headerCbtInfo) headerCbtInfo.style.display = 'none';
      if (headerSubmitBtn) headerSubmitBtn.style.display = 'none';
      if (headerKeyBadge) headerKeyBadge.style.display = 'inline-flex';
      if (headerRecordsBtn) headerRecordsBtn.style.display = 'inline-flex';
    }

    // Update calculator visibility based on mode and view
    const calcBtn = document.getElementById('header-calc-btn');
    if (calcBtn) {
      if (viewName === 'cbt' && (this.examMode === 'GATE' || this.examMode === 'CAT' || this.examMode === 'CUSTOM')) {
        calcBtn.style.display = 'inline-flex';
        if (window.MockShiftCalc) {
          window.MockShiftCalc.setMode(this.examMode === 'CAT' ? 'CAT' : 'GATE');
        }
      } else {
        calcBtn.style.display = 'none';
        if (window.MockShiftCalc) window.MockShiftCalc.toggle(false);
      }
    }

    // Update mobile palette button visibility
    const mobilePaletteBtn = document.getElementById('mobile-palette-toggle');
    if (mobilePaletteBtn) {
      mobilePaletteBtn.style.display = viewName === 'cbt' ? 'inline-flex' : 'none';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  showToast(message, type = 'warning') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'warning' ? 'exclamation-circle' : type === 'danger' ? 'times-circle' : 'check-circle';
    toast.innerHTML = `<i class="fas fa-${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // =========================================================================
  // VIEW 1: UPLOAD SCREEN & DUAL-PDF LOGIC
  // =========================================================================
  setupUploadScreen() {
    // Official Competitive Exam Presets (Duration & Marking schemes)
    const EXAM_PRESETS = {
      CAT: { duration: 120, pos: 3.0, neg: 1.0 },
      GATE: { duration: 180, pos: 2.0, neg: 0.66 },
      JEE: { duration: 180, pos: 4.0, neg: 1.0 },
      NEET: { duration: 200, pos: 4.0, neg: 1.0 },
      UPSC_GS: { duration: 120, pos: 2.0, neg: 0.66 },
      UPSC_CSAT: { duration: 120, pos: 2.5, neg: 0.83 },
      SSC: { duration: 60, pos: 2.0, neg: 0.5 },
      RAILWAYS: { duration: 90, pos: 1.0, neg: 0.33 },
      BANKING: { duration: 60, pos: 1.0, neg: 0.25 },
      CUET: { duration: 60, pos: 5.0, neg: 1.0 },
      CUSTOM: { duration: 180, pos: 3.0, neg: 1.0 }
    };

    // Category filter tabs
    const catButtons = document.querySelectorAll('.mode-category-btn');
    const pills = document.querySelectorAll('.mode-pill');

    catButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        catButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.getAttribute('data-filter');

        pills.forEach((p) => {
          if (filter === 'all' || p.getAttribute('data-category') === filter) {
            p.style.display = 'flex';
          } else {
            p.style.display = 'none';
          }
        });
      });
    });

    // Mode selector pills
    pills.forEach((pill) => {
      pill.addEventListener('click', () => {
        pills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.examMode = pill.getAttribute('data-mode') || 'CAT';

        const customBar = document.getElementById('custom-settings-bar');
        if (customBar) {
          customBar.style.display = this.examMode === 'CUSTOM' ? 'flex' : 'none';
        }

        const preset = EXAM_PRESETS[this.examMode] || EXAM_PRESETS.CUSTOM;
        const durInput = document.getElementById('custom-duration-input');
        const posInput = document.getElementById('custom-pos-marks');
        const negInput = document.getElementById('custom-neg-marks');
        if (durInput) durInput.value = preset.duration;
        if (posInput) posInput.value = preset.pos;
        if (negInput) negInput.value = preset.neg;
      });
    });

    // Dropzone for Question Paper
    const qDropzone = document.getElementById('q-dropzone');
    const qInput = document.getElementById('q-file-input');
    this.bindDropzone(qDropzone, qInput, (file) => {
      this.questionFile = file;
      this.updateDropzoneUI(qDropzone, file);
    });

    // Dropzone for Answer Key (Optional)
    const akDropzone = document.getElementById('ak-dropzone');
    const akInput = document.getElementById('ak-file-input');
    this.bindDropzone(akDropzone, akInput, (file) => {
      this.answerKeyFile = file;
      this.updateDropzoneUI(akDropzone, file);
    });

    // "Load Sample Demo Paper" button (Zero API calls, instant testing)
    const sampleBtn = document.getElementById('load-sample-btn');
    if (sampleBtn) {
      sampleBtn.addEventListener('click', async () => {
        await this.loadSamplePaper();
      });
    }

    // "Load Full 68Q CAT Mock Paper" button
    const fullMockBtn = document.getElementById('load-full-mock-btn');
    if (fullMockBtn) {
      fullMockBtn.addEventListener('click', async () => {
        await this.loadFullMockPaper();
      });
    }

    // "Import Shared Paper (.json)" button (0 API Calls)
    const importSharedBtn = document.getElementById('import-shared-paper-btn');
    const sharedFileInput = document.getElementById('shared-paper-file-input');
    if (importSharedBtn && sharedFileInput) {
      importSharedBtn.addEventListener('click', () => {
        sharedFileInput.click();
      });
      sharedFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const data = JSON.parse(event.target.result);
              if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
                alert('Invalid file: The selected JSON does not contain an exam questions array.');
                return;
              }
              this.showUploadProgress(false);
              this.initQuickEditor(data);
              this.showToast(`Imported "${data.exam_title || 'Shared Paper'}" with ${data.questions.length} questions!`, 'success');
            } catch (err) {
              alert('Error reading shared paper JSON: ' + err.message);
            }
          };
          reader.readAsText(file);
        }
      });
    }

    // "Upload & Parse Paper" button
    const parseBtn = document.getElementById('parse-pdf-btn');
    if (parseBtn) {
      parseBtn.addEventListener('click', async () => {
        if (!this.questionFile) {
          alert('Please select or drop a Question Paper PDF first.');
          return;
        }
        await this.uploadAndParsePDF();
      });
    }

    // Lockdown Mode toggle checkbox
    const lockdownToggle = document.getElementById('lockdown-mode-toggle');
    if (lockdownToggle) {
      lockdownToggle.addEventListener('change', (e) => {
        this.lockdownEnabled = e.target.checked;
      });
    }
  }

  bindDropzone(dropzone, input, callback) {
    if (!dropzone || !input) return;

    dropzone.addEventListener('click', () => input.click());

    input.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        callback(e.target.files[0]);
      }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        callback(e.dataTransfer.files[0]);
      }
    });
  }

  updateDropzoneUI(dropzone, file) {
    dropzone.classList.add('has-file');
    let badge = dropzone.querySelector('.file-info-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'file-info-badge';
      dropzone.appendChild(badge);
    }
    badge.textContent = `Attached: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  }

  async loadSamplePaper() {
    this.showUploadProgress(true, 'Loading built-in standard competitive exam paper...');
    try {
      let res = await fetch('/api/sample-paper').catch(() => null);
      if (!res || !res.ok) {
        res = await fetch('sample_paper.json').catch(() => null);
      }
      if (!res || !res.ok) throw new Error('Could not load sample paper from server or local file');
      const data = await res.json();
      this.showUploadProgress(false);
      this.initQuickEditor(data);
    } catch (err) {
      console.warn('Fallback: loading local memory sample paper:', err);
      // Fallback built-in data in case backend endpoint is unreachable
      const fallbackData = {
        exam_title: "MockShift CAT/GATE Benchmark Demo",
        exam_mode: this.examMode,
        duration_minutes: 40,
        sections: ["Verbal Ability & Reading Comprehension", "Data Interpretation & Logical Reasoning", "Quantitative Ability"],
        questions: [
          {
            id: 1,
            section: "Verbal Ability & Reading Comprehension",
            type: "MCQ",
            text: "Which one of the following best captures the author's primary thesis regarding algorithmic content moderation?\\n'The shift from curated publication to engagement-driven feeds has commodified outrage, creating an environment where high-friction nuance is discarded in favor of immediate emotional reactivity.'",
            options: {
              A: "Algorithmic curation systematically sacrifices intellectual depth for viral user engagement.",
              B: "Social networks are intentionally malicious organizations designed to dismantle independent journalism.",
              C: "Readers consistently prefer sensationalized headlines over verified factual reporting.",
              D: "Traditional editorial gatekeeping was immune to commercial advertising pressures."
            },
            correct_answer: "A",
            marks_positive: 3.0,
            marks_negative: 1.0
          },
          {
            id: 2,
            section: "Quantitative Ability",
            type: "NAT",
            text: "Find the minimum real value of $y = |x - 3| + |x - 7| + |x - 12|$, where $x \\in \\mathbb{R}$.",
            options: null,
            correct_answer: "9",
            marks_positive: 3.0,
            marks_negative: 0.0
          },
          {
            id: 3,
            section: "Quantitative Ability",
            type: "MCQ",
            text: "Evaluate the limit: $$\\lim_{x \\to 0} \\frac{\\sin(3x) - 3x}{x^3}$$",
            options: {
              A: "-4.5",
              B: "4.5",
              C: "0",
              D: "-1.5"
            },
            correct_answer: "A",
            marks_positive: 3.0,
            marks_negative: 1.0
          }
        ]
      };
      this.showUploadProgress(false);
      this.initQuickEditor(fallbackData);
    }
  }

  async loadFullMockPaper() {
    this.showUploadProgress(true, 'Loading full 68-question CAT Mock Paper (VARC: 24, DILR: 22, QA: 22)...');
    try {
      let res = await fetch('/api/full-paper').catch(() => null);
      if (!res || !res.ok) {
        res = await fetch('full_cat_mock_paper.json').catch(() => null);
      }
      if (!res || !res.ok) throw new Error('Could not load full paper from server or local file');
      const data = await res.json();
      this.showUploadProgress(false);
      this.initQuickEditor(data);
    } catch (err) {
      this.showUploadProgress(false);
      alert('Error loading full CAT paper: ' + err.message);
    }
  }

  async uploadAndParsePDF() {
    this.showUploadProgress(true, 'Analyzing your question paper and preparing CBT interface...');
    const formData = new FormData();
    formData.append('question_pdf', this.questionFile);
    if (this.answerKeyFile) {
      formData.append('answer_key_pdf', this.answerKeyFile);
    }
    formData.append('exam_mode', this.examMode);

    const dur = parseInt(document.getElementById('custom-duration-input')?.value, 10);
    if (dur && !isNaN(dur)) {
      formData.append('duration_minutes', dur);
    }

    try {
      const headers = {};
      const userApiKey = window.MockShiftAuth ? window.MockShiftAuth.getApiKey() : null;
      if (userApiKey) {
        headers['X-Gemini-Api-Key'] = userApiKey;
      }

      const res = await fetch('/api/parse-pdf', {
        method: 'POST',
        headers: headers,
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 401 && window.MockShiftAuth) {
          window.MockShiftAuth.openKeyModal();
        }
        throw new Error(errJson.detail || `Upload failed: ${res.statusText}`);
      }

      const paperData = await res.json();
      this.showUploadProgress(false);
      this.initQuickEditor(paperData);
    } catch (err) {
      this.showUploadProgress(false);
      const isHighDemand = err.message.includes('high demand') || err.message.includes('503') || err.message.includes('temporary');
      if (isHighDemand) {
        alert(
          'Google AI Studio is experiencing temporary high demand right now.\n\n' +
          'Spikes in public API traffic usually clear within 10–20 seconds.\n' +
          '• Please wait a moment and click "Upload & Parse with Gemini" again, OR\n' +
          '• Try the instant offline demo papers or import a shared paper (.json) with 0 API calls!'
        );
      } else {
        alert('Error parsing PDF: ' + err.message);
      }
    }
  }

  showUploadProgress(show, text = 'Processing...') {
    const container = document.getElementById('upload-progress-container');
    const textEl = document.getElementById('upload-progress-text');
    if (!container) return;
    if (textEl) textEl.textContent = text;
    container.style.display = show ? 'block' : 'none';
  }

  // =========================================================================
  // VIEW 2: HUMAN-IN-THE-LOOP QUICK EDITOR (PRE-EXAM REVIEW)
  // =========================================================================
  initQuickEditor(paperData) {
    this.examPaper = paperData;
    this.switchView('editor');

    const totalQEl = document.getElementById('editor-total-questions');
    const sectionsEl = document.getElementById('editor-sections-count');
    const durationEl = document.getElementById('editor-duration');
    const titleInput = document.getElementById('editor-exam-title');

    if (totalQEl) totalQEl.textContent = this.examPaper.questions.length;
    if (sectionsEl) sectionsEl.textContent = (this.examPaper.sections || []).length;
    if (durationEl) durationEl.textContent = `${this.examPaper.duration_minutes || 180}m`;
    if (titleInput) titleInput.value = this.examPaper.exam_title || 'Competitive Exam Mock';

    // Hook up "Add Question" button
    const addQBtn = document.getElementById('editor-add-q-btn');
    if (addQBtn) {
      addQBtn.onclick = () => {
        this.saveEditorChanges();
        const newId = this.examPaper.questions.length > 0
          ? Math.max(...this.examPaper.questions.map((q) => q.id)) + 1
          : 1;
        const firstSec = (this.examPaper.sections && this.examPaper.sections[0]) || 'Section A';
        this.examPaper.questions.push({
          id: newId,
          section: firstSec,
          type: 'MCQ',
          text: 'New question with formula $x^2 + y^2 = r^2$',
          options: { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' },
          correct_answer: null,
          marks_positive: 3.0,
          marks_negative: 1.0,
        });
        this.renderEditorQuestionsList();
        if (totalQEl) totalQEl.textContent = this.examPaper.questions.length;
      };
    }

    this.renderEditorQuestionsList();

    const exportBtn = document.getElementById('editor-export-paper-btn');
    if (exportBtn) {
      exportBtn.onclick = () => {
        this.saveEditorChanges();
        if (window.MockShiftAnalytics && window.MockShiftAnalytics.exportPaperJson) {
          window.MockShiftAnalytics.examData = this.examPaper;
          window.MockShiftAnalytics.exportPaperJson();
        } else {
          const jsonStr = JSON.stringify(this.examPaper, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(this.examPaper.exam_title || 'paper').replace(/[^a-z0-9_-]/gi, '_')}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
      };
    }

    const startBtn = document.getElementById('editor-start-exam-btn');
    if (startBtn) {
      startBtn.onclick = () => {
        this.saveEditorChanges();
        this.startExam();
      };
    }
  }

  renderEditorQuestionsList() {
    const list = document.getElementById('questions-edit-list');
    if (!list) return;

    const sections = this.examPaper.sections || ['General'];

    list.innerHTML = this.examPaper.questions.map((q, idx) => {
      const hasOpts = q.type === 'MCQ' || q.type === 'MSQ';
      const optionsHtml = `
        <div class="edit-row edit-options-container" id="edit-opts-${q.id}" style="${hasOpts ? '' : 'display: none;'}">
          <label>Options (A, B, C, D)</label>
          <div class="edit-options-grid">
            ${['A', 'B', 'C', 'D'].map((optKey) => `
              <div>
                <span style="font-weight: 700; color: var(--accent);">${optKey}:</span>
                <input type="text" class="edit-input edit-opt-input" data-qid="${q.id}" data-opt="${optKey}" value="${(q.options && q.options[optKey]) || ''}">
              </div>
            `).join('')}
          </div>
        </div>
      `;

      const sectionOptions = sections.map((s) => `
        <option value="${s}" ${q.section === s ? 'selected' : ''}>${s}</option>
      `).join('');

      const diagramPreviewHtml = q.image_data ? `
        <div class="edit-diagram-preview" id="edit-diagram-wrap-${q.id}">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
            <span style="font-size: 0.78rem; font-weight: 700; color: var(--accent);">
              <i class="fas fa-image"></i> Extracted Question Diagram (Page ${q.image_page || 'Auto'})
            </span>
            <div style="display: flex; gap: 0.4rem;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.MockShiftZoomImage && window.MockShiftZoomImage('${q.image_data}')" style="padding: 0.15rem 0.5rem; font-size: 0.72rem;">
                <i class="fas fa-search-plus"></i> View Diagram
              </button>
              <button type="button" class="btn btn-danger btn-sm" onclick="window.MockShiftRemoveDiagram && window.MockShiftRemoveDiagram(${q.id})" style="padding: 0.15rem 0.5rem; font-size: 0.72rem;">
                <i class="fas fa-trash-alt"></i> Remove
              </button>
            </div>
          </div>
          <img src="${q.image_data}" alt="Diagram Q${q.id}" onclick="window.MockShiftZoomImage && window.MockShiftZoomImage('${q.image_data}')" style="cursor: zoom-in;" />
        </div>
      ` : '';

      return `
        <div class="edit-q-card" data-qid="${q.id}">
          <div class="edit-q-header">
            <div class="edit-q-tags">
              <span class="tag tag-primary">Q${idx + 1} (ID: ${q.id})</span>
              <select class="edit-input edit-sec-select" data-qid="${q.id}" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; width: auto;">
                ${sectionOptions}
              </select>
              <select class="edit-input edit-type-select" data-qid="${q.id}" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; width: auto; font-weight: 700;">
                <option value="MCQ" ${q.type === 'MCQ' ? 'selected' : ''}>MCQ (Single)</option>
                <option value="MSQ" ${q.type === 'MSQ' ? 'selected' : ''}>MSQ (Multi-Select)</option>
                <option value="NAT" ${q.type === 'NAT' ? 'selected' : ''}>NAT (Numeric)</option>
              </select>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items: center;">
              <div style="display: flex; gap: 0.35rem; align-items: center;">
                <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted);">Key:</label>
                <input type="text" class="edit-input edit-key-input" data-qid="${q.id}" style="width: 75px; text-align: center; font-weight: 700;" value="${q.correct_answer || ''}" placeholder="null">
              </div>
              <div style="display: flex; gap: 0.35rem; align-items: center;">
                <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted);">Marks:</label>
                <input type="number" class="edit-input edit-pos-input" data-qid="${q.id}" style="width: 50px; text-align: center;" value="${q.marks_positive || 3}" step="0.5">
                <input type="number" class="edit-input edit-neg-input" data-qid="${q.id}" style="width: 50px; text-align: center;" value="${q.marks_negative || 1}" step="0.25">
              </div>
              <button class="btn btn-icon btn-danger btn-delete-q" data-qid="${q.id}" title="Delete Question" style="width: 32px; height: 32px;">
                <i class="fas fa-trash" style="font-size: 0.8rem;"></i>
              </button>
            </div>
          </div>

          <div class="edit-row">
            <label>Question Text (LaTeX in $...$ or $$...$$)</label>
            <textarea class="edit-textarea edit-text-input" data-qid="${q.id}" rows="3">${q.text}</textarea>
            <div class="katex-live-preview" id="preview-q-${q.id}">${q.text}</div>
          </div>

          ${diagramPreviewHtml}
          ${optionsHtml}
        </div>
      `;
    }).join('');

    // Bind Type Switcher to toggle Options row
    list.querySelectorAll('.edit-type-select').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const qid = sel.getAttribute('data-qid');
        const optsRow = document.getElementById(`edit-opts-${qid}`);
        if (optsRow) {
          optsRow.style.display = (e.target.value === 'MCQ' || e.target.value === 'MSQ') ? 'block' : 'none';
        }
      });
    });

    // Bind Delete Question Buttons
    list.querySelectorAll('.btn-delete-q').forEach((btn) => {
      btn.addEventListener('click', () => {
        const qid = parseInt(btn.getAttribute('data-qid'), 10);
        if (this.examPaper.questions.length <= 1) {
          alert('An exam paper must have at least one question.');
          return;
        }
        this.saveEditorChanges();
        this.examPaper.questions = this.examPaper.questions.filter((q) => q.id !== qid);
        this.renderEditorQuestionsList();
        const totalQEl = document.getElementById('editor-total-questions');
        if (totalQEl) totalQEl.textContent = this.examPaper.questions.length;
      });
    });

    // Live update preview on input
    list.querySelectorAll('.edit-text-input').forEach((textarea) => {
      textarea.addEventListener('input', (e) => {
        const qid = textarea.getAttribute('data-qid');
        const previewEl = document.getElementById(`preview-q-${qid}`);
        if (previewEl) {
          previewEl.innerHTML = e.target.value;
          if (window.renderMathInElement) {
            window.renderMathInElement(previewEl, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false }
              ],
              throwOnError: false
            });
          }
        }
      });
    });

    // Render KaTeX for all previews
    if (window.renderMathInElement) {
      window.renderMathInElement(list, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    }
  }

  saveEditorChanges() {
    const titleInput = document.getElementById('editor-exam-title');
    if (titleInput) this.examPaper.exam_title = titleInput.value;

    this.examPaper.questions.forEach((q) => {
      const card = document.querySelector(`.edit-q-card[data-qid="${q.id}"]`);
      if (!card) return;

      const textInput = card.querySelector('.edit-text-input');
      if (textInput) q.text = textInput.value;

      const secSelect = card.querySelector('.edit-sec-select');
      if (secSelect) q.section = secSelect.value;

      const typeSelect = card.querySelector('.edit-type-select');
      if (typeSelect) q.type = typeSelect.value;

      const keyInput = card.querySelector('.edit-key-input');
      if (keyInput) {
        const val = keyInput.value.trim();
        q.correct_answer = val !== '' && val.toLowerCase() !== 'null' ? val : null;
      }

      const posInput = card.querySelector('.edit-pos-input');
      if (posInput) q.marks_positive = parseFloat(posInput.value) || 3.0;

      const negInput = card.querySelector('.edit-neg-input');
      if (negInput) q.marks_negative = parseFloat(negInput.value) || 1.0;

      if (q.type === 'MCQ' || q.type === 'MSQ') {
        if (!q.options) q.options = {};
        card.querySelectorAll('.edit-opt-input').forEach((optInput) => {
          const optKey = optInput.getAttribute('data-opt');
          q.options[optKey] = optInput.value;
        });
      } else {
        q.options = null;
      }
    });
  }

  // =========================================================================
  // VIEW 3: AUTHENTIC CBT EXAM-HALL INTERFACE & PALETTE STATE MACHINE
  // =========================================================================
  startExam() {
    if (!this.examPaper || !this.examPaper.questions.length) {
      alert('No question paper loaded.');
      return;
    }

    this.isExamActive = true;
    this.currentSectionName = 'All';
    this.currentQuestionIndex = 0;
    this.userAnswers = {};
    this.markedForReview = {};
    this.visitedQuestions = {};
    this.timeSpentByQuestion = {};
    this.questionTimeSpent = this.timeSpentByQuestion;
    this.focusBreaks = [];

    // Initialize timers
    this.totalTimeLeft = (this.examPaper.duration_minutes || 180) * 60;
    const secCount = (this.examPaper.sections || []).length || 1;
    this.sectionTimeLeft = Math.floor(this.totalTimeLeft / secCount);

    // Switch view
    this.switchView('cbt');

    // Trigger Lockdown Mode if enabled
    if (this.lockdownEnabled) {
      document.body.classList.add('lockdown-active');
      this.requestFullscreenSafe();
    }

    this.renderCBT();
    this.startTimers();
    this.startAutoSave();
  }

  startExamWithData(paperData) {
    this.examPaper = paperData;
    this.startExam();
  }

  renderCBT() {
    this.renderSectionTabs();
    this.renderCurrentQuestion();
    this.renderPaletteGrid();
    this.updatePaletteLegendCounts();
  }

  renderSectionTabs() {
    const tabsContainer = document.getElementById('cbt-section-tabs');
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';

    const sections = ['All', ...(this.examPaper.sections || ['General'])];
    sections.forEach((secName) => {
      const btn = document.createElement('button');
      const isActive = (this.currentSectionName || 'All') === secName;
      btn.className = `section-tab ${isActive ? 'active' : ''}`;
      btn.textContent = secName === 'All' ? 'All Questions' : secName;
      btn.addEventListener('click', () => {
        this.saveCurrentQuestionTime();
        this.currentSectionName = secName;
        this.currentQuestionIndex = 0;
        this.renderCBT();
      });
      tabsContainer.appendChild(btn);
    });
  }

  getCurrentSectionQuestions() {
    if (!this.examPaper || !this.examPaper.questions) return [];
    if (!this.currentSectionName || this.currentSectionName === 'All') {
      return this.examPaper.questions;
    }
    return this.examPaper.questions.filter((q) => q.section === this.currentSectionName);
  }

  renderCurrentQuestion() {
    const secQuestions = this.getCurrentSectionQuestions();
    const q = secQuestions[this.currentQuestionIndex];
    if (!q) return;

    // Record visit
    this.visitedQuestions[q.id] = true;
    this.questionActiveStartTime = Date.now();

    const titleEl = document.getElementById('cbt-question-title');
    const marksEl = document.getElementById('cbt-question-marks');
    const textEl = document.getElementById('cbt-question-text');
    const typeBadge = document.getElementById('cbt-question-type-badge');
    const optionsContainer = document.getElementById('cbt-options-container');
    const natContainer = document.getElementById('cbt-nat-container');
    const imgWrap = document.getElementById('cbt-question-image-wrap');
    const imgEl = document.getElementById('cbt-question-image');

    if (titleEl) titleEl.textContent = `Question ${this.currentQuestionIndex + 1}`;
    if (marksEl) marksEl.textContent = `+${q.marks_positive || 3} / -${q.marks_negative || 1}`;
    if (textEl) textEl.innerHTML = q.text;

    // Question Type Badge
    if (typeBadge) {
      if (q.type === 'MSQ') {
        typeBadge.className = 'badge-qtype badge-msq';
        typeBadge.textContent = 'MSQ (Multi-Select)';
      } else if (q.type === 'NAT') {
        typeBadge.className = 'badge-qtype badge-nat';
        typeBadge.textContent = 'NAT (Numerical)';
      } else {
        typeBadge.className = 'badge-qtype badge-mcq';
        typeBadge.textContent = 'MCQ (Single Choice)';
      }
    }

    // Question Diagram Handling (Stateless base64 Data URI)
    if (imgWrap && imgEl) {
      if (q.image_data) {
        imgEl.src = q.image_data;
        imgWrap.style.display = 'flex';
      } else {
        imgWrap.style.display = 'none';
        imgEl.src = '';
      }
    }

    const currentAnswer = this.userAnswers[q.id];

    if (q.type === 'MCQ') {
      if (natContainer) natContainer.style.display = 'none';
      if (optionsContainer) {
        optionsContainer.style.display = 'flex';
        optionsContainer.innerHTML = '';

        const opts = q.options || { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' };
        Object.entries(opts).forEach(([key, val]) => {
          if (!val && val !== '') return;
          const optDiv = document.createElement('div');
          optDiv.className = `cbt-option ${currentAnswer === key ? 'selected' : ''}`;
          optDiv.innerHTML = `
            <div class="cbt-option-letter">${key}</div>
            <div class="cbt-option-text">${val}</div>
          `;
          optDiv.addEventListener('click', () => {
            // Toggle single selection
            if (this.userAnswers[q.id] === key) {
              delete this.userAnswers[q.id];
            } else {
              this.userAnswers[q.id] = key;
            }
            this.renderCurrentQuestion();
            this.renderPaletteGrid();
            this.updatePaletteLegendCounts();
          });
          optionsContainer.appendChild(optDiv);
        });
      }
    } else if (q.type === 'MSQ') {
      // Multiple Select Question (MSQ)
      if (natContainer) natContainer.style.display = 'none';
      if (optionsContainer) {
        optionsContainer.style.display = 'flex';
        optionsContainer.innerHTML = '';

        // Parse selected options e.g. "A, C" -> ["A", "C"]
        const selectedList = (currentAnswer || '')
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);

        const opts = q.options || { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' };
        Object.entries(opts).forEach(([key, val]) => {
          if (!val && val !== '') return;
          const isSelected = selectedList.includes(key);
          const optDiv = document.createElement('div');
          optDiv.className = `cbt-option msq-opt ${isSelected ? 'selected' : ''}`;
          optDiv.innerHTML = `
            <div class="cbt-option-letter">${isSelected ? '<i class="fas fa-check"></i>' : key}</div>
            <div class="cbt-option-text">${val}</div>
          `;
          optDiv.addEventListener('click', () => {
            let updated = [...selectedList];
            if (updated.includes(key)) {
              updated = updated.filter((k) => k !== key);
            } else {
              updated.push(key);
              updated.sort();
            }

            if (updated.length === 0) {
              delete this.userAnswers[q.id];
            } else {
              this.userAnswers[q.id] = updated.join(', ');
            }
            this.renderCurrentQuestion();
            this.renderPaletteGrid();
            this.updatePaletteLegendCounts();
          });
          optionsContainer.appendChild(optDiv);
        });
      }
    } else {
      // NAT / TITA Question
      if (optionsContainer) optionsContainer.style.display = 'none';
      if (natContainer) {
        natContainer.style.display = 'flex';
        const input = document.getElementById('nat-answer-input');
        if (input) input.value = currentAnswer || '';
      }
    }

    // Render KaTeX for mathematical formulas
    if (window.renderMathInElement) {
      window.renderMathInElement(document.getElementById('cbt-question-card'), {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    }

    this.updateNavButtons();
  }

  // 5-State Palette Status Calculation
  getQuestionState(qId) {
    const isAnswered = this.userAnswers[qId] !== undefined && this.userAnswers[qId] !== null && String(this.userAnswers[qId]).trim() !== '';
    const isMarked = this.markedForReview[qId] === true;
    const isVisited = this.visitedQuestions[qId] === true;

    if (isAnswered && isMarked) return 'answered-marked-review';
    if (isMarked) return 'marked-review';
    if (isAnswered) return 'answered';
    if (isVisited) return 'not-answered';
    return 'not-visited';
  }

  renderPaletteGrid() {
    const grid = document.getElementById('cbt-palette-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const secQuestions = this.getCurrentSectionQuestions();
    secQuestions.forEach((q, idx) => {
      const btn = document.createElement('button');
      const state = this.getQuestionState(q.id);
      btn.className = `palette-q-btn ${state} ${idx === this.currentQuestionIndex ? 'active' : ''}`;
      btn.textContent = idx + 1;
      btn.addEventListener('click', () => {
        this.saveCurrentQuestionTime();
        this.currentQuestionIndex = idx;
        this.renderCurrentQuestion();
        this.renderPaletteGrid();
      });
      grid.appendChild(btn);
    });
  }

  updatePaletteLegendCounts() {
    let counts = {
      'not-visited': 0,
      'not-answered': 0,
      'answered': 0,
      'marked-review': 0,
      'answered-marked-review': 0
    };

    this.examPaper.questions.forEach((q) => {
      const state = this.getQuestionState(q.id);
      counts[state] = (counts[state] || 0) + 1;
    });

    const elNv = document.getElementById('legend-cnt-not-visited');
    const elNa = document.getElementById('legend-cnt-not-answered');
    const elAns = document.getElementById('legend-cnt-answered');
    const elMr = document.getElementById('legend-cnt-marked-review');
    const elAmr = document.getElementById('legend-cnt-ans-marked-review');

    if (elNv) elNv.textContent = counts['not-visited'];
    if (elNa) elNa.textContent = counts['not-answered'];
    if (elAns) elAns.textContent = counts['answered'];
    if (elMr) elMr.textContent = counts['marked-review'];
    if (elAmr) elAmr.textContent = counts['answered-marked-review'];

    // Update floating mobile palette drawer button label
    const mobileBtn = document.getElementById('mobile-palette-toggle');
    if (mobileBtn && this.examPaper && this.examPaper.questions) {
      const answeredTotal = (counts['answered'] || 0) + (counts['answered-marked-review'] || 0);
      const total = this.examPaper.questions.length;
      mobileBtn.innerHTML = `<i class="fas fa-th"></i> <span>Palette (${answeredTotal}/${total})</span>`;
    }
  }

  saveCurrentQuestionTime() {
    const secQuestions = this.getCurrentSectionQuestions();
    const q = secQuestions[this.currentQuestionIndex];
    if (q && this.questionActiveStartTime) {
      const elapsed = Math.floor((Date.now() - this.questionActiveStartTime) / 1000);
      if (elapsed > 0) {
        if (!this.timeSpentByQuestion) this.timeSpentByQuestion = {};
        this.timeSpentByQuestion[q.id] = (this.timeSpentByQuestion[q.id] || 0) + elapsed;
        this.questionTimeSpent = this.timeSpentByQuestion;
      }
      this.questionActiveStartTime = Date.now();
    }
  }

  updateNavButtons() {
    const prevBtn = document.getElementById('cbt-prev-btn');
    const nextBtn = document.getElementById('cbt-next-btn');
    const clearBtn = document.getElementById('cbt-clear-btn');
    const markBtn = document.getElementById('cbt-mark-review-btn');
    const submitBtn = document.getElementById('cbt-submit-test-btn');

    const secQuestions = this.getCurrentSectionQuestions();
    const isFirst = this.currentQuestionIndex === 0;

    if (prevBtn) {
      prevBtn.disabled = isFirst && (!this.currentSectionName || this.currentSectionName === 'All');
      prevBtn.onclick = () => this.navigatePrev();
    }

    if (nextBtn) {
      nextBtn.onclick = () => this.navigateSaveNext();
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        const q = secQuestions[this.currentQuestionIndex];
        if (q) {
          delete this.userAnswers[q.id];
          this.renderCurrentQuestion();
          this.renderPaletteGrid();
          this.updatePaletteLegendCounts();
        }
      };
    }

    if (markBtn) {
      markBtn.onclick = () => {
        const q = secQuestions[this.currentQuestionIndex];
        if (q) {
          this.markedForReview[q.id] = !this.markedForReview[q.id];
          this.navigateSaveNext(false); // Advance without resetting marked
        }
      };
    }

    if (submitBtn) {
      submitBtn.onclick = () => {
        if (confirm('Are you sure you want to end the test and generate your post-test intelligence analytics?')) {
          this.submitExam();
        }
      };
    }
  }

  navigatePrev() {
    this.saveCurrentQuestionTime();
    if (this.currentQuestionIndex > 0) {
      this.currentQuestionIndex--;
    } else {
      const sections = ['All', ...(this.examPaper.sections || ['General'])];
      const curIdx = sections.indexOf(this.currentSectionName || 'All');
      if (curIdx > 0) {
        this.currentSectionName = sections[curIdx - 1];
        this.renderSectionTabs();
        this.currentQuestionIndex = Math.max(0, this.getCurrentSectionQuestions().length - 1);
      }
    }
    this.renderCurrentQuestion();
    this.renderPaletteGrid();
  }

  navigateSaveNext(resetMarked = true) {
    this.saveCurrentQuestionTime();
    const secQuestions = this.getCurrentSectionQuestions();
    const q = secQuestions[this.currentQuestionIndex];

    if (resetMarked && q && this.userAnswers[q.id]) {
      this.markedForReview[q.id] = false;
    }

    if (this.currentQuestionIndex < secQuestions.length - 1) {
      this.currentQuestionIndex++;
    } else {
      const sections = ['All', ...(this.examPaper.sections || ['General'])];
      const curIdx = sections.indexOf(this.currentSectionName || 'All');
      if (curIdx >= 0 && curIdx < sections.length - 1) {
        this.currentSectionName = sections[curIdx + 1];
        this.currentQuestionIndex = 0;
        this.renderSectionTabs();
      }
    }
    this.renderCurrentQuestion();
    this.renderPaletteGrid();
    this.updatePaletteLegendCounts();
  }

  // =========================================================================
  // POWER-USER EXAM KEYBOARD SHORTCUTS
  // =========================================================================
  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // 1. Escape key closes open modals and mobile drawers across all views
      if (e.key === 'Escape') {
        const modals = [
          document.getElementById('calculator-modal'),
          document.getElementById('instructions-modal'),
          document.getElementById('autopsy-modal-backdrop'),
          document.getElementById('image-zoom-modal'),
          document.getElementById('history-modal-backdrop'),
          document.getElementById('byok-modal-backdrop'),
        ];
        modals.forEach((m) => {
          if (m) {
            m.classList.remove('open');
            if (m.style.display === 'flex' || m.style.display === 'block') m.style.display = 'none';
          }
        });
        const sidebar = document.getElementById('cbt-sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
          sidebar.classList.remove('open');
        }
        return;
      }

      // 2. Active exam keyboard shortcuts (only in CBT view)
      if (!this.isExamActive || this.currentView !== 'cbt') return;

      // Do not intercept if user is typing in an input, textarea, or select
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;

      const secQuestions = this.getCurrentSectionQuestions();
      const currentQ = secQuestions[this.currentQuestionIndex];
      if (!currentQ) return;

      const key = e.key.toLowerCase();

      // Options 1, 2, 3, 4 or A, B, C, D for MCQ
      if (['1', '2', '3', '4', 'a', 'b', 'c', 'd'].includes(key)) {
        if (currentQ.type === 'MCQ') {
          const map = { '1': 'A', 'a': 'A', '2': 'B', 'b': 'B', '3': 'C', 'c': 'C', '4': 'D', 'd': 'D' };
          const letter = map[key];
          this.userAnswers[currentQ.id] = letter;
          this.renderCurrentQuestion();
          this.renderPaletteGrid();
          this.updatePaletteLegendCounts();
          e.preventDefault();
        }
        return;
      }

      // Save & Next (ArrowRight or Enter)
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        this.navigateSaveNext();
        return;
      }

      // Previous (ArrowLeft)
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.navigatePrev();
        return;
      }

      // Mark for Review & Next (m or M)
      if (key === 'm') {
        e.preventDefault();
        this.markedForReview[currentQ.id] = !this.markedForReview[currentQ.id];
        this.navigateSaveNext(false);
        return;
      }
    });
  }

  // =========================================================================
  // VIRTUAL NUMPAD FOR NAT QUESTIONS
  // =========================================================================
  setupNumpad() {
    const numpad = document.getElementById('nat-numpad');
    const input = document.getElementById('nat-answer-input');
    if (!numpad || !input) return;

    numpad.addEventListener('click', (e) => {
      const btn = e.target.closest('.numpad-btn');
      if (!btn) return;

      const action = btn.getAttribute('data-action');
      const val = btn.getAttribute('data-val');
      const secQuestions = this.getCurrentSectionQuestions();
      const q = secQuestions[this.currentQuestionIndex];

      if (val !== null) {
        input.value += val;
      } else if (action === 'backspace') {
        input.value = input.value.slice(0, -1);
      } else if (action === 'clear') {
        input.value = '';
      }

      if (q) {
        if (input.value.trim() === '') {
          delete this.userAnswers[q.id];
        } else {
          this.userAnswers[q.id] = input.value;
        }
        this.renderPaletteGrid();
        this.updatePaletteLegendCounts();
      }
    });
  }

  // =========================================================================
  // TIMER & AUTO-SAVE CRASH RECOVERY
  // =========================================================================
  startTimers() {
    clearInterval(this.timerInterval);
    const overallTimerEl = document.getElementById('cbt-overall-timer');
    const headerTimerEl = document.getElementById('header-cbt-timer');
    const headerTimerWrap = document.getElementById('header-cbt-timer-wrap');
    const sectionTimerEl = document.getElementById('cbt-section-timer');

    this.timerInterval = setInterval(() => {
      if (!this.isExamActive) return;

      if (this.totalTimeLeft > 0) {
        this.totalTimeLeft--;
      } else {
        clearInterval(this.timerInterval);
        this.submitExam();
        return;
      }

      if (this.sectionTimeLeft > 0) {
        this.sectionTimeLeft--;
      }

      const h = Math.floor(this.totalTimeLeft / 3600);
      const m = Math.floor((this.totalTimeLeft % 3600) / 60);
      const s = this.totalTimeLeft % 60;
      const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

      if (overallTimerEl) overallTimerEl.textContent = formatted;
      if (headerTimerEl) headerTimerEl.textContent = formatted;

      // Critical time warning (under 5 minutes)
      const isCritical = this.totalTimeLeft <= 300;
      if (headerTimerWrap) headerTimerWrap.classList.toggle('timer-critical', isCritical);
      if (overallTimerEl) overallTimerEl.classList.toggle('timer-critical', isCritical);

      const sm = Math.floor(this.sectionTimeLeft / 60);
      const ss = this.sectionTimeLeft % 60;
      if (sectionTimerEl) {
        sectionTimerEl.textContent = `${String(sm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      }
    }, 1000);
  }

  startAutoSave() {
    setInterval(() => {
      if (!this.isExamActive || !this.examPaper) return;
      this.saveCurrentQuestionTime();

      const session = {
        examPaper: this.examPaper,
        examMode: this.examMode,
        currentSectionName: this.currentSectionName || 'All',
        currentQuestionIndex: this.currentQuestionIndex,
        userAnswers: this.userAnswers,
        markedForReview: this.markedForReview,
        visitedQuestions: this.visitedQuestions,
        timeSpentByQuestion: this.timeSpentByQuestion,
        totalTimeLeft: this.totalTimeLeft,
        sectionTimeLeft: this.sectionTimeLeft,
        focusBreaks: this.focusBreaks,
        savedAt: Date.now(),
      };

      try {
        const key = (window.MockShiftConfig && window.MockShiftConfig.STORAGE_KEYS && window.MockShiftConfig.STORAGE_KEYS.ACTIVE_SESSION) || 'mockshift_active_cbt_session';
        const payload = JSON.stringify(session);
        localStorage.setItem(key, payload);
        localStorage.setItem('mockshift_session', payload);
      } catch (err) {
        console.warn('Auto-save failed:', err);
      }
    }, 1000);
  }

  checkSessionRecovery() {
    const primaryKey = (window.MockShiftConfig && window.MockShiftConfig.STORAGE_KEYS && window.MockShiftConfig.STORAGE_KEYS.ACTIVE_SESSION) || 'mockshift_active_cbt_session';
    const raw = localStorage.getItem(primaryKey) || localStorage.getItem('mockshift_session');
    if (!raw) return;

    try {
      const session = JSON.parse(raw);
      if (!session || !session.examPaper || session.totalTimeLeft <= 0) return;

      const banner = document.getElementById('resume-session-banner');
      if (!banner) return;
      banner.style.display = 'flex';

      const resumeBtn = document.getElementById('resume-session-btn');
      const discardBtn = document.getElementById('discard-session-btn');

      if (resumeBtn) {
        resumeBtn.onclick = () => {
          this.examPaper = session.examPaper;
          this.examMode = session.examMode || 'CAT';
          this.currentSectionName = session.currentSectionName || 'All';
          this.currentQuestionIndex = session.currentQuestionIndex || 0;
          this.userAnswers = session.userAnswers || {};
          this.markedForReview = session.markedForReview || {};
          this.visitedQuestions = session.visitedQuestions || {};
          this.timeSpentByQuestion = session.timeSpentByQuestion || session.questionTimeSpent || {};
          this.questionTimeSpent = this.timeSpentByQuestion;
          this.totalTimeLeft = session.totalTimeLeft;
          this.sectionTimeLeft = session.sectionTimeLeft;
          this.focusBreaks = session.focusBreaks || [];

          banner.style.display = 'none';
          this.isExamActive = true;
          this.switchView('cbt');
          if (this.lockdownEnabled) {
            document.body.classList.add('lockdown-active');
            this.requestFullscreenSafe();
          }
          this.renderCBT();
          this.startTimers();
          this.startAutoSave();
          this.showToast('Restored previous exam progress from browser memory.', 'success');
        };
      }

      if (discardBtn) {
        discardBtn.onclick = () => {
          localStorage.removeItem(primaryKey);
          localStorage.removeItem('mockshift_session');
          banner.style.display = 'none';
        };
      }
    } catch (e) {
      console.warn('Session parse error:', e);
    }
  }

  // =========================================================================
  // EXAM-HALL LOCKDOWN & FOCUS BREAK DETECTION
  // =========================================================================
  setupLockdownListeners() {
    // Fullscreen exit tracking
    document.addEventListener('fullscreenchange', () => {
      if (this.isExamActive && this.lockdownEnabled && !document.fullscreenElement) {
        this.logFocusBreak('Exited Fullscreen Mode');
        this.showToast('Warning: Fullscreen exited! Please remain in exam mode.', 'danger');
      }
    });

    // Window blur / Tab switch tracking
    window.addEventListener('blur', () => {
      if (this.isExamActive && this.lockdownEnabled) {
        this.blurTimestamp = Date.now();
      }
    });

    window.addEventListener('focus', () => {
      if (this.isExamActive && this.lockdownEnabled && this.blurTimestamp) {
        const duration = Math.round((Date.now() - this.blurTimestamp) / 1000);
        this.logFocusBreak('Window Blur / Tab Switch', duration);
        this.showToast(`Focus break logged (${duration}s away). Maintain exam integrity!`, 'warning');
        this.blurTimestamp = null;
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (this.isExamActive && this.lockdownEnabled && document.hidden) {
        this.logFocusBreak('Switched Browser Tab');
        this.showToast('Focus Break: Tab switch detected and recorded.', 'danger');
      }
    });

    // Context menu blocking
    window.addEventListener('contextmenu', (e) => {
      if (this.isExamActive && this.lockdownEnabled) {
        e.preventDefault();
        this.showToast('Right-click context menu is disabled in Lockdown Mode.', 'warning');
      }
    });

    // Copy / Paste / Cut blocking
    ['copy', 'paste', 'cut'].forEach((ev) => {
      window.addEventListener(ev, (e) => {
        if (this.isExamActive && this.lockdownEnabled) {
          e.preventDefault();
          this.showToast('Clipboard copy/paste is restricted in Lockdown Mode.', 'danger');
        }
      });
    });

    // Key combinations blocking (Ctrl+C, Ctrl+V, Ctrl+U, F12)
    window.addEventListener('keydown', (e) => {
      if (this.isExamActive && this.lockdownEnabled) {
        if ((e.ctrlKey && ['c', 'v', 'x', 'u', 'a'].includes(e.key.toLowerCase())) || e.key === 'F12') {
          e.preventDefault();
        }
      }
    });
  }

  logFocusBreak(reason, durationSeconds = 0) {
    this.focusBreaks.push({
      timestamp: Date.now(),
      reason,
      durationSeconds,
    });
  }

  requestFullscreenSafe() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch (e) {}
  }

  // =========================================================================
  // SUBMISSION & POST-TEST ANALYTICS TRANSITION
  // =========================================================================
  submitExam() {
    this.isExamActive = false;
    clearInterval(this.timerInterval);
    clearInterval(this.sectionTimerInterval);
    this.saveCurrentQuestionTime();

    // Remove lockdown restrictions
    document.body.classList.remove('lockdown-active');
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    // Clear active session from browser memory to prevent stale recovery
    try {
      const primaryKey = (window.MockShiftConfig && window.MockShiftConfig.STORAGE_KEYS && window.MockShiftConfig.STORAGE_KEYS.ACTIVE_SESSION) || 'mockshift_active_cbt_session';
      localStorage.removeItem(primaryKey);
      localStorage.removeItem('mockshift_session');
    } catch (e) {}

    // Switch to Analytics view
    this.switchView('analytics');

    // Hand over to Post-Test Analytics engine
    if (window.MockShiftAnalytics) {
      window.MockShiftAnalytics.evaluateAndRender(
        this.examPaper,
        this.userAnswers,
        this.timeSpentByQuestion,
        this.focusBreaks
      );
    }
  }

  setupAutopsyModal() {
    const backdrop = document.getElementById('autopsy-modal-backdrop');
    const closeBtn = document.getElementById('autopsy-modal-close');
    if (backdrop && closeBtn) {
      closeBtn.addEventListener('click', () => backdrop.classList.remove('open'));
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.remove('open');
      });
    }
  }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
  window.MockShiftApp = new MockShiftCBT();
});

