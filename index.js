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
const path = require("path");

const SOCKETS_FILE = path.join(__dirname, "sockets.json");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = require("http").createServer(app);

const usedDeviceIDs = new Set();

const generateUniqueDeviceID = () => {
  let newDeviceID;
  do {
    newDeviceID = Math.floor(Math.random() * 10) + 1;
  } while (usedDeviceIDs.has(newDeviceID));

  usedDeviceIDs.add(newDeviceID);
  return newDeviceID;
};

const cargarSockets = () => {
  if (!fs.existsSync(SOCKETS_FILE) || fs.statSync(SOCKETS_FILE).size === 0) {
    console.log(
      "El archivo sockets.json está vacío o no existe. Iniciando con un objeto vacío."
    );
    return {};
  }

  const socketsData = JSON.parse(fs.readFileSync(SOCKETS_FILE));

  const restoredSockets = Object.keys(socketsData).reduce((acc, key) => {
    acc[key] = {
      deviceId: socketsData[key].deviceId,
      user: socketsData[key].user,
      logout: eval("(" + socketsData[key].logout + ")"),
      sendMessage: eval("(" + socketsData[key].sendMessage + ")"),
    };
    return acc;
  }, {});

  return restoredSockets;
};

const guardarSockets = () => {
  const socketsData = Object.keys(sockets).reduce((acc, key) => {
    acc[key] = {
      deviceId: acc[key],
      user: sockets[key].user,
      logout: sockets[key].logout.toString(),
      sendMessage: sockets[key].sendMessage.toString(),
    };
    return acc;
  }, {});

  fs.writeFileSync(SOCKETS_FILE, JSON.stringify(socketsData, null, 2));
};

let sockets = cargarSockets();

const connectOrReconnect = async (userID) => {
  let codeQR;
  const sessionDir = `session_${userID}`;
  const { state, saveCreds, qr } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    logger: log({ level: "silent" }),
  });

  return new Promise((resolve, reject) => {
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === "close") {
        let reason = new Boom(lastDisconnect.error).output.statusCode;

        if (reason === DisconnectReason.connectionClosed) {
          console.log("Conexión cerrada, reconectando....");
          reConnectToWhatsApp(deviceId);
        } else if (reason === DisconnectReason.loggedOut) {
          console.log(
            `Dispositivo ${userID} desconectado por cierre de sesión.`
          );

          await fs.promises.rm(sessionDir, { recursive: true, force: true });
          console.log(
            "Sesión eliminada. Reiniciando proceso de conexión en 5 segundos..."
          );

          setTimeout(() => {
            console.log("Reiniciando proceso de conexión...");
            connectOrReconnect(userID);
          }, 5000);
        } else if (reason === DisconnectReason.restartRequired) {
          console.log("Se requiere reinicio, reiniciando...");
          connectOrReconnect(userID);
        } else if (reason === DisconnectReason.timedOut) {
          console.log("Se agotó el tiempo de conexión, conectando...");
          connectOrReconnect(userID);
        } else {
          sock.end(
            `Motivo de desconexión desconocido: ${reason}|${lastDisconnect.error}`
          );
        }
      }

      if (qr && connection !== "open") {
        codeQR = await qrcode.toDataURL(qr);
        resolve({
          message: "Conexión pendiente",
          status: 201,
          deviceId: userID,
          qr: codeQR,
        });
      } else if (!qr && connection === "open") {
        guardarSockets();
        resolve({
          message: "Conexión abierta",
          status: 200,
          deviceId: userID,
          qr: null,
        });
      }
    });

    sock.ev.on("creds.update", saveCreds);
    sockets[userID] = sock;
  });
};

app.get("/whatsapp-qrcode/:deviceId?", async (req, res) => {
  const { deviceId } = req.params;
  const userID = generateUniqueDeviceID();
  try {
    await connectOrReconnect(deviceId === undefined ? userID : deviceId)
      .then((data) => {
        res.send(data);
      })
      .catch((error) => {
        console.log(error);
        res.status(405).json({ error: "Error al iniciar la conexión" });
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error al iniciar la conexión" });
  }
});

app.post("/disconnect/:deviceId", async (req, res) => {
  const { deviceId } = req.params;

  await connectOrReconnect(deviceId).then(async (data) => {
    if (data.status === 201) {
      return res.status(404).json({
        error: `El ID del dispositivo no se encuentra registrado`,
        status: 404,
      });
    }

    const sock = sockets[deviceId];
    if (sock) {
      try {
        await sock.logout();
        delete sockets[deviceId];
        const sessionDir = `session_${deviceId}`;
        await fs.promises.rm(sessionDir, { recursive: true, force: true });
        guardarSockets();

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
});

app.get("/devices-active", async (req, res) => {
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
  await connectOrReconnect(deviceId).then(async (data) => {
    const sock = sockets[deviceId];

    if (data.status === 201) {
      return res.status(404).json({
        error: `El ID del dispositivo no se encuentra registrado`,
        status: 404,
      });
    }

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
});

app.get("/user-info/:deviceId", async (req, res) => {
  const { deviceId } = req.params;

  await connectOrReconnect(deviceId).then(async (data) => {
    if (data.status === 201) {
      return res.status(404).json({
        error: `El ID del dispositivo no se encuentra registrado`,
        status: 404,
      });
    }

    const sock = sockets[deviceId];

    if (!sock || !sock.user) {
      return res.status(404).json({
        error: "Usuario no encontrado o no conectado",
        status: 404,
      });
    }

    const userInfo = {
      deviceId,
      nombreUsuario: sock.user.name,
      idUsuario: sock.user.id,
    };
    res.json({
      mensaje: "Información del usuario obtenida con éxito",
      status: 200,
      usuario: userInfo,
    });
  });
});

server.listen(8000, () => {
  cargarSockets();
  console.log("Servidor ejecutándose en el puerto: " + 8000);
});
