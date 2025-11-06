const mongoose = require('mongoose');

const ReferralSchema = new mongoose.Schema({
  // the user who referred (if known)
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  // fallback uniqueId string for referrer (when lead created before referrer signed in)
  referrerUniqueId: { type: String, index: true },

  // the referred user (once they register)
  referred: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  referredUniqueId: { type: String, index: true },

  // lead/contact details
  name: { type: String, required: true },
  email: { type: String },
  phone: { type: String },

  // earnings amount for this referral (set by admin)
  amount: { type: Number, default: 0 },

  // status: inactive until admin activates
  status: { type: String, enum: ['inactive', 'active'], default: 'inactive' },

  createdAt: { type: Date, default: Date.now },
  activatedAt: { type: Date, default: null },
  adminNotes: { type: String, default: '' }
});

module.exports = mongoose.model('Referral', ReferralSchema);
