const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

// POST /api/messages - create a new chat message
// body: { userId?, userName?, message }
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const messageText = (body.message || '').toString().trim();
    if (!messageText) return res.status(400).json({ message: 'Message is required' });
    if (messageText.length > 2000) return res.status(400).json({ message: 'Message too long' });

    const doc = new Message({
      userId: body.userId || '',
      userName: body.userName || 'Guest',
      message: messageText,
    });
    await doc.save();
    return res.json({ message: 'Saved', data: doc });
  } catch (err) {
    console.error('POST /api/messages error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/messages - list recent messages (public)
// optional query: ?limit=100
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(1000, Math.max(20, Number(req.query.limit) || 200));
    const list = await Message.find().sort({ createdAt: -1 }).limit(limit).lean();
    // return in chronological order (oldest first)
    return res.json({ messages: list.reverse() });
  } catch (err) {
    console.error('GET /api/messages error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
