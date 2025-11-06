// filepath: backend/models/User.js
const mongoose = require("mongoose");

const AccountDetailsSchema = new mongoose.Schema({
  holderName: { type: String },
  bankName: { type: String },
  accountNumber: { type: String },
  ifsc: { type: String },
  branch: { type: String },
  upiId: { type: String },
  addedAt: { type: Date, default: Date.now }
}, { _id: false });

const NotificationSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
  title: { type: String, required: true },
  body: { type: String },
  sessionId: { type: String },
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const TransferSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
  type: { type: String, enum: ['sent', 'received'], required: true },
  amount: { type: Number, required: true },
  fee: { type: Number, default: 0 },
  counterpartyId: { type: mongoose.Schema.Types.ObjectId },
  counterpartyUniqueId: { type: String },
  counterpartyName: { type: String },
  message: { type: String },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: false, index: true, unique: false }, // optional if you keep name-only flow
  password: { type: String, required: true },
  // password reset fields
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  // unique 5-digit ID generated at registration (optional for older users)
  uniqueId: { type: String, index: true, unique: true, sparse: true },
  wallet: { type: Number, default: 0 },
  // new: phone and photo
  phone: { type: String, trim: true, default: null }, // expect 10 digits
  photo: { type: String, default: null }, // path like /uploads/<filename>
  // notifications stored per-user (with _id and optional sessionId)
  notifications: { type: [NotificationSchema], default: [] },
  // bank/account details for payout
  accountDetails: { type: AccountDetailsSchema, default: null },
  // transfer history (recent transactions for this user)
  transfers: { type: [TransferSchema], default: [] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", UserSchema);