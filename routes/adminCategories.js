// routes/adminCategories.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Category = require("../models/Category");

// GET /api/admin/categories
router.get("/", async (req, res, next) => {
  try {
    const list = await Category.find().sort({ name: 1 }).lean().exec();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/categories
router.post("/", async (req, res, next) => {
  try {
    const { name, description, active } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ message: "Name required" });
    const created = await Category.findOneAndUpdate(
      { name: String(name).trim() },
      { $setOnInsert: { name: String(name).trim(), description: description ?? "", active: active ?? true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean().exec();
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Category exists" });
    next(err);
  }
});

// PATCH /api/admin/categories/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = {};
    if ("name" in req.body) updates.name = String(req.body.name).trim();
    if ("description" in req.body) updates.description = req.body.description ?? "";
    if ("active" in req.body) updates.active = !!req.body.active;
    const updated = await Category.findByIdAndUpdate(id, { $set: updates }, { new: true }).lean().exec();
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/categories/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const removed = await Category.findByIdAndDelete(id).lean().exec();
    if (!removed) return res.status(404).json({ message: "Not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;