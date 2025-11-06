const mongoose = require('mongoose');

const BankTransferRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  userName: { type: String },
  userUniqueId: { type: String },
  amount: { type: Number, required: true },
  fee: { type: Number, required: true }, // 5% cut
  netAmount: { type: Number, required: true },
  accountSnapshot: {
    holderName: String,
    bankName: String,
    accountNumber: String,
    ifsc: String,
    branch: String,
    upiId: String
  },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date }
});

module.exports = mongoose.model('BankTransferRequest', BankTransferRequestSchema);
