const WastePost = require("../models/WastePost");

// Post Waste
exports.createWastePost = async (req, res) => {
  try {
    const { wasteType, quantity } = req.body;

    // Simple pricing logic
    const pricePerKg = 20;
    const totalPrice = quantity * pricePerKg;

    const waste = await WastePost.create({
      user: req.user.id,
      wasteType,
      quantity,
      price: totalPrice,
    });

    res.status(201).json(waste);
  } catch (error) {
    res.status(500).json({ message: "Error creating waste post" });
  }
};

// Schedule Pickup
exports.schedulePickup = async (req, res) => {
  try {
    const { pickupDate } = req.body;

    const waste = await WastePost.findById(req.params.id);

    if (!waste)
      return res.status(404).json({ message: "Waste post not found" });

    waste.pickupDate = pickupDate;
    waste.status = "Scheduled";

    await waste.save();

    res.json({ message: "Pickup Scheduled", waste });
  } catch (error) {
    res.status(500).json({ message: "Error scheduling pickup" });
  }
};

// Get User Waste Posts
exports.getUserWastePosts = async (req, res) => {
  const wastes = await WastePost.find({ user: req.user.id });
  res.json(wastes);
};
