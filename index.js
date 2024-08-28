const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

const log = (pino = require("pino"));
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const express = require("express");
const app = express();
const qrcode = require("qrcode");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = require("http").createServer(app);

const MAX_DEVICES = 10;
let sockets = {};
let qrCallbacks = {};
let deviceCounter = 0;

const connectOrReconnect = async (deviceId) => {
  if (MAX_DEVICES <= deviceCounter) {
    return {
      error: "Se ha alcanzado el límite de dispositivos",
      status: 404,
    };
  }

  const sessionDir = `session_auth_info_${deviceId}`;

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    logger: log({ level: "silent" }),
  });

  return new Promise((resolve, reject) => {
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrCode = await qrcode.toDataURL(qr);
        if (qrCallbacks[deviceId]) {
          qrCallbacks[deviceId](qrCode);
        }
        resolve({ qrCode, deviceId });
      }

      if (connection === "close") {
        let reason = new Boom(lastDisconnect.error).output.statusCode;

        if (reason === DisconnectReason.connectionClosed) {
          console.log("Conexión cerrada, reconectando....");
          reConnectToWhatsApp(deviceId);
        } else if (reason === DisconnectReason.loggedOut) {
          console.log(
            `Dispositivo ${deviceId} desconectado por cierre de sesión.`
          );

          await fs.promises.rm(sessionDir, { recursive: true, force: true });
          console.log(
            "Sesión eliminada. Reiniciando proceso de conexión en 5 segundos..."
          );

          setTimeout(() => {
            console.log("Reiniciando proceso de conexión...");
            reConnectToWhatsApp(deviceId);
          }, 5000);
        } else if (reason === DisconnectReason.restartRequired) {
          console.log("Se requiere reinicio, reiniciando...");
          reConnectToWhatsApp(deviceId);
        } else if (reason === DisconnectReason.timedOut) {
          console.log("Se agotó el tiempo de conexión, conectando...");
          reConnectToWhatsApp(deviceId);
        } else {
          sock.end(
            `Motivo de desconexión desconocido: ${reason}|${lastDisconnect.error}`
          );
        }
      }

      if (connection === "open") {
        console.log(`Conexión abierta para el dispositivo ${deviceId}`);
        resolve({ message: "Conexión abierta", status: 200 });
        return;
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sockets[deviceId] = sock;
  });
};

const reConnectToWhatsApp = async (deviceId) => {
  return connectOrReconnect(deviceId);
};

const connectToWhatsApp = async () => {
  const deviceId = ++deviceCounter;
  return connectOrReconnect(deviceId);
};

app.get("/whatsapp-qrcode", async (req, res) => {
  try {
    const { qrCode, deviceId } = await connectToWhatsApp();
    res.status(200).json({ qrCode, deviceId, status: 200 });
  } catch (error) {
    console.error("Error al generar QR:", error);
    res.status(408).json({ error: error.message, status: 408 });
  }
});

app.post("/disconnect/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  const sock = sockets[deviceId];
  if (sock) {
    try {
      await sock.logout();
      delete sockets[deviceId];
      const sessionDir = `session_auth_info_${deviceId}`;
      await fs.promises.rm(sessionDir, { recursive: true, force: true });
      res.send({
        message: `El usuario ha sido desconectado y la sesión eliminada`,
        status: 200,
      });
    } catch (error) {
      res
        .status(500)
        .send(
          `Error al desconectar el dispositivo ${deviceId}: ${error.message}`
        );
    }
  } else {
    res.status(404).send(`Dispositivo ${deviceId} no encontrado`);
  }
});

app.get("/devices-active", (req, res) => {
  const dispositivosConectados = Object.entries(sockets)
    .filter(([_, sock]) => sock.user != null)
    .map(([deviceId, sock]) => ({
      deviceId,
      nombreUsuario: sock.user.name,
      idUsuario: sock.user.id,
    }));

  res.json({
    totalConectados: dispositivosConectados.length,
    dispositivos: dispositivosConectados,
  });
});

app.post("/send-message/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  const { numero, mensaje, imagen } = req.body;

  const sock = sockets[deviceId];
  if (!sock) {
    return res.status(404).json({
      error: `El ID del dispositivo no se encuentra registrado`,
      status: 404,
    });
  }

  if (!numero) {
    return res.status(404).json({
      error: `El número de teléfono es requerido`,
      status: 404,
    });
  }

  if (!mensaje && !imagen) {
    return res.status(404).json({
      error: `El mensaje o la imagen es requerido`,
      status: 404,
    });
  }

  try {
    const numeroWhatsApp = `${numero}@s.whatsapp.net`;

    if (imagen) {
      await sock.sendMessage(numeroWhatsApp, {
        image: { url: imagen },
        caption: mensaje || "",
      });
    } else {
      await sock.sendMessage(numeroWhatsApp, { text: mensaje });
    }

    res.json({ mensaje: "Mensaje enviado con éxito", status: 200 });
  } catch (error) {
    res.status(404).json({
      error: "Error al enviar el mensaje, El dispositivo no esta Vinculado",
      status: 404,
    });
  }
});

server.listen(8000, () => {
  console.log("Servidor ejecutándose en el puerto: " + 8000);
});
