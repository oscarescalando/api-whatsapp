const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  downloadContentFromMessage,
} = require("@whiskeysockets/baileys");

const log = (pino = require("pino"));
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const express = require("express");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = require("http").createServer(app);

const MAX_DEVICES = 5;
let sockets = {};

const connectToWhatsApp = async (deviceId) => {
  const sessionDir = `session_auth_info_${deviceId}`;
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: log({ level: "silent" }),
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect.error).output.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(
          `Sesión incorrecta, por favor elimine ${sessionDir} y escanee de nuevo`
        );
        sock.logout();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Conexión cerrada, reconectando....");
        connectToWhatsApp(deviceId);
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Conexión perdida del servidor, reconectando...");
        connectToWhatsApp(deviceId);
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(
          `Dispositivo ${deviceId} desconectado por cierre de sesión.`
        );
        console.log(
          `Eliminando ${sessionDir} y preparando para nuevo escaneo.`
        );

        await fs.promises.rm(sessionDir, { recursive: true, force: true });

        console.log(
          "Sesión eliminada. Reiniciando proceso de conexión en 5 segundos..."
        );

        setTimeout(() => {
          console.log("Reiniciando proceso de conexión...");
          connectToWhatsApp(deviceId);
        }, 5000);
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Se requiere reinicio, reiniciando...");
        connectToWhatsApp(deviceId);
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Se agotó el tiempo de conexión, conectando...");
        connectToWhatsApp(deviceId);
      } else {
        sock.end(
          `Motivo de desconexión desconocido: ${reason}|${lastDisconnect.error}`
        );
      }
    } else if (connection === "open") {
      console.log(`Conexión abierta para el dispositivo ${deviceId}`);
      return;
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sockets[deviceId] = sock;
};

const initializeDevices = async () => {
  for (let i = 1; i <= MAX_DEVICES; i++) {
    await connectToWhatsApp(i);
  }
};

initializeDevices().catch((err) => console.log("Error inesperado: " + err));

app.get("/send-message/:deviceId", (req, res) => {
  const { deviceId } = req.params;
  const sock = sockets[deviceId];
  if (sock) {
    res.send(`Usando el dispositivo ${deviceId}`);
  } else {
    res.status(404).send(`Dispositivo ${deviceId} no encontrado`);
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
        message: `Dispositivo ${deviceId} desconectado y sesión eliminada`,
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

app.get("/dispositivos-conectados", (req, res) => {
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

app.post("/enviar-mensaje/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  const { numero, mensaje, imagen } = req.body;

  if (!numero || (!mensaje && !imagen)) {
    return res
      .status(400)
      .json({ error: "Se requiere número y mensaje o imagen" });
  }

  const sock = sockets[deviceId];
  if (!sock) {
    return res
      .status(404)
      .json({ error: `Dispositivo ${deviceId} no encontrado` });
  }

  try {
    const numeroWhatsApp = `${numero}@s.whatsapp.net`;

    if (imagen) {
      // Enviar imagen
      await sock.sendMessage(numeroWhatsApp, {
        image: { url: imagen },
        caption: mensaje || "", // El mensaje se usa como pie de foto si se proporciona
      });
    } else {
      // Enviar mensaje de texto
      await sock.sendMessage(numeroWhatsApp, { text: mensaje });
    }

    res.json({ mensaje: "Mensaje enviado con éxito", status: 200 });
  } catch (error) {
    console.error(
      `Error al enviar mensaje desde dispositivo ${deviceId}:`,
      error
    );
    res
      .status(500)
      .json({ error: "Error al enviar el mensaje", detalles: error.message });
  }
});

server.listen(8000, () => {
  console.log("Servidor ejecutándose en el puerto: " + 8000);
});
