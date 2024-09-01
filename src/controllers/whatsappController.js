const whatsappService = require("../services/whatsappService");

exports.getQRCode = async (req, res) => {
  const { deviceId } = req.params;
  const userID = deviceId || whatsappService.generateUniqueDeviceID();
  try {
    const result = await whatsappService.connectOrReconnect(userID);
    res.send(result);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error al iniciar la conexión" });
  }
};

exports.disconnect = async (req, res) => {
  const { deviceId } = req.params;
  try {
    const result = await whatsappService.disconnectDevice(deviceId);
    res.send(result);
  } catch (error) {
    res.status(500).json({
      message: `Error al desconectar el dispositivo ${deviceId}, usuario no encontrado o no esta vinculado`,
      status: 404,
    });
  }
};

exports.getActiveDevices = async (req, res) => {
  try {
    const devices = await whatsappService.getActiveDevices();
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener dispositivos activos" });
  }
};

exports.sendMessage = async (req, res) => {
  const { deviceId } = req.params;
  const { numero, mensaje, imagen } = req.body;
  try {
    const result = await whatsappService.sendMessage(
      deviceId,
      numero,
      mensaje,
      imagen
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getUserInfo = async (req, res) => {
  const { deviceId } = req.params;
  try {
    const userInfo = await whatsappService.getUserInfo(deviceId);
    res.json(userInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
