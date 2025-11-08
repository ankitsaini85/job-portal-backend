const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');

// Public: create a contact lead from home page
// POST /api/contact
// body: { name, email, phone, message }
router.post('/', async (req, res) => {
  try {
    console.log('Contact POST received:', { url: req.originalUrl, ip: req.ip || req.connection?.remoteAddress, headers: req.headers });
    // show body for debugging (may be empty if body-parsing middleware didn't run)
    console.log('Contact body (raw parsed):', req.body);
    // guard against missing body (some clients may not send JSON or middleware not applied)
    const body = req.body || {};
    const name = body.name;
    const email = body.email;
    const phone = body.phone;
    const message = body.message;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const doc = new Contact({ name: name.trim(), email: email || '', phone: phone || '', message: message || '' });
    await doc.save();
    return res.json({ message: 'Saved', contact: doc });
  } catch (err) {
    console.error('Contact route error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
