import { Router } from "express";
import { container } from "tsyringe";
import multer from "multer";
import { ProfileController } from "./profile.controller";
import { authenticate } from "../../middleware/auth";
import { ServiceError } from "../../lib/service-error";

const router = Router();
const controller = container.resolve(ProfileController);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ServiceError("invalid_file_type", 400));
    }
  },
});

router.get("/", authenticate, controller.getProfile);
router.patch("/", authenticate, controller.updateProfile);
router.post("/image", authenticate, upload.single("image"), controller.uploadImage);
router.delete("/image", authenticate, controller.deleteImage);

export default router;
