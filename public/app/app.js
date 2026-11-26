const app = {
  token: localStorage.getItem('mudgal_access_token') || '',
  refreshToken: localStorage.getItem('mudgal_refresh_token') || '',
  user: null,
  tab: 'home',
  lang: localStorage.getItem('mudgal_lang') || 'en',
  exams: [],
  selectedExamFilter: '',
  searchQuery: '',
  activeAttempt: null,
  timerInterval: null,
  playbackSpeed: '1x',

  t(en, hi) {
    return this.lang === 'hi' ? hi : en;
  },

  async api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`/api/v1${path}`, { ...options, headers });
    if (res.status === 401 && this.refreshToken && !options._retried) {
      const ok = await this.tryRefresh();
      if (ok) return this.api(path, { ...options, _retried: true });
    }
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { const err = await res.json(); msg = err.message || err.error || msg; } catch {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  },

  async tryRefresh() {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken })
      });
      if (!res.ok) return false;
      this.saveAuth(await res.json());
      return true;
    } catch { return false; }
  },

  saveAuth(auth) {
    this.token = auth.accessToken;
    this.refreshToken = auth.refreshToken;
    this.user = auth.user;
    localStorage.setItem('mudgal_access_token', auth.accessToken);
    localStorage.setItem('mudgal_refresh_token', auth.refreshToken);
  },

  clearAuth() {
    this.token = '';
    this.refreshToken = '';
    this.user = null;
    localStorage.removeItem('mudgal_access_token');
    localStorage.removeItem('mudgal_refresh_token');
  },

  toggleDark() { document.body.classList.toggle('dark'); },
  toggleLang() {
    this.lang = this.lang === 'en' ? 'hi' : 'en';
    localStorage.setItem('mudgal_lang', this.lang);
    this.render();
  },

  navigate(tab) {
    this.tab = tab;
    document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    this.render();
  },

  async init() {
    try {
      this.exams = await this.api('/exams');
      if (this.token) {
        this.user = await this.api('/me');
        this.refreshNotifCount();
      }
    } catch { this.clearAuth(); }
    this.render();
  },

  async refreshNotifCount() {
    if (!this.token) return;
    try {
      const list = await this.api('/notifications');
      const unread = list.filter(n => !n.readAt).length;
      const badge = document.getElementById('notifCount');
      badge.textContent = unread;
      badge.style.display = unread > 0 ? 'grid' : 'none';
    } catch {}
  },

  render() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    const goalPill = document.getElementById('goalPill');
    const goalLabel = document.getElementById('goalLabel');
    const langLabel = document.getElementById('langLabel');
    if (langLabel) langLabel.textContent = this.lang.toUpperCase();

    if (this.user?.targetExamName) {
      goalPill.style.display = 'inline-flex';
      goalLabel.textContent = this.user.targetExamName;
    } else {
      goalPill.style.display = 'none';
    }

    const view = document.getElementById('mainView');
    if (!this.token || !this.user) return this.renderAuth(view);
    if (!this.user.targetExamId) return this.renderExamOnboarding(view);

    switch (this.tab) {
      case 'home': this.renderHome(view); break;
      case 'explore': this.renderExplore(view); break;
      case 'learning': this.renderLearning(view); break;
      case 'tests': this.renderTests(view); break;
      case 'community': this.renderCommunity(view); break;
      case 'profile': this.renderProfile(view); break;
    }
  },

  renderAuth(view) {
    view.innerHTML = `
      <div class="card" style="max-width:460px;margin:28px auto;">
        <div class="row" style="margin-bottom:8px;">
          <div class="brand-mark">MB</div>
          <span class="badge">Mudgal Biology</span>
        </div>
        <h2 style="margin:6px 0;">${this.t('Welcome to Mudgal Biology', 'मुदगल बायोलॉजी में स्वागत है')}</h2>
        <p class="muted">${this.t('Sign in with your mobile number to access live classes, smart e-books, flashcards & mock tests.', 'लाइव क्लासेस, स्मार्ट ई-बुक्स, फ्लैशकार्ड्स और मॉक टेस्ट के लिए मोबाइल OTP से लॉग इन करें।')}</p>
        <div style="margin:14px 0;">
          <label class="muted">10-digit Mobile Number</label>
          <input id="phoneInput" value="9876543210" placeholder="Enter 10-digit phone" />
        </div>
        <button class="btn btn-primary" style="width:100%;" onclick="app.requestOtp()">Request OTP</button>
        <div id="otpStep" style="display:none;margin-top:16px;">
          <div id="devOtpHint" class="badge-amber" style="display:inline-block;margin-bottom:10px;"></div>
          <label class="muted">Enter 6-digit OTP</label>
          <input id="otpInput" placeholder="6-digit OTP" />
          <label class="muted" style="margin-top:10px;display:block;">Aspirant Full Name</label>
          <input id="nameInput" value="Aarav Sharma" />
          <button class="btn btn-navy" style="width:100%;margin-top:12px;" onclick="app.verifyOtp()">Verify &amp; Continue</button>
        </div>
        <p id="authErr" style="color:var(--danger);font-size:.88rem;margin-top:10px;"></p>
        <div class="muted" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);font-size:.8rem;">
          By continuing, you consent to our <a href="/terms" target="_blank">Terms &amp; Conditions</a> and <a href="/privacy" target="_blank">Privacy Policy</a>.
          <div style="margin-top:6px;"><a href="/about">About Mudgal Biology</a> &bull; <a href="/contact">Support</a> &bull; <a href="/admin">Staff Admin Login</a></div>
        </div>
      </div>
    `;
  },

  async requestOtp() {
    try {
      document.getElementById('authErr').textContent = '';
      const phone = document.getElementById('phoneInput').value;
      const res = await this.api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) });
      document.getElementById('otpStep').style.display = 'block';
      if (res.devOtpHint) {
        document.getElementById('devOtpHint').textContent = `Sandbox Dev OTP: ${res.devOtpHint}`;
        document.getElementById('otpInput').value = res.devOtpHint;
      }
    } catch (e) { document.getElementById('authErr').textContent = e.message; }
  },

  async verifyOtp() {
    try {
      const auth = await this.api('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({
          phone: document.getElementById('phoneInput').value,
          otp: document.getElementById('otpInput').value,
          fullName: document.getElementById('nameInput').value
        })
      });
      this.saveAuth(auth);
      this.refreshNotifCount();
      this.render();
    } catch (e) { document.getElementById('authErr').textContent = e.message; }
  },

  openGoalPicker() {
    this.showModal(`
      <h2>${this.t('Switch Target Exam', 'लक्ष्य परीक्षा बदलें')}</h2>
      <div class="grid" style="margin-top:12px;">
        ${this.exams.map(e => `
          <div class="card" style="margin:0;cursor:pointer;" onclick="app.closeModal();app.setTargetExam('${e.examId}')">
            <span class="badge">${e.code}</span>
            <h4 style="margin:8px 0 4px;">${e.name}</h4>
            <p class="muted">${e.description}</p>
          </div>
        `).join('')}
      </div>
    `);
  },

  renderExamOnboarding(view) {
    view.innerHTML = `
      <div class="card" style="max-width:680px;margin:20px auto;">
        <h2>${this.t('Choose Your Target Exam', 'अपना लक्ष्य परीक्षा चुनें')}</h2>
        <p class="muted">Mudgal Biology tailors your Home Feed, Batches, and Mock Tests to your goal.</p>
        <div class="grid" style="margin-top:14px;">
          ${this.exams.map(e => `
            <div class="card" style="margin:0;cursor:pointer;" onclick="app.setTargetExam('${e.examId}')">
              <span class="badge">${e.code}</span>
              <h3 style="margin:8px 0 4px;">${e.name}</h3>
              <p class="muted">${e.description}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  async setTargetExam(examId) {
    this.user = await this.api('/me/exam-preferences', {
      method: 'PUT',
      body: JSON.stringify({ targetExamId: examId, preferredLanguage: this.lang })
    });
    this.render();
  },

  async renderHome(view) {
    view.innerHTML = `<div class="card">Loading your Mudgal Biology dashboard...</div>`;
    try {
      const feed = await this.api('/me/home-feed');
      view.innerHTML = `
        <div class="hero-banner">
          <div>
            <span class="badge-amber">Mudgal Biology &bull; Daily Prep</span>
            <h2 style="margin:8px 0 4px;">${this.t('Welcome back', 'वापसी पर स्वागत है')}, ${this.user.fullName}</h2>
            <div style="opacity:.88;font-size:.9rem;">Active Goal: <button onclick="app.openGoalPicker()" style="background:rgba(255,255,255,.14);color:#5EEAD4;border:1px solid rgba(94,234,212,.35);border-radius:999px;padding:2px 10px;font:inherit;font-weight:700;cursor:pointer;">${this.user.targetExamName} ▾</button></div>
          </div>
          <div class="row">
            <button class="btn btn-primary btn-sm" onclick="app.openFlashcardsModal()">⚡ Practice Flashcards</button>
            <button class="btn btn-amber btn-sm" onclick="app.openPlansModal()">⭐ Exam Passes</button>
          </div>
        </div>

        <div class="quick-grid">
          <div class="quick-tile" onclick="app.navigate('learning')"><span class="qt-icon">📺</span>Live Classes</div>
          <div class="quick-tile" onclick="app.navigate('explore')"><span class="qt-icon">🎓</span>All Batches</div>
          <div class="quick-tile" onclick="app.navigate('tests')"><span class="qt-icon">📝</span>Mock Tests</div>
          <div class="quick-tile" onclick="app.openFlashcardsModal()"><span class="qt-icon">⚡</span>Flashcards</div>
          <div class="quick-tile" onclick="app.navigate('learning')"><span class="qt-icon">📖</span>Smart E-Books</div>
          <div class="quick-tile" onclick="app.navigate('community')"><span class="qt-icon">🙋</span>Doubt Desk</div>
          <div class="quick-tile" onclick="app.openPlansModal()"><span class="qt-icon">🎟️</span>Passes</div>
          <div class="quick-tile" onclick="app.navigate('community')"><span class="qt-icon">💬</span>Community</div>
        </div>

        <div class="row" style="justify-content:space-between;margin-bottom:10px;">
          <h3 style="margin:0;">${this.t('Continue Learning', 'पढ़ाई जारी रखें')}</h3>
          <button class="btn btn-outline btn-sm" onclick="app.navigate('learning')">View All</button>
        </div>
        ${feed.continueLearning.length === 0 ? `<div class="card empty-state">No enrolled batches yet. <button class="btn btn-primary btn-sm" onclick="app.navigate('explore')">Browse Batches</button></div>` : `
          <div class="grid">
            ${feed.continueLearning.map(c => `
              <div class="card" style="margin:0;">
                <span class="badge">${c.language}</span>
                <h4 style="margin:8px 0 4px;">${c.title}</h4>
                <div class="muted">${c.completedLessons}/${c.totalLessons} lessons (${c.progressPercent}%)</div>
                <div class="progress-bar" style="margin:10px 0;"><div class="progress-fill" style="width:${c.progressPercent}%"></div></div>
                <button class="btn btn-primary btn-sm" onclick="app.openCoursePlayer('${c.courseId}')">Resume Lesson &rarr;</button>
              </div>
            `).join('')}
          </div>
        `}

        <h3 style="margin:20px 0 10px;">${this.t('Live & Upcoming Classes', 'लाइव कक्षाएं')}</h3>
        <div class="grid">
          ${feed.upcomingLiveClasses.map(s => `
            <div class="card" style="margin:0;">
              <div class="row" style="justify-content:space-between;">
                <span class="badge">${s.provider}</span>
                ${s.isLiveNow ? `<span class="badge-live">● LIVE NOW</span>` : `<span class="muted">${new Date(s.startsAt).toLocaleString()}</span>`}
              </div>
              <h4 style="margin:8px 0 4px;">${s.title}</h4>
              <div class="muted">${s.facultyName} &bull; ${s.courseTitle}</div>
              <div style="margin-top:12px;">
                ${s.canJoin ? `<button class="btn btn-navy btn-sm" onclick="app.joinLive('${s.sessionId}')">Join Live Class</button>` : `<button class="btn btn-outline btn-sm" onclick="app.openCourseDetail('${s.courseId}')">Enroll to Join</button>`}
              </div>
            </div>
          `).join('')}
        </div>

        <h3 style="margin:20px 0 10px;">${this.t('Recommended Mock Tests', 'अनुशंसित मॉक टेस्ट')}</h3>
        <div class="grid">
          ${feed.recommendedTests.map(t => `
            <div class="card" style="margin:0;">
              <span class="badge">${t.courseTitle}</span>
              <h4 style="margin:8px 0 4px;">${t.title}</h4>
              <div class="muted">${t.questionCount} Qs &bull; ${t.totalMarks} Marks &bull; ${Math.round(t.durationSeconds/60)} mins</div>
              <div style="margin-top:12px;">
                ${t.isLocked ? `<button class="btn btn-outline btn-sm" onclick="app.openCourseDetail('${t.courseId}')">Unlock via Batch</button>` : `<button class="btn btn-primary btn-sm" onclick="app.startTest('${t.testId}')">${t.inProgressAttemptId ? 'Resume Attempt' : 'Attempt Now'}</button>`}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) {
      view.innerHTML = `<div class="card">Error: ${e.message} <button class="btn btn-sm btn-primary" onclick="app.render()">Retry</button></div>`;
    }
  },

  async renderExplore(view) {
    view.innerHTML = `<div class="card">Loading Mudgal Biology store...</div>`;
    const params = new URLSearchParams();
    if (this.selectedExamFilter) params.set('examId', this.selectedExamFilter);
    if (this.searchQuery) params.set('search', this.searchQuery);
    const data = await this.api(`/courses?${params.toString()}`);

    view.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:14px;">
        <div>
          <h2 style="margin:0;">Batches &amp; Course Store</h2>
          <span class="muted">Filter by exam, preview free demo classes, or get an All-Access Pass.</span>
        </div>
        <button class="btn btn-amber btn-sm" onclick="app.openPlansModal()">⭐ View Subscription Passes</button>
      </div>
      <div class="row" style="margin-bottom:14px;">
        <input id="courseSearchBox" placeholder="Search Biology, NEET, SSC, UPSC, Banking..." value="${this.searchQuery}" style="max-width:360px;" />
        <button class="btn btn-navy btn-sm" onclick="app.searchQuery=document.getElementById('courseSearchBox').value;app.renderExplore(document.getElementById('mainView'))">Search</button>
        ${this.searchQuery ? `<button class="btn btn-outline btn-sm" onclick="app.searchQuery='';app.renderExplore(document.getElementById('mainView'))">Clear</button>` : ''}
      </div>
      <div class="row" style="margin-bottom:18px;">
        <span class="chip ${this.selectedExamFilter === '' ? 'active' : ''}" onclick="app.selectedExamFilter='';app.renderExplore(document.getElementById('mainView'))">All Exams</span>
        ${this.exams.map(e => `<span class="chip ${this.selectedExamFilter === e.examId ? 'active' : ''}" onclick="app.selectedExamFilter='${e.examId}';app.renderExplore(document.getElementById('mainView'))">${e.code}</span>`).join('')}
      </div>
      ${data.items.length === 0 ? `<div class="card empty-state">No courses matched your filter.</div>` : `
        <div class="grid">
          ${data.items.map(c => `
            <div class="card" style="margin:0;display:flex;flex-direction:column;justify-content:space-between;">
              <div>
                <div class="row" style="justify-content:space-between;">
                  <span class="badge">${(c.examCodes || []).join(', ')}</span>
                  <span class="muted">${c.language}</span>
                </div>
                <h3 style="margin:10px 0 6px;">${c.title}</h3>
                <p class="muted">${c.description}</p>
                <div class="muted" style="margin-top:8px;">👨‍🏫 ${(c.facultyNames || []).join(', ') || 'Dr. Mudgal & Team'}</div>
                <div class="muted">🎬 ${c.lessonCount} Lessons &bull; 📝 ${c.testCount} Tests &bull; ⏳ ${c.validityDays}d</div>
              </div>
              <div class="row" style="justify-content:space-between;margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
                <strong style="font-size:1.2rem;">₹${c.price}</strong>
                <button class="btn btn-primary btn-sm" onclick="app.openCourseDetail('${c.courseId}')">Explore Batch</button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  },

  async openCourseDetail(courseId) {
    const [detail, curriculum] = await Promise.all([
      this.api(`/courses/${courseId}`),
      this.api(`/courses/${courseId}/curriculum`)
    ]);
    this.showModal(`
      <span class="badge">${detail.language} &bull; ${detail.courseType}</span>
      <h2 style="margin:8px 0;">${detail.title}</h2>
      <p class="muted">${detail.description}</p>
      <div class="row" style="justify-content:space-between;margin:14px 0;padding:12px;background:var(--bg);border-radius:12px;">
        <div><strong style="font-size:1.25rem;">₹${detail.price}</strong> <span class="muted">(${detail.validityDays} days validity)</span></div>
        ${detail.isEnrolled
          ? `<button class="btn btn-primary" onclick="app.closeModal();app.openCoursePlayer('${detail.courseId}')">Open in My Library &rarr;</button>`
          : `<button class="btn btn-amber" onclick="app.checkout('Course','${detail.courseId}','${detail.title.replace(/'/g,'')}',${detail.price})">Buy Batch (₹${detail.price})</button>`}
      </div>
      <h4>Syllabus &amp; Free Demo Lessons</h4>
      ${curriculum.modules.map(m => `
        <div class="card" style="padding:12px;margin-bottom:10px;">
          <strong>${m.title}</strong>
          ${m.chapters.map(ch => `
            <div style="margin-top:8px;padding-left:8px;">
              <div class="muted">${ch.title}</div>
              ${ch.lessons.map(l => `
                <div class="row" style="justify-content:space-between;margin-top:6px;">
                  <span>${l.isLocked ? '🔒' : '▶'} ${l.title}</span>
                  ${!l.isLocked ? `<button class="btn btn-sm btn-outline" onclick="app.playLesson('${l.lessonId}')">Watch Demo</button>` : `<span class="muted">Locked</span>`}
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `).join('')}
      ${detail.faqs.length ? `<h4>FAQs</h4>${detail.faqs.map(f => `<div style="margin-bottom:8px;"><strong>${f.Question || f.question}</strong><div class="muted">${f.Answer || f.answer}</div></div>`).join('')}` : ''}
    `);
  },

  async openPlansModal() {
    const plans = await this.api('/subscription-plans');
    this.showModal(`
      <h2>Mudgal Biology Subscription Passes</h2>
      <p class="muted">One pass unlocks multiple curated batches &amp; test series.</p>
      ${plans.map(p => `
        <div class="card">
          <div class="row" style="justify-content:space-between;">
            <h3 style="margin:0;">${p.name}</h3>
            <strong>₹${p.price} / ${p.durationDays}d</strong>
          </div>
          <p class="muted">${p.description}</p>
          <div class="muted">Includes: ${p.includedCourseTitles.join(' • ')}</div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="app.checkout('SubscriptionPlan','${p.planId}','${p.name.replace(/'/g,'')}',${p.price})">Activate Pass</button>
        </div>
      `).join('')}
    `);
  },

  async checkout(productType, productId, title, price) {
    try {
      const order = await this.api('/orders', {
        method: 'POST',
        body: JSON.stringify({ productType, productId, idempotencyKey: `web_${productId}_${Date.now()}` })
      });
      const session = await this.api('/payments/checkout-session', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.orderId })
      });
      if (session.provider === 'Razorpay' && session.keyId) {
        await this.openRazorpayCheckout(session, order, title);
        return;
      }
      this.showModal(`
        <h2>Secure Server-Verified Checkout</h2>
        <p>Item: <strong>${title}</strong></p>
        <p>Payable Amount: <strong>₹${session.amount} ${session.currency}</strong></p>
        <p class="muted">Order: <code>${order.orderId}</code><br/>Gateway Ref: <code>${session.providerReference}</code></p>
        <div class="card" style="background:rgba(20,184,166,.08);">
          <small class="muted">Sandbox Payment Gateway: triggers our HMAC-SHA256 signed server webhook and grants access idempotently.</small>
        </div>
        <div class="row" style="margin-top:14px;">
          <button class="btn btn-primary" onclick="app.completeSandboxPayment('${session.providerReference}','${order.orderId}',${session.amount},'${session.currency}')">Complete Verified Payment</button>
          <button class="btn btn-outline" onclick="app.closeModal()">Cancel</button>
        </div>
      `);
    } catch (e) { alert(e.message); }
  },

  async openRazorpayCheckout(session, order, title) {
    if (!window.Razorpay) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load Razorpay Checkout.'));
        document.head.appendChild(s);
      });
    }
    const rzp = new window.Razorpay({
      key: session.keyId,
      amount: session.amountPaise || Math.round(session.amount * 100),
      currency: session.currency || 'INR',
      name: 'Mudgal Biology',
      description: title,
      order_id: session.providerReference,
      prefill: { name: this.user?.fullName || '', contact: this.user?.phone || '', email: this.user?.email || '' },
      theme: { color: '#14B8A6' },
      handler: async (resp) => {
        try {
          await this.api('/payments/razorpay/verify', {
            method: 'POST',
            body: JSON.stringify({ orderId: order.orderId, ...resp })
          });
          this.refreshNotifCount();
          alert('Payment verified! Batch added to My Library.');
          this.navigate('learning');
        } catch (err) { alert(err.message); }
      }
    });
    rzp.open();
  },

  async completeSandboxPayment(providerReference, orderId, amount, currency) {
    try {
      await this.api('/payments/sandbox/simulate', {
        method: 'POST',
        body: JSON.stringify({ providerReference, orderId, status: 'captured', amount, currency })
      });
      this.closeModal();
      this.refreshNotifCount();
      alert('Payment verified! Batch added to My Library.');
      this.navigate('learning');
    } catch (e) { alert(e.message); }
  },

  async renderLearning(view) {
    const [courses, live] = await Promise.all([this.api('/me/courses'), this.api('/live-sessions')]);
    view.innerHTML = `
      <h2>My Library &amp; Batches</h2>
      ${courses.length === 0 ? `<div class="card empty-state">You have no active batches yet. <button class="btn btn-primary btn-sm" onclick="app.navigate('explore')">Browse Store</button></div>` : `
        <div class="grid">
          ${courses.map(c => `
            <div class="card" style="margin:0;">
              <span class="badge">${c.language}</span>
              <h3 style="margin:8px 0 6px;">${c.title}</h3>
              <div class="muted">Progress: ${c.completedLessons}/${c.totalLessons} (${c.progressPercent}%)</div>
              <div class="progress-bar" style="margin:10px 0;"><div class="progress-fill" style="width:${c.progressPercent}%"></div></div>
              <div class="muted" style="margin-bottom:12px;">Valid till: ${new Date(c.expiresAt).toLocaleDateString()}</div>
              <button class="btn btn-primary btn-sm" onclick="app.openCoursePlayer('${c.courseId}')">Open Videos &amp; E-Books</button>
            </div>
          `).join('')}
        </div>
      `}
      <h3 style="margin-top:24px;">Live Class Schedule</h3>
      <div class="grid">
        ${live.map(s => `
          <div class="card" style="margin:0;">
            <div class="row" style="justify-content:space-between;">
              <span class="badge">${s.provider}</span>
              ${s.isLiveNow ? `<span class="badge-live">● LIVE</span>` : ''}
            </div>
            <h4 style="margin:8px 0 4px;">${s.title}</h4>
            <div class="muted">${s.facultyName} &bull; ${new Date(s.startsAt).toLocaleString()}</div>
            <div style="margin-top:10px;">
              ${s.canJoin ? `<button class="btn btn-navy btn-sm" onclick="app.joinLive('${s.sessionId}')">Join Session</button>` : `<span class="muted">Enrollment required</span>`}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  async openCoursePlayer(courseId) {
    const cur = await this.api(`/courses/${courseId}/curriculum`);
    const view = document.getElementById('mainView');
    view.innerHTML = `
      <button class="btn btn-outline btn-sm" onclick="app.navigate('learning')">&larr; Back to My Library</button>
      <h2 style="margin:12px 0;">${cur.courseTitle}</h2>
      <div id="playerArea"></div>
      ${cur.modules.map(m => `
        <div class="card">
          <h3>${m.title}</h3>
          ${m.chapters.map(ch => `
            <div style="margin-top:10px;">
              <strong>${ch.title}</strong>
              ${ch.lessons.map(l => `
                <div class="row" style="justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
                  <div>
                    <div>${l.isCompleted ? '✅' : (l.isLocked ? '🔒' : '▶')} <strong>${l.title}</strong></div>
                    <div class="muted">${Math.round(l.durationSeconds/60)} min &bull; Resume at ${l.lastPositionSeconds}s</div>
                  </div>
                  <div class="row">
                    ${!l.isLocked ? `<button class="btn btn-primary btn-sm" onclick="app.playLesson('${l.lessonId}', true)">Play Video</button>` : ''}
                    ${!l.isLocked && l.resources.length ? `<button class="btn btn-amber btn-sm" onclick="app.viewResources('${l.lessonId}')">📖 Smart E-Books (${l.resources.length})</button>` : ''}
                    <button class="btn btn-outline btn-sm" onclick="app.toggleBookmark('${l.lessonId}')">${l.isBookmarked ? '★' : '☆'}</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;
  },

  async playLesson(lessonId, inline = false) {
    try {
      const p = await this.api(`/lessons/${lessonId}/playback`);
      const html = `
        <div class="card">
          <div class="row" style="justify-content:space-between;">
            <h3 style="margin:0;">${p.lessonTitle}</h3>
            <div class="row">
              <span class="muted">Speed:</span>
              ${['0.75x','1x','1.25x','1.5x','2x'].map(sp => `<button class="chip ${app.playbackSpeed===sp?'active':''}" onclick="app.playbackSpeed='${sp}';app.playLesson('${lessonId}',${inline})">${sp}</button>`).join('')}
            </div>
          </div>
          <iframe src="${p.playbackUrl}" style="width:100%;height:280px;border:none;border-radius:12px;margin:12px 0;"></iframe>
          <div class="row" style="justify-content:space-between;">
            <span class="muted">Playing at <strong>${app.playbackSpeed}</strong> &bull; Resumed at ${p.lastPositionSeconds}s &bull; Signed URL expires ${new Date(p.expiresAt).toLocaleTimeString()}</span>
            <button class="btn btn-primary btn-sm" onclick="app.markLessonComplete('${lessonId}')">Mark Completed ✓</button>
          </div>
        </div>
      `;
      if (inline && document.getElementById('playerArea')) {
        document.getElementById('playerArea').innerHTML = html;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        this.showModal(html);
      }
    } catch (e) { alert(e.message); }
  },

  async markLessonComplete(lessonId) {
    await this.api(`/lessons/${lessonId}/progress`, { method: 'PUT', body: JSON.stringify({ lastPositionSeconds: 600, completed: true }) });
    alert('Progress synced & lesson marked completed!');
  },

  async viewResources(lessonId) {
    try {
      const res = await this.api(`/lessons/${lessonId}/resources`);
      this.showModal(`
        <h3>Smart E-Books &amp; Class PDFs</h3>
        <div class="row" style="margin-bottom:10px;">
          <span class="muted">Reader Theme:</span>
          <button class="btn btn-sm btn-outline" onclick="app.setReaderTheme('')">Light</button>
          <button class="btn btn-sm btn-outline" onclick="app.setReaderTheme('ebook-sepia')">Sepia</button>
          <button class="btn btn-sm btn-outline" onclick="app.setReaderTheme('ebook-night')">Night</button>
          <button class="btn btn-sm btn-outline" onclick="app.adjustReaderFont(1)">A+</button>
          <button class="btn btn-sm btn-outline" onclick="app.adjustReaderFont(-1)">A-</button>
        </div>
        ${res.map(r => `
          <div class="row" style="justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
            <div><strong>${r.title}</strong><div class="muted">${r.resourceType}</div></div>
            <div class="row">
              <button class="btn btn-primary btn-sm" onclick="app.previewSmartEbook('${r.signedUrl}','${r.title.replace(/'/g,'')}')">Smart Read</button>
              <a class="btn btn-outline btn-sm" href="${r.signedUrl}" target="_blank">Download</a>
            </div>
          </div>
        `).join('')}
        <div id="ebookReaderBox" class="ebook-reader" style="display:none;font-size:15px;"></div>
      `);
    } catch (e) { alert(e.message); }
  },

  async previewSmartEbook(url, title) {
    const text = await (await fetch(url)).text();
    const box = document.getElementById('ebookReaderBox');
    box.style.display = 'block';
    box.innerHTML = `<h4 style="margin-top:0;">📖 ${title}</h4><pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${text}</pre>`;
  },
  setReaderTheme(cls) {
    const box = document.getElementById('ebookReaderBox');
    if (box) box.className = `ebook-reader ${cls}`;
  },
  adjustReaderFont(delta) {
    const box = document.getElementById('ebookReaderBox');
    if (!box) return;
    const cur = parseInt(box.style.fontSize || '15', 10);
    box.style.fontSize = `${Math.min(24, Math.max(12, cur + delta))}px`;
  },

  async openFlashcardsModal() {
    const cards = await this.api('/flashcards');
    this._fc = { cards, idx: 0, flipped: false, mastered: new Set() };
    this.renderFlashcardModal();
  },

  renderFlashcardModal() {
    const fc = this._fc;
    const c = fc.cards[fc.idx];
    this.showModal(`
      <div class="row" style="justify-content:space-between;margin-bottom:12px;">
        <h3 style="margin:0;">⚡ Active Recall Flashcards</h3>
        <span class="badge">Mastered: ${fc.mastered.size}/${fc.cards.length}</span>
      </div>
      <div class="flashcard-box" onclick="app._fc.flipped=!app._fc.flipped;app.renderFlashcardModal()">
        <span class="badge" style="align-self:center;">${c.subject} &bull; ${c.topic}</span>
        <h3 style="margin:6px 0;">${fc.flipped ? c.back : c.front}</h3>
        <div class="muted">${fc.flipped ? 'Answer revealed (tap to flip back)' : 'Tap card to reveal answer'}</div>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:14px;">
        <button class="btn btn-outline btn-sm" onclick="app._fc.idx=(app._fc.idx-1+app._fc.cards.length)%app._fc.cards.length;app._fc.flipped=false;app.renderFlashcardModal()">&larr; Prev</button>
        <button class="btn btn-primary btn-sm" onclick="app._fc.mastered.add(${c.id});app._fc.idx=(app._fc.idx+1)%app._fc.cards.length;app._fc.flipped=false;app.renderFlashcardModal()">Got It ✓</button>
        <button class="btn btn-outline btn-sm" onclick="app._fc.idx=(app._fc.idx+1)%app._fc.cards.length;app._fc.flipped=false;app.renderFlashcardModal()">Next &rarr;</button>
      </div>
    `);
  },

  async toggleBookmark(lessonId) {
    await this.api(`/lessons/${lessonId}/bookmark`, { method: 'POST' });
    alert('Bookmark updated.');
  },

  async joinLive(sessionId) {
    try {
      const info = await this.api(`/live-sessions/${sessionId}/join`, { method: 'POST' });
      this.showModal(`
        <h3>Live Class Ready</h3>
        <p>Provider: <strong>${info.provider}</strong> &bull; Code: <code>${info.meetingCode}</code></p>
        <p class="muted">Attendance logged automatically.</p>
        <a href="${info.joinUrl}" target="_blank" class="btn btn-primary">Launch Live Class &rarr;</a>
      `);
    } catch (e) { alert(e.message); }
  },

  async renderTests(view) {
    const tests = await this.api('/tests');
    view.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px;">
        <div>
          <h2 style="margin:0;">All-India Mock Tests &amp; PYQ Series</h2>
          <span class="muted">Timed negative-marked tests with instant scorecard &amp; solutions.</span>
        </div>
        <button class="btn btn-primary btn-sm" onclick="app.openFlashcardsModal()">⚡ Quick Flashcards</button>
      </div>
      <div class="grid">
        ${tests.map(t => `
          <div class="card" style="margin:0;">
            <span class="badge">${t.courseTitle}</span>
            <h3 style="margin:10px 0 6px;">${t.title}</h3>
            <div class="muted">${t.questionCount} Qs &bull; ${t.totalMarks} Marks &bull; ${Math.round(t.durationSeconds/60)} mins</div>
            <div class="row" style="margin-top:14px;">
              ${t.isLocked
                ? `<button class="btn btn-outline btn-sm" onclick="app.openCourseDetail('${t.courseId}')">Unlock Batch</button>`
                : `<button class="btn btn-primary btn-sm" onclick="app.startTest('${t.testId}')">${t.inProgressAttemptId ? 'Resume Attempt' : 'Start Test'}</button>`}
              ${t.lastSubmittedAttemptId ? `<button class="btn btn-navy btn-sm" onclick="app.viewResult('${t.lastSubmittedAttemptId}')">View Scorecard</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  async startTest(testId) {
    const detail = await this.api(`/tests/${testId}`);
    this.showModal(`
      <h2>${detail.title}</h2>
      <p>${detail.instructions}</p>
      <p class="muted">Duration: ${Math.round(detail.durationSeconds/60)} minutes &bull; Total Marks: ${detail.totalMarks}</p>
      <div class="row" style="margin-top:16px;">
        <button class="btn btn-primary" onclick="app.closeModal();app.launchRunner('${testId}')">Begin / Recover Attempt</button>
        <button class="btn btn-outline" onclick="app.closeModal()">Cancel</button>
      </div>
    `);
  },

  async launchRunner(testId) {
    const attempt = await this.api(`/tests/${testId}/attempts`, { method: 'POST' });
    this.activeAttempt = { ...attempt, currentIndex: 0 };
    this.renderTestRunner();
  },

  renderTestRunner() {
    const a = this.activeAttempt;
    const view = document.getElementById('mainView');
    const q = a.questions[a.currentIndex];
    let remaining = a.remainingSeconds;

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      a.remainingSeconds = remaining;
      const el = document.getElementById('testTimer');
      if (el) el.textContent = `${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
      if (remaining === 0) { clearInterval(this.timerInterval); this.submitActiveTest(); }
    }, 1000);

    view.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between;">
          <div><strong>${a.testTitle}</strong> ${a.recovered ? `<span class="badge-amber">Recovered</span>` : ''}</div>
          <div class="row">
            <span class="badge">⏱ <span id="testTimer">${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}</span></span>
            <button class="btn btn-danger btn-sm" onclick="app.submitActiveTest()">Submit Test</button>
          </div>
        </div>
      </div>
      <div class="row" style="align-items:flex-start;">
        <div class="card" style="flex:2;min-width:280px;">
          <div class="row" style="justify-content:space-between;margin-bottom:10px;">
            <span class="muted">Q${a.currentIndex + 1} of ${a.questions.length} &bull; ${q.sectionName}</span>
            <span class="badge">+${q.marks} / -${q.negativeMarks}</span>
          </div>
          <h3 style="margin-top:0;">${q.stem}</h3>
          ${q.options.map(o => `
            <button class="option-btn ${q.selectedOptionId === o.optionId ? 'selected' : ''}" onclick="app.selectOption('${q.questionId}','${o.optionId}')">${o.text}</button>
          `).join('')}
          <div class="row" style="justify-content:space-between;margin-top:14px;">
            <div class="row">
              <button class="btn btn-amber btn-sm" onclick="app.toggleReview('${q.questionId}')">${q.isMarkedForReview ? 'Unmark Review' : 'Mark Review'}</button>
              <button class="btn btn-outline btn-sm" onclick="app.selectOption('${q.questionId}', null)">Clear</button>
            </div>
            <div class="row">
              ${a.currentIndex > 0 ? `<button class="btn btn-outline btn-sm" onclick="app.activeAttempt.currentIndex--;app.renderTestRunner()">Previous</button>` : ''}
              ${a.currentIndex < a.questions.length - 1 ? `<button class="btn btn-primary btn-sm" onclick="app.activeAttempt.currentIndex++;app.renderTestRunner()">Next</button>` : ''}
            </div>
          </div>
        </div>
        <div class="card" style="flex:1;min-width:210px;">
          <h4 style="margin-top:0;">Question Palette</h4>
          <div class="row">
            ${a.questions.map((item, idx) => `
              <button class="palette-btn ${item.selectedOptionId ? 'answered' : ''} ${item.isMarkedForReview ? 'review' : ''} ${idx === a.currentIndex ? 'current' : ''}"
                onclick="app.activeAttempt.currentIndex=${idx};app.renderTestRunner()">${idx + 1}</button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  },

  async selectOption(questionId, optionId) {
    const q = this.activeAttempt.questions.find(x => x.questionId === questionId);
    q.selectedOptionId = optionId;
    await this.api(`/attempts/${this.activeAttempt.attemptId}/answers/${questionId}`, {
      method: 'PUT', body: JSON.stringify({ selectedOptionId: optionId, isMarkedForReview: q.isMarkedForReview })
    });
    this.renderTestRunner();
  },

  async toggleReview(questionId) {
    const q = this.activeAttempt.questions.find(x => x.questionId === questionId);
    q.isMarkedForReview = !q.isMarkedForReview;
    await this.api(`/attempts/${this.activeAttempt.attemptId}/answers/${questionId}`, {
      method: 'PUT', body: JSON.stringify({ selectedOptionId: q.selectedOptionId, isMarkedForReview: q.isMarkedForReview })
    });
    this.renderTestRunner();
  },

  async submitActiveTest() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    const res = await this.api(`/attempts/${this.activeAttempt.attemptId}/submit`, { method: 'POST' });
    this.activeAttempt = null;
    this.showResultView(res);
  },

  async viewResult(attemptId) {
    this.showResultView(await this.api(`/attempts/${attemptId}/result`));
  },

  async showResultView(res) {
    const view = document.getElementById('mainView');
    let reviewHtml = '';
    if (res.canReview) {
      const rev = await this.api(`/attempts/${res.attemptId}/review`);
      reviewHtml = rev.questions.map((q, i) => `
        <div class="card">
          <div class="row" style="justify-content:space-between;">
            <strong>Q${i+1}. ${q.stem}</strong>
            <span class="badge">${q.isCorrect ? '✅ Correct' : (q.selectedOptionId ? '❌ Incorrect' : '⚪ Skipped')}</span>
          </div>
          <div style="margin:8px 0;">
            ${q.options.map(o => `<div style="padding:4px 0;${o.isCorrect ? 'color:var(--success);font-weight:700;' : (o.optionId === q.selectedOptionId ? 'color:var(--danger);' : '')}">${o.isCorrect ? '✔ ' : ''}${o.text}</div>`).join('')}
          </div>
          <div class="muted"><strong>Explanation:</strong> ${q.explanation}</div>
        </div>
      `).join('');
    }
    view.innerHTML = `
      <button class="btn btn-outline btn-sm" onclick="app.navigate('tests')">&larr; Back to Tests</button>
      <div class="card" style="margin-top:12px;">
        <h2 style="margin-top:0;">${res.testTitle} — Scorecard</h2>
        <div class="grid">
          <div><div class="muted">Score</div><strong style="font-size:1.6rem;">${res.score} / ${res.maxScore}</strong></div>
          <div><div class="muted">Accuracy</div><strong style="font-size:1.6rem;">${res.accuracyPercent}%</strong></div>
          <div><div class="muted">Correct / Wrong / Skipped</div><strong>${res.correctCount} / ${res.incorrectCount} / ${res.unansweredCount}</strong></div>
        </div>
      </div>
      <h3>Detailed Solutions &amp; Explanations</h3>
      ${reviewHtml}
    `;
  },

  async renderCommunity(view) {
    const [doubts, posts, courses] = await Promise.all([
      this.api('/me/doubts'), this.api('/community/posts'), this.api('/courses')
    ]);
    this._cachedCourses = courses.items || [];
    view.innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));">
        <div>
          <div class="row" style="justify-content:space-between;margin-bottom:10px;">
            <h2 style="margin:0;">Faculty Doubt Desk</h2>
            <button class="btn btn-primary btn-sm" onclick="app.openCreateDoubtModal()">+ Ask Doubt</button>
          </div>
          ${doubts.map(d => `
            <div class="card">
              <div class="row" style="justify-content:space-between;"><strong>${d.title}</strong><span class="badge">${d.status}</span></div>
              <div class="muted">${d.courseTitle}</div>
              <p>${d.text}</p>
              ${d.replies.map(r => `<div style="background:var(--bg);padding:8px 10px;border-radius:8px;margin-top:6px;"><strong>${r.authorName}:</strong> ${r.message}</div>`).join('')}
            </div>
          `).join('') || '<div class="card empty-state">No doubts asked yet.</div>'}
        </div>
        <div>
          <h2 style="margin-top:0;">Aspirant Community Feed</h2>
          <div class="card">
            <textarea id="newPostBody" rows="2" placeholder="Ask a question or share your study progress..."></textarea>
            <button class="btn btn-navy btn-sm" style="margin-top:8px;" onclick="app.createCommunityPost()">Publish Post</button>
          </div>
          ${posts.map(p => `
            <div class="card">
              <div class="row" style="justify-content:space-between;"><strong>${p.authorName}</strong><button class="btn btn-outline btn-sm" onclick="app.reportEntity('Post','${p.postId}')">Report</button></div>
              <p>${p.body}</p>
              ${p.comments.map(c => `<div class="muted" style="padding:4px 0;"><strong>${c.authorName}:</strong> ${c.body}</div>`).join('')}
              <div class="row" style="margin-top:8px;">
                <input id="cmt_${p.postId}" placeholder="Add comment..." style="flex:1;" />
                <button class="btn btn-outline btn-sm" onclick="app.addComment('${p.postId}')">Reply</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  openCreateDoubtModal() {
    const opts = (this._cachedCourses || []).map(c => `<option value="${c.courseId}">${c.title}</option>`).join('');
    this.showModal(`
      <h3>Ask Mudgal Biology Faculty</h3>
      <label class="muted">Batch</label><select id="doubtCourse">${opts}</select>
      <label class="muted" style="margin-top:10px;display:block;">Topic</label><input id="doubtTitle" placeholder="e.g. Cardiac Cycle P-wave" />
      <label class="muted" style="margin-top:10px;display:block;">Question</label><textarea id="doubtText" rows="4"></textarea>
      <button class="btn btn-primary" style="margin-top:12px;" onclick="app.submitDoubt()">Submit Ticket</button>
    `);
  },

  async submitDoubt() {
    await this.api('/doubts', {
      method: 'POST',
      body: JSON.stringify({
        courseId: document.getElementById('doubtCourse').value,
        title: document.getElementById('doubtTitle').value,
        text: document.getElementById('doubtText').value
      })
    });
    this.closeModal(); this.render();
  },

  async createCommunityPost() {
    const body = document.getElementById('newPostBody').value;
    if (!body.trim()) return;
    await this.api('/community/posts', { method: 'POST', body: JSON.stringify({ body }) });
    this.render();
  },

  async addComment(postId) {
    const body = document.getElementById(`cmt_${postId}`).value;
    if (!body.trim()) return;
    await this.api(`/community/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    this.render();
  },

  async reportEntity(entityType, entityId) {
    const reason = prompt('Reason for reporting:', 'Spam or off-topic');
    if (!reason) return;
    await this.api('/community/reports', { method: 'POST', body: JSON.stringify({ entityType, entityId, reason }) });
    alert('Reported to moderators.');
  },

  async renderProfile(view) {
    const [orders, subs, prefs] = await Promise.all([
      this.api('/me/orders'), this.api('/me/subscriptions'), this.api('/me/notification-preferences')
    ]);
    this._prefs = prefs;
    view.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between;">
          <div><h2 style="margin:0;">${this.user.fullName}</h2><div class="muted">Mobile: ${this.user.phone} &bull; Goal: ${this.user.targetExamName || 'Not set'}</div></div>
          <div class="row">
            <button class="btn btn-outline btn-sm" onclick="app.openGoalPicker()">Change Exam Goal</button>
            <button class="btn btn-danger btn-sm" onclick="app.logout()">Logout</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Notification Preferences</h3>
        <label class="row"><input type="checkbox" style="width:auto;" ${prefs.pushLiveClasses?'checked':''} onchange="app.savePref('pushLiveClasses',this.checked)"> Live Class Reminders</label>
        <label class="row"><input type="checkbox" style="width:auto;" ${prefs.pushDoubtReplies?'checked':''} onchange="app.savePref('pushDoubtReplies',this.checked)"> Doubt Replies</label>
        <label class="row"><input type="checkbox" style="width:auto;" ${prefs.pushCourseUpdates?'checked':''} onchange="app.savePref('pushCourseUpdates',this.checked)"> Batch Updates</label>
      </div>
      <div class="card">
        <h3>Active Passes</h3>
        ${subs.map(s => `<div><strong>${s.planName}</strong> &bull; ${s.status} (till ${new Date(s.expiresAt).toLocaleDateString()})</div>`).join('') || '<span class="muted">No active pass.</span>'}
      </div>
      <div class="card">
        <h3>Order History</h3>
        ${orders.map(o => `<div style="padding:8px 0;border-bottom:1px solid var(--border);"><strong>₹${o.totalAmount}</strong> — ${o.items.map(i=>i.productTitle).join(', ')} <span class="badge">${o.status}</span></div>`).join('') || '<span class="muted">No orders yet.</span>'}
      </div>
      <div class="card">
        <h3>Policies, Portals &amp; Account</h3>
        <div class="row" style="margin-bottom:12px;">
          <a class="btn btn-outline btn-sm" href="/about" target="_blank">About Us</a>
          <a class="btn btn-outline btn-sm" href="/privacy" target="_blank">Privacy Policy</a>
          <a class="btn btn-outline btn-sm" href="/terms" target="_blank">Terms</a>
          <a class="btn btn-outline btn-sm" href="/refund" target="_blank">Refund Policy</a>
          <a class="btn btn-outline btn-sm" href="/contact" target="_blank">Contact</a>
          <a class="btn btn-navy btn-sm" href="/admin" target="_blank">Admin Portal</a>
        </div>
        <button class="btn btn-danger btn-sm" onclick="app.requestDeletion()">Request Account Deletion</button>
      </div>
    `;
  },

  async requestDeletion() {
    if (!confirm('Are you sure you want to request account deletion? Your active sessions will be signed out.')) return;
    await this.api('/me/delete-request', { method: 'POST' });
    this.clearAuth();
    alert('Account deletion request recorded.');
    this.render();
  },

  async savePref(key, val) {
    this._prefs[key] = val;
    await this.api('/me/notification-preferences', { method: 'PUT', body: JSON.stringify(this._prefs) });
  },

  async openNotifications() {
    if (!this.token) return;
    const list = await this.api('/notifications');
    this.showModal(`
      <h3>Notifications</h3>
      ${list.map(n => `<div class="card" style="margin-bottom:8px;${n.readAt?'opacity:.65;':''}"><strong>${n.title}</strong><div class="muted">${n.body}</div></div>`).join('') || '<div class="empty-state">No notifications.</div>'}
    `);
  },

  async logout() {
    try { await this.api('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: this.refreshToken }) }); } catch {}
    const badge = document.getElementById('notifCount');
    if (badge) badge.style.display = 'none';
    this.clearAuth(); this.render();
  },

  showModal(html) {
    document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)app.closeModal()"><div class="modal">${html}</div></div>`;
  },
  closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
};

app.init();
