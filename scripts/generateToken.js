// scripts/generateToken.js
// Usage: node scripts/generateToken.js <userId> [role]
// Example: node scripts/generateToken.js 607d1f2b8f1b2c0012345678 user
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "SECRET_KEY";
const argv = process.argv.slice(2);
if (!argv[0]) {
  console.error("Usage: node scripts/generateToken.js <userId> [role]");
  process.exit(1);
}
const userId = argv[0];
const role = argv[1] || "user";

const payload = {
  id: userId,
  role,
  // optional: name/email
  name: "Dev User",
  iat: Math.floor(Date.now() / 1000),
};
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

console.log(token);