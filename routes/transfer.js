const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Setting = require('../models/Setting');
const BankTransferRequest = require('../models/BankTransferRequest');
const mongoose = require('mongoose');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// POST /api/transfer - body: { toUniqueId, amount, message }
router.post('/', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }
    const fromId = decoded.id;
    const { toUniqueId, amount, message } = req.body;
    if (!toUniqueId || typeof toUniqueId !== 'string' || toUniqueId.length !== 5) return res.status(400).json({ message: 'Invalid recipient id' });
    const amt = Number(amount);
    if (Number.isNaN(amt) || amt <= 0) return res.status(400).json({ message: 'Invalid amount' });

    // fetch minimum amount from settings (default 100)
    const s = await Setting.findOne({ key: 'minTransferAmount' });
    const minTransfer = (s && typeof s.value === 'number') ? s.value : 100;
    if (amt < minTransfer) return res.status(400).json({ message: `Minimum transfer amount is ${minTransfer}` });

    // 2% convenience fee applied to sender (rounded to 2 decimals)
    const fee = Math.round((amt * 0.02) * 100) / 100;

    // find recipient
    const toUser = await User.findOne({ uniqueId: toUniqueId });
    if (!toUser) return res.status(404).json({ message: 'Recipient ID not found' });

    // load sender
    const fromUser = await User.findById(fromId);
    if (!fromUser) return res.status(404).json({ message: 'Sender not found' });

    const totalDebit = Math.round((amt + fee) * 100) / 100;
    if ((fromUser.wallet || 0) < totalDebit) return res.status(400).json({ message: 'Insufficient wallet balance' });

    // perform transfer (simple, not multi-document transaction)
    fromUser.wallet = Math.round(((fromUser.wallet || 0) - totalDebit) * 100) / 100;
    toUser.wallet = Math.round(((toUser.wallet || 0) + amt) * 100) / 100;

    // notifications
    const notifTo = { _id: new mongoose.Types.ObjectId(), title: 'Wallet credited', body: `You received ₹${amt} from ${fromUser.name}.`, createdAt: new Date(), read: false };
    const notifFrom = { _id: new mongoose.Types.ObjectId(), title: 'Wallet debited', body: `You sent ₹${amt} (fee ₹${fee}). New balance: ₹${fromUser.wallet}`, createdAt: new Date(), read: false };
    toUser.notifications = toUser.notifications || [];
    fromUser.notifications = fromUser.notifications || [];
    toUser.notifications.push(notifTo);
    fromUser.notifications.push(notifFrom);

    // record transfers in each user's transfers array
    const sentRecord = {
      _id: new mongoose.Types.ObjectId(),
      type: 'sent',
      amount: amt,
      fee,
      counterpartyId: toUser._id,
      counterpartyUniqueId: toUser.uniqueId,
      counterpartyName: toUser.name,
      message: message || '',
      createdAt: new Date()
    };
    const receivedRecord = {
      _id: new mongoose.Types.ObjectId(),
      type: 'received',
      amount: amt,
      fee: 0,
      counterpartyId: fromUser._id,
      counterpartyUniqueId: fromUser.uniqueId,
      counterpartyName: fromUser.name,
      message: message || '',
      createdAt: new Date()
    };
    fromUser.transfers = fromUser.transfers || [];
    toUser.transfers = toUser.transfers || [];
    // push newest first
    fromUser.transfers.unshift(sentRecord);
    toUser.transfers.unshift(receivedRecord);

  await toUser.save();
  await fromUser.save();
  return res.json({ message: 'Transfer successful', from: { id: fromUser._id, wallet: fromUser.wallet }, to: { id: toUser._id, wallet: toUser.wallet }, fee, totalDebit });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/transfer/history - get transfer history for current user
router.get('/history', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }
    const userId = decoded.id;
    const user = await User.findById(userId).select('transfers');
    if (!user) return res.status(404).json({ message: 'User not found' });
    // return most recent 50 transfers
    const transfers = (user.transfers || []).slice(0, 50);
    return res.json({ transfers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/transfer/bank-request - request a bank transfer (admin will process)

router.post('/bank-request', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
    const token = auth.split(' ')[1];
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }
    const userId = decoded.id;
    const { amount } = req.body;
    const amt = Number(amount);
    if (Number.isNaN(amt) || amt <= 0) return res.status(400).json({ message: 'Invalid amount' });

    // fetch min bank transfer amount from settings (default 500)
    const s = await Setting.findOne({ key: 'minBankTransfer' });
    const minBank = (s && typeof s.value === 'number') ? s.value : 500;
    if (amt < minBank) return res.status(400).json({ message: `Minimum bank transfer amount is ${minBank}` });

    // 5% fee/cut
    const fee = Math.round((amt * 0.05) * 100) / 100;
    const net = Math.round((amt - fee) * 100) / 100;

    // load user and account details snapshot
    const user = await User.findById(userId).select('name uniqueId accountDetails');
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.accountDetails) return res.status(400).json({ message: 'No account details on file. Please add account details first.' });

    const snapshot = {
      holderName: user.accountDetails.holderName,
      bankName: user.accountDetails.bankName,
      accountNumber: user.accountDetails.accountNumber,
      ifsc: user.accountDetails.ifsc,
      branch: user.accountDetails.branch,
      upiId: user.accountDetails.upiId
    };

    const reqDoc = new BankTransferRequest({
      userId: user._id,
      userName: user.name,
      userUniqueId: user.uniqueId,
      amount: amt,
      fee,
      netAmount: net,
      accountSnapshot: snapshot,
      status: 'pending'
    });

    await reqDoc.save();

    // push a notification to user
    const notif = { _id: new mongoose.Types.ObjectId(), title: 'Bank transfer requested', body: `Your bank transfer request of ₹${amt} has been submitted and is pending admin approval. Fee: ₹${fee}`, createdAt: new Date(), read: false };
    const u = await User.findById(userId);
    u.notifications = u.notifications || [];
    u.notifications.push(notif);
    await u.save();

    return res.json({ message: 'Bank transfer request created', requestId: reqDoc._id, amount: amt, fee, net });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
