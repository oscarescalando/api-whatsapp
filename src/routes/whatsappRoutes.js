const express = require("express");
const router = express.Router();
const whatsappController = require("../controllers/whatsappController");

router.get("/whatsapp-qrcode/:deviceId?", whatsappController.getQRCode);
router.post("/disconnect/:deviceId", whatsappController.disconnect);
router.get("/devices-active", whatsappController.getActiveDevices);
router.post("/send-message/:deviceId", whatsappController.sendMessage);
router.get("/user-info/:deviceId", whatsappController.getUserInfo);

module.exports = router;
