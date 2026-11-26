import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { hashPassword } from './security.js';

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
  syncStaffPasswords(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      UserId TEXT PRIMARY KEY,
      Phone TEXT UNIQUE NOT NULL,
      Email TEXT,
      FullName TEXT NOT NULL,
      PasswordHash TEXT,
      IsVerified INTEGER NOT NULL DEFAULT 0,
      VerificationSource TEXT NOT NULL DEFAULT 'Pending',
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
  const cols = db.prepare('PRAGMA table_info(Users)').all();
  if (!cols.some((c) => c.name === 'PasswordHash')) {
    db.exec('ALTER TABLE Users ADD COLUMN PasswordHash TEXT');
  }
  if (!cols.some((c) => c.name === 'IsVerified')) {
    db.exec('ALTER TABLE Users ADD COLUMN IsVerified INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'VerificationSource')) {
    db.exec("ALTER TABLE Users ADD COLUMN VerificationSource TEXT NOT NULL DEFAULT 'Pending'");
  }
}

function syncStaffPasswords(db) {
  const adminPwd = process.env.ADMIN_PASSWORD;
  if (adminPwd && adminPwd.length >= 6) {
    db.prepare("UPDATE Users SET PasswordHash = ?, IsVerified = 1, VerificationSource = 'Staff' WHERE Phone = '9999999999'").run(hashPassword(adminPwd));
  }
  const superPwd = process.env.SUPER_ADMIN_PASSWORD;
  if (superPwd && superPwd.length >= 6) {
    db.prepare("UPDATE Users SET PasswordHash = ?, IsVerified = 1, VerificationSource = 'Staff' WHERE Phone = '8888888888'").run(hashPassword(superPwd));
  }
  if ((process.env.NODE_ENV || 'development') !== 'production') {
    const devHash = hashPassword('Mudgal@123');
    db.prepare("UPDATE Users SET PasswordHash = COALESCE(PasswordHash, ?), IsVerified = 1, VerificationSource = 'Sandbox' WHERE Phone IN ('9876543210', '9811112222', '9811113333', '9811114444', '9999999999', '8888888888')").run(devHash);
  }
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
    { id: uuid(), phone: '9811112222', email: 'mudgalbiolgy@gmail.com', name: 'Hemant Mudgal (Senior Teacher)', role: 'Faculty' },
    { id: uuid(), phone: '9811113333', email: 'zoology@mudgalbiology.in', name: 'Dr. Kavita Sharma (Zoology)', role: 'Faculty' },
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

  // Exams (Aligned with @MUDGALBIOLOGY YouTube Channel)
  const exams = [
    { id: uuid(), name: 'RPSC 2nd Grade Science', code: 'RPSC_2ND', desc: 'Graduation Biology Series, Invertebrates, Chordates, Teaching Methods & GEMS Mentorship' },
    { id: uuid(), name: 'RPSC 1st Grade Biology', code: 'RPSC_1ST', desc: 'School Lecturer Biology — Genetics, Developmental Biology, Ecology & RPSC PYQs' },
    { id: uuid(), name: 'NEET (Bio Focused)', code: 'NEET_BIO', desc: 'NCERT Line-by-Line Botany & Zoology with Short Tricks for 360/360 in NEET Biology' }
  ];
  for (const e of exams) {
    db.prepare('INSERT INTO Exams (ExamId, Name, Code, Description, IsActive) VALUES (?, ?, ?, ?, 1)')
      .run(e.id, e.name, e.code, e.desc);
  }
  const [rpsc2nd, rpsc1st, neetBio] = exams;

  db.prepare(`INSERT INTO StudentProfiles (UserId, PreferredLanguage, State, TargetExamId, AcceptedTerms, TermsAcceptedAt) VALUES (?, 'en', 'Rajasthan', ?, 1, ?)`)
    .run(student.id, rpsc2nd.id, nowIso());
  db.prepare(`INSERT INTO NotificationPreferences (UserId) VALUES (?)`).run(student.id);

  // Subjects
  const subGradBio = uuid(), subGenetics = uuid(), subPhysiology = uuid(), subBotany = uuid();
  for (const [sid, eid, name] of [
    [subGradBio, rpsc2nd.id, 'Graduation Biology (Invertebrates & Chordates)'],
    [subPhysiology, rpsc2nd.id, 'Animal & Plant Physiology'],
    [subGenetics, rpsc1st.id, 'Genetics & Molecular Biology'],
    [subBotany, neetBio.id, 'NCERT Botany & Ecology']
  ]) {
    db.prepare('INSERT INTO Subjects (SubjectId, ExamId, Name) VALUES (?, ?, ?)').run(sid, eid, name);
  }

  // Courses
  const rpsc2ndCourseId = uuid(), rpsc1stCourseId = uuid(), neetCourseId = uuid();
  const courses = [
    {
      id: rpsc2ndCourseId, title: 'RPSC 2nd Grade Science 2027 — Graduation Biology & GEMS Mentorship',
      slug: 'rpsc-2nd-grade-science-gems-2027',
      desc: 'Har topic ko simple banake padhate hain! Complete Graduation Biology (Invertebrates, Vertebrates, Nervous & Circulatory Systems), RPSC PYQ marathons & GEMS Test Series by Hemant Mudgal.',
      lang: 'Bilingual (HI/EN)', type: 'GEMS Mentorship + Live', price: 1499, days: 365, examId: rpsc2nd.id, facId: faculty1.id,
      faqs: JSON.stringify([{ Question: 'Does this cover Graduation-level Biology for RPSC 2nd Grade?', Answer: 'Yes, every B.Sc. level topic including Invertebrates, Vertebrates, Locomotion, Circulation, and Nervous System is covered with RPSC PYQs.' }])
    },
    {
      id: rpsc1stCourseId, title: 'RPSC 1st Grade Biology — School Lecturer Complete Batch',
      slug: 'rpsc-1st-grade-biology-lecturer',
      desc: 'In-depth Genetics, DNA Polymerase & Molecular Biology, Developmental Biology, Ecology, and previous year paper solutions with short-note PDFs.',
      lang: 'Bilingual (HI/EN)', type: 'Live + Recorded', price: 2499, days: 365, examId: rpsc1st.id, facId: faculty1.id,
      faqs: JSON.stringify([{ Question: 'Are RPSC PYQs solved topic-wise?', Answer: 'Yes, every unit includes previous year RPSC Biology questions and detailed solutions.' }])
    },
    {
      id: neetCourseId, title: 'NEET (Bio Focused) — NCERT Line-by-Line 360/360 Batch',
      slug: 'mudgal-biology-neet-bio-focused',
      desc: 'Master Class 11 & 12 NCERT Botany & Zoology with Hemant Mudgal: short tricks, diagram revision, active-recall flashcards & negative-marked mock tests.',
      lang: 'Bilingual (HI/EN)', type: 'Foundation + Test Series', price: 1999, days: 365, examId: neetBio.id, facId: faculty1.id,
      faqs: JSON.stringify([{ Question: 'Does this cover Class 11 & 12 NCERT?', Answer: 'Yes, every NCERT line, diagram, and high-yield NEET Biology PYQ is covered.' }])
    }
  ];

  for (const c of courses) {
    db.prepare(`INSERT INTO Courses (CourseId, Title, Slug, Description, Language, CourseType, Status, ValidityDays, Price, Currency, FaqJson, CreatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 'Published', ?, ?, 'INR', ?, ?)`).run(c.id, c.title, c.slug, c.desc, c.lang, c.type, c.days, c.price, c.faqs, nowIso());
    db.prepare('INSERT INTO CourseExams (CourseId, ExamId) VALUES (?, ?)').run(c.id, c.examId);
    db.prepare('INSERT INTO CourseFaculties (CourseId, FacultyUserId) VALUES (?, ?)').run(c.id, c.facId);
  }

  // Media + Curriculum Helper (linked to real @MUDGALBIOLOGY YouTube video IDs)
  const addLessonSet = (courseId, modTitle, chTitle, lessons) => {
    const modId = uuid(), chId = uuid();
    db.prepare('INSERT INTO CourseModules (ModuleId, CourseId, Title, SortOrder) VALUES (?, ?, ?, 1)').run(modId, courseId, modTitle);
    db.prepare('INSERT INTO Chapters (ChapterId, ModuleId, Title, SortOrder) VALUES (?, ?, ?, 1)').run(chId, modId, chTitle);
    lessons.forEach((l, idx) => {
      const assetId = uuid(), lessonId = uuid();
      db.prepare(`INSERT INTO MediaAssets (MediaAssetId, Provider, ProviderAssetId, AssetType, Status) VALUES (?, 'YouTube', ?, 'Video', 'Ready')`)
        .run(assetId, l.assetKey);
      db.prepare(`INSERT INTO Lessons (LessonId, ChapterId, Title, LessonType, MediaAssetId, DurationSeconds, IsPreview, SortOrder) VALUES (?, ?, ?, 'Video', ?, ?, ?, ?)`)
        .run(lessonId, chId, l.title, assetId, l.dur, l.preview ? 1 : 0, idx + 1);
      if (l.pdfTitle) {
        db.prepare(`INSERT INTO Resources (ResourceId, LessonId, StorageKey, ResourceType, Title) VALUES (?, ?, ?, ?, ?)`)
          .run(uuid(), lessonId, l.pdfKey, l.resType || 'Pdf', l.pdfTitle);
      }
    });
  };

  addLessonSet(rpsc2ndCourseId, 'Module 1: Graduation Biology — Circulation & Nervous System', 'Chapter 1: Comparative Anatomy & Physiology', [
    { title: 'Circulation in Vertebrates Complete Lecture (Free Demo)', assetKey: 'XfB-yCqwxo8', dur: 2460, preview: true, pdfTitle: 'Vertebrate Circulation Short Notes.pdf', pdfKey: 'mudgal_vertebrate_circulation.pdf', resType: 'EBook' },
    { title: 'Circulation in Invertebrates Complete Lecture', assetKey: 'PcSkgaK6LyQ', dur: 2100, preview: false, pdfTitle: 'Invertebrate Circulation PYQ Notes.pdf', pdfKey: 'mudgal_invertebrate_circulation.pdf', resType: 'Pdf' },
    { title: 'Nervous System in Vertebrates — Graduation Biology Series', assetKey: '6F3-zdr6-AM', dur: 2340, preview: false },
    { title: 'Locomotion in Invertebrates (Part 1 & 2)', assetKey: 'LRcwAYxZxTE', dur: 1980, preview: false }
  ]);
  addLessonSet(rpsc1stCourseId, 'Module 1: Molecular Biology, Genetics & RPSC Strategy', 'Chapter 1: DNA Replication, Krebs Cycle & PYQs', [
    { title: 'Types of DNA Polymerase Enzyme — RPSC PYQ Lecture (Free Demo)', assetKey: 'HoMQLU1ucks', dur: 1500, preview: true, pdfTitle: 'DNA Polymerase Comparison Table.pdf', pdfKey: 'mudgal_dna_polymerase.pdf', resType: 'EBook' },
    { title: 'Krebs Cycle NADH Yield & RPSC PYQ Concept', assetKey: 'a2l5Q3qI6Hw', dur: 960, preview: false, pdfTitle: 'Krebs Cycle & Glycolysis Short Tricks.pdf', pdfKey: 'mudgal_krebs_cycle.pdf', resType: 'EBook' },
    { title: 'GEMS Mentorship & Complete RPSC Biology Roadmap', assetKey: '7t_IjBOSF1w', dur: 1620, preview: false, pdfTitle: 'RPSC Biology Syllabus & PYQ Planner.pdf', pdfKey: 'mudgal_rpsc_planner.pdf' }
  ]);
  addLessonSet(neetCourseId, 'Module 1: Neural Control, Genetics & Exam Strategy', 'Chapter 1: Types of Nerves & Dihybrid Cross', [
    { title: 'Types of Nerves — Paper Solution & NCERT Tricks (Free Demo)', assetKey: '7dkkv4kWqQU', dur: 1320, preview: true, pdfTitle: 'NCERT Neural Control Mind Map.pdf', pdfKey: 'mudgal_nerves_mindmap.pdf', resType: 'EBook' },
    { title: 'Dihybrid Cross & Mendelian Genetics Short Tricks', assetKey: 'WjTyNIY11fw', dur: 1440, preview: false },
    { title: 'Nervous System in Invertebrates & Comparative Bio', assetKey: 'Hsoqc1sZ6Bc', dur: 1920, preview: false }
  ]);

  // Subscription Plans
  const gemsPassId = uuid(), allBioPassId = uuid();
  db.prepare(`INSERT INTO SubscriptionPlans (PlanId, Name, Description, Price, Currency, DurationDays, Status) VALUES (?, ?, ?, 2999, 'INR', 365, 'Active')`)
    .run(gemsPassId, 'RPSC GEMS Combo Pass (1st + 2nd Grade Biology)', 'Unlock both RPSC 2nd Grade Science Graduation Biology & RPSC 1st Grade Biology batches + GEMS Test Series.');
  db.prepare(`INSERT INTO SubscriptionPlans (PlanId, Name, Description, Price, Currency, DurationDays, Status) VALUES (?, ?, ?, 3999, 'INR', 365, 'Active')`)
    .run(allBioPassId, 'Mudgal Biology All-Exam Pass (12 Months)', 'Full access to RPSC 1st & 2nd Grade Biology and NEET Bio Focused batches.');
  for (const [pid, cid] of [[gemsPassId, rpsc2ndCourseId], [gemsPassId, rpsc1stCourseId], [allBioPassId, rpsc2ndCourseId], [allBioPassId, rpsc1stCourseId], [allBioPassId, neetCourseId]]) {
    db.prepare('INSERT INTO SubscriptionPlanCourses (PlanId, CourseId) VALUES (?, ?)').run(pid, cid);
  }

  // Demo student entitlements: RPSC 2nd Grade + NEET Bio enrolled; RPSC 1st Grade locked for purchase testing
  for (const cid of [rpsc2ndCourseId, neetCourseId]) {
    db.prepare(`INSERT INTO Entitlements (EntitlementId, UserId, CourseId, StartsAt, ExpiresAt, SourceType, SourceId, Status) VALUES (?, ?, ?, ?, ?, 'ManualGrant', ?, 'Active')`)
      .run(uuid(), student.id, cid, isoOffset(-3 * DAY), isoOffset(360 * DAY), uuid());
  }

  // Live Sessions
  db.prepare(`INSERT INTO LiveSessions (SessionId, CourseId, Title, FacultyName, StartsAt, EndsAt, Provider, ProviderSessionId, JoinUrl) VALUES (?, ?, ?, ?, ?, ?, 'Zoom', 'GEMS-BIO-101', 'https://zoom.us/j/90123456789')`)
    .run(uuid(), rpsc2ndCourseId, 'GEMS Live Marathon: Circulation & Nervous System PYQs', faculty1.name, isoOffset(5 * MIN), isoOffset(95 * MIN));
  db.prepare(`INSERT INTO LiveSessions (SessionId, CourseId, Title, FacultyName, StartsAt, EndsAt, Provider, ProviderSessionId, JoinUrl) VALUES (?, ?, ?, ?, ?, ?, 'Zoom', 'NEET-BIO-202', 'https://zoom.us/j/90123456789')`)
    .run(uuid(), neetCourseId, 'NCERT Line-by-Line Revision: Plant Physiology & Krebs Cycle', faculty1.name, isoOffset(30 * MIN), isoOffset(120 * MIN));
  db.prepare(`INSERT INTO LiveSessions (SessionId, CourseId, Title, FacultyName, StartsAt, EndsAt, Provider, ProviderSessionId, JoinUrl) VALUES (?, ?, ?, ?, ?, ?, 'GoogleMeet', 'RPSC-1ST-303', 'https://meet.google.com/abc-defg-hij')`)
    .run(uuid(), rpsc1stCourseId, 'Molecular Biology: DNA Polymerase I, II & III Doubt Session', faculty2.name, isoOffset(24 * 3600_000), isoOffset(26 * 3600_000));

  // Tests & Questions (Authentic @MUDGALBIOLOGY PYQs)
  const rpsc2ndTestId = uuid(), neetTestId = uuid(), rpsc1stTestId = uuid();
  db.prepare(`INSERT INTO Tests (TestId, CourseId, Title, Instructions, DurationSeconds, AllowReviewAfterSubmit, Status) VALUES (?, ?, ?, ?, 900, 1, 'Published')`)
    .run(rpsc2ndTestId, rpsc2ndCourseId, 'RPSC 2nd Grade Science: Graduation Biology Mock Test #01', 'RPSC Pattern: +2.0 marks for each correct answer, -0.50 negative marking for wrong answer.');
  db.prepare(`INSERT INTO Tests (TestId, CourseId, Title, Instructions, DurationSeconds, AllowReviewAfterSubmit, Status) VALUES (?, ?, ?, ?, 900, 1, 'Published')`)
    .run(neetTestId, neetCourseId, 'Mudgal Biology NEET Bio Mock Test #01', 'NEET Pattern: +4.0 marks for correct answer, -1.0 negative marking for wrong answer.');
  db.prepare(`INSERT INTO Tests (TestId, CourseId, Title, Instructions, DurationSeconds, AllowReviewAfterSubmit, Status) VALUES (?, ?, ?, ?, 1200, 1, 'Published')`)
    .run(rpsc1stTestId, rpsc1stCourseId, 'RPSC 1st Grade Biology: Genetics & Molecular PYQ Test #01', 'Each correct answer awards +2.0 marks. Negative marking is 0.66 marks per wrong answer.');

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

  addQuestion(rpsc2ndTestId, subPhysiology, 'Plant Physiology (RPSC 2018 PYQ)', 'In the Krebs cycle (TCA cycle), at which step is NADH NOT formed?', 'Succinate to Fumarate (catalyzed by succinate dehydrogenase) produces FADH2 instead of NADH.', 2, 0.5, 1, [
    ['Succinate to Fumarate', true], ['Isocitrate to alpha-Ketoglutarate', false], ['alpha-Ketoglutarate to Succinyl-CoA', false], ['Malate to Oxaloacetate', false]
  ]);
  addQuestion(rpsc2ndTestId, subGradBio, 'Molecular Biology (RPSC 2026 PYQ)', 'Which prokaryotic DNA polymerase primarily fills gaps after RNA primer removal (5\'→3\' exonuclease)?', 'DNA Polymerase I removes RNA primers using its 5\'→3\' exonuclease activity and fills the DNA gap; DNA Pol III is the main replicative enzyme.', 2, 0.5, 2, [
    ['DNA Polymerase I', true], ['DNA Polymerase II', false], ['DNA Polymerase III', false], ['RNA Primase', false]
  ]);
  addQuestion(rpsc2ndTestId, subGradBio, 'Graduation Biology', 'Which group of vertebrates possesses a 3-chambered heart (two atria, one ventricle) with mixed circulation?', 'Amphibians and most reptiles (except crocodilians) have a 3-chambered heart with incomplete double circulation.', 2, 0.5, 3, [
    ['Fishes', false], ['Amphibians', true], ['Birds', false], ['Mammals', false]
  ]);
  addQuestion(neetTestId, subBotany, 'Botany & Genetics', 'What is the classic Mendelian phenotypic ratio in the F2 generation of a dihybrid cross?', 'Independent assortment of two traits yields a 9 : 3 : 3 : 1 phenotypic ratio in F2.', 4, 1, 1, [
    ['9 : 3 : 3 : 1', true], ['3 : 1', false], ['1 : 2 : 1', false], ['9 : 7', false]
  ]);
  addQuestion(neetTestId, subPhysiology, 'Human Physiology', 'In a standard ECG, which wave represents ventricular depolarization?', 'The QRS complex represents depolarization of the ventricles, initiating ventricular systole.', 4, 1, 2, [
    ['P-wave', false], ['QRS complex', true], ['T-wave', false], ['PR interval', false]
  ]);
  addQuestion(rpsc1stTestId, subGenetics, 'Molecular Genetics', 'Which enzyme unwinds the DNA double helix ahead of the replication fork?', 'DNA Helicase breaks hydrogen bonds between complementary bases to separate the two strands.', 2, 0.66, 1, [
    ['DNA Ligase', false], ['DNA Helicase', true], ['DNA Topoisomerase', false], ['Reverse Transcriptase', false]
  ]);

  // Doubts, Community & Notifications
  const doubtId = uuid();
  db.prepare(`INSERT INTO Doubts (DoubtId, UserId, CourseId, Title, Text, Status, AssignedTo, CreatedAt) VALUES (?, ?, ?, ?, ?, 'Answered', ?, ?)`)
    .run(doubtId, student.id, rpsc2ndCourseId, 'Difference between Open & Closed Circulation in Invertebrates', 'Sir, does Annelida (Earthworm) have a closed circulatory system while Arthropoda has an open one?', faculty1.id, nowIso());
  db.prepare(`INSERT INTO DoubtReplies (ReplyId, DoubtId, AuthorUserId, Message, CreatedAt) VALUES (?, ?, ?, ?, ?)`)
    .run(uuid(), doubtId, faculty1.id, 'Bilkul sahi! Annelids (like Earthworm) have closed circulation, whereas Arthropods & most Molluscs have open circulation.', nowIso());

  const postId = uuid();
  db.prepare(`INSERT INTO CommunityPosts (PostId, UserId, CourseId, ExamId, Body, Status, CreatedAt) VALUES (?, ?, ?, ?, ?, 'Visible', ?)`)
    .run(postId, student.id, rpsc2ndCourseId, rpsc2nd.id, 'Completed Hemant Sir\'s Circulation in Vertebrates lecture today! Short notes + PYQs made it super easy.', nowIso());
  db.prepare(`INSERT INTO CommunityComments (CommentId, PostId, UserId, Body, Status, CreatedAt) VALUES (?, ?, ?, ?, 'Visible', ?)`)
    .run(uuid(), postId, faculty1.id, 'Shabash! Revise the Flashcards once and attempt RPSC 2nd Grade Mock Test #01.', nowIso());

  db.prepare(`INSERT INTO Notifications (NotificationId, UserId, Title, Body, Type, CreatedAt) VALUES (?, ?, ?, ?, 'LiveClass', ?)`)
    .run(uuid(), student.id, 'GEMS Live Class Starting Soon', "Hemant Mudgal's Circulation & Nervous System PYQ marathon starts shortly.", nowIso());
  db.prepare(`INSERT INTO Notifications (NotificationId, UserId, Title, Body, Type, CreatedAt) VALUES (?, ?, ?, ?, 'SystemAnnouncement', ?)`)
    .run(uuid(), student.id, 'Welcome to Mudgal Biology (@MUDGALBIOLOGY)', 'Har topic ko simple banake padhate hain! Your RPSC 2nd Grade & NEET Bio batches are ready.', nowIso());
}
