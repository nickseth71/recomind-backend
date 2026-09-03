import mongoose from "mongoose"

const tokenReservationSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    key: { type: String, required: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["reserved", "processing", "completed", "refunded"],
      default: "reserved",
    },
    simulationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PromptSimulation",
      default: null,
    },
  },
  { timestamps: true },
)
tokenReservationSchema.index({ storeId: 1, key: 1 }, { unique: true })
export default mongoose.model("TokenReservation", tokenReservationSchema)
