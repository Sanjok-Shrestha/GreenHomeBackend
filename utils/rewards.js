// utils/rewards.js
const REWARDS = [
  { id: "meal", title: "Free Meal", cost: 100, description: "Redeem 100 points for a free meal voucher." },
  { id: "helmet", title: "Free Helmet", cost: 500, description: "Redeem 500 points for a safety helmet." },
  { id: "voucher100", title: "₹100 Voucher", cost: 120, description: "Gift voucher worth ₹100 (redeem 120 points)." }
];

function findReward(id) {
  return REWARDS.find(r => r.id === id);
}

module.exports = { REWARDS, findReward };