import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function openDatabase(dbPath) {
  const resolved = dbPath || process.env.SQLITE_PATH || path.resolve(process.cwd(), 'data', 'mudgal_biology.db');
  if (resolved !== ':memory:') {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  initSchema(db);
  seedIfEmpty(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      UserId TEXT PRIMARY KEY,
      Phone TEXT UNIQUE NOT NULL,
      Email TEXT,
      FullName TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Active',
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Roles (
      RoleId TEXT PRIMARY KEY,
      Name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS UserRoles (
      UserId TEXT NOT NULL,
      RoleId TEXT NOT NULL,
      PRIMARY KEY (UserId, RoleId)
    );
    CREATE TABLE IF NOT EXISTS StudentProfiles (
      UserId TEXT PRIMARY KEY,
      PreferredLanguage TEXT NOT NULL DEFAULT 'en',
      State TEXT,
      TargetExamId TEXT,
      AcceptedTerms INTEGER NOT NULL DEFAULT 1,
      TermsAcceptedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS OtpChallenges (
      ChallengeId TEXT PRIMARY KEY,
      Phone TEXT NOT NULL,
      CodeHash TEXT NOT NULL,
      ExpiresAt TEXT NOT NULL,
      Attempts INTEGER NOT NULL DEFAULT 0,
      Consumed INTEGER NOT NULL DEFAULT 0,
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS RefreshTokens (
      TokenId TEXT PRIMARY KEY,
      UserId TEXT NOT NULL,
      TokenHash TEXT NOT NULL,
      ExpiresAt TEXT NOT NULL,
      RevokedAt TEXT,
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Exams (
      ExamId TEXT PRIMARY KEY,
      Name TEXT NOT NULL,
      Code TEXT UNIQUE NOT NULL,
      Description TEXT NOT NULL DEFAULT '',
      IsActive INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS Subjects (
      SubjectId TEXT PRIMARY KEY,
      ExamId TEXT NOT NULL,
      Name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Courses (
      CourseId TEXT PRIMARY KEY,
      Title TEXT NOT NULL,
      Slug TEXT UNIQUE NOT NULL,
      Description TEXT NOT NULL,
      Language TEXT NOT NULL DEFAULT 'English',
      CourseType TEXT NOT NULL DEFAULT 'Foundation',
      Status TEXT NOT NULL DEFAULT 'Draft',
      ValidityDays INTEGER NOT NULL DEFAULT 365,
      Price REAL NOT NULL,
      Currency TEXT NOT NULL DEFAULT 'INR',
      FaqJson TEXT NOT NULL DEFAULT '[]',
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS CourseExams (
      CourseId TEXT NOT NULL,
      ExamId TEXT NOT NULL,
      PRIMARY KEY (CourseId, ExamId)
    );
    CREATE TABLE IF NOT EXISTS CourseFaculties (
      CourseId TEXT NOT NULL,
      FacultyUserId TEXT NOT NULL,
      PRIMARY KEY (CourseId, FacultyUserId)
    );
    CREATE TABLE IF NOT EXISTS CourseModules (
      ModuleId TEXT PRIMARY KEY,
      CourseId TEXT NOT NULL,
      Title TEXT NOT NULL,
      SortOrder INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS Chapters (
      ChapterId TEXT PRIMARY KEY,
      ModuleId TEXT NOT NULL,
      Title TEXT NOT NULL,
      SortOrder INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS MediaAssets (
      MediaAssetId TEXT PRIMARY KEY,
      Provider TEXT NOT NULL DEFAULT 'MockHlsCdn',
      ProviderAssetId TEXT NOT NULL,
      AssetType TEXT NOT NULL DEFAULT 'Video',
      Status TEXT NOT NULL DEFAULT 'Ready'
    );
    CREATE TABLE IF NOT EXISTS Lessons (
      LessonId TEXT PRIMARY KEY,
      ChapterId TEXT NOT NULL,
      Title TEXT NOT NULL,
      LessonType TEXT NOT NULL DEFAULT 'Video',
      MediaAssetId TEXT,
      DurationSeconds INTEGER NOT NULL DEFAULT 1200,
      IsPreview INTEGER NOT NULL DEFAULT 0,
      SortOrder INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS Resources (
      ResourceId TEXT PRIMARY KEY,
      LessonId TEXT NOT NULL,
      StorageKey TEXT NOT NULL,
      ResourceType TEXT NOT NULL DEFAULT 'Pdf',
      Title TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS LessonBookmarks (
      UserId TEXT NOT NULL,
      LessonId TEXT NOT NULL,
      CreatedAt TEXT NOT NULL,
      PRIMARY KEY (UserId, LessonId)
    );
    CREATE TABLE IF NOT EXISTS LessonProgresses (
      UserId TEXT NOT NULL,
      LessonId TEXT NOT NULL,
      LastPositionSeconds INTEGER NOT NULL DEFAULT 0,
      CompletedAt TEXT,
      UpdatedAt TEXT NOT NULL,
      PRIMARY KEY (UserId, LessonId)
    );
    CREATE TABLE IF NOT EXISTS SubscriptionPlans (
      PlanId TEXT PRIMARY KEY,
      Name TEXT NOT NULL,
      Description TEXT NOT NULL,
      Price REAL NOT NULL,
      Currency TEXT NOT NULL DEFAULT 'INR',
      DurationDays INTEGER NOT NULL DEFAULT 180,
      Status TEXT NOT NULL DEFAULT 'Active'
    );
    CREATE TABLE IF NOT EXISTS SubscriptionPlanCourses (
      PlanId TEXT NOT NULL,
      CourseId TEXT NOT NULL,
      PRIMARY KEY (PlanId, CourseId)
    );
    CREATE TABLE IF NOT EXISTS Orders (
      OrderId TEXT PRIMARY KEY,
      UserId TEXT NOT NULL,
      TotalAmount REAL NOT NULL,
      Currency TEXT NOT NULL DEFAULT 'INR',
      Status TEXT NOT NULL DEFAULT 'Pending',
      IdempotencyKey TEXT NOT NULL,
      CreatedAt TEXT NOT NULL,
      UNIQUE (UserId, IdempotencyKey)
    );
    CREATE TABLE IF NOT EXISTS OrderItems (
      OrderItemId TEXT PRIMARY KEY,
      OrderId TEXT NOT NULL,
      ProductType TEXT NOT NULL,
      ProductId TEXT NOT NULL,
      ProductTitle TEXT NOT NULL,
      UnitPrice REAL NOT NULL,
      Quantity INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS Payments (
      PaymentId TEXT PRIMARY KEY,
      OrderId TEXT NOT NULL,
      Provider TEXT NOT NULL,
      ProviderReference TEXT UNIQUE NOT NULL,
      Amount REAL NOT NULL,
      Currency TEXT NOT NULL DEFAULT 'INR',
      Status TEXT NOT NULL DEFAULT 'Initiated',
      VerifiedAt TEXT,
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Subscriptions (
      SubscriptionId TEXT PRIMARY KEY,
      UserId TEXT NOT NULL,
      PlanId TEXT NOT NULL,
      StartsAt TEXT NOT NULL,
      ExpiresAt TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Active',
      SourceOrderId TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Entitlements (
      EntitlementId TEXT PRIMARY KEY,
      UserId TEXT NOT NULL,
      CourseId TEXT NOT NULL,
      StartsAt TEXT NOT NULL,
      ExpiresAt TEXT NOT NULL,
      SourceType TEXT NOT NULL,
      SourceId TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Active'
    );
    CREATE TABLE IF NOT EXISTS Tests (
      TestId TEXT PRIMARY KEY,
      CourseId TEXT NOT NULL,
      Title TEXT NOT NULL,
      Instructions TEXT NOT NULL DEFAULT '',
      DurationSeconds INTEGER NOT NULL DEFAULT 900,
      AllowReviewAfterSubmit INTEGER NOT NULL DEFAULT 1,
      Status TEXT NOT NULL DEFAULT 'Published'
    );
    CREATE TABLE IF NOT EXISTS Questions (
      QuestionId TEXT PRIMARY KEY,
      SubjectId TEXT NOT NULL,
      Type TEXT NOT NULL DEFAULT 'SingleChoiceMcq',
      SectionName TEXT NOT NULL DEFAULT 'General',
      Stem TEXT NOT NULL,
      Explanation TEXT NOT NULL DEFAULT '',
      Difficulty TEXT NOT NULL DEFAULT 'Medium'
    );
    CREATE TABLE IF NOT EXISTS QuestionOptions (
      OptionId TEXT PRIMARY KEY,
      QuestionId TEXT NOT NULL,
      Text TEXT NOT NULL,
      IsCorrect INTEGER NOT NULL DEFAULT 0,
      SortOrder INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS TestQuestions (
      TestId TEXT NOT NULL,
      QuestionId TEXT NOT NULL,
      Marks REAL NOT NULL DEFAULT 2.0,
      NegativeMarks REAL NOT NULL DEFAULT 0.5,
      SortOrder INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (TestId, QuestionId)
    );
    CREATE TABLE IF NOT EXISTS TestAttempts (
      AttemptId TEXT PRIMARY KEY,
      TestId TEXT NOT NULL,
      UserId TEXT NOT NULL,
      StartedAt TEXT NOT NULL,
      SubmittedAt TEXT,
      Status TEXT NOT NULL DEFAULT 'InProgress',
      Score REAL,
      MaxScore REAL,
      CorrectCount INTEGER NOT NULL DEFAULT 0,
      IncorrectCount INTEGER NOT NULL DEFAULT 0,
      UnansweredCount INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS AttemptAnswers (
      AttemptId TEXT NOT NULL,
      QuestionId TEXT NOT NULL,
      SelectedOptionId TEXT,
      IsMarkedForReview INTEGER NOT NULL DEFAULT 0,
      SavedAt TEXT NOT NULL,
      PRIMARY KEY (AttemptId, QuestionId)
    );
    CREATE TABLE IF NOT EXISTS LiveSessions (
      SessionId TEXT PRIMARY KEY,
      CourseId TEXT NOT NULL,
      Title TEXT NOT NULL,
      FacultyName TEXT NOT NULL,
      StartsAt TEXT NOT NULL,
      EndsAt TEXT NOT NULL,
      Provider TEXT NOT NULL DEFAULT 'Zoom',
      ProviderSessionId TEXT NOT NULL,
      JoinUrl TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS LiveAttendances (
      AttendanceId TEXT PRIMARY KEY,
      SessionId TEXT NOT NULL,
      UserId TEXT NOT NULL,
      JoinedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Doubts (
      DoubtId TEXT PRIMARY KEY,
      UserId TEXT NOT NULL,
      CourseId TEXT NOT NULL,
      Title TEXT NOT NULL,
      Text TEXT NOT NULL,
      AttachmentUrl TEXT,
      Status TEXT NOT NULL DEFAULT 'Open',
      AssignedTo TEXT,
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS DoubtReplies (
      ReplyId TEXT PRIMARY KEY,
      DoubtId TEXT NOT NULL,
      AuthorUserId TEXT NOT NULL,
      Message TEXT NOT NULL,
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS CommunityPosts (
      PostId TEXT PRIMARY KEY,
      UserId TEXT NOT NULL,
      CourseId TEXT,
      ExamId TEXT,
      Body TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Visible',
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS CommunityComments (
      CommentId TEXT PRIMARY KEY,
      PostId TEXT NOT NULL,
      UserId TEXT NOT NULL,
      Body TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Visible',
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ContentReports (
      ReportId TEXT PRIMARY KEY,
      ReporterUserId TEXT NOT NULL,
      EntityType TEXT NOT NULL,
      EntityId TEXT NOT NULL,
      Reason TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Open',
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Notifications (
      NotificationId TEXT PRIMARY KEY,
      UserId TEXT NOT NULL,
      Title TEXT NOT NULL,
      Body TEXT NOT NULL,
      Type TEXT NOT NULL DEFAULT 'SystemAnnouncement',
      ReadAt TEXT,
      CreatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS NotificationPreferences (
      UserId TEXT PRIMARY KEY,
      PushLiveClasses INTEGER NOT NULL DEFAULT 1,
      PushCourseUpdates INTEGER NOT NULL DEFAULT 1,
      PushDoubtReplies INTEGER NOT NULL DEFAULT 1,
      PushAnnouncements INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS AuditLogs (
      AuditId TEXT PRIMARY KEY,
      ActorUserId TEXT NOT NULL,
      ActorName TEXT NOT NULL,
      Action TEXT NOT NULL,
      EntityType TEXT NOT NULL,
      EntityId TEXT NOT NULL,
      Details TEXT NOT NULL DEFAULT '',
      CreatedAt TEXT NOT NULL
    );
  `);
}

export function hasActiveEntitlement(db, userId, courseId) {
  const now = nowIso();
  const row = db.prepare(`
    SELECT 1 FROM Entitlements
    WHERE UserId = ? AND CourseId = ? AND Status = 'Active' AND StartsAt <= ? AND ExpiresAt > ?
    LIMIT 1
  `).get(userId, courseId, now, now);
  return Boolean(row);
}

export function recordAudit(db, actorUserId, actorName, action, entityType, entityId, details = '') {
  db.prepare(`
    INSERT INTO AuditLogs (AuditId, ActorUserId, ActorName, Action, EntityType, EntityId, Details, CreatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid(), actorUserId, actorName || 'Staff', action, entityType, entityId, details, nowIso());
}

function seedIfEmpty(db) {
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM Exams').get().cnt;
  if (count > 0) return;

  const now = Date.now();
  const isoOffset = (ms) => new Date(now + ms).toISOString();
  const DAY = 86400_000;
  const MIN = 60_000;

  // Roles
  const roleMap = {};
  for (const name of ['Student', 'Faculty', 'SupportAgent', 'Admin', 'SuperAdmin']) {
    const id = uuid();
    roleMap[name] = id;
    db.prepare('INSERT INTO Roles (RoleId, Name) VALUES (?, ?)').run(id, name);
  }

  // Users
  const users = [
    { id: uuid(), phone: '9876543210', email: 'aarav@example.in', name: 'Aarav Sharma', role: 'Student' },
    { id: uuid(), phone: '9811112222', email: 'mudgal@mudgalbiology.in', name: 'Dr. Mudgal (Biology Lead)', role: 'Faculty' },
    { id: uuid(), phone: '9811113333', email: 'rajesh@mudgalbiology.in', name: 'Prof. Rajesh Verma', role: 'Faculty' },
    { id: uuid(), phone: '9811114444', email: 'priya@mudgalbiology.in', name: 'Priya Nair (Support)', role: 'SupportAgent' },
    { id: uuid(), phone: '9999999999', email: 'admin@mudgalbiology.in', name: 'Mudgal Admin', role: 'Admin' },
    { id: uuid(), phone: '8888888888', email: 'super@mudgalbiology.in', name: 'Super Admin', role: 'SuperAdmin' }
  ];
  for (const u of users) {
    db.prepare('INSERT INTO Users (UserId, Phone, Email, FullName, Status, CreatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, u.phone, u.email, u.name, 'Active', nowIso());
    db.prepare('INSERT INTO UserRoles (UserId, RoleId) VALUES (?, ?)').run(u.id, roleMap[u.role]);
  }
  const [student, faculty1, faculty2] = users;

  // Exams
  const exams = [
    { id: uuid(), name: 'NEET & Medical Biology', code: 'NEET_BIO', desc: 'NCERT Line-by-Line Botany, Zoology, CUET Biology & Nursing' },
    { id: uuid(), name: 'SSC CGL & CHSL', code: 'SSC', desc: 'Combined Graduate Level, CHSL & General Science preparation' },
    { id: uuid(), name: 'UPSC Civil Services', code: 'UPSC', desc: 'UPSC CSE Prelims GS, Science & Tech, CSAT & Mains Foundation' },
    { id: uuid(), name: 'Banking (IBPS / SBI)', code: 'BANKING', desc: 'IBPS PO, SBI Clerk & RBI Assistant quantitative & reasoning mastery' },
    { id: uuid(), name: 'State PSC (PCS)', code: 'STATE_PSC', desc: 'State Administrative Services GS, Biology & State GK' }
  ];
  for (const e of exams) {
    db.prepare('INSERT INTO Exams (ExamId, Name, Code, Description, IsActive) VALUES (?, ?, ?, ?, 1)')
      .run(e.id, e.name, e.code, e.desc);
  }
  const [neetBio, ssc, upsc, banking, statePsc] = exams;

  db.prepare(`INSERT INTO StudentProfiles (UserId, PreferredLanguage, State, TargetExamId, AcceptedTerms, TermsAcceptedAt) VALUES (?, 'en', 'Rajasthan', ?, 1, ?)`)
    .run(student.id, neetBio.id, nowIso());
  db.prepare(`INSERT INTO NotificationPreferences (UserId) VALUES (?)`).run(student.id);

  // Subjects
  const subBotany = uuid(), subZoology = uuid(), subQuant = uuid(), subReason = uuid(), subPolity = uuid();
  for (const [sid, eid, name] of [
    [subBotany, neetBio.id, 'Botany & Plant Physiology'],
    [subZoology, neetBio.id, 'Human Physiology & Genetics'],
    [subQuant, ssc.id, 'Quantitative Aptitude'],
    [subReason, ssc.id, 'General Intelligence & Reasoning'],
    [subPolity, upsc.id, 'Indian Polity & Governance']
  ]) {
    db.prepare('INSERT INTO Subjects (SubjectId, ExamId, Name) VALUES (?, ?, ?)').run(sid, eid, name);
  }

  // Courses
  const neetCourseId = uuid(), sscCourseId = uuid(), upscCourseId = uuid(), bankCourseId = uuid(), pscCourseId = uuid();
  const courses = [
    {
      id: neetCourseId, title: 'Mudgal Biology — NEET UG Complete NCERT Line-by-Line Batch',
      slug: 'mudgal-biology-neet-ug-2027',
      desc: 'Master 360/360 in NEET Biology with Dr. Mudgal: NCERT Botany & Zoology, 3D diagram notes, smart e-books, daily flashcards & All-India mock tests.',
      lang: 'Bilingual (EN/HI)', type: 'Live + Recorded', price: 1999, days: 365, examId: neetBio.id, facId: faculty1.id,
      faqs: JSON.stringify([{ Question: 'Does this cover Class 11 & 12 NCERT?', Answer: 'Yes, every NCERT line, diagram, and exemplar MCQ is covered in depth.' }])
    },
    {
      id: sscCourseId, title: 'SSC CGL Tier I & II Complete Foundation Batch 2027',
      slug: 'ssc-cgl-complete-foundation-2027',
      desc: 'Structured daily classes, arithmetic & advance maths, PYQ drills, bilingual PDFs, and full-length Tier-I/II mock tests.',
      lang: 'Bilingual (EN/HI)', type: 'Foundation', price: 1499, days: 365, examId: ssc.id, facId: faculty2.id,
      faqs: JSON.stringify([{ Question: 'Is this batch bilingual?', Answer: 'Classes use English slides with Hindi & English explanation.' }])
    },
    {
      id: upscCourseId, title: 'UPSC CSE Prelims GS + CSAT Integrated Batch',
      slug: 'upsc-cse-prelims-gs-csat',
      desc: 'Comprehensive NCERT-to-Standard Polity, Economy, Modern History, Environment & CSAT problem solving.',
      lang: 'English', type: 'Prelims + CSAT', price: 2999, days: 365, examId: upsc.id, facId: faculty1.id,
      faqs: JSON.stringify([{ Question: 'Are current affairs notes included?', Answer: 'Yes, monthly curated PDFs are attached to module lessons.' }])
    },
    {
      id: bankCourseId, title: 'IBPS PO & SBI Clerk Speed Booster Batch',
      slug: 'ibps-sbi-speed-booster',
      desc: 'High-speed DI, seating arrangement puzzles, reading comprehension and sectional speed tests.',
      lang: 'English', type: 'Target Batch', price: 999, days: 180, examId: banking.id, facId: faculty2.id, faqs: '[]'
    },
    {
      id: pscCourseId, title: 'State PSC Integrated Prelims & Mains GS',
      slug: 'state-psc-integrated-gs',
      desc: 'Complete coverage of General Studies, Constitution, Geography and State-specific modules.',
      lang: 'Hindi', type: 'Foundation', price: 1799, days: 365, examId: statePsc.id, facId: faculty1.id, faqs: '[]'
    }
  ];

  for (const c of courses) {
    db.prepare(`INSERT INTO Courses (CourseId, Title, Slug, Description, Language, CourseType, Status, ValidityDays, Price, Currency, FaqJson, CreatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 'Published', ?, ?, 'INR', ?, ?)`).run(c.id, c.title, c.slug, c.desc, c.lang, c.type, c.days, c.price, c.faqs, nowIso());
    db.prepare('INSERT INTO CourseExams (CourseId, ExamId) VALUES (?, ?)').run(c.id, c.examId);
    db.prepare('INSERT INTO CourseFaculties (CourseId, FacultyUserId) VALUES (?, ?)').run(c.id, c.facId);
  }

  // Media + Curriculum Helper
  const addLessonSet = (courseId, modTitle, chTitle, lessons) => {
    const modId = uuid(), chId = uuid();
    db.prepare('INSERT INTO CourseModules (ModuleId, CourseId, Title, SortOrder) VALUES (?, ?, ?, 1)').run(modId, courseId, modTitle);
    db.prepare('INSERT INTO Chapters (ChapterId, ModuleId, Title, SortOrder) VALUES (?, ?, ?, 1)').run(chId, modId, chTitle);
    lessons.forEach((l, idx) => {
      const assetId = uuid(), lessonId = uuid();
      db.prepare(`INSERT INTO MediaAssets (MediaAssetId, Provider, ProviderAssetId, AssetType, Status) VALUES (?, 'MockHlsCdn', ?, 'Video', 'Ready')`)
        .run(assetId, l.assetKey);
      db.prepare(`INSERT INTO Lessons (LessonId, ChapterId, Title, LessonType, MediaAssetId, DurationSeconds, IsPreview, SortOrder) VALUES (?, ?, ?, 'Video', ?, ?, ?, ?)`)
        .run(lessonId, chId, l.title, assetId, l.dur, l.preview ? 1 : 0, idx + 1);
      if (l.pdfTitle) {
        db.prepare(`INSERT INTO Resources (ResourceId, LessonId, StorageKey, ResourceType, Title) VALUES (?, ?, ?, ?, ?)`)
          .run(uuid(), lessonId, l.pdfKey, l.resType || 'Pdf', l.pdfTitle);
      }
    });
  };

  addLessonSet(neetCourseId, 'Module 1: Cell — The Unit of Life & Biomolecules', 'Chapter 1: Prokaryotic & Eukaryotic Organelles', [
    { title: 'Cell Theory, Mitochondria & Chloroplast (Free Demo)', assetKey: 'mudgal_cell_biology_01', dur: 1860, preview: true, pdfTitle: 'NCERT Cell Biology Diagram E-Book.pdf', pdfKey: 'mudgal_cell_biology_ebook.pdf', resType: 'EBook' },
    { title: 'Human Heart Cardiac Cycle & ECG NCERT Deep Dive', assetKey: 'mudgal_cardiac_cycle_02', dur: 2400, preview: false, pdfTitle: 'Human Physiology 100 High-Yield PYQs.pdf', pdfKey: 'mudgal_physiology_pyq.pdf', resType: 'Pdf' }
  ]);
  addLessonSet(sscCourseId, 'Module 1: Arithmetic Foundations', 'Chapter 1: Ratio, Proportion & Percentage', [
    { title: 'Orientation & Ratio Shortcuts (Free Demo)', assetKey: 'ssc_intro_ratio_v1', dur: 1240, preview: true, pdfTitle: 'Ratio & Proportion Formula Sheet.pdf', pdfKey: 'ssc_ratio_formulas.pdf' },
    { title: 'Successive Percentage & Election Questions', assetKey: 'ssc_percentage_lec2', dur: 2150, preview: false, pdfTitle: 'Percentage 50 PYQ Practice Set.pdf', pdfKey: 'ssc_percentage_pyq.pdf' }
  ]);
  addLessonSet(upscCourseId, 'Module 1: Constitutional Framework', 'Chapter 1: Preamble & Fundamental Rights', [
    { title: 'Philosophy of the Preamble (Free Demo)', assetKey: 'upsc_polity_preamble', dur: 1800, preview: true, pdfTitle: 'Polity Laxmikanth Summary Notes.pdf', pdfKey: 'upsc_preamble_notes.pdf', resType: 'EBook' },
    { title: 'Articles 12-35 Deep Dive & Case Laws', assetKey: 'upsc_articles_12_35', dur: 2700, preview: false }
  ]);
  addLessonSet(bankCourseId, 'Module 1: Seating & Floor Puzzles', 'Chapter 1: Multi-variable Floor Puzzles', [
    { title: '8-Floor Variable Puzzle Approach (Demo)', assetKey: 'bank_puzzle_floors', dur: 1500, preview: true }
  ]);
  addLessonSet(pscCourseId, 'Module 1: State Governance & History', 'Chapter 1: Administrative Structure', [
    { title: 'State Secretariat & Governor Powers (Demo)', assetKey: 'psc_state_gov', dur: 1400, preview: true }
  ]);

  // Subscription Plans
  const allPassId = uuid(), civilPassId = uuid();
  db.prepare(`INSERT INTO SubscriptionPlans (PlanId, Name, Description, Price, Currency, DurationDays, Status) VALUES (?, ?, ?, 1999, 'INR', 180, 'Active')`)
    .run(allPassId, 'All-India Govt Exam Pass (6 Months)', 'Unlock SSC CGL Foundation + Banking Speed Booster + all associated mock tests.');
  db.prepare(`INSERT INTO SubscriptionPlans (PlanId, Name, Description, Price, Currency, DurationDays, Status) VALUES (?, ?, ?, 3999, 'INR', 365, 'Active')`)
    .run(civilPassId, 'Civil Services Combo Pass (12 Months)', 'Includes UPSC CSE Prelims + State PSC Integrated GS.');
  for (const [pid, cid] of [[allPassId, sscCourseId], [allPassId, bankCourseId], [civilPassId, upscCourseId], [civilPassId, pscCourseId]]) {
    db.prepare('INSERT INTO SubscriptionPlanCourses (PlanId, CourseId) VALUES (?, ?)').run(pid, cid);
  }

  // Demo student entitlements: NEET Biology + SSC enrolled; UPSC/Banking/StatePSC locked
  for (const cid of [neetCourseId, sscCourseId]) {
    db.prepare(`INSERT INTO Entitlements (EntitlementId, UserId, CourseId, StartsAt, ExpiresAt, SourceType, SourceId, Status) VALUES (?, ?, ?, ?, ?, 'ManualGrant', ?, 'Active')`)
      .run(uuid(), student.id, cid, isoOffset(-3 * DAY), isoOffset(360 * DAY), uuid());
  }

  // Live Sessions
  db.prepare(`INSERT INTO LiveSessions (SessionId, CourseId, Title, FacultyName, StartsAt, EndsAt, Provider, ProviderSessionId, JoinUrl) VALUES (?, ?, ?, ?, ?, ?, 'Zoom', 'MUDGAL-BIO-101', 'https://zoom.us/j/90123456789')`)
    .run(uuid(), neetCourseId, 'Live Marathon: Human Physiology & Genetics NCERT Line-by-Line', faculty1.name, isoOffset(5 * MIN), isoOffset(95 * MIN));
  db.prepare(`INSERT INTO LiveSessions (SessionId, CourseId, Title, FacultyName, StartsAt, EndsAt, Provider, ProviderSessionId, JoinUrl) VALUES (?, ?, ?, ?, ?, ?, 'Zoom', 'SSC-LIVE-901', 'https://zoom.us/j/90123456789')`)
    .run(uuid(), sscCourseId, 'Live Marathon: Trigonometry & Geometry PYQs', faculty2.name, isoOffset(30 * MIN), isoOffset(120 * MIN));
  db.prepare(`INSERT INTO LiveSessions (SessionId, CourseId, Title, FacultyName, StartsAt, EndsAt, Provider, ProviderSessionId, JoinUrl) VALUES (?, ?, ?, ?, ?, ?, 'GoogleMeet', 'UPSC-LIVE-402', 'https://meet.google.com/abc-defg-hij')`)
    .run(uuid(), upscCourseId, 'Union Budget & Economic Survey Key Takeaways', 'Dr. Kavita Rao', isoOffset(24 * 3600_000), isoOffset(26 * 3600_000));

  // Tests & Questions
  const neetTestId = uuid(), sscTestId = uuid(), upscTestId = uuid();
  db.prepare(`INSERT INTO Tests (TestId, CourseId, Title, Instructions, DurationSeconds, AllowReviewAfterSubmit, Status) VALUES (?, ?, ?, ?, 900, 1, 'Published')`)
    .run(neetTestId, neetCourseId, 'Mudgal Biology NEET All-India Mock Test #01', 'NEET Pattern: +4.0 marks for correct answer, -1.0 negative marking for wrong answer.');
  db.prepare(`INSERT INTO Tests (TestId, CourseId, Title, Instructions, DurationSeconds, AllowReviewAfterSubmit, Status) VALUES (?, ?, ?, ?, 900, 1, 'Published')`)
    .run(sscTestId, sscCourseId, 'SSC CGL Tier-I Mini Mock Test #01', 'Each correct answer awards +2.0 marks. Each wrong answer deducts 0.50 marks.');
  db.prepare(`INSERT INTO Tests (TestId, CourseId, Title, Instructions, DurationSeconds, AllowReviewAfterSubmit, Status) VALUES (?, ?, ?, ?, 1200, 1, 'Published')`)
    .run(upscTestId, upscCourseId, 'UPSC Prelims Polity Sectional Test #01', 'Each correct answer awards +2.0 marks. Negative marking is 0.66 marks per wrong answer.');

  const addQuestion = (testId, subjectId, section, stem, explanation, marks, neg, sortOrder, options) => {
    const qId = uuid();
    db.prepare(`INSERT INTO Questions (QuestionId, SubjectId, Type, SectionName, Stem, Explanation, Difficulty) VALUES (?, ?, 'SingleChoiceMcq', ?, ?, ?, 'Medium')`)
      .run(qId, subjectId, section, stem, explanation);
    options.forEach(([text, correct], idx) => {
      db.prepare(`INSERT INTO QuestionOptions (OptionId, QuestionId, Text, IsCorrect, SortOrder) VALUES (?, ?, ?, ?, ?)`)
        .run(uuid(), qId, text, correct ? 1 : 0, idx + 1);
    });
    db.prepare(`INSERT INTO TestQuestions (TestId, QuestionId, Marks, NegativeMarks, SortOrder) VALUES (?, ?, ?, ?, ?)`)
      .run(testId, qId, marks, neg, sortOrder);
  };

  addQuestion(neetTestId, subBotany, 'Botany', 'Which of the following organelles is NOT part of the endomembrane system in eukaryotic cells?', 'Mitochondria, chloroplasts and peroxisomes are not coordinated with ER/Golgi/lysosomes/vacuoles.', 4, 1, 1, [
    ['Mitochondria', true], ['Golgi apparatus', false], ['Lysosomes', false], ['Endoplasmic reticulum', false]
  ]);
  addQuestion(neetTestId, subZoology, 'Zoology', 'In a standard ECG, which wave represents the depolarization of the ventricles?', 'The QRS complex represents ventricular depolarization, initiating ventricular contraction.', 4, 1, 2, [
    ['P-wave', false], ['QRS complex', true], ['T-wave', false], ['PR interval', false]
  ]);
  addQuestion(sscTestId, subQuant, 'Quantitative Aptitude', 'If A : B = 3 : 4 and B : C = 8 : 9, what is A : B : C?', 'Equalize B: A:B = 6:8 and B:C = 8:9, therefore A:B:C = 6:8:9.', 2, 0.5, 1, [
    ['6 : 8 : 9', true], ['3 : 4 : 9', false], ['6 : 4 : 9', false], ['9 : 8 : 6', false]
  ]);
  addQuestion(sscTestId, subQuant, 'Quantitative Aptitude', 'A price is increased by 20% and then decreased by 20%. What is the net percentage change?', 'Using x + y + xy/100 = +20 - 20 - 400/100 = -4%, i.e. 4% decrease.', 2, 0.5, 2, [
    ['No change', false], ['4% decrease', true], ['4% increase', false], ['2% decrease', false]
  ]);
  addQuestion(sscTestId, subReason, 'Reasoning', 'Find the missing number in the series: 2, 6, 12, 20, 30, ?', 'Pattern is n*(n+1): 6x7=42.', 2, 0.5, 3, [
    ['40', false], ['42', true], ['44', false], ['36', false]
  ]);
  addQuestion(upscTestId, subPolity, 'Indian Polity', "Which Constitutional Amendment Act added the words 'Socialist', 'Secular' and 'Integrity' to the Preamble?", 'The 42nd Constitutional Amendment Act, 1976 amended the Preamble.', 2, 0.66, 1, [
    ['44th Amendment Act, 1978', false], ['42nd Amendment Act, 1976', true], ['24th Amendment Act, 1971', false], ['73rd Amendment Act, 1992', false]
  ]);

  // Doubts, Community & Notifications
  const doubtId = uuid();
  db.prepare(`INSERT INTO Doubts (DoubtId, UserId, CourseId, Title, Text, Status, AssignedTo, CreatedAt) VALUES (?, ?, ?, ?, ?, 'Answered', ?, ?)`)
    .run(doubtId, student.id, neetCourseId, 'Difference between QRS complex and T-wave in ECG', 'Dr. Mudgal, does T-wave indicate ventricular repolarization?', faculty1.id, nowIso());
  db.prepare(`INSERT INTO DoubtReplies (ReplyId, DoubtId, AuthorUserId, Message, CreatedAt) VALUES (?, ?, ?, ?, ?)`)
    .run(uuid(), doubtId, faculty1.id, 'Yes! P-wave = atrial depolarization, QRS = ventricular depolarization, T-wave = ventricular repolarization.', nowIso());

  const postId = uuid();
  db.prepare(`INSERT INTO CommunityPosts (PostId, UserId, CourseId, ExamId, Body, Status, CreatedAt) VALUES (?, ?, ?, ?, ?, 'Visible', ?)`)
    .run(postId, student.id, neetCourseId, neetBio.id, 'Finished Cell Biology NCERT E-Book today! Ready for Mudgal Biology Mock Test #01.', nowIso());
  db.prepare(`INSERT INTO CommunityComments (CommentId, PostId, UserId, Body, Status, CreatedAt) VALUES (?, ?, ?, ?, 'Visible', ?)`)
    .run(uuid(), postId, faculty1.id, 'Great consistency! Use the Active Recall Flashcards before attempting the mock test.', nowIso());

  db.prepare(`INSERT INTO Notifications (NotificationId, UserId, Title, Body, Type, CreatedAt) VALUES (?, ?, ?, ?, 'LiveClass', ?)`)
    .run(uuid(), student.id, 'Live Class Starting Soon', "Dr. Mudgal's Human Physiology & Genetics marathon starts shortly.", nowIso());
  db.prepare(`INSERT INTO Notifications (NotificationId, UserId, Title, Body, Type, CreatedAt) VALUES (?, ?, ?, ?, 'SystemAnnouncement', ?)`)
    .run(uuid(), student.id, 'Welcome to Mudgal Biology', 'Your NEET Biology & SSC batches, Smart E-Books, and Daily Flashcards are ready.', nowIso());
}
