const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const mongoose = require('mongoose');
const router = express.Router();
const Setting = require('../models/Setting');
const BankTransferRequest = require('../models/BankTransferRequest');
const Referral = require('../models/Referral');
const Contact = require('../models/Contact');
const Message = require('../models/Message');
const ExamCredential = require('../models/ExamCredential');
const ExamSession = require('../models/ExamSession');
const Question = require('../models/Question');
const JobCard = require('../models/JobCard');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// POST /api/admin/login
// body: { email, password }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return res.status(500).json({ message: 'Admin not configured' });
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) return res.status(401).json({ message: 'Invalid admin credentials' });

    const token = jwt.sign({ isAdmin: true, email }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// middleware to verify admin token
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.isAdmin) return res.status(403).json({ message: 'Forbidden' });
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// GET /api/admin/users - list all users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password -resetPasswordToken -resetPasswordExpires');
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/admin/users/:id - delete user
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await User.findByIdAndDelete(id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/admin/users/:id/notify - send a notification to a single user
// body: { title, body }
router.post('/users/:id/notify', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, body } = req.body;
    if (!title) return res.status(400).json({ message: 'Title is required' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
  const notif = { _id: new mongoose.Types.ObjectId(), title, body, createdAt: new Date(), read: false };
    user.notifications = user.notifications || [];
    user.notifications.push(notif);
    await user.save();
    return res.json({ message: 'Notification sent to user', notification: notif });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/admin/users/notifyAll - send a notification to all users
// body: { title, body }
router.post('/users/notifyAll', requireAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title) return res.status(400).json({ message: 'Title is required' });
    const users = await User.find();
    const results = [];
    for (const u of users) {
  const notif = { _id: new mongoose.Types.ObjectId(), title, body, createdAt: new Date(), read: false };
      u.notifications = u.notifications || [];
      u.notifications.push(notif);
      await u.save();
      results.push({ userId: u._id, notificationId: notif._id });
    }
    return res.json({ message: 'Notification sent to all users', results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/admin/users/notify-multiple - send a notification to multiple selected users
// body: { ids: [userId], title, body }
router.post('/users/notify-multiple', requireAdmin, async (req, res) => {
  try {
    const { ids, title, body } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'No user ids provided' });
    if (!title) return res.status(400).json({ message: 'Title required' });

  const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));
    const users = await User.find({ _id: { $in: objectIds } });

    const results = [];
    for (const u of users) {
      const notif = { _id: new mongoose.Types.ObjectId(), title, body, createdAt: new Date(), read: false };
      u.notifications = u.notifications || [];
      u.notifications.push(notif);
      await u.save();
      results.push({ userId: u._id, notificationId: notif._id });
    }

    return res.json({ message: 'Notifications sent to selected users', count: results.length, results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/admin/users/:id/notifications/:nid - delete a notification for a single user
router.delete('/users/:id/notifications/:nid', requireAdmin, async (req, res) => {
  try {
    const { id, nid } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.notifications = (user.notifications || []).filter(n => String(n._id) !== String(nid));
    await user.save();
    return res.json({ message: 'Notification removed from user' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Note: global-remove endpoint was removed — admins should remove per-user notifications only

// PUT /api/admin/users/:id/wallet - update wallet amount
// body: { wallet }
router.put('/users/:id/wallet', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { wallet } = req.body;
    if (typeof wallet !== 'number') return res.status(400).json({ message: 'Invalid wallet amount' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.wallet = wallet;
    await user.save();
    res.json({ message: 'Wallet updated', user: { id: user._id, wallet: user.wallet } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== Job Cards Management =====

// Public: GET /api/admin/job-cards - list all job cards (public for homepage)
// Adds idempotent seeding of 3 default cards if collection is empty so admin can edit them.
router.get('/job-cards', async (req, res) => {
  try {
    let count = await JobCard.estimatedDocumentCount();
    if (count === 0) {
      // Seed defaults ONLY when collection is empty. These are editable later by admin.
      // Assumption: original static homepage showed three feature areas; adjust copy/images later in admin.
          const defaults = [
            {
              title: 'Data Analytics',
              name: 'Data Analyst',
              jobId: 'data-analytics',
              summary: 'Analyze datasets, build dashboards, and generate insights to support business decisions.',
              details: 'Work with tools like Excel, SQL, and BI platforms to extract and visualize trends.',
              imageUrl: 'https://images.unsplash.com/photo-1551281044-8d8d0d8d0d56',
              order: 1,
            },
            {
              title: 'Data Entry',
              name: 'Data Entry Specialist',
              jobId: 'data-entry',
              summary: 'Digitize documents and maintain accurate records for organizations worldwide.',
              details: 'Focus on quality, speed, and accuracy to keep databases current and useful.',
              imageUrl: 'https://images.unsplash.com/photo-1581090700227-1e37b190418e',
              order: 2,
            },
            {
              title: 'Loan & Mortgage',
              name: 'Loan & Mortgage Processor',
              jobId: 'loan-mortgage',
              summary: 'Assist clients by processing loan applications and managing documentation.',
              details: 'Coordinate with lenders, verify details, and keep applicants informed.',
              imageUrl: 'https://assets-news.housing.com/news/wp-content/uploads/2020/12/23144314/What-is-a-mortgage-FB-1200x700-compressed.jpg',
              order: 3,
            },
          ];
          await JobCard.insertMany(defaults);
    }
    const cards = await JobCard.find().sort({ order: 1, createdAt: 1 }).lean();
    return res.json({ jobCards: cards, seeded: count === 0 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: POST /api/admin/job-cards - create a new job card
router.post('/job-cards', requireAdmin, async (req, res) => {
  try {
    const { title, name, summary, details, imageUrl, order, jobId, navigationLink } = req.body;
    if (!title || !name || !summary || !imageUrl) {
      return res.status(400).json({ message: 'title, name, summary, and imageUrl are required' });
    }
    // Basic validation: require http(s) URL for image
    if (typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) {
      return res.status(400).json({ message: 'imageUrl must be an http(s) URL' });
    }
    let cleanJobId = '';
    if (jobId) {
      if (typeof jobId !== 'string' || !/^[a-z0-9\-]{2,50}$/i.test(jobId)) {
        return res.status(400).json({ message: 'jobId must be 2-50 chars a-z0-9- only' });
      }
      cleanJobId = jobId.trim().toLowerCase();
    }
    let cleanNavLink = '';
    if (navigationLink) {
      if (typeof navigationLink !== 'string') {
        return res.status(400).json({ message: 'navigationLink must be a string' });
      }
      cleanNavLink = navigationLink.trim();
    }
    const card = new JobCard({ title, name, summary, details: details || '', imageUrl, order: order || 0, jobId: cleanJobId, navigationLink: cleanNavLink });
    await card.save();
    return res.json({ message: 'Job card created', jobCard: card });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: PUT /api/admin/job-cards/:id - update a job card
router.put('/job-cards/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, name, summary, details, imageUrl, order, jobId, navigationLink } = req.body;
    const card = await JobCard.findById(id);
    if (!card) return res.status(404).json({ message: 'Job card not found' });

    if (title !== undefined) card.title = title;
    if (name !== undefined) card.name = name;
    if (summary !== undefined) card.summary = summary;
    if (details !== undefined) card.details = details;
    if (imageUrl !== undefined) {
      if (typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) {
        return res.status(400).json({ message: 'imageUrl must be an http(s) URL' });
      }
      card.imageUrl = imageUrl;
    }
    if (order !== undefined) card.order = order;
    if (jobId !== undefined) {
      if (jobId === '' || jobId === null) {
        card.jobId = '';
      } else if (typeof jobId === 'string' && /^[a-z0-9\-]{2,50}$/i.test(jobId)) {
        card.jobId = jobId.trim().toLowerCase();
      } else {
        return res.status(400).json({ message: 'jobId must be 2-50 chars a-z0-9- only' });
      }
    }
    if (navigationLink !== undefined) {
      if (navigationLink === '' || navigationLink === null) {
        card.navigationLink = '';
      } else if (typeof navigationLink === 'string') {
        card.navigationLink = navigationLink.trim();
      } else {
        return res.status(400).json({ message: 'navigationLink must be a string' });
      }
    }

    await card.save();
    return res.json({ message: 'Job card updated', jobCard: card });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: DELETE /api/admin/job-cards/:id - delete a job card
router.delete('/job-cards/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await JobCard.findByIdAndDelete(id);
    return res.json({ message: 'Job card deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

// Public GET for settings (frontend reads minTransferAmount)
router.get('/settings', async (req, res) => {
  try {
    const s1 = await Setting.findOne({ key: 'minTransferAmount' });
    const s2 = await Setting.findOne({ key: 'minBankTransfer' });
    const s3 = await Setting.findOne({ key: 'examStartAt' });
    const s4 = await Setting.findOne({ key: 'homeHeroImageUrl' });
    const minTransferAmount = s1 ? s1.value : null;
    const minBankTransfer = s2 ? s2.value : null;
    const examStartAt = s3 ? s3.value : null;
    const homeHeroImageUrl = s4 ? s4.value : null;
    return res.json({ minTransferAmount, minBankTransfer, examStartAt, homeHeroImageUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: update settings
router.put('/settings', requireAdmin, async (req, res) => {
  try {
    const { minTransferAmount, minBankTransfer, homeHeroImageUrl } = req.body;
    const result = {};
    if (typeof minTransferAmount === 'number') {
      const s = await Setting.findOneAndUpdate({ key: 'minTransferAmount' }, { value: minTransferAmount }, { upsert: true, new: true });
      result.minTransferAmount = s.value;
    }
    if (typeof minBankTransfer === 'number') {
      const s2 = await Setting.findOneAndUpdate({ key: 'minBankTransfer' }, { value: minBankTransfer }, { upsert: true, new: true });
      result.minBankTransfer = s2.value;
    }
    // examStartAt may be provided as ISO string or null to clear
    if (req.body.hasOwnProperty('examStartAt')) {
      const v = req.body.examStartAt;
      if (v === null || v === '') {
        await Setting.findOneAndDelete({ key: 'examStartAt' });
        result.examStartAt = null;
      } else {
        const d = new Date(v);
        if (isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid examStartAt datetime' });
        const s3 = await Setting.findOneAndUpdate({ key: 'examStartAt' }, { value: d.toISOString() }, { upsert: true, new: true });
        result.examStartAt = s3.value;
      }
    }
    // homeHeroImageUrl can be string or null/empty to clear
    if (req.body.hasOwnProperty('homeHeroImageUrl')) {
      const val = req.body.homeHeroImageUrl;
      if (val === null || val === '') {
        await Setting.findOneAndDelete({ key: 'homeHeroImageUrl' });
        result.homeHeroImageUrl = null;
      } else {
        // Basic validation: require http(s) URL
        if (typeof val !== 'string' || !/^https?:\/\//i.test(val)) {
          return res.status(400).json({ message: 'homeHeroImageUrl must be an http(s) URL' });
        }
        const s4 = await Setting.findOneAndUpdate({ key: 'homeHeroImageUrl' }, { value: val.trim() }, { upsert: true, new: true });
        result.homeHeroImageUrl = s4.value;
      }
    }
    return res.json({ message: 'Updated', ...result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: list bank transfer requests
router.get('/transfer-requests', requireAdmin, async (req, res) => {
  try {
    const list = await BankTransferRequest.find().sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ requests: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: list referrals
router.get('/referrals', requireAdmin, async (req, res) => {
  try {
    let list = await Referral.find().sort({ createdAt: -1 }).limit(500).lean();

    // attach referrer/referred user info when possible
    const referredUniques = list.filter(r => (!r.referred || !r.referred.name) && r.referredUniqueId).map(r => r.referredUniqueId);
    const referrerUniques = list.filter(r => (!r.referrer || !r.referrer.name) && r.referrerUniqueId).map(r => r.referrerUniqueId);

    const uniqs = Array.from(new Set([...referredUniques, ...referrerUniques]));
    if (uniqs.length > 0) {
      const users = await User.find({ uniqueId: { $in: uniqs } }).select('name email phone uniqueId').lean();
      const byUnique = {};
      users.forEach(u => { byUnique[String(u.uniqueId)] = u; });
      list = list.map(r => {
        if ((!r.referred || !r.referred.name) && r.referredUniqueId && byUnique[r.referredUniqueId]) r.referred = byUnique[r.referredUniqueId];
        if ((!r.referrer || !r.referrer.name) && r.referrerUniqueId && byUnique[r.referrerUniqueId]) r.referrer = byUnique[r.referrerUniqueId];
        return r;
      });
    }

    return res.json({ referrals: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: update a referral (status, amount, notes)
router.post('/referrals/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, amount, adminNotes } = req.body;
    const ref = await Referral.findById(id);
    if (!ref) return res.status(404).json({ message: 'Referral not found' });

    const prevStatus = ref.status;
    const prevAmount = Number(ref.amount || 0);

    if (typeof amount === 'number') ref.amount = amount;
    if (adminNotes !== undefined) ref.adminNotes = adminNotes;
    if (status && ['active','inactive'].includes(status)) {
      ref.status = status;
      if (status === 'active' && !ref.activatedAt) ref.activatedAt = new Date();
      if (status === 'inactive') ref.activatedAt = null;
    }

    await ref.save();

    // handle wallet crediting/adjustment
    if (prevStatus !== 'active' && ref.status === 'active') {
      // newly activated -> credit referrer's wallet
      if (ref.referrer) {
        const referrer = await User.findById(ref.referrer);
        if (referrer) {
          referrer.wallet = (referrer.wallet || 0) + Number(ref.amount || 0);
          referrer.notifications = referrer.notifications || [];
          referrer.notifications.push({ _id: new mongoose.Types.ObjectId(), title: 'Referral activated', body: `Your referral ${ref.name || ref.referredUniqueId} is active. You earned ₹${Number(ref.amount||0).toFixed(2)}.`, createdAt: new Date(), read: false });
          await referrer.save();
        }
      }
    } else if (prevStatus === 'active' && ref.status === 'active' && Number(ref.amount || 0) !== prevAmount) {
      const diff = Number(ref.amount || 0) - prevAmount;
      if (diff !== 0 && ref.referrer) {
        const referrer = await User.findById(ref.referrer);
        if (referrer) {
          referrer.wallet = (referrer.wallet || 0) + diff;
          referrer.notifications = referrer.notifications || [];
          referrer.notifications.push({ _id: new mongoose.Types.ObjectId(), title: 'Referral earning updated', body: `Earning for ${ref.name || ref.referredUniqueId} updated by ₹${diff >= 0 ? '+' : ''}${diff.toFixed(2)}.`, createdAt: new Date(), read: false });
          await referrer.save();
        }
      }
    }

    const populated = await Referral.findById(ref._id).lean();
    return res.json({ message: 'Referral updated', referral: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: update a bank transfer request status
router.put('/transfer-requests/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // expected 'approved' or 'rejected'
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
    const doc = await BankTransferRequest.findById(id);
    if (!doc) return res.status(404).json({ message: 'Request not found' });
    doc.status = status;
    doc.processedAt = new Date();
    await doc.save();

    // notify user
    const user = await User.findById(doc.userId);
    if (user) {
      const notif = { _id: new mongoose.Types.ObjectId(), title: `Bank transfer ${status}`, body: `Your bank transfer request of ₹${doc.amount} was ${status}.`, createdAt: new Date(), read: false };
      user.notifications = user.notifications || [];
      user.notifications.push(notif);
      await user.save();
    }

    return res.json({ message: 'Updated', request: doc });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: list contact submissions
router.get('/contacts', requireAdmin, async (req, res) => {
  try {
    const list = await Contact.find().sort({ createdAt: -1 }).limit(1000).lean();
    return res.json({ contacts: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: delete a contact submission
router.delete('/contacts/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await Contact.findByIdAndDelete(id);
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: list chat messages
router.get('/messages', requireAdmin, async (req, res) => {
  try {
    const list = await Message.find().sort({ createdAt: -1 }).limit(2000).lean();
    return res.json({ messages: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: clear all chat messages
router.delete('/messages', requireAdmin, async (req, res) => {
  try {
    await Message.deleteMany({});
    return res.json({ message: 'Messages cleared' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: manage exam credentials


router.get('/exam-credentials', requireAdmin, async (req, res) => {
  try {
    const list = await ExamCredential.find().sort({ createdAt: -1 }).lean();
    return res.json({ credentials: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/exam-credentials/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await ExamCredential.findByIdAndDelete(id);
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: view exam results (sessions that have been completed)
router.get('/exam-results', requireAdmin, async (req, res) => {
  try {
    const list = await ExamSession.find().sort({ startedAt: -1 }).limit(2000).populate('credentialId', 'username label').lean();
    return res.json({ results: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: clear exam sessions (danger)
router.delete('/exam-results', requireAdmin, async (req, res) => {
  try {
    await ExamSession.deleteMany({});
    return res.json({ message: 'Exam sessions cleared' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: create exam credentials
router.post('/exam-credentials', requireAdmin, async (req, res) => {
  try {
    const { username, password, label } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'username and password required' });
    const existing = await ExamCredential.findOne({ username });
    if (existing) return res.status(400).json({ message: 'Credential with this username already exists' });

    const cred = new ExamCredential({ username, password, label });
    await cred.save();
    return res.json({ message: 'Created', credential: { id: cred._id, username: cred.username, label: cred.label } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: manage exam questions
// GET all questions
router.get('/exam-questions', requireAdmin, async (req, res) => {
  try {
    const list = await Question.find().sort({ createdAt: 1 }).lean();
    return res.json({ questions: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST create a question
router.post('/exam-questions', requireAdmin, async (req, res) => {
  try {
    const { text, choices, correctIndex } = req.body;
    if (!text || !Array.isArray(choices) || choices.length < 2) {
      return res.status(400).json({ message: 'text and at least 2 choices required' });
    }
    if (typeof correctIndex !== 'number' || correctIndex < 0 || correctIndex >= choices.length) {
      return res.status(400).json({ message: 'correctIndex must be valid' });
    }
    const q = new Question({ text, choices, correctIndex });
    await q.save();
    return res.json({ message: 'Question created', question: q });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// DELETE a question
router.delete('/exam-questions/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await Question.findByIdAndDelete(id);
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});
