// filepath: backend/routes/auth.js
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { sendEmail } = require("../utils/email");
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const SALT_ROUNDS = 10;
const RESET_TOKEN_EXPIRY_MINUTES = Number(process.env.RESET_TOKEN_EXPIRY_MINUTES || 60);

// ensure uploads dir exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random()*1e6)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// helper: generate a unique 5-digit string id
async function generateUniqueFiveDigitId() {
  for (let i = 0; i < 8; i++) {
    const code = String(Math.floor(10000 + Math.random() * 90000)); // 10000..99999
    const existing = await User.findOne({ uniqueId: code }).lean();
    if (!existing) return code;
  }
  // fallback to last-5 of timestamp
  return String(Date.now()).slice(-5);
}

// POST /api/auth/signup - accepts multipart/form-data with optional 'photo' file
router.post("/signup", upload.single('photo'), async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !password) return res.status(400).json({ message: "Name and password required" });

    if (phone && !/^\d{10}$/.test(phone)) return res.status(400).json({ message: 'Phone must be 10 digits' });

    const existing = email ? await User.findOne({ email }) : null;
    if (existing) return res.status(400).json({ message: "User already exists with that email" });

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const uniqueId = await generateUniqueFiveDigitId();
    const photoPath = req.file ? `/uploads/${req.file.filename}` : null;
    const user = new User({ name, email, password: hashed, uniqueId, phone: phone || null, photo: photoPath });
    await user.save();

    // if signup carried a ref param (either body or query), or if there are existing leads matching this email/phone,
    // link them to this newly created user
    try {
      const Referral = require('../models/Referral');
      const refParam = req.body.ref || req.query.ref || req.headers['x-referral'];

      // find candidate leads by either the referrerUniqueId (if provided) OR by matching contact details
      const queryClauses = [];
      if (refParam) queryClauses.push({ referrerUniqueId: String(refParam) });
      if (user.email) queryClauses.push({ email: user.email });
      if (user.phone) queryClauses.push({ phone: user.phone });

      if (queryClauses.length > 0) {
        // find all candidate referral docs that might correspond to this user
        const candidates = await Referral.find({ $or: queryClauses });
        const referrer = refParam ? await User.findOne({ uniqueId: String(refParam) }).select('_id uniqueId').lean() : null;
        for (const c of candidates) {
          c.referred = user._id;
          c.referredUniqueId = user.uniqueId;
          if (referrer) c.referrer = referrer._id;
          await c.save();
        }
      }
    } catch (e) {
      console.error('Failed to record referral linkage', e);
    }

    const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, photo: user.photo, wallet: user.wallet, uniqueId: user.uniqueId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, name, password } = req.body;
    // try find by email if provided otherwise by name
    const query = email ? { email } : { name };
    const user = await User.findOne(query);
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid credentials" });

  const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, photo: user.photo, wallet: user.wallet, uniqueId: user.uniqueId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/forgot
// body: { email }
router.post("/forgot", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email });

    // Always respond with a generic message to avoid account enumeration
    const genericRes = { message: "If an account with that email exists, you will receive password reset instructions." };

    if (!user) {
      // don't reveal that the email doesn't exist
      return res.json(genericRes);
    }

    // generate raw token and hashed token to store
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(rawToken).digest("hex");

    user.resetPasswordToken = hash;
    user.resetPasswordExpires = Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000;
    await user.save();

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}&id=${user._id}`;

    // send email (best-effort)
    try {
      const html = `<p>You requested a password reset. Click the link below to reset your password (valid for ${RESET_TOKEN_EXPIRY_MINUTES} minutes):</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>`;
      await sendEmail(user.email, 'Password reset instructions', html);
    } catch (err) {
      console.error('Failed to send reset email', err.message || err);
      // continue - we still return generic response
    }

    return res.json(genericRes);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/reset
// body: { id, token, password }
router.post("/reset", async (req, res) => {
  try {
    const { id, token, password } = req.body;
    if (!id || !token || !password) return res.status(400).json({ message: "Missing parameters" });

    const hash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({ _id: id, resetPasswordToken: hash, resetPasswordExpires: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ message: "Invalid or expired token" });

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    user.password = hashed;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Optionally send a confirmation email
    try {
      await sendEmail(user.email, 'Your password has been changed', '<p>Your password was successfully changed. If you did not perform this action, contact support immediately.</p>');
    } catch (err) {
      console.error('Failed to send confirmation email', err.message || err);
    }

    return res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;

// GET /api/auth/me - return current user (requires Authorization: Bearer <token>)
// This is added so frontends can fetch latest user info (including wallet)
router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    const user = await User.findById(decoded.id).select('-password -resetPasswordToken -resetPasswordExpires');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/notifications - return current user's notifications
router.get('/notifications', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    const user = await User.findById(decoded.id).select('notifications');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ notifications: user.notifications || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/notifications/:nid - delete a notification for the current user
router.delete('/notifications/:nid', async (req, res) => {
  try {
    const { nid } = req.params;
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.notifications = (user.notifications || []).filter(n => String(n._id) !== String(nid));
    await user.save();
    return res.json({ message: 'Notification removed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/notifications/:nid/read - mark a single notification as read for current user
router.put('/notifications/:nid/read', async (req, res) => {
  try {
    const { nid } = req.params;
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    let changed = false;
    user.notifications = (user.notifications || []).map(n => {
      if (String(n._id) === String(nid)) { changed = true; n.read = true; }
      return n;
    });
    if (changed) await user.save();
    return res.json({ message: 'Marked read' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/notifications/markAllRead - mark all notifications as read for current user
router.post('/notifications/markAllRead', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    let changed = false;
    user.notifications = (user.notifications || []).map(n => { if (!n.read) { changed = true; n.read = true; } return n; });
    if (changed) await user.save();
    return res.json({ message: 'All marked read' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// --- Account details endpoints ---
// GET /api/auth/account - return current user's account details
router.get('/account', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }
    const user = await User.findById(decoded.id).select('accountDetails');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ accountDetails: user.accountDetails || null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/account - add account details (if none)
router.post('/account', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }

    const { holderName, bankName, accountNumber, ifsc, branch, upiId } = req.body;
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.accountDetails) return res.status(400).json({ message: 'Account details already exist. Use update.' });

    user.accountDetails = { holderName, bankName, accountNumber, ifsc, branch, upiId, addedAt: new Date() };
    await user.save();
    return res.json({ message: 'Account details added', accountDetails: user.accountDetails });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/auth/account - update existing account details
router.put('/account', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }

    const { holderName, bankName, accountNumber, ifsc, branch, upiId } = req.body;
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.accountDetails = {
      holderName: holderName ?? user.accountDetails?.holderName,
      bankName: bankName ?? user.accountDetails?.bankName,
      accountNumber: accountNumber ?? user.accountDetails?.accountNumber,
      ifsc: ifsc ?? user.accountDetails?.ifsc,
      branch: branch ?? user.accountDetails?.branch,
      upiId: upiId ?? user.accountDetails?.upiId,
      addedAt: user.accountDetails?.addedAt || new Date()
    };
    await user.save();
    return res.json({ message: 'Account details updated', accountDetails: user.accountDetails });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});