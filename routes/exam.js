const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const ExamCredential = require('../models/ExamCredential');
const ExamSession = require('../models/ExamSession');
const Question = require('../models/Question');
const Setting = require('../models/Setting');

// fallback sample questions in case DB is empty
const SAMPLE_QUESTIONS = Array.from({ length: 40 }).map((_, i) => ({
  id: i + 1,
  text: `Sample question ${i + 1}: What is ${i + 1} + ${i + 2}?`,
  choices: [String(i + 1), String(i + 2), String((i + 1) + (i + 2)), String((i + 1) * (i + 2))],
  correctIndex: 2
}));

const EXAM_DURATION_MS = 20 * 60 * 1000; // 20 minutes

// POST /api/exam/login { username, password }
// If credentials valid, create a session and return token + session info + questions
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'username and password required' });
    const cred = await ExamCredential.findOne({ username }).lean();
      if (!cred || cred.password !== password) return res.status(401).json({ message: 'Invalid credentials' });

      // Global examStartAt (if set) overrides per-credential scheduling
      try {
        const s = await Setting.findOne({ key: 'examStartAt' });
        if (s && s.value) {
          const globalStart = new Date(s.value);
          if (!isNaN(globalStart.getTime())) {
            const now = new Date();
            if (now < globalStart) return res.status(403).json({ message: 'Exam not started yet', startAt: globalStart.toISOString() });
          }
        }
      } catch (e) {
        // ignore setting fetch errors and continue to credential-level check
      }

      // per-credential scheduling removed: global examStartAt controls availability

    // create session
    const token = crypto.randomBytes(18).toString('hex');
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + EXAM_DURATION_MS);
    const session = new ExamSession({ credentialId: cred._id, sessionToken: token, startedAt, expiresAt, clientIp: req.ip });
    await session.save();

    // fetch 40 questions from DB or fallback to SAMPLE_QUESTIONS
    const dbCount = await Question.countDocuments();
    let questions = [];
    if (dbCount >= 40) {
      // pick latest 40 (or randomize if desired)
      questions = await Question.find().sort({ createdAt: 1 }).limit(40).lean();
    } else if (dbCount > 0) {
      questions = await Question.find().sort({ createdAt: 1 }).limit(40).lean();
    } else {
      questions = SAMPLE_QUESTIONS.map((q, idx) => ({ id: idx + 1, text: q.text, choices: q.choices }));
    }

  const stripped = questions.map((q, idx) => ({ id: q._id || idx + 1, q: q.text || q.text, choices: q.choices }));
  return res.json({ sessionToken: token, startedAt, expiresAt, questions: stripped });
  } catch (err) {
    console.error('POST /api/exam/login', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Public endpoint: GET /api/exam/start -> returns global examStartAt if set
router.get('/start', async (req, res) => {
  try {
    const s = await Setting.findOne({ key: 'examStartAt' });
    const startAt = s && s.value ? s.value : null;
    return res.json({ startAt });
  } catch (err) {
    console.error('/api/exam/start', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/exam/session/:token - validate and return session info + questions
router.get('/session/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ message: 'token required' });
    const s = await ExamSession.findOne({ sessionToken: token });
    if (!s) return res.status(404).json({ message: 'Session not found' });
    // fetch questions used for this exam from DB or fallback
    const dbCount = await Question.countDocuments();
    let questions = [];
    if (dbCount > 0) {
      questions = await Question.find().sort({ createdAt: 1 }).limit(40).lean();
      questions = questions.map((q) => ({ id: q._id, q: q.text, choices: q.choices }));
    } else {
      questions = SAMPLE_QUESTIONS.map((q, idx) => ({ id: idx + 1, q: q.text, choices: q.choices }));
    }
    return res.json({ session: { startedAt: s.startedAt, expiresAt: s.expiresAt, completed: s.completed }, questions });
  } catch (err) {
    console.error('GET /api/exam/session/:token', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/exam/submit { sessionToken, answers: [{ qIndex, choiceIndex }] }
router.post('/submit', async (req, res) => {
  try {
    const { sessionToken, answers } = req.body || {};
    if (!sessionToken) return res.status(400).json({ message: 'sessionToken required' });
    const s = await ExamSession.findOne({ sessionToken });
    if (!s) return res.status(404).json({ message: 'Session not found' });
    if (s.completed) return res.status(400).json({ message: 'Session already submitted' });

    const now = new Date();
    // allow submission if not yet expired; if expired, mark completed but still accept answers (auto-submission logic may call this)
    if (s.expiresAt && now > s.expiresAt) {
      // continue and grade whatever answers provided
    }

    const parsedAnswers = Array.isArray(answers) ? answers : [];
    // compute score using DB questions
    let score = 0;
    // fetch questions map
    const dbQuestions = await Question.find().sort({ createdAt: 1 }).limit(40).lean();
    parsedAnswers.forEach((a) => {
      const qi = Number(a.qIndex) - 1;
      const choice = Number(a.choiceIndex);
      const q = dbQuestions[qi] || SAMPLE_QUESTIONS[qi];
      const correct = q ? (q.correctIndex ?? q.correctIndex) : null;
      if (correct !== null && Number(correct) === choice) score += 1;
    });

    s.answers = parsedAnswers.map(a => ({ qIndex: a.qIndex, choice: a.choiceIndex }));
    s.score = score;
    s.completed = true;
    await s.save();

    const total = Math.max(40, dbQuestions.length || SAMPLE_QUESTIONS.length);
    return res.json({ message: 'Submitted', score, total });
  } catch (err) {
    console.error('POST /api/exam/submit', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
