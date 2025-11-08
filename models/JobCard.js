const mongoose = require('mongoose');

const JobCardSchema = new mongoose.Schema({
  title: { type: String, required: true },
  name: { type: String, required: true },
  summary: { type: String, required: true },
  details: { type: String, default: '' },
  imageUrl: { type: String, required: true },
  order: { type: Number, default: 0 },
  // optional stable identifier used on the frontend for routing (e.g., "data-entry")
  jobId: { type: String, default: '' },
  // optional custom navigation URL for Apply button (can be internal route or external URL)
  navigationLink: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('JobCard', JobCardSchema);
