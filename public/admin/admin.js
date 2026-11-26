const admin = {
  token: localStorage.getItem('mudgal_admin_token') || '',
  user: null,
  tab: 'dashboard',

  async api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`/api/v1${path}`, { ...options, headers });
    if (!res.ok) {
      let msg = `Error (${res.status})`;
      try { const e = await res.json(); msg = e.message || e.error || msg; } catch {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('text/csv') ? res.text() : res.json();
  },

  async init() {
    if (this.token) {
      try {
        const me = await this.api('/me');
        const staffRoles = ['Admin', 'SuperAdmin', 'Faculty', 'SupportAgent'];
        if (me.roles.some((r) => staffRoles.includes(r))) {
          this.user = me;
        } else {
          this.logout(false);
        }
      } catch {
        this.logout(false);
      }
    }
    this.render();
  },

  toggleMenu() {
    document.getElementById('adminSide')?.classList.toggle('open');
    document.getElementById('adminBackdrop')?.classList.toggle('open');
  },

  navigate(tab) {
    this.tab = tab;
    this.render();
  },

  logout(reRender = true) {
    this.token = '';
    this.user = null;
    localStorage.removeItem('mudgal_admin_token');
    if (reRender) this.render();
  },

  render() {
    const root = document.getElementById('adminRoot');
    if (!this.user) {
      root.innerHTML = `
        <main class="content">
          <div class="card" style="max-width:460px;margin:40px auto;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
              <img src="/assets/logo.jpg" alt="Mudgal Biology Logo" class="brand-logo" />
              <span class="badge">Mudgal Biology</span>
            </div>
            <h2 style="margin:0 0 6px;">Admin &amp; Faculty Console</h2>
            <p style="color:var(--slate);margin-top:0;">Staff sign in (Admin, SuperAdmin, Faculty, SupportAgent).</p>
            <div style="display:flex;gap:8px;margin-bottom:14px;">
              <button id="admTabPwd" class="btn btn-navy btn-sm" style="flex:1;" onclick="admin.switchAuthMode('pwd')">Password Login</button>
              <button id="admTabOtp" class="btn btn-sm" style="flex:1;background:#E2E8F0;color:#0F172A;" onclick="admin.switchAuthMode('otp')">OTP Login</button>
            </div>
            <label>Staff Phone Number</label>
            <input id="admPhone" value="9999999999" />
            <div id="admPwdPane">
              <label>Password</label>
              <input id="admPwd" type="password" placeholder="Enter staff password" />
              <button class="btn btn-primary" style="width:100%;" onclick="admin.loginWithPassword()">Sign In &rarr;</button>
            </div>
            <div id="admOtpPane" style="display:none;">
              <button class="btn btn-primary" style="width:100%;" onclick="admin.requestOtp()">Request Staff OTP</button>
              <div id="admOtpBox" style="display:none;margin-top:14px;">
                <div id="admOtpHint" style="background:#FEF3C7;color:#92400E;padding:8px 12px;border-radius:8px;font-size:.84rem;font-weight:600;margin-bottom:10px;"></div>
                <label>Enter 6-digit OTP</label>
                <input id="admOtp" />
                <button class="btn btn-navy" style="width:100%;" onclick="admin.verifyOtp()">Verify OTP &amp; Sign In</button>
              </div>
            </div>
            <p id="admErr" style="color:var(--danger);font-weight:600;margin-top:10px;"></p>
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);font-size:.82rem;color:var(--slate);">
              Staff Phones: <code>9999999999</code> (Admin) &bull; <code>8888888888</code> (SuperAdmin) &bull; <code>9811112222</code> (Faculty)
              <div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;">
                <a href="/">Website</a> <a href="/app">Student App</a> <a href="/about">About Us</a> <a href="/privacy">Privacy Policy</a>
              </div>
            </div>
          </div>
        </main>
      `;
      return;
    }

    const isSuper = this.user.roles.includes('SuperAdmin');
    root.innerHTML = `
      <div class="mobile-header">
        <div style="display:flex;align-items:center;gap:8px;font-weight:800;"><img src="/assets/logo.jpg" alt="Mudgal Biology Logo" class="brand-logo" /> Mudgal Biology Admin</div>
        <div style="display:flex;gap:6px;">
          <button class="hamburger" style="background:rgba(239,68,68,.28);" onclick="admin.logout()">🚪 Logout</button>
          <button class="hamburger" onclick="admin.toggleMenu()">☰ Menu</button>
        </div>
      </div>
      <div id="adminBackdrop" class="backdrop" onclick="admin.toggleMenu()"></div>
      <div class="admin-shell">
        <aside id="adminSide" class="side">
          <div class="brand"><img src="/assets/logo.jpg" alt="Mudgal Biology Logo" class="brand-logo" /><div>Mudgal Biology<div style="font-size:.72rem;font-weight:500;color:#94A3B8;">${this.user.roles.join(', ')}</div></div></div>
          <button class="${this.tab==='dashboard'?'active':''}" onclick="admin.navigate('dashboard')">📊 Dashboard &amp; Students</button>
          <button class="${this.tab==='catalogue'?'active':''}" onclick="admin.navigate('catalogue')">📚 Courses &amp; Curriculum</button>
          <button class="${this.tab==='tests'?'active':''}" onclick="admin.navigate('tests')">📝 Mock Tests &amp; Live</button>
          <button class="${this.tab==='operations'?'active':''}" onclick="admin.navigate('operations')">🛡️ Students, Doubts &amp; Logs</button>
          <button class="${this.tab==='staff'?'active':''}" onclick="admin.navigate('staff')">👨‍🏫 Faculty &amp; Staff ${isSuper ? '(SuperAdmin)' : ''}</button>
          <a href="/">🏠 Public Website &rarr;</a>
          <a href="/app">🌐 Student App &rarr;</a>
          <a href="/about">ℹ️ About Us</a>
          <a href="/privacy">🔒 Privacy Policy</a>
          <div style="margin-top:auto;padding-top:14px;">
            <button class="btn btn-amber" style="width:100%;color:var(--navy);justify-content:center;" onclick="admin.logout()">🚪 Sign Out (${this.user.fullName})</button>
          </div>
        </aside>
        <main class="content" id="admMain"><div class="card">Loading...</div></main>
      </div>
    `;

    if (this.tab === 'dashboard') this.loadDashboard();
    else if (this.tab === 'catalogue') this.loadCatalogue();
    else if (this.tab === 'tests') this.loadTests();
    else if (this.tab === 'operations') this.loadOperations();
    else if (this.tab === 'staff') this.loadStaff();
  },

  switchAuthMode(mode) {
    document.getElementById('admErr').textContent = '';
    const isPwd = mode === 'pwd';
    document.getElementById('admPwdPane').style.display = isPwd ? 'block' : 'none';
    document.getElementById('admOtpPane').style.display = isPwd ? 'none' : 'block';
    document.getElementById('admTabPwd').className = isPwd ? 'btn btn-navy btn-sm' : 'btn btn-sm';
    document.getElementById('admTabOtp').className = !isPwd ? 'btn btn-navy btn-sm' : 'btn btn-sm';
    if (isPwd) {
      document.getElementById('admTabPwd').style.cssText = 'flex:1;';
      document.getElementById('admTabOtp').style.cssText = 'flex:1;background:#E2E8F0;color:#0F172A;';
    } else {
      document.getElementById('admTabOtp').style.cssText = 'flex:1;';
      document.getElementById('admTabPwd').style.cssText = 'flex:1;background:#E2E8F0;color:#0F172A;';
    }
  },

  async loginWithPassword() {
    try {
      document.getElementById('admErr').textContent = '';
      const auth = await this.api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          phone: document.getElementById('admPhone').value,
          password: document.getElementById('admPwd').value
        })
      });
      if (!auth.user.roles.some(r => ['Admin', 'SuperAdmin', 'Faculty', 'SupportAgent'].includes(r))) {
        throw new Error('This account does not have staff privileges.');
      }
      this.token = auth.accessToken;
      this.user = auth.user;
      localStorage.setItem('mudgal_admin_token', auth.accessToken);
      this.render();
    } catch (e) { document.getElementById('admErr').textContent = e.message; }
  },

  async requestOtp() {
    try {
      document.getElementById('admErr').textContent = '';
      const phone = document.getElementById('admPhone').value;
      const res = await this.api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) });
      document.getElementById('admOtpBox').style.display = 'block';
      if (res.devOtpHint) {
        document.getElementById('admOtpHint').textContent = `Sandbox Dev OTP: ${res.devOtpHint}`;
        document.getElementById('admOtp').value = res.devOtpHint;
      }
    } catch (e) { document.getElementById('admErr').textContent = e.message; }
  },

  async verifyOtp() {
    try {
      const auth = await this.api('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phone: document.getElementById('admPhone').value, otp: document.getElementById('admOtp').value })
      });
      const staffRoles = ['Admin', 'SuperAdmin', 'Faculty', 'SupportAgent'];
      if (!auth.user.roles.some((r) => staffRoles.includes(r))) {
        throw new Error('Student accounts are not authorized to access the Admin Portal.');
      }
      this.token = auth.accessToken;
      this.user = auth.user;
      localStorage.setItem('mudgal_admin_token', auth.accessToken);
      this.render();
    } catch (e) { document.getElementById('admErr').textContent = e.message; }
  },

  async loadDashboard() {
    const d = await this.api('/admin/dashboard');
    const students = d.students || [];
    document.getElementById('admMain').innerHTML = `
      <div class="page-head">
        <div><h1>Mudgal Biology — Executive Overview</h1><span style="color:var(--slate);font-size:.9rem;">Signed in as <strong>${this.user.fullName}</strong> (${this.user.roles.join(', ')})</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="admin.exportCsv()">⬇ Export Orders CSV</button>
          <button class="btn btn-navy" onclick="admin.exportStudentsCsv()">⬇ Export Students CSV</button>
          <button class="btn btn-danger" onclick="admin.logout()">🚪 Logout</button>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><span>Registered Students</span><strong>${d.totalStudents}</strong></div>
        <div class="kpi"><span>Verified Real Students</span><strong>${d.verifiedStudents ?? 0}</strong></div>
        <div class="kpi"><span>Active Enrollments</span><strong>${d.activeEntitlements}</strong></div>
        <div class="kpi"><span>Published Courses</span><strong>${d.publishedCourses}</strong></div>
        <div class="kpi"><span>Open Doubts</span><strong>${d.openDoubts}</strong></div>
        <div class="kpi"><span>Verified Revenue</span><strong>₹${d.totalRevenueInr}</strong></div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          <h3 style="margin:0;">Student Details (${students.length})</h3>
          <input id="dashStudentSearch" placeholder="Search name, phone, email, exam..." oninput="admin.filterDashStudents()" style="max-width:280px;margin:0;" />
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Student</th><th>Phone &amp; Email</th><th>State &amp; Exam</th><th>Batches &amp; Paid</th><th>Verification</th><th>Actions</th></tr></thead>
            <tbody id="dashStudentsBody">
              ${this.renderStudentRows(students)}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0;">Recent Orders</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order ID</th><th>Items</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              ${d.recentOrders.map((o) => `<tr><td><code>${o.orderId.slice(0,8)}</code></td><td>${o.items.map((i)=>i.productTitle).join(', ')}</td><td>₹${o.totalAmount} ${o.currency}</td><td><span class="badge">${o.status}</span></td><td>${new Date(o.createdAt).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="5">No orders yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
    this._dashStudents = students;
  },

  renderStudentRows(students) {
    return students.map((u) => `
      <tr>
        <td><strong>${u.fullName}</strong><br/><small style="color:var(--slate);">Joined ${new Date(u.createdAt).toLocaleDateString()}</small></td>
        <td><code>${u.phone}</code><br/><small style="color:var(--slate);">${u.email}</small></td>
        <td>${u.state}<br/><span class="badge">${u.targetExam}</span></td>
        <td><strong>${u.enrolledCount}</strong> batch(es) &bull; ₹${u.totalSpentInr}<br/><small style="color:var(--slate);">${u.enrolledCourses.join(', ') || 'Free tier'}</small></td>
        <td>${u.isVerified ? `<span class="badge">✓ Verified (${u.verificationSource})</span>` : `<span class="badge" style="background:#FEF3C7;color:#92400E;">Pending</span>`}<br/><small>${u.status}</small></td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          ${u.isVerified ? `<button class="btn btn-sm" style="background:#E2E8F0;color:#0F172A;" onclick="admin.verifyStudent('${u.userId}',false)">Unverify</button>` : `<button class="btn btn-primary btn-sm" onclick="admin.verifyStudent('${u.userId}',true)">Verify Real ✓</button>`}
          ${u.status === 'Suspended' ? `<button class="btn btn-amber btn-sm" onclick="admin.moderate('user','${u.userId}','activate')">Activate</button>` : `<button class="btn btn-danger btn-sm" onclick="admin.moderate('user','${u.userId}','suspend')">Suspend</button>`}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6">No students registered yet.</td></tr>';
  },

  filterDashStudents() {
    const q = (document.getElementById('dashStudentSearch')?.value || '').toLowerCase().trim();
    const list = (this._dashStudents || []).filter((u) =>
      `${u.fullName} ${u.phone} ${u.email} ${u.state} ${u.targetExam}`.toLowerCase().includes(q)
    );
    document.getElementById('dashStudentsBody').innerHTML = this.renderStudentRows(list);
  },

  async verifyStudent(userId, verified) {
    await this.api(`/admin/students/${userId}/verify`, { method: 'POST', body: JSON.stringify({ verified }) });
    if (this.tab === 'dashboard') this.loadDashboard();
    else this.loadOperations();
  },

  async exportCsv() {
    const csv = await this.api('/admin/orders/export');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mudgal-biology-orders.csv'; a.click();
  },

  async exportStudentsCsv() {
    const csv = await this.api('/admin/students/export');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mudgal-biology-students.csv'; a.click();
  },

  async loadCatalogue() {
    const [exams, courses] = await Promise.all([this.api('/exams'), this.api('/admin/courses')]);
    document.getElementById('admMain').innerHTML = `
      <div class="page-head"><h1>Exams, Courses &amp; Curriculum</h1></div>
      <div class="grid-2">
        <div class="card">
          <h3 style="margin-top:0;">Create Exam Category</h3>
          <label>Exam Name</label><input id="exName" placeholder="e.g. CUET Biology" />
          <label>Code</label><input id="exCode" placeholder="e.g. CUET_BIO" />
          <label>Description</label><input id="exDesc" placeholder="Short description" />
          <button class="btn btn-primary" onclick="admin.createExam()">Add Exam</button>
        </div>
        <div class="card">
          <h3 style="margin-top:0;">Create Course (Draft)</h3>
          <label>Course Title</label><input id="cTitle" />
          <label>URL Slug</label><input id="cSlug" />
          <label>Description</label><input id="cDesc" />
          <label>Exam</label><select id="cExam">${exams.map((e)=>`<option value="${e.examId}">${e.name} (${e.code})</option>`).join('')}</select>
          <label>Price (INR)</label><input id="cPrice" type="number" value="1499" />
          <button class="btn btn-navy" onclick="admin.createCourse()">Create Draft Course</button>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0;">Add Lesson &amp; Study PDF to Course</h3>
        <div class="grid-2">
          <div><label>Course</label><select id="lCourse">${courses.map((c)=>`<option value="${c.courseId}">${c.title}</option>`).join('')}</select></div>
          <div><label>Lesson Title</label><input id="lTitle" placeholder="e.g. Photosynthesis C3 & C4 Cycle" /></div>
        </div>
        <div class="grid-2">
          <div><label>Asset ID</label><input id="lAsset" value="mudgal_bio_lecture" /></div>
          <div><label>Optional PDF Title</label><input id="lPdf" placeholder="e.g. C3 Cycle Notes.pdf" /></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><input id="lPreview" type="checkbox" style="width:auto;margin:0;" /> Free Preview Demo</label>
        <button class="btn btn-primary" onclick="admin.addQuickLesson()">Add Lesson</button>
      </div>
      <div class="card">
        <h3 style="margin-top:0;">All Courses (${courses.length})</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Language</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${courses.map((c)=>`<tr><td><strong>${c.title}</strong><br/><small style="color:var(--slate);">${c.slug}</small></td><td>${c.language}</td><td>₹${c.price}</td><td><span class="badge">${c.status}</span></td><td>${c.status!=='Published'?`<button class="btn btn-primary btn-sm" onclick="admin.togglePublish('${c.courseId}',true)">Publish</button>`:`<button class="btn btn-amber btn-sm" onclick="admin.togglePublish('${c.courseId}',false)">Move to Draft</button>`}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async createExam() {
    await this.api('/admin/exams', { method: 'POST', body: JSON.stringify({ name: document.getElementById('exName').value, code: document.getElementById('exCode').value, description: document.getElementById('exDesc').value }) });
    this.loadCatalogue();
  },
  async createCourse() {
    await this.api('/admin/courses', { method: 'POST', body: JSON.stringify({ title: document.getElementById('cTitle').value, slug: document.getElementById('cSlug').value, description: document.getElementById('cDesc').value, examIds: [document.getElementById('cExam').value], price: Number(document.getElementById('cPrice').value) }) });
    this.loadCatalogue();
  },
  async addQuickLesson() {
    await this.api(`/admin/courses/${document.getElementById('lCourse').value}/quick-lesson`, { method: 'POST', body: JSON.stringify({ lessonTitle: document.getElementById('lTitle').value, assetId: document.getElementById('lAsset').value, pdfTitle: document.getElementById('lPdf').value, isPreview: document.getElementById('lPreview').checked }) });
    alert('Lesson added!'); this.loadCatalogue();
  },
  async togglePublish(id, pub) {
    await this.api(`/admin/courses/${id}/${pub ? 'publish' : 'unpublish'}`, { method: 'POST' });
    this.loadCatalogue();
  },

  async loadTests() {
    const [courses, meta] = await Promise.all([this.api('/admin/courses'), this.api('/admin/tests-meta')]);
    document.getElementById('admMain').innerHTML = `
      <div class="page-head"><h1>Mock Tests &amp; Live Classes</h1></div>
      <div class="grid-2">
        <div class="card">
          <h3 style="margin-top:0;">Create Mock Test</h3>
          <label>Course</label><select id="tCourse">${courses.map((c)=>`<option value="${c.courseId}">${c.title}</option>`).join('')}</select>
          <label>Title</label><input id="tTitle" placeholder="Test Title" />
          <label>Duration (seconds)</label><input id="tDur" type="number" value="900" />
          <button class="btn btn-primary" onclick="admin.createTest()">Create Test</button>
        </div>
        <div class="card">
          <h3 style="margin-top:0;">Schedule Live Class</h3>
          <label>Course</label><select id="sCourse">${courses.map((c)=>`<option value="${c.courseId}">${c.title}</option>`).join('')}</select>
          <label>Session Title</label><input id="sTitle" placeholder="Session Title" />
          <label>Faculty</label><input id="sFac" value="Hemant Mudgal (Senior Teacher)" />
          <label>Join URL</label><input id="sUrl" value="https://zoom.us/j/9988776655" />
          <button class="btn btn-navy" onclick="admin.scheduleLive()">Schedule Live Class</button>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0;">Add MCQ Question to Test</h3>
        <div class="grid-2">
          <div><label>Test</label><select id="qTest">${meta.tests.map((t)=>`<option value="${t.testId}">${t.title}</option>`).join('')}</select></div>
          <div><label>Subject</label><select id="qSub">${meta.subjects.map((s)=>`<option value="${s.subjectId}">${s.name}</option>`).join('')}</select></div>
        </div>
        <label>Question Stem</label><input id="qStem" placeholder="Question..." />
        <div class="grid-2">
          <input id="qO1" placeholder="Option A (Correct)" /><input id="qO2" placeholder="Option B" />
          <input id="qO3" placeholder="Option C" /><input id="qO4" placeholder="Option D" />
        </div>
        <label>Explanation</label><input id="qExp" placeholder="Explanation shown after submission" />
        <button class="btn btn-primary" onclick="admin.addQuestion()">Add Question (+2 / -0.5)</button>
      </div>
    `;
  },

  async createTest() {
    await this.api('/admin/tests', { method: 'POST', body: JSON.stringify({ courseId: document.getElementById('tCourse').value, title: document.getElementById('tTitle').value, durationSeconds: Number(document.getElementById('tDur').value) }) });
    alert('Mock Test created!'); this.loadTests();
  },
  async scheduleLive() {
    await this.api('/admin/live-sessions', { method: 'POST', body: JSON.stringify({ courseId: document.getElementById('sCourse').value, title: document.getElementById('sTitle').value, facultyName: document.getElementById('sFac').value, joinUrl: document.getElementById('sUrl').value }) });
    alert('Live class scheduled!'); this.loadTests();
  },
  async addQuestion() {
    await this.api('/admin/questions', {
      method: 'POST',
      body: JSON.stringify({
        testId: document.getElementById('qTest').value, subjectId: document.getElementById('qSub').value,
        stem: document.getElementById('qStem').value, explanation: document.getElementById('qExp').value,
        options: [
          { text: document.getElementById('qO1').value, isCorrect: true },
          { text: document.getElementById('qO2').value, isCorrect: false },
          { text: document.getElementById('qO3').value, isCorrect: false },
          { text: document.getElementById('qO4').value, isCorrect: false }
        ]
      })
    });
    alert('Question added!'); this.loadTests();
  },

  async loadOperations() {
    const [students, doubts, reports, logs] = await Promise.all([
      this.api('/admin/students'), this.api('/admin/doubts'), this.api('/admin/reports'), this.api('/admin/audit-logs')
    ]);
    document.getElementById('admMain').innerHTML = `
      <div class="page-head"><h1>Students, Doubts, Moderation &amp; Audit</h1></div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
          <h3 style="margin:0;">Registered Students (${students.length})</h3>
          <button class="btn btn-navy btn-sm" onclick="admin.exportStudentsCsv()">⬇ Export Students CSV</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Student</th><th>Phone &amp; Email</th><th>State &amp; Exam</th><th>Batches &amp; Paid</th><th>Verification</th><th>Actions</th></tr></thead><tbody>
          ${this.renderStudentRows(students)}
        </tbody></table></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0;">Student Doubt Tickets</h3>
        ${doubts.map((d)=>`<div style="padding:10px 0;border-bottom:1px solid var(--border);"><strong>${d.title}</strong> <span class="badge">${d.status}</span> &bull; <small>${d.studentName}</small><p style="margin:6px 0;">${d.text}</p><div style="display:flex;gap:8px;flex-wrap:wrap;"><input id="rep_${d.doubtId}" placeholder="Reply..." style="margin:0;flex:1;min-width:200px;" /><button class="btn btn-primary btn-sm" onclick="admin.replyDoubt('${d.doubtId}')">Reply</button></div></div>`).join('') || 'No doubts.'}
      </div>
      <div class="card">
        <h3 style="margin-top:0;">Content Reports</h3>
        <div class="table-wrap"><table><thead><tr><th>Entity</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody>
          ${reports.map((r)=>`<tr><td>${r.entityType}</td><td>${r.reason}</td><td><span class="badge">${r.status}</span></td><td><button class="btn btn-danger btn-sm" onclick="admin.moderate('${r.entityType}','${r.entityId}','remove')">Remove</button> <button class="btn btn-amber btn-sm" onclick="admin.moderate('${r.entityType}','${r.entityId}','dismiss')">Dismiss</button></td></tr>`).join('') || '<tr><td colspan="4">No reports.</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0;">Audit Log</h3>
        <div class="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
          ${logs.map((a)=>`<tr><td>${new Date(a.createdAt).toLocaleString()}</td><td>${a.actorName}</td><td><code>${a.action}</code></td><td>${a.entityType}</td><td>${a.details}</td></tr>`).join('') || '<tr><td colspan="5">No audit entries yet.</td></tr>'}
        </tbody></table></div>
      </div>
    `;
  },

  async replyDoubt(id) {
    const message = document.getElementById(`rep_${id}`).value;
    await this.api(`/doubts/${id}/replies`, { method: 'POST', body: JSON.stringify({ message }) });
    this.loadOperations();
  },
  async moderate(entityType, id, action) {
    await this.api(`/admin/community/${entityType}/${id}/moderate`, { method: 'POST', body: JSON.stringify({ action }) });
    if (this.tab === 'dashboard') this.loadDashboard();
    else this.loadOperations();
  },

  async loadStaff() {
    const isSuper = this.user.roles.includes('SuperAdmin');
    let staff = [];
    let errMsg = '';
    try {
      staff = await this.api('/admin/staff');
    } catch (e) { errMsg = e.message; }
    document.getElementById('admMain').innerHTML = `
      <div class="page-head">
        <div><h1>Faculty &amp; Staff Management (CRUD)</h1><span style="color:var(--slate);font-size:.9rem;">Only <strong>SuperAdmin</strong> can Create, Update, Suspend, or Delete Faculty, Support, and Admin accounts.</span></div>
        <button class="btn btn-danger" onclick="admin.logout()">🚪 Logout</button>
      </div>
      ${isSuper ? `
        <div class="card">
          <h3 id="fFormTitle" style="margin-top:0;">➕ Add New Faculty / Staff (SuperAdmin)</h3>
          <input id="fEditId" type="hidden" value="" />
          <div class="grid-2">
            <div><label>Full Name</label><input id="fName" placeholder="e.g. Dr. Anjali Verma" /></div>
            <div><label>10-digit Mobile Number</label><input id="fPhone" placeholder="e.g. 9822334455" /></div>
            <div><label>Email (optional)</label><input id="fEmail" placeholder="faculty@mudgalbiology.in" /></div>
            <div><label id="fPwdLabel">Password (min 6 chars)</label><input id="fPwd" type="password" placeholder="Set login password" /></div>
          </div>
          <label>Role</label>
          <select id="fRole" style="max-width:260px;">
            <option value="Faculty">Faculty</option>
            <option value="SupportAgent">SupportAgent</option>
            <option value="Admin">Admin</option>
          </select>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="fSaveBtn" class="btn btn-primary" onclick="admin.saveFaculty()">Add Faculty Account</button>
            <button id="fCancelBtn" class="btn" style="display:none;background:#E2E8F0;color:#0F172A;" onclick="admin.resetFacultyForm()">Cancel Edit</button>
          </div>
          <p id="fErr" style="color:var(--danger);font-weight:600;margin-top:8px;"></p>
        </div>
      ` : `<div class="card" style="border-left:4px solid var(--amber);"><strong>Permission Notice:</strong> You are signed in as <strong>${this.user.roles.join(', ')}</strong>. Sign in as <strong>SuperAdmin</strong> (<code>8888888888</code>) to create, edit, or delete Faculty accounts.</div>`}
      <div class="card">
        <h3 style="margin-top:0;">Current Staff &amp; Faculties (${staff.length})</h3>
        ${errMsg ? `<p style="color:var(--danger);">${errMsg}</p>` : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Role</th><th>Status</th><th>Actions (CRUD)</th></tr></thead>
              <tbody>
                ${staff.map((s) => `
                  <tr>
                    <td><strong>${s.fullName}</strong></td>
                    <td><code>${s.phone}</code></td>
                    <td>${s.email}</td>
                    <td><span class="badge">${s.role}</span></td>
                    <td>${s.status}</td>
                    <td style="display:flex;gap:6px;flex-wrap:wrap;">${isSuper && s.userId !== this.user.userId ? `
                      <button class="btn btn-navy btn-sm" onclick="admin.editFaculty('${s.userId}')">✏️ Edit</button>
                      ${s.status === 'Suspended' ? `<button class="btn btn-primary btn-sm" onclick="admin.toggleStaffStatus('${s.userId}','Active')">Activate</button>` : `<button class="btn btn-amber btn-sm" onclick="admin.toggleStaffStatus('${s.userId}','Suspended')">Suspend</button>`}
                      ${s.role !== 'SuperAdmin' ? `<button class="btn btn-danger btn-sm" onclick="admin.deleteFaculty('${s.userId}','${s.fullName.replace(/'/g, '')}')">🗑️ Delete</button>` : ''}
                    ` : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
    this._staffList = staff;
  },

  editFaculty(userId) {
    const s = (this._staffList || []).find((x) => x.userId === userId);
    if (!s) return;
    document.getElementById('fEditId').value = s.userId;
    document.getElementById('fFormTitle').textContent = `✏️ Edit Faculty / Staff: ${s.fullName}`;
    document.getElementById('fName').value = s.fullName;
    document.getElementById('fPhone').value = s.phone;
    document.getElementById('fEmail').value = s.email === '-' ? '' : s.email;
    document.getElementById('fPwd').value = '';
    document.getElementById('fPwdLabel').textContent = 'New Password (leave blank to keep existing)';
    document.getElementById('fRole').value = ['Faculty', 'SupportAgent', 'Admin'].includes(s.role) ? s.role : 'Faculty';
    document.getElementById('fSaveBtn').textContent = 'Save Changes';
    document.getElementById('fCancelBtn').style.display = 'inline-flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  resetFacultyForm() {
    document.getElementById('fEditId').value = '';
    document.getElementById('fFormTitle').textContent = '➕ Add New Faculty / Staff (SuperAdmin)';
    document.getElementById('fName').value = '';
    document.getElementById('fPhone').value = '';
    document.getElementById('fEmail').value = '';
    document.getElementById('fPwd').value = '';
    document.getElementById('fPwdLabel').textContent = 'Password (min 6 chars)';
    document.getElementById('fRole').value = 'Faculty';
    document.getElementById('fSaveBtn').textContent = 'Add Faculty Account';
    document.getElementById('fCancelBtn').style.display = 'none';
    document.getElementById('fErr').textContent = '';
  },

  async saveFaculty() {
    try {
      document.getElementById('fErr').textContent = '';
      const editId = document.getElementById('fEditId').value;
      const body = {
        fullName: document.getElementById('fName').value,
        phone: document.getElementById('fPhone').value,
        email: document.getElementById('fEmail').value,
        password: document.getElementById('fPwd').value,
        role: document.getElementById('fRole').value
      };
      if (editId) {
        await this.api(`/admin/faculties/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
        alert('Faculty account updated!');
      } else {
        await this.api('/admin/faculties', { method: 'POST', body: JSON.stringify(body) });
        alert('Faculty account added successfully!');
      }
      this.loadStaff();
    } catch (e) { document.getElementById('fErr').textContent = e.message; }
  },

  async deleteFaculty(userId, name) {
    if (!confirm(`Delete faculty/staff account "${name}"? This cannot be undone.`)) return;
    await this.api(`/admin/faculties/${userId}`, { method: 'DELETE' });
    this.loadStaff();
  },

  async toggleStaffStatus(userId, status) {
    await this.api(`/admin/staff/${userId}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    this.loadStaff();
  }
};

admin.init();
