/**
 * MockShift - Post-Test Intelligence Dashboard & Analytics Engine
 * Features:
 *  - Executive Scorecard (+Marks Gained, -Marks Lost, Accuracy, Attempt Rate, Avg Pace, Focus Breaks)
 *  - Section-Wise Performance Breakdown Table
 *  - Behavioral Quadrant Chart (Chart.js):
 *      1. Mastery Zone (Fast & Correct - #10b981)
 *      2. Careless / Rushed Slips (Fast & Incorrect - #f59e0b)
 *      3. Deep Grinds (Slow & Correct - #06b6d4)
 *      4. Time Traps (Slow & Incorrect - #ef4444)
 *  - Interactive Point-to-Question Scroll & Pulse Highlight
 *  - Printable Score Reports (window.print()) & Pure Paper JSON Exporter
 *  - Lazy Solving & Evaluation Pipeline
 *  - On-Demand AI Mistake Autopsy Modal with Persistent History Caching
 *  - One-Click Adaptive 5Q AI Weakness Drill Launcher
 */

class MockShiftAnalytics {
  constructor() {
    this.chartInstance = null;
    this.autopsyCache = {}; // In-memory & local cache for autopsy results
    this.currentFilter = 'all';
    this.examData = null;
    this.userAnswers = {};
    this.timeSpent = {};
    this.focusBreaks = [];
  }

  async evaluateAndRender(examData, userAnswers, timeSpent, focusBreaks) {
    this.examData = examData;
    this.userAnswers = userAnswers;
    this.timeSpent = timeSpent;
    this.focusBreaks = focusBreaks || [];

    // Stage 2: Token-Optimized Lazy Evaluation
    // Find attempted questions where correct_answer is null
    const missingAnswerQuestions = [];
    for (const q of this.examData.questions) {
      const uAns = this.userAnswers[q.id];
      const isAttempted = uAns !== undefined && uAns !== null && String(uAns).trim() !== '';
      if (isAttempted && (q.correct_answer === null || q.correct_answer === undefined)) {
        missingAnswerQuestions.push(q);
      }
    }

    if (missingAnswerQuestions.length > 0) {
      this.showEvaluationLoading(true, `Evaluating unkeyed responses with AI (${missingAnswerQuestions.length} questions)...`);
      try {
        const headers = { 'Content-Type': 'application/json' };
        const userKey = window.MockShiftAuth ? window.MockShiftAuth.getApiKey() : null;
        if (userKey) headers['X-Gemini-Api-Key'] = userKey;

        const res = await fetch('/api/solve-batch', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ questions: missingAnswerQuestions })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.answers) {
            for (const q of this.examData.questions) {
              if (data.answers[String(q.id)]) {
                q.correct_answer = data.answers[String(q.id)];
              }
            }
          }
        } else if (res.status === 401 && window.MockShiftAuth) {
          window.MockShiftAuth.openKeyModal();
        }
      } catch (err) {
        console.warn('Batch solve error (continuing with existing keys):', err);
      } finally {
        this.showEvaluationLoading(false);
      }
    }

    this.renderDashboard();
  }

  showEvaluationLoading(show, message = 'Evaluating responses...') {
    let loader = document.getElementById('eval-loader');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'eval-loader';
      loader.style.cssText = `
        position: fixed; inset: 0; background: rgba(10, 15, 29, 0.88); backdrop-filter: blur(8px);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        z-index: 1000; color: #14b8a6; font-size: 1.1rem; font-weight: 700; gap: 1rem;
      `;
      loader.innerHTML = `
        <div class="progress-spinner" style="width: 48px; height: 48px; border-width: 4px;"></div>
        <div id="eval-loader-text">${message}</div>
      `;
      document.body.appendChild(loader);
    }
    const textEl = document.getElementById('eval-loader-text');
    if (textEl) textEl.textContent = message;
    loader.style.display = show ? 'flex' : 'none';
  }

  computeMetrics() {
    let totalScore = 0;
    let maxPossibleScore = 0;
    let totalAttempted = 0;
    let totalCorrect = 0;
    let totalIncorrect = 0;
    let totalSecondsAttempted = 0;
    let positiveMarksGained = 0;
    let negativeMarksLost = 0;

    const questionsAnalysis = [];
    const sectionMap = {};

    this.examData.questions.forEach((q) => {
      const pos = Number(q.marks_positive !== undefined ? q.marks_positive : 3);
      maxPossibleScore += pos;
      const uAns = this.userAnswers[q.id];
      const isAttempted = uAns !== undefined && uAns !== null && String(uAns).trim() !== '';
      const spent = this.timeSpent[q.id] || 0;

      let isCorrect = false;
      let marksEarned = 0;

      const secName = q.section || 'General';
      if (!sectionMap[secName]) {
        sectionMap[secName] = {
          name: secName,
          total: 0,
          attempted: 0,
          correct: 0,
          incorrect: 0,
          netScore: 0,
          totalTime: 0
        };
      }
      sectionMap[secName].total++;
      sectionMap[secName].totalTime += spent;

      if (isAttempted) {
        totalAttempted++;
        sectionMap[secName].attempted++;
        totalSecondsAttempted += spent;

        const correctClean = String(q.correct_answer || '').trim().toUpperCase();
        const userClean = String(uAns).trim().toUpperCase();

        if (q.type === 'MCQ') {
          isCorrect = userClean === correctClean;
        } else if (q.type === 'MSQ') {
          const normalizeSet = (str) =>
            str.replace(/[^A-Za-z]/g, ' ')
               .toUpperCase()
               .split(/\s+/)
               .filter(Boolean)
               .sort()
               .join(',');
          const userSet = normalizeSet(userClean);
          const correctSet = normalizeSet(correctClean);
          isCorrect = userSet.length > 0 && userSet === correctSet;
        } else {
          // NAT: Allow numeric equivalence within small tolerance
          const uNum = parseFloat(userClean);
          const cNum = parseFloat(correctClean);
          if (!isNaN(uNum) && !isNaN(cNum)) {
            isCorrect = Math.abs(uNum - cNum) < 0.01;
          } else {
            isCorrect = userClean === correctClean;
          }
        }

        if (isCorrect) {
          totalCorrect++;
          sectionMap[secName].correct++;
          marksEarned = pos;
          positiveMarksGained += pos;
        } else {
          totalIncorrect++;
          sectionMap[secName].incorrect++;
          const neg = q.type === 'MSQ'
            ? (q.marks_negative !== undefined ? Number(q.marks_negative) : 0)
            : Number(q.marks_negative !== undefined ? q.marks_negative : 1);
          marksEarned = -neg;
          negativeMarksLost += neg;
        }
        totalScore += marksEarned;
        sectionMap[secName].netScore += marksEarned;
      }

      questionsAnalysis.push({
        question: q,
        userAnswer: isAttempted ? uAns : null,
        correctAnswer: q.correct_answer,
        isAttempted,
        isCorrect,
        marksEarned,
        timeSpent: spent,
      });
    });

    const totalQuestions = this.examData.questions.length;
    const accuracy = totalAttempted > 0 ? (totalCorrect / totalAttempted) * 100 : 0;
    const attemptRate = totalQuestions > 0 ? (totalAttempted / totalQuestions) * 100 : 0;
    const avgTimePerQuestion = totalAttempted > 0 ? Math.round(totalSecondsAttempted / totalAttempted) : 0;

    // Calculate median pace threshold for attempted questions
    const attemptedTimes = questionsAnalysis
      .filter((qa) => qa.isAttempted)
      .map((qa) => qa.timeSpent)
      .sort((a, b) => a - b);

    let medianTime = 60; // fallback default
    if (attemptedTimes.length > 0) {
      const mid = Math.floor(attemptedTimes.length / 2);
      medianTime = attemptedTimes.length % 2 !== 0
        ? attemptedTimes[mid]
        : Math.round((attemptedTimes[mid - 1] + attemptedTimes[mid]) / 2);
    }
    if (medianTime === 0) medianTime = 45;

    // 4 Behavioral Quadrant Zones
    const buckets = {
      mastered: [],   // Fast & Correct (<= median, correct)
      careless: [],   // Fast & Incorrect (<= median, wrong)
      deepGrind: [],  // Slow & Correct (> median, correct)
      timeTrap: []    // Slow & Incorrect (> median, wrong)
    };

    questionsAnalysis.forEach((qa) => {
      if (!qa.isAttempted) return;
      if (qa.isCorrect) {
        if (qa.timeSpent <= medianTime) buckets.mastered.push(qa);
        else buckets.deepGrind.push(qa);
      } else {
        if (qa.timeSpent <= medianTime) buckets.careless.push(qa);
        else buckets.timeTrap.push(qa);
      }
    });

    const sections = Object.values(sectionMap).map((sec) => ({
      ...sec,
      accuracy: sec.attempted > 0 ? (sec.correct / sec.attempted) * 100 : 0,
    }));

    return {
      totalScore,
      maxPossibleScore,
      positiveMarksGained,
      negativeMarksLost,
      totalQuestions,
      totalAttempted,
      totalCorrect,
      totalIncorrect,
      accuracy,
      attemptRate,
      avgTimePerQuestion,
      medianTime,
      buckets,
      sections,
      questionsAnalysis,
    };
  }

  renderDashboard() {
    const metrics = this.computeMetrics();

    // Save test record into user's isolated local history (and sync to Google Drive if connected)
    if (window.MockShiftAuth && window.MockShiftAuth.saveExamAttempt) {
      window.MockShiftAuth.saveExamAttempt({
        examTitle: this.examData.exam_title,
        examMode: this.examData.exam_mode,
        totalScore: metrics.totalScore,
        maxPossibleScore: metrics.maxPossibleScore,
        positiveMarksGained: metrics.positiveMarksGained,
        negativeMarksLost: metrics.negativeMarksLost,
        accuracy: metrics.accuracy,
        totalAttempted: metrics.totalAttempted,
        totalQuestions: metrics.totalQuestions,
        avgTimePerQuestion: metrics.avgTimePerQuestion,
        buckets: {
          mastered: metrics.buckets.mastered.length,
          careless: metrics.buckets.careless.length,
          deepGrind: metrics.buckets.deepGrind.length,
          timeTrap: metrics.buckets.timeTrap.length,
        },
        examData: this.examData,
        userAnswers: this.userAnswers,
        timeSpent: this.timeSpent,
        focusBreaks: this.focusBreaks,
        autopsies: this.autopsyCache,
      });
    }

    const container = document.getElementById('analytics-screen');
    if (!container) return;

    const avgMinutes = Math.floor(metrics.avgTimePerQuestion / 60);
    const avgSecs = metrics.avgTimePerQuestion % 60;

    const netScoreDisplay = metrics.totalScore >= 0 ? metrics.totalScore.toFixed(2) : `-${Math.abs(metrics.totalScore).toFixed(2)}`;

    container.innerHTML = `
      <div class="analytics-wrapper">
        <!-- Top Action Bar (Print & Export Paper) -->
        <div class="analytics-action-bar no-print" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <button class="btn btn-secondary btn-sm" id="analytics-back-home-btn">
              <i class="fas fa-arrow-left"></i> Home
            </button>
            <h2 style="font-size: 1.25rem; font-weight: 800; margin: 0; color: var(--text-primary);">
              ${this.examData.exam_title || 'Post-Test Performance Report'}
            </h2>
          </div>
          <div style="display: flex; gap: 0.65rem; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm" id="export-paper-json-btn" title="Download clean KaTeX-ready JSON paper with 0 user answers">
              <i class="fas fa-file-download"></i> Export Paper (.json)
            </button>
            <button class="btn btn-primary btn-sm" id="download-pdf-report-btn" title="Print or save as PDF score report">
              <i class="fas fa-print"></i> Download PDF Report
            </button>
          </div>
        </div>

        <!-- Printable Exam Header (Visible in print) -->
        <div class="print-only-header" style="display: none; border-bottom: 2px solid #000; padding-bottom: 1rem; margin-bottom: 1.5rem;">
          <h1 style="font-size: 1.6rem; font-weight: 900; margin: 0 0 0.25rem 0;">MockShift CBT Performance Report</h1>
          <div style="font-size: 0.95rem; color: #4b5563;">Exam: <strong>${this.examData.exam_title}</strong> | Mode: <strong>${this.examData.exam_mode}</strong> | Date: ${new Date().toLocaleDateString()}</div>
        </div>

        <!-- Top Hero Bar / Scorecard -->
        <div class="analytics-hero">
          <div class="score-display">
            <span class="score-label">Net Score</span>
            <div class="score-number">${netScoreDisplay}</div>
            <div class="score-sub">out of ${metrics.maxPossibleScore.toFixed(2)} max marks</div>
            <div style="font-size: 0.8rem; margin-top: 0.4rem; color: var(--text-muted);">
              <span style="color: #10b981; font-weight: 700;">+${metrics.positiveMarksGained.toFixed(2)} gained</span>
              ${metrics.negativeMarksLost > 0 ? ` &bull; <span style="color: #ef4444; font-weight: 700;">-${metrics.negativeMarksLost.toFixed(2)} lost</span>` : ''}
            </div>
          </div>
          <div class="summary-cards-grid">
            <div class="stat-card">
              <div class="num" style="color: #10b981;">${metrics.accuracy.toFixed(1)}%</div>
              <div class="desc">Accuracy (${metrics.totalCorrect}/${metrics.totalAttempted || 0})</div>
            </div>
            <div class="stat-card">
              <div class="num" style="color: #38bdf8;">${metrics.attemptRate.toFixed(1)}%</div>
              <div class="desc">Attempt Rate (${metrics.totalAttempted}/${metrics.totalQuestions})</div>
            </div>
            <div class="stat-card">
              <div class="num">${avgMinutes}m ${avgSecs}s</div>
              <div class="desc">Avg Pace / Question</div>
            </div>
            <div class="stat-card" style="cursor: pointer;" id="focus-break-card" title="Click to view focus break log">
              <div class="num" style="color: ${this.focusBreaks.length > 0 ? '#f59e0b' : '#10b981'};">
                ${this.focusBreaks.length} <i class="fas fa-external-link-alt" style="font-size: 0.8rem;"></i>
              </div>
              <div class="desc">Focus Breaks (${this.focusBreaks.length === 0 ? '100% Discipline' : 'Lockdown Alerts'})</div>
            </div>
          </div>
        </div>

        <!-- Section-Wise Performance Table -->
        <div class="section-breakdown-card" style="background: var(--bg-card); border-radius: var(--radius-md); padding: 1.25rem 1.5rem; margin-bottom: 2rem; border: 1px solid var(--border);">
          <h3 style="font-size: 1.15rem; font-weight: 800; margin-bottom: 1rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem;">
            <i class="fas fa-layer-group" style="color: var(--accent);"></i> Section-Wise Performance Breakdown
          </h3>
          <div style="overflow-x: auto;">
            <table class="review-table section-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Total Qs</th>
                  <th>Attempted</th>
                  <th>Correct</th>
                  <th>Incorrect</th>
                  <th>Net Score</th>
                  <th>Accuracy</th>
                  <th>Time Spent</th>
                </tr>
              </thead>
              <tbody>
                ${this.renderSectionTableRows(metrics.sections)}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Adaptive Weakness Drill CTA Banner (Hidden in print) -->
        <div class="no-print" style="background: linear-gradient(135deg, #115e59, #0f766e); border-radius: var(--radius-md); padding: 1.25rem 1.75rem; margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; box-shadow: 0 4px 20px rgba(13, 148, 136, 0.25);">
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 800; color: #ffffff; display: flex; align-items: center; gap: 0.5rem;">
              <i class="fas fa-bolt" style="color: #fde047;"></i> One-Click AI Weakness Drill
            </h3>
            <p style="color: #ccfbf1; font-size: 0.85rem; margin-top: 0.25rem;">
              Instantly generate an adaptive 5-question (10 min) mini-test targeting your exact mistakes.
            </p>
          </div>
          <button class="btn btn-accent" id="start-weakness-drill-btn" style="padding: 0.75rem 1.4rem; font-weight: 800;">
            <i class="fas fa-play"></i> Start Weakness Drill
          </button>
        </div>

        <!-- Behavioral Quadrant Scatter Plot Card -->
        <div class="quadrant-card">
          <div class="quadrant-header">
            <div>
              <h2 style="font-size: 1.3rem; font-weight: 800; color: var(--text-primary);">
                Time vs. Accuracy Behavioral Quadrant
              </h2>
              <p style="font-size: 0.85rem; color: var(--text-muted);">
                Click any plotted point to jump directly to its question autopsy. Pace benchmark: <strong>${metrics.medianTime}s</strong>
              </p>
            </div>
          </div>

          <div style="position: relative; height: 340px; width: 100%;">
            <canvas id="quadrant-chart"></canvas>
          </div>

          <!-- 4 Buckets Breakdown (Clickable Quadrant Filters) -->
          <div class="quadrant-buckets">
            <div class="bucket-item bucket-mastered" data-quadrant="mastered" style="cursor: pointer;" title="Click to filter questions in Mastery Zone">
              <div class="bucket-title">
                <span style="color: #10b981;"><i class="fas fa-check-circle"></i> Mastery Zone</span>
                <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 2px 8px; border-radius: 12px; font-weight: 800;">${metrics.buckets.mastered.length}</span>
              </div>
              <div class="bucket-desc">Fast & Correct: High-confidence solves; maintain steady pace.</div>
            </div>
            <div class="bucket-item bucket-impulse" data-quadrant="careless" style="cursor: pointer;" title="Click to filter questions with Careless Slips">
              <div class="bucket-title">
                <span style="color: #f59e0b;"><i class="fas fa-bolt"></i> Careless Slips</span>
                <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; padding: 2px 8px; border-radius: 12px; font-weight: 800;">${metrics.buckets.careless.length}</span>
              </div>
              <div class="bucket-desc">Fast & Incorrect: Answered below target time but lost marks; double-check.</div>
            </div>
            <div class="bucket-item bucket-speed-trap" data-quadrant="deepGrind" style="cursor: pointer;" title="Click to filter questions with Deep Grinds">
              <div class="bucket-title">
                <span style="color: #06b6d4;"><i class="fas fa-brain"></i> Deep Grinds</span>
                <span class="badge" style="background: rgba(6, 182, 212, 0.2); color: #06b6d4; padding: 2px 8px; border-radius: 12px; font-weight: 800;">${metrics.buckets.deepGrind.length}</span>
              </div>
              <div class="bucket-desc">Slow & Correct: Accurate but time-consuming; review shortcut methods.</div>
            </div>
            <div class="bucket-item bucket-ego-trap" data-quadrant="timeTrap" style="cursor: pointer;" title="Click to filter questions in Time Traps">
              <div class="bucket-title">
                <span style="color: #ef4444;"><i class="fas fa-hourglass-end"></i> Time Traps</span>
                <span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 2px 8px; border-radius: 12px; font-weight: 800;">${metrics.buckets.timeTrap.length}</span>
              </div>
              <div class="bucket-desc">Slow & Incorrect: Clock drains that lost marks; highest priority review.</div>
            </div>
          </div>
        </div>

        <!-- Question Review Table & AI Mistake Autopsy -->
        <div class="review-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 1rem;">
            <h2 style="font-size: 1.25rem; font-weight: 800;">Question Review & AI Mistake Autopsy</h2>
            <div class="review-filter-tabs no-print">
              <button class="filter-tab active" data-filter="all">All (${metrics.totalQuestions})</button>
              <button class="filter-tab" data-filter="wrong">Wrong (${metrics.totalIncorrect})</button>
              <button class="filter-tab" data-filter="skipped">Skipped (${metrics.totalQuestions - metrics.totalAttempted})</button>
              <button class="filter-tab" data-filter="correct">Correct (${metrics.totalCorrect})</button>
            </div>
          </div>

          <div style="overflow-x: auto;">
            <table class="review-table">
              <thead>
                <tr>
                  <th>Q#</th>
                  <th>Section</th>
                  <th>Question Preview</th>
                  <th>Your Answer</th>
                  <th>Correct Key</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th class="no-print">AI Autopsy</th>
                </tr>
              </thead>
              <tbody id="review-table-body">
                ${this.renderReviewTableRows(metrics.questionsAnalysis, 'all')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Initialize Chart.js
    this.renderQuadrantChart(metrics);

    // Bind event listeners
    this.bindEvents(metrics);

    // Render KaTeX math in the review table
    if (window.renderMathInElement) {
      window.renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false
      });
    }
  }

  renderSectionTableRows(sections) {
    if (!sections || sections.length === 0) {
      return `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No section data available</td></tr>`;
    }

    return sections.map((sec) => {
      const minutes = Math.floor(sec.totalTime / 60);
      const seconds = sec.totalTime % 60;
      const netDisplay = sec.netScore >= 0 ? `+${sec.netScore.toFixed(2)}` : sec.netScore.toFixed(2);
      const netColor = sec.netScore >= 0 ? '#10b981' : '#ef4444';

      return `
        <tr>
          <td><strong>${sec.name}</strong></td>
          <td>${sec.total}</td>
          <td>${sec.attempted}</td>
          <td style="color: #10b981; font-weight: 700;">${sec.correct}</td>
          <td style="color: #ef4444; font-weight: 700;">${sec.incorrect}</td>
          <td style="color: ${netColor}; font-weight: 800;">${netDisplay}</td>
          <td><strong>${sec.accuracy.toFixed(1)}%</strong></td>
          <td style="color: var(--text-muted); font-size: 0.85rem;">${minutes}m ${seconds}s</td>
        </tr>
      `;
    }).join('');
  }

  renderReviewTableRows(questionsAnalysis, filter) {
    const metrics = this.computeMetrics();
    const median = metrics.medianTime;

    return questionsAnalysis
      .filter((qa) => {
        if (filter === 'wrong') return qa.isAttempted && !qa.isCorrect;
        if (filter === 'skipped') return !qa.isAttempted;
        if (filter === 'correct') return qa.isAttempted && qa.isCorrect;
        if (filter === 'mastered') return qa.isAttempted && qa.isCorrect && qa.timeSpent <= median;
        if (filter === 'careless') return qa.isAttempted && !qa.isCorrect && qa.timeSpent <= median;
        if (filter === 'deepGrind') return qa.isAttempted && qa.isCorrect && qa.timeSpent > median;
        if (filter === 'timeTrap') return qa.isAttempted && !qa.isCorrect && qa.timeSpent > median;
        return true;
      })
      .map((qa) => {
        let statusBadge = '';
        if (!qa.isAttempted) {
          statusBadge = '<span class="status-badge skipped"><i class="fas fa-minus"></i> Skipped</span>';
        } else if (qa.isCorrect) {
          statusBadge = `<span class="status-badge correct"><i class="fas fa-check"></i> +${qa.marksEarned}</span>`;
        } else {
          statusBadge = `<span class="status-badge incorrect"><i class="fas fa-times"></i> ${qa.marksEarned}</span>`;
        }

        const cleanPreview = qa.question.text.replace(/<[^>]*>?/gm, '').substring(0, 95) + '...';
        const userDisplay = qa.isAttempted ? String(qa.userAnswer) : '&mdash;';
        const correctDisplay = qa.correctAnswer ? String(qa.correctAnswer) : 'Pending';

        const canAutopsy = !qa.isAttempted || !qa.isCorrect;
        const autopsyBtn = canAutopsy
          ? `<button class="btn btn-secondary btn-autopsy no-print" data-qid="${qa.question.id}" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;">
               <i class="fas fa-microscope" style="color: var(--accent);"></i> Autopsy
             </button>`
          : `<span style="font-size: 0.75rem; color: #10b981; font-weight: 600;"><i class="fas fa-check"></i> Solved</span>`;

        return `
          <tr id="review-q-${qa.question.id}">
            <td><strong>Q${qa.question.id}</strong></td>
            <td><span class="tag tag-primary">${(qa.question.section || 'General').split('&')[0].trim()}</span></td>
            <td>${cleanPreview}</td>
            <td><strong>${userDisplay}</strong></td>
            <td style="color: #10b981;"><strong>${correctDisplay}</strong></td>
            <td>${statusBadge}</td>
            <td style="font-size: 0.82rem; color: var(--text-muted);">${qa.timeSpent}s</td>
            <td class="no-print">${autopsyBtn}</td>
          </tr>
        `;
      })
      .join('');
  }

  renderQuadrantChart(metrics) {
    const canvas = document.getElementById('quadrant-chart');
    if (!canvas || !window.Chart) return;

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    // 4 Distinct Behavioral Datasets
    const datasets = [
      {
        label: 'Mastery Zone (Fast & Correct)',
        data: metrics.buckets.mastered.map((qa) => ({
          x: qa.timeSpent,
          y: 1,
          qId: qa.question.id,
          userAns: qa.userAnswer,
          correctAns: qa.correctAnswer,
          section: qa.question.section,
        })),
        backgroundColor: '#10b981',
        pointRadius: 8,
        pointHoverRadius: 11,
      },
      {
        label: 'Careless Slips (Fast & Wrong)',
        data: metrics.buckets.careless.map((qa) => ({
          x: qa.timeSpent,
          y: 0,
          qId: qa.question.id,
          userAns: qa.userAnswer,
          correctAns: qa.correctAnswer,
          section: qa.question.section,
        })),
        backgroundColor: '#f59e0b',
        pointRadius: 8,
        pointHoverRadius: 11,
      },
      {
        label: 'Deep Grinds (Slow & Correct)',
        data: metrics.buckets.deepGrind.map((qa) => ({
          x: qa.timeSpent,
          y: 1,
          qId: qa.question.id,
          userAns: qa.userAnswer,
          correctAns: qa.correctAnswer,
          section: qa.question.section,
        })),
        backgroundColor: '#06b6d4',
        pointRadius: 8,
        pointHoverRadius: 11,
      },
      {
        label: 'Time Traps (Slow & Wrong)',
        data: metrics.buckets.timeTrap.map((qa) => ({
          x: qa.timeSpent,
          y: 0,
          qId: qa.question.id,
          userAns: qa.userAnswer,
          correctAns: qa.correctAnswer,
          section: qa.question.section,
        })),
        backgroundColor: '#ef4444',
        pointRadius: 8,
        pointHoverRadius: 11,
      },
    ];

    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? '#475569' : '#9ca3af';
    const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';

    this.chartInstance = new window.Chart(canvas, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (event, elements) => {
          if (elements && elements.length > 0) {
            const el = elements[0];
            const dataset = datasets[el.datasetIndex];
            if (dataset && dataset.data[el.index]) {
              const pt = dataset.data[el.index];
              if (pt && pt.qId) {
                this.scrollToQuestion(pt.qId);
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Time Spent per Question (seconds) — Pace Target: ' + metrics.medianTime + 's',
              color: textColor,
              font: { weight: 'bold' }
            },
            grid: { color: gridColor },
            ticks: { color: textColor }
          },
          y: {
            min: -0.2,
            max: 1.2,
            ticks: {
              stepSize: 1,
              callback: (value) => (value === 1 ? 'Correct' : value === 0 ? 'Incorrect' : ''),
              color: textColor
            },
            grid: { color: gridColor },
            title: {
              display: true,
              text: 'Outcome',
              color: textColor,
              font: { weight: 'bold' }
            }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: textColor, boxWidth: 12, usePointStyle: true }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const p = context.raw;
                return [
                  `Question ${p.qId} (${p.section})`,
                  `Time: ${p.x}s | Pace Target: ${metrics.medianTime}s`,
                  `Your Answer: ${p.userAns} | Correct: ${p.correctAns}`,
                  `👉 Click point to inspect question`
                ];
              }
            }
          }
        }
      }
    });
  }

  scrollToQuestion(qId) {
    // If the review table currently filters this out, reset filter to 'all'
    const tbody = document.getElementById('review-table-body');
    const existingRow = document.getElementById(`review-q-${qId}`);
    if (!existingRow) {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      const allTab = document.querySelector('.filter-tab[data-filter="all"]');
      if (allTab) allTab.classList.add('active');
      const metrics = this.computeMetrics();
      if (tbody) tbody.innerHTML = this.renderReviewTableRows(metrics.questionsAnalysis, 'all');
      this.bindAutopsyButtons();
    }

    const targetRow = document.getElementById(`review-q-${qId}`);
    if (targetRow) {
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetRow.classList.remove('highlight-question-card');
      void targetRow.offsetWidth; // Force CSS reflow
      targetRow.classList.add('highlight-question-card');
      setTimeout(() => targetRow.classList.remove('highlight-question-card'), 2500);
    }
  }

  bindEvents(metrics) {
    // Filter tabs
    const filterTabs = document.querySelectorAll('.filter-tab');
    filterTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        filterTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.getAttribute('data-filter');
        const tbody = document.getElementById('review-table-body');
        if (tbody) {
          tbody.innerHTML = this.renderReviewTableRows(metrics.questionsAnalysis, filter);
          this.bindAutopsyButtons();
        }
      });
    });

    // Clickable quadrant cards for filtering
    const quadrantCards = document.querySelectorAll('.bucket-item[data-quadrant]');
    quadrantCards.forEach((qc) => {
      qc.addEventListener('click', () => {
        const quad = qc.getAttribute('data-quadrant');
        filterTabs.forEach((t) => t.classList.remove('active'));
        const tbody = document.getElementById('review-table-body');
        if (tbody) {
          tbody.innerHTML = this.renderReviewTableRows(metrics.questionsAnalysis, quad);
          this.bindAutopsyButtons();
        }
        const reviewCard = document.querySelector('.review-card');
        if (reviewCard) reviewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    this.bindAutopsyButtons();

    // Focus break popover
    const fbCard = document.getElementById('focus-break-card');
    if (fbCard) {
      fbCard.addEventListener('click', () => this.showFocusBreakLog());
    }

    // Weakness Drill CTA
    const drillBtn = document.getElementById('start-weakness-drill-btn');
    if (drillBtn) {
      drillBtn.addEventListener('click', () => this.launchWeaknessDrill(metrics));
    }

    // Export Paper (.json)
    const exportBtn = document.getElementById('export-paper-json-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportPaperJson());
    }

    // Download PDF Report (window.print)
    const pdfBtn = document.getElementById('download-pdf-report-btn');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', () => window.print());
    }

    // Back to Home
    const backBtn = document.getElementById('analytics-back-home-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (window.MockShiftApp && window.MockShiftApp.switchView) {
          window.MockShiftApp.switchView('upload');
        } else {
          window.location.reload();
        }
      });
    }
  }

  exportPaperJson() {
    if (!this.examData) {
      alert('No active exam paper to export.');
      return;
    }

    // Create clean KaTeX-ready ExamPaper payload stripped of user answers, API keys, or personal state
    const cleanPaper = {
      exam_title: this.examData.exam_title || 'MockShift Exam Paper',
      exam_mode: this.examData.exam_mode || 'CUSTOM',
      duration_minutes: this.examData.duration_minutes || 180,
      sections: this.examData.sections || ['General'],
      questions: (this.examData.questions || []).map((q) => ({
        id: q.id,
        section: q.section,
        type: q.type,
        text: q.text,
        options: q.options || null,
        correct_answer: q.correct_answer || null,
        marks_positive: q.marks_positive !== undefined ? q.marks_positive : 3,
        marks_negative: q.marks_negative !== undefined ? q.marks_negative : 1,
        has_image: Boolean(q.has_image),
        image_data: q.image_data || null,
        image_page: q.image_page || null,
        image_bbox: q.image_bbox || null,
      }))
    };

    const jsonStr = JSON.stringify(cleanPaper, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = (cleanPaper.exam_title || 'paper').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    a.href = url;
    a.download = `${safeTitle}_mockshift.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  bindAutopsyButtons() {
    const btns = document.querySelectorAll('.btn-autopsy');
    btns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const qId = parseInt(btn.getAttribute('data-qid'), 10);
        const question = this.examData.questions.find((q) => q.id === qId);
        if (!question) return;

        const userAns = this.userAnswers[qId];
        await this.openMistakeAutopsy(question, userAns);
      });
    });
  }

  async openMistakeAutopsy(question, userAns) {
    const modalBackdrop = document.getElementById('autopsy-modal-backdrop');
    const modalTitle = document.getElementById('autopsy-modal-title');
    const modalBody = document.getElementById('autopsy-modal-body');

    if (!modalBackdrop || !modalBody) return;

    modalTitle.textContent = `AI Mistake Autopsy: Question ${question.id}`;
    modalBackdrop.classList.add('open');

    // Check in-memory & persisted cache first (0 API calls)
    if (this.autopsyCache[question.id]) {
      this.renderAutopsyContent(modalBody, this.autopsyCache[question.id], question, userAns);
      return;
    }

    modalBody.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem;">
        <div class="progress-spinner" style="width: 40px; height: 40px; margin: 0 auto 1rem;"></div>
        <p style="font-weight: 600; color: var(--accent);">
          Consulting AI coach for surgical mistake autopsy...
        </p>
      </div>
    `;

    try {
      const headers = { 'Content-Type': 'application/json' };
      const userKey = window.MockShiftAuth ? window.MockShiftAuth.getApiKey() : null;
      if (userKey) headers['X-Gemini-Api-Key'] = userKey;

      const spent = this.timeSpent[question.id] || 0;

      const res = await fetch('/api/mistake-autopsy', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          question,
          user_answer: userAns ? String(userAns) : null,
          correct_answer: question.correct_answer ? String(question.correct_answer) : null,
          time_spent: spent,
          exam_mode: this.examData.exam_mode || 'CUSTOM'
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 401 && window.MockShiftAuth) {
          window.MockShiftAuth.openKeyModal();
        }
        throw new Error(errJson.detail || `Server returned error: ${res.statusText}`);
      }

      const autopsy = await res.json();
      this.autopsyCache[question.id] = autopsy;

      // Persist autopsy into user's exam attempt history for instant reopening
      if (window.MockShiftAuth && window.MockShiftAuth.getPastRecords) {
        try {
          const records = window.MockShiftAuth.getPastRecords();
          if (records && records.length > 0) {
            records[0].autopsies = this.autopsyCache;
            localStorage.setItem(window.MockShiftAuth.LOCAL_STORAGE_KEY, JSON.stringify(records));
            if (window.MockShiftAuth.syncStudentHistoryWithDrive) {
              window.MockShiftAuth.syncStudentHistoryWithDrive();
            }
          }
        } catch (e) {
          console.warn('Could not persist autopsy to history:', e);
        }
      }

      this.renderAutopsyContent(modalBody, autopsy, question, userAns);
    } catch (err) {
      modalBody.innerHTML = `
        <div style="padding: 1.5rem; text-align: center; color: var(--danger);">
          <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 0.75rem;"></i>
          <p>Failed to generate autopsy: ${err.message}</p>
        </div>
      `;
    }
  }

  renderAutopsyContent(container, autopsy, question, userAns) {
    const stepsHtml = (autopsy.step_by_step_solution || [])
      .map((s, idx) => `<div class="autopsy-step"><strong>Step ${idx + 1}:</strong> ${s}</div>`)
      .join('');

    const diagramHtml = question.image_data ? `
      <div style="margin: 0.75rem 0; padding: 0.75rem; background: var(--bg-surface); border-radius: var(--radius-sm); border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
          <span style="font-size: 0.8rem; font-weight: 700; color: var(--accent);"><i class="fas fa-image"></i> Question Diagram</span>
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.MockShiftZoomImage && window.MockShiftZoomImage('${question.image_data}')" style="padding: 0.15rem 0.5rem; font-size: 0.72rem;">
            <i class="fas fa-search-plus"></i> View Diagram
          </button>
        </div>
        <img src="${question.image_data}" alt="Diagram Q${question.id}" onclick="window.MockShiftZoomImage && window.MockShiftZoomImage('${question.image_data}')" style="max-height: 220px; max-width: 100%; object-fit: contain; display: block; margin: 0 auto; background: #ffffff; padding: 6px; border-radius: 4px; cursor: zoom-in;" />
      </div>
    ` : '';

    const rootCauseBadge = autopsy.root_cause
      ? `<span class="tag" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; font-weight: 800; font-size: 0.8rem; padding: 3px 8px; border-radius: 4px;"><i class="fas fa-diagnoses"></i> Root Cause: ${autopsy.root_cause}</span>`
      : '';

    const shortcutHtml = autopsy.time_saver_shortcut ? `
      <div class="autopsy-section-box" style="background: rgba(6, 182, 212, 0.08); border-left: 3px solid #06b6d4;">
        <h4 style="color: #06b6d4;"><i class="fas fa-bolt"></i> 30-Second Time-Saver Shortcut</h4>
        <div>${autopsy.time_saver_shortcut}</div>
      </div>
    ` : '';

    container.innerHTML = `
      <div style="margin-bottom: 1rem; padding: 0.75rem 1rem; background: var(--bg-surface); border-radius: var(--radius-sm); font-size: 0.85rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span style="font-weight: 700; color: var(--text-primary);">Question ${question.id} &bull; ${question.section || 'General'}</span>
          ${rootCauseBadge}
        </div>
        <div style="margin-bottom: 0.5rem; color: var(--text-primary); font-size: 0.95rem; line-height: 1.5;">${question.text}</div>
        ${diagramHtml}
        <div style="display: flex; gap: 1.5rem; margin-top: 0.5rem; font-size: 0.85rem;">
          <div><strong>Your Answer:</strong> <span style="color: ${userAns ? '#ef4444' : 'var(--text-muted)'}; font-weight: 700;">${userAns || 'Unattempted'}</span></div>
          <div><strong style="color: #10b981;">Verified Correct Answer:</strong> <span style="color: #10b981; font-weight: 800;">${question.correct_answer || 'Pending'}</span></div>
        </div>
      </div>

      <div class="autopsy-section-box">
        <h4><i class="fas fa-lightbulb"></i> Core Concept</h4>
        <div>${autopsy.core_concept || 'Concept Analysis'}</div>
      </div>

      <div class="autopsy-section-box">
        <h4><i class="fas fa-square-root-alt"></i> Key Formula / Principle</h4>
        <div style="font-size: 1.05rem; padding: 0.25rem 0;">${autopsy.formula_used || 'Standard Exam Method'}</div>
      </div>

      <div class="autopsy-section-box">
        <h4><i class="fas fa-list-ol"></i> Step-by-Step Solution</h4>
        ${stepsHtml}
      </div>

      ${shortcutHtml}

      <div class="autopsy-section-box trap-box">
        <h4 style="color: var(--warning);"><i class="fas fa-exclamation-triangle"></i> Common Trap & Aspirant Pitfalls</h4>
        <div>${autopsy.common_trap || 'Carefully check question boundary constraints.'}</div>
      </div>
    `;

    // Render KaTeX in autopsy modal
    if (window.renderMathInElement) {
      window.renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    }
  }

  showFocusBreakLog() {
    const modalBackdrop = document.getElementById('autopsy-modal-backdrop');
    const modalTitle = document.getElementById('autopsy-modal-title');
    const modalBody = document.getElementById('autopsy-modal-body');

    if (!modalBackdrop || !modalBody) return;

    modalTitle.textContent = `Focus Break Log (${this.focusBreaks.length} Incidents Recorded)`;
    modalBackdrop.classList.add('open');

    if (this.focusBreaks.length === 0) {
      modalBody.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: #10b981;">
          <i class="fas fa-shield-alt" style="font-size: 3rem; margin-bottom: 1rem;"></i>
          <h3>Flawless Concentration!</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 0.5rem;">
            No tab switches, window blurs, or fullscreen exits were detected during this session.
          </p>
        </div>
      `;
      return;
    }

    const rows = this.focusBreaks.map((fb, idx) => `
      <tr>
        <td>#${idx + 1}</td>
        <td>${new Date(fb.timestamp).toLocaleTimeString()}</td>
        <td><strong>${fb.reason || 'Tab Switch / Window Blur'}</strong></td>
        <td>${fb.durationSeconds ? fb.durationSeconds + 's' : 'Instant'}</td>
      </tr>
    `).join('');

    modalBody.innerHTML = `
      <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem;">
        MockShift Exam-Hall Lockdown monitors browser window focus and document visibility to emulate strict CBT exam conditions.
      </p>
      <table class="review-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>Event</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  async launchWeaknessDrill(metrics) {
    const wrongOrSkipped = metrics.questionsAnalysis
      .filter((qa) => !qa.isAttempted || !qa.isCorrect)
      .map((qa) => qa.question);

    if (wrongOrSkipped.length === 0) {
      alert('Congratulations! You got 100% of questions correct. No weakness drill needed.');
      return;
    }

    this.showEvaluationLoading(true, 'Synthesizing adaptive 5-question Weakness Drill with AI mentor...');

    try {
      const headers = { 'Content-Type': 'application/json' };
      const userKey = window.MockShiftAuth ? window.MockShiftAuth.getApiKey() : null;
      if (userKey) headers['X-Gemini-Api-Key'] = userKey;

      const res = await fetch('/api/weakness-drill', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          wrong_questions: wrongOrSkipped.slice(0, 5),
          exam_mode: this.examData.exam_mode || 'CUSTOM'
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 401 && window.MockShiftAuth) {
          window.MockShiftAuth.openKeyModal();
        }
        throw new Error(errJson.detail || `Failed to generate drill: ${res.statusText}`);
      }

      const drillPaper = await res.json();
      this.showEvaluationLoading(false);

      if (window.MockShiftApp && window.MockShiftApp.startExamWithData) {
        window.MockShiftApp.startExamWithData(drillPaper);
      } else {
        alert('Weakness Drill generated successfully! Starting...');
        window.location.reload();
      }
    } catch (err) {
      this.showEvaluationLoading(false);
      alert('Error launching weakness drill: ' + err.message);
    }
  }
}

// Global instance exposed on window
window.MockShiftAnalytics = new MockShiftAnalytics();
