// routes/payment.js
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
// Ensure env vars are loaded in case this module is required directly
const dotenv = require('dotenv');
dotenv.config();
const {
  buildPaymentSignString,
  buildCallbackSignStringCallback,
  md5GbkHex
} = require('../utils/watchpay');
const Order = require('../models/Order');
const User = require('../models/User');
const mongoose = require('mongoose');

const {
  WATCHPAY_MERCHANT_ID,
  WATCHPAY_KEY,
  WATCHPAY_API_DOMAIN,
  WATCHPAY_PAY_TYPE = '101',
  WATCHPAY_VERSION = '1.0',
  WATCHPAY_NOTIFY_URL
} = process.env;

if (!WATCHPAY_MERCHANT_ID || !WATCHPAY_KEY || !WATCHPAY_API_DOMAIN || !WATCHPAY_NOTIFY_URL) {
  console.warn('WATCHPAY: Missing env variables.');
} else {
  console.log('WATCHPAY: using domain=', WATCHPAY_API_DOMAIN, 'mch=', WATCHPAY_MERCHANT_ID ? 'present' : 'missing');
}

// --------------------- Helper Functions -----------------------

function makeMchOrderNo() {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ORD${ts}${rand}`;
}

function fmtDate(d) {
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// --------------------- CREATE PAYMENT ORDER --------------------

router.post('/watchpay/create', async (req, res) => {
  try {
    let user = req.user || null;

    if (!user) {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ message: 'Unauthorized' });

      try {
        const jwt = require('jsonwebtoken');
        const payload = jwt.decode(token);
        if (payload && payload.id) user = await User.findById(payload.id);
      } catch (e) {}

      if (!user) return res.status(401).json({ message: 'Unauthorized' });
    }

    let { amount, amountNeeded, required } = req.body;
    const walletNow = typeof user.wallet === 'number' ? user.wallet : 0;

    if (!amount && amountNeeded) amount = Number(amountNeeded);
    if (!amount && required) amount = Math.max(0, Number(required) - walletNow);

    if (!amount || amount <= 0)
      return res.status(400).json({ message: 'Invalid amount' });

    const mchOrderNo = makeMchOrderNo();

    const order = new Order({
      mchOrderNo,
      user: user._id,
      amount,
      status: 'PENDING'
    });
    await order.save();

    // ------------- FIX APPLIED HERE (order_date generated internally) --------------

    const order_date = fmtDate(new Date());

    const params = {
      version: WATCHPAY_VERSION,
      goods_name: 'Wallet Recharge',
      mch_id: WATCHPAY_MERCHANT_ID,
      mch_order_no: mchOrderNo,
      notify_url: WATCHPAY_NOTIFY_URL,
      order_date,
      pay_type: WATCHPAY_PAY_TYPE,
      trade_amount: String(amount)
    };

    // Build sign
    const signSource = buildPaymentSignString(params);
    const sign = md5GbkHex(signSource, WATCHPAY_KEY);

    // Raw body, not URL encoded
    const rawBody =
      `goods_name=${params.goods_name}` +
      `&mch_id=${params.mch_id}` +
      `&mch_order_no=${params.mch_order_no}` +
      `&notify_url=${params.notify_url}` +
      `&order_date=${params.order_date}` +
      `&pay_type=${params.pay_type}` +
      `&trade_amount=${params.trade_amount}` +
      `&version=${params.version}` +
      `&sign_type=MD5` +
      `&sign=${sign}`;

    const gatewayDomain = (WATCHPAY_API_DOMAIN || 'https://api.watchglb.com');
    const gatewayUrl = `${gatewayDomain.replace(/\/$/, '')}/pay/web`;

    const gwResp = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0'
      },
      body: rawBody
    });

    const text = await gwResp.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    order.respData = parsed || text;
    await order.save();

    if (parsed && parsed.respCode === 'SUCCESS') {
      return res.json({
        ok: true,
        payInfo: parsed.payInfo || null,
        orderId: order._id,
        raw: parsed
      });
    }

    return res.json({ ok: true, html: text, orderId: order._id });

  } catch (err) {
    console.error('watchpay create error', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// --------------------- CALLBACK --------------------

router.post('/watchpay/callback', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const body = req.body || {};

    const signSource = buildCallbackSignStringCallback(body);
    const expected = md5GbkHex(signSource, WATCHPAY_KEY);
    const incoming = (body.sign || '').toLowerCase();

    if (expected !== incoming) {
      console.warn('Callback signature mismatch', { expected, incoming });
      return res.status(400).send('Signature error');
    }

    const mchOrderNo = body.mchOrderNo || body.mch_order_no;
    const tradeResult = String(body.tradeResult || '0');
    const oriAmount = Number(body.oriAmount || body.tradeAmount || 0);

    const order = await Order.findOne({ mchOrderNo });
    if (!order) return res.status(404).send('Order not found');

    if (order.status === 'PAID') return res.send('success');

    if (tradeResult === '1') {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();

        const user = await User.findById(order.user).session(session);
        const add = oriAmount || order.amount;

        user.wallet = (user.wallet || 0) + add;
        await user.save({ session });

        order.status = 'PAID';
        order.gatewayOrderNo = body.orderNo || null;
        order.respData = body;
        await order.save({ session });

        await session.commitTransaction();
      } catch (e) {
        await session.abortTransaction();
        console.error('Callback processing failed', e);
        return res.status(500).send('Server error');
      } finally {
        session.endSession();
      }

      return res.send('success');
    }

    order.status = 'FAILED';
    order.respData = body;
    await order.save();
    return res.send('success');

  } catch (err) {
    console.error('watchpay callback error', err);
    res.status(500).send('Server error');
  }
});

// --------------------- ORDER STATUS --------------------

router.get('/watchpay/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    return res.json({ ok: true, status: order.status, order });
  } catch (err) {
    console.error('watchpay status error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
