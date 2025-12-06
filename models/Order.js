
const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  mchOrderNo: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true }, // amount requested (in gateway currency units)
  status: { type: String, enum: ['PENDING','PAID','FAILED','CANCELLED'], default: 'PENDING' },
  gatewayOrderNo: { type: String, default: null }, // platform orderNo
  respData: { type: mongoose.Schema.Types.Mixed, default: {} }, // raw response json
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

OrderSchema.pre('save', function(next){ this.updatedAt = Date.now(); next(); });

module.exports = mongoose.model('Order', OrderSchema);
