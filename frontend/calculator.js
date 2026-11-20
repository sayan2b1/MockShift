/**
 * MockShift - Authentic Mouse-Only Virtual Calculator
 * Supports:
 *  - GATE Mode: TCS iON Scientific Calculator (Post-fix unary ops, Deg/Rad toggle, Memory, Constants)
 *  - CAT Mode: TCS iON Basic On-Screen Calculator (+, -, *, /, sqrt, %, +/-, Memory)
 * Strict Requirement: Mouse-only interaction (ignores physical keyboard).
 */

class MockShiftCalculator {
  constructor() {
    this.mode = 'GATE'; // 'GATE' (Scientific) or 'CAT' (Basic)
    this.isOpen = false;
    this.angleMode = 'DEG'; // 'DEG' or 'RAD'
    this.currentVal = '0';
    this.expression = '';
    this.memory = 0;
    this.newNumber = true;
    this.pendingOp = null;
    this.prevVal = null;

    this.container = null;
    this.displayVal = null;
    this.displayExpr = null;
    this.angleIndicator = null;

    this.initDOM();
    this.initDrag();
    this.initMouseOnlyShield();
  }

  setMode(mode) {
    this.mode = mode.toUpperCase() === 'CAT' ? 'CAT' : 'GATE';
    this.renderKeypad();
    const titleEl = document.getElementById('calc-title');
    if (titleEl) {
      titleEl.textContent = this.mode === 'GATE' ? 'GATE TCS iON Scientific Calculator' : 'CAT Basic Calculator';
    }
  }

  initDOM() {
    this.container = document.getElementById('calc-modal');
    if (!this.container) return;

    this.displayVal = document.getElementById('calc-display-val');
    this.displayExpr = document.getElementById('calc-display-expr');
    this.angleIndicator = document.getElementById('calc-angle-mode');

    // Close button
    const closeBtn = document.getElementById('calc-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggle(false);
      });
    }

    // Toggle button in header
    const toggleBtn = document.getElementById('header-calc-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggle();
      });
    }

    this.renderKeypad();
  }

  toggle(forceState) {
    if (!this.container) return;
    this.isOpen = typeof forceState === 'boolean' ? forceState : !this.isOpen;
    if (this.isOpen) {
      this.container.classList.add('open');
      this.updateDisplay();
    } else {
      this.container.classList.remove('open');
    }
  }

  initMouseOnlyShield() {
    // Strictly prevent physical keyboard events when calculator is focused or open
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && this.container && this.container.contains(document.activeElement)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  initDrag() {
    const header = document.getElementById('calc-header');
    if (!header || !this.container) return;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('#calc-close-btn')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.container.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      // Unset right/bottom styles to allow absolute positioning
      this.container.style.right = 'auto';
      this.container.style.bottom = 'auto';
      this.container.style.left = `${initialLeft}px`;
      this.container.style.top = `${initialTop}px`;

      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      // Keep within bounds
      newLeft = Math.max(10, Math.min(window.innerWidth - this.container.offsetWidth - 10, newLeft));
      newTop = Math.max(10, Math.min(window.innerHeight - this.container.offsetHeight - 10, newTop));

      this.container.style.left = `${newLeft}px`;
      this.container.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  renderKeypad() {
    const grid = document.getElementById('calc-buttons-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (this.mode === 'CAT') {
      grid.className = 'calc-grid cat-mode';
      const catButtons = [
        { label: 'MC', action: () => this.memClear(), cls: 'fn' },
        { label: 'MR', action: () => this.memRecall(), cls: 'fn' },
        { label: 'M+', action: () => this.memAdd(), cls: 'fn' },
        { label: 'M-', action: () => this.memSub(), cls: 'fn' },

        { label: 'C', action: () => this.clearAll(), cls: 'clear' },
        { label: 'CE', action: () => this.clearEntry(), cls: 'clear' },
        { label: '⌫', action: () => this.backspace(), cls: 'fn' },
        { label: '÷', action: () => this.setBinaryOp('/'), cls: 'op' },

        { label: '7', action: () => this.inputDigit('7') },
        { label: '8', action: () => this.inputDigit('8') },
        { label: '9', action: () => this.inputDigit('9') },
        { label: '×', action: () => this.setBinaryOp('*'), cls: 'op' },

        { label: '4', action: () => this.inputDigit('4') },
        { label: '5', action: () => this.inputDigit('5') },
        { label: '6', action: () => this.inputDigit('6') },
        { label: '-', action: () => this.setBinaryOp('-'), cls: 'op' },

        { label: '1', action: () => this.inputDigit('1') },
        { label: '2', action: () => this.inputDigit('2') },
        { label: '3', action: () => this.inputDigit('3') },
        { label: '+', action: () => this.setBinaryOp('+'), cls: 'op' },

        { label: '±', action: () => this.toggleSign(), cls: 'fn' },
        { label: '0', action: () => this.inputDigit('0') },
        { label: '.', action: () => this.inputDot() },
        { label: '=', action: () => this.computeEquals(), cls: 'eq' },

        { label: '√', action: () => this.applyUnaryOp('sqrt'), cls: 'fn' },
        { label: '%', action: () => this.applyPercent(), cls: 'fn' },
        { label: '1/x', action: () => this.applyUnaryOp('reciprocal'), cls: 'fn' },
      ];

      catButtons.forEach(btn => this.createButton(grid, btn));
      if (this.angleIndicator) this.angleIndicator.style.display = 'none';
    } else {
      // GATE TCS iON Scientific
      grid.className = 'calc-grid';
      if (this.angleIndicator) {
        this.angleIndicator.style.display = 'inline-block';
        this.angleIndicator.textContent = `Mode: ${this.angleMode}`;
      }

      const gateButtons = [
        // Row 1
        { label: 'Deg/Rad', action: () => this.toggleAngleMode(), cls: 'fn' },
        { label: 'sin', action: () => this.applyUnaryOp('sin'), cls: 'fn' },
        { label: 'cos', action: () => this.applyUnaryOp('cos'), cls: 'fn' },
        { label: 'tan', action: () => this.applyUnaryOp('tan'), cls: 'fn' },
        { label: 'ln', action: () => this.applyUnaryOp('ln'), cls: 'fn' },

        // Row 2
        { label: 'asin', action: () => this.applyUnaryOp('asin'), cls: 'fn' },
        { label: 'acos', action: () => this.applyUnaryOp('acos'), cls: 'fn' },
        { label: 'atan', action: () => this.applyUnaryOp('atan'), cls: 'fn' },
        { label: 'log', action: () => this.applyUnaryOp('log10'), cls: 'fn' },
        { label: 'e', action: () => this.inputConstant(Math.E), cls: 'fn' },

        // Row 3
        { label: 'x²', action: () => this.applyUnaryOp('sq'), cls: 'fn' },
        { label: 'x³', action: () => this.applyUnaryOp('cube'), cls: 'fn' },
        { label: 'xʸ', action: () => this.setBinaryOp('^'), cls: 'op' },
        { label: '√x', action: () => this.applyUnaryOp('sqrt'), cls: 'fn' },
        { label: 'π', action: () => this.inputConstant(Math.PI), cls: 'fn' },

        // Row 4
        { label: '1/x', action: () => this.applyUnaryOp('reciprocal'), cls: 'fn' },
        { label: 'n!', action: () => this.applyUnaryOp('factorial'), cls: 'fn' },
        { label: 'eˣ', action: () => this.applyUnaryOp('exp'), cls: 'fn' },
        { label: '10ˣ', action: () => this.applyUnaryOp('tenPow'), cls: 'fn' },
        { label: 'mod', action: () => this.setBinaryOp('%'), cls: 'op' },

        // Row 5: Memory & Clear
        { label: 'MC', action: () => this.memClear(), cls: 'fn' },
        { label: 'MR', action: () => this.memRecall(), cls: 'fn' },
        { label: 'M+', action: () => this.memAdd(), cls: 'fn' },
        { label: 'C', action: () => this.clearAll(), cls: 'clear' },
        { label: '⌫', action: () => this.backspace(), cls: 'fn' },

        // Row 6: Keypad 7 8 9 /
        { label: '7', action: () => this.inputDigit('7') },
        { label: '8', action: () => this.inputDigit('8') },
        { label: '9', action: () => this.inputDigit('9') },
        { label: '(', action: () => this.inputBracket('('), cls: 'op' },
        { label: '÷', action: () => this.setBinaryOp('/'), cls: 'op' },

        // Row 7: Keypad 4 5 6 *
        { label: '4', action: () => this.inputDigit('4') },
        { label: '5', action: () => this.inputDigit('5') },
        { label: '6', action: () => this.inputDigit('6') },
        { label: ')', action: () => this.inputBracket(')'), cls: 'op' },
        { label: '×', action: () => this.setBinaryOp('*'), cls: 'op' },

        // Row 8: Keypad 1 2 3 -
        { label: '1', action: () => this.inputDigit('1') },
        { label: '2', action: () => this.inputDigit('2') },
        { label: '3', action: () => this.inputDigit('3') },
        { label: '±', action: () => this.toggleSign(), cls: 'fn' },
        { label: '-', action: () => this.setBinaryOp('-'), cls: 'op' },

        // Row 9: 0 . = +
        { label: '0', action: () => this.inputDigit('0') },
        { label: '00', action: () => { this.inputDigit('0'); this.inputDigit('0'); } },
        { label: '.', action: () => this.inputDot() },
        { label: '=', action: () => this.computeEquals(), cls: 'eq' },
        { label: '+', action: () => this.setBinaryOp('+'), cls: 'op' },
      ];

      gateButtons.forEach(btn => this.createButton(grid, btn));
    }
  }

  createButton(container, config) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `calc-btn ${config.cls || ''}`;
    btn.textContent = config.label;
    btn.tabIndex = -1; // Keep out of tab flow
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevents stealing focus
      config.action();
    });
    container.appendChild(btn);
  }

  updateDisplay() {
    if (this.displayVal) {
      this.displayVal.textContent = this.currentVal;
    }
    if (this.displayExpr) {
      this.displayExpr.textContent = this.expression;
    }
  }

  inputDigit(d) {
    if (this.newNumber) {
      this.currentVal = d;
      this.newNumber = false;
    } else {
      if (this.currentVal === '0' && d !== '.') {
        this.currentVal = d;
      } else {
        if (this.currentVal.length < 16) {
          this.currentVal += d;
        }
      }
    }
    this.updateDisplay();
  }

  inputDot() {
    if (this.newNumber) {
      this.currentVal = '0.';
      this.newNumber = false;
    } else if (!this.currentVal.includes('.')) {
      this.currentVal += '.';
    }
    this.updateDisplay();
  }

  inputConstant(val) {
    this.currentVal = String(Number(val.toFixed(10)));
    this.newNumber = true;
    this.updateDisplay();
  }

  inputBracket(b) {
    this.expression += ` ${b} `;
    this.updateDisplay();
  }

  toggleSign() {
    if (this.currentVal !== '0') {
      if (this.currentVal.startsWith('-')) {
        this.currentVal = this.currentVal.substring(1);
      } else {
        this.currentVal = '-' + this.currentVal;
      }
      this.updateDisplay();
    }
  }

  toggleAngleMode() {
    this.angleMode = this.angleMode === 'DEG' ? 'RAD' : 'DEG';
    if (this.angleIndicator) {
      this.angleIndicator.textContent = `Mode: ${this.angleMode}`;
    }
  }

  clearAll() {
    this.currentVal = '0';
    this.expression = '';
    this.pendingOp = null;
    this.prevVal = null;
    this.newNumber = true;
    this.updateDisplay();
  }

  clearEntry() {
    this.currentVal = '0';
    this.newNumber = true;
    this.updateDisplay();
  }

  backspace() {
    if (this.newNumber) return;
    if (this.currentVal.length > 1) {
      this.currentVal = this.currentVal.slice(0, -1);
      if (this.currentVal === '-') this.currentVal = '0';
    } else {
      this.currentVal = '0';
      this.newNumber = true;
    }
    this.updateDisplay();
  }

  // Memory functions
  memClear() {
    this.memory = 0;
  }
  memRecall() {
    this.currentVal = String(this.memory);
    this.newNumber = true;
    this.updateDisplay();
  }
  memAdd() {
    this.memory += parseFloat(this.currentVal) || 0;
    this.newNumber = true;
  }
  memSub() {
    this.memory -= parseFloat(this.currentVal) || 0;
    this.newNumber = true;
  }

  // Binary Operations (+, -, *, /, ^, %)
  setBinaryOp(op) {
    const val = parseFloat(this.currentVal);
    if (this.pendingOp && !this.newNumber) {
      this.computeEquals();
    } else {
      this.prevVal = val;
    }

    this.pendingOp = op;
    this.expression = `${this.prevVal} ${op}`;
    this.newNumber = true;
    this.updateDisplay();
  }

  computeEquals() {
    if (!this.pendingOp || this.prevVal === null) return;
    const a = this.prevVal;
    const b = parseFloat(this.currentVal);
    let result = 0;

    switch (this.pendingOp) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case '*': result = a * b; break;
      case '/':
        if (b === 0) {
          this.currentVal = 'Error: Div by 0';
          this.newNumber = true;
          this.updateDisplay();
          return;
        }
        result = a / b;
        break;
      case '^': result = Math.pow(a, b); break;
      case '%': result = a % b; break;
    }

    // Format cleanly
    result = Number(result.toFixed(10));
    this.expression = `${a} ${this.pendingOp} ${b} =`;
    this.currentVal = String(result);
    this.prevVal = result;
    this.pendingOp = null;
    this.newNumber = true;
    this.updateDisplay();
  }

  // Post-fix Unary Operations (GATE style: typing 30 then clicking sin computes sin(30))
  applyUnaryOp(opName) {
    let x = parseFloat(this.currentVal);
    let res = 0;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;

    switch (opName) {
      case 'sin':
        res = Math.sin(this.angleMode === 'DEG' ? toRad(x) : x);
        this.expression = `sin(${x})`;
        break;
      case 'cos':
        res = Math.cos(this.angleMode === 'DEG' ? toRad(x) : x);
        this.expression = `cos(${x})`;
        break;
      case 'tan':
        res = Math.tan(this.angleMode === 'DEG' ? toRad(x) : x);
        this.expression = `tan(${x})`;
        break;
      case 'asin':
        res = Math.asin(x);
        if (this.angleMode === 'DEG') res = toDeg(res);
        this.expression = `asin(${x})`;
        break;
      case 'acos':
        res = Math.acos(x);
        if (this.angleMode === 'DEG') res = toDeg(res);
        this.expression = `acos(${x})`;
        break;
      case 'atan':
        res = Math.atan(x);
        if (this.angleMode === 'DEG') res = toDeg(res);
        this.expression = `atan(${x})`;
        break;
      case 'ln':
        if (x <= 0) { this.currentVal = 'Error: Domain'; this.newNumber = true; this.updateDisplay(); return; }
        res = Math.log(x);
        this.expression = `ln(${x})`;
        break;
      case 'log10':
        if (x <= 0) { this.currentVal = 'Error: Domain'; this.newNumber = true; this.updateDisplay(); return; }
        res = Math.log10(x);
        this.expression = `log(${x})`;
        break;
      case 'sqrt':
        if (x < 0) { this.currentVal = 'Error: Neg sqrt'; this.newNumber = true; this.updateDisplay(); return; }
        res = Math.sqrt(x);
        this.expression = `sqrt(${x})`;
        break;
      case 'sq':
        res = x * x;
        this.expression = `sqr(${x})`;
        break;
      case 'cube':
        res = x * x * x;
        this.expression = `cube(${x})`;
        break;
      case 'reciprocal':
        if (x === 0) { this.currentVal = 'Error: Div by 0'; this.newNumber = true; this.updateDisplay(); return; }
        res = 1 / x;
        this.expression = `1/(${x})`;
        break;
      case 'exp':
        res = Math.exp(x);
        this.expression = `e^(${x})`;
        break;
      case 'tenPow':
        res = Math.pow(10, x);
        this.expression = `10^(${x})`;
        break;
      case 'factorial':
        if (x < 0 || !Number.isInteger(x) || x > 170) {
          this.currentVal = 'Error: Int ≤ 170';
          this.newNumber = true;
          this.updateDisplay();
          return;
        }
        res = 1;
        for (let i = 2; i <= x; i++) res *= i;
        this.expression = `fact(${x})`;
        break;
    }

    res = Number(res.toFixed(10));
    this.currentVal = String(res);
    this.newNumber = true;
    this.updateDisplay();
  }

  applyPercent() {
    let x = parseFloat(this.currentVal) || 0;
    let res = x / 100;
    this.currentVal = String(res);
    this.expression = `${x}%`;
    this.newNumber = true;
    this.updateDisplay();
  }
}

// Global instance exposed on window
window.MockShiftCalc = new MockShiftCalculator();

