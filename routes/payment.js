const express = require('express');

// Placeholder payment router: Stripe implementation removed.
// WatchPay integration will replace these endpoints under /api/payment/watchpay.
// Keeping this file (with non-Stripe handlers) avoids startup errors until WatchPay is added.

const router = express.Router();

// Basic health endpoint for payment subsystem
router.get('/status', (req, res) => {
  return res.json({ status: 'disabled', message: 'Stripe removed. WatchPay integration pending.' });
});

// Create payment (placeholder)
router.post('/create', (req, res) => {
  return res.status(501).json({ message: 'Payment provider not configured. WatchPay integration pending.' });
});

// Verify payment (placeholder)
router.post('/verify', (req, res) => {
  return res.status(501).json({ message: 'Payment provider not configured. WatchPay integration pending.' });
});

module.exports = router;
