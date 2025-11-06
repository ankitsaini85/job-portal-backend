const express = require('express');
const Referral = require('../models/Referral');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// POST /api/referral/register
// body: { name, email, phone, referrerUniqueId }
// POST /api/referral/register
// body: { name, email, phone, referrerUniqueId }
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, referrerUniqueId } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });

    const rdata = { name, email, phone, referrerUniqueId };
    // if referrerUniqueId corresponds to a user, store referrer ObjectId too
    if (referrerUniqueId) {
      try {
        const refUser = await User.findOne({ uniqueId: String(referrerUniqueId) }).select('_id uniqueId').lean();
        if (refUser) rdata.referrer = refUser._id;
      } catch (e) { /* ignore */ }
    }

    // try to reuse existing lead for same referrer + email/phone to avoid duplicates
    let r;
    try {
      const matchClauses = [];
      if (email) matchClauses.push({ email });
      if (phone) matchClauses.push({ phone });
      if (matchClauses.length > 0) {
        const existing = await Referral.findOne({ referrerUniqueId: String(referrerUniqueId || ''), $or: matchClauses });
        if (existing) {
          existing.name = existing.name || name;
          existing.email = existing.email || email;
          existing.phone = existing.phone || phone;
          if (rdata.referrer) existing.referrer = rdata.referrer;
          await existing.save();
          r = existing;
        }
      }
    } catch (e) {
      console.error('Referral register match error', e);
    }

    if (!r) {
      r = new Referral(rdata);
      await r.save();
    }

    // If this contact already has a user account (signed up earlier), link referred -> user
    try {
      if ((!r.referred || !r.referred.toString) && (email || phone)) {
        const userQuery = {};
        if (email) userQuery.email = email;
        if (phone) userQuery.phone = phone;
        const foundUser = await User.findOne(userQuery).select('_id uniqueId').lean();
        if (foundUser) {
          r.referred = foundUser._id;
          r.referredUniqueId = String(foundUser.uniqueId);
          await r.save();
        }
      }
    } catch (e) {
      console.error('Referral register: error linking existing user', e);
    }

    return res.json({ message: 'Registered', referral: r });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/referral/my - referrals for current logged-in referrer
router.get('/my', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }
    const userId = decoded.id;
    const currentUser = await User.findById(userId).select('uniqueId').lean();
    const uniqueId = currentUser?.uniqueId ? String(currentUser.uniqueId) : null;

    const orClauses = [{ referrer: userId }];
    if (uniqueId) orClauses.push({ referrerUniqueId: uniqueId });

    let list = await Referral.find({ $or: orClauses }).populate('referred', 'name email uniqueId phone').sort({ createdAt: -1 }).lean();

    // attach referred user info when missing
    const missing = list.filter(r => (!r.referred || !r.referred.name) && r.referredUniqueId).map(r => r.referredUniqueId);
    if (missing.length > 0) {
      const users = await User.find({ uniqueId: { $in: missing } }).select('name email phone uniqueId').lean();
      const byUnique = {};
      users.forEach(u => { byUnique[String(u.uniqueId)] = u; });
      list = list.map(r => {
        if ((!r.referred || !r.referred.name) && r.referredUniqueId && byUnique[r.referredUniqueId]) {
          r.referred = byUnique[r.referredUniqueId];
        }
        return r;
      });
    }

    const total = list.reduce((s, r) => s + (r.status === 'active' ? Number(r.amount || 0) : 0), 0);
    return res.json({ referrals: list, total });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
