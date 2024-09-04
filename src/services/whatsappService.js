const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode");
const fs = require("fs");
const socketManager = require("../utils/socketManager");
const log = (pino = require("pino"));

const activeConnections = new Map();

exports.generateUniqueDeviceID = () => {
  let newDeviceID = Math.floor(Math.random() * 10) + 1;
  return newDeviceID;
};

exports.connectOrReconnect = async (userID, message) => {
  if (activeConnections.has(userID) && !!message) {
    console.log(`Conexión ya existente para el usuario ${userID}`);
    return activeConnections.get(userID);
  }

  let connectionPromise = new Promise(async (resolve, reject) => {
    let codeQR;
    const sessionDir = `session_${userID}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const sock = makeWASocket({
      printQRInTerminal: false,
      auth: state,
      logger: log({ level: "silent" }),
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (connection === "close") {
        let reason = new Boom(lastDisconnect.error).output.statusCode;
        if (reason === DisconnectReason.loggedOut) {
          console.log(
            `Dispositivo ${userID} desconectado por cierre de sesión.`
          );
          await fs.promises.rm(sessionDir, { recursive: true, force: true });
          console.log(
            "Sesión eliminada. Reiniciando proceso de conexión en 5 segundos..."
          );
          setTimeout(() => {
            console.log("Reiniciando proceso de conexión...");
            this.connectOrReconnect(userID, false);
          }, 5000);
        } else {
          this.connectOrReconnect(userID, false);
        }
        if (reason === DisconnectReason.connectionClosed) {
          this.connectOrReconnect(userID, false);
        } else if (reason === DisconnectReason.timedOut) {
          reject({
            message: "Request Time-out",
            status: 408,
          });
        }
      }

      if (qr && connection !== "open") {
        codeQR = await qrcode.toDataURL(qr);
        resolve({
          message: "Conexión pendiente",
          status: 200,
          deviceId: userID,
          qr: codeQR,
        });
      } else if (!qr && connection === "open") {
        socketManager.saveSockets();
        activeConnections.set(
          userID,
          Promise.resolve({
            message: "Conexión abierta",

            status: 201,
            deviceId: userID,
            qr: null,
          })
        );
        resolve({
          message: "Conexión abierta",
          status: 201,
          deviceId: userID,
          qr: null,
        });
      }
    });

    socketManager.setSocket(userID, sock);
    sock.ev.on("creds.update", saveCreds);
  });

  return connectionPromise;
};

exports.disconnectDevice = async (deviceId) => {
  if (activeConnections.has(deviceId)) {
    const connectionResult = await activeConnections.get(deviceId);
    if (connectionResult.status === 201) {
      const sock = socketManager.getSocket(deviceId);
      if (sock) {
        try {
          await sock.logout();
          socketManager.removeSocket(deviceId);
          const sessionDir = `session_${deviceId}`;
          await fs.promises.rm(sessionDir, { recursive: true, force: true });
          socketManager.saveSockets();

          activeConnections.delete(deviceId);

          return {
            message: `El usuario ha sido desconectado y la sesión eliminada`,
            status: 200,
          };
        } catch (error) {
          console.error(
            `Error al desconectar el dispositivo ${deviceId}:`,
            error
          );
          return {
            message: `Error al desconectar el dispositivo ${deviceId}`,
            status: 500,
          };
        }
      }
    }
  }

  return {
    message: `El dispositivo ${deviceId} no está conectado o no se encuentra`,
    status: 404,
  };
};

exports.getActiveDevices = () => {
  const dispositivosConectados = Object.entries(socketManager.getAllSockets())
    .filter(([_, sock]) => sock.user != null)
    .map(([deviceId, sock]) => ({
      deviceId,
      nombreUsuario: sock.user.name,
      idUsuario: sock.user.id,
    }));

  return {
    totalConectados: dispositivosConectados.length,
    dispositivos: dispositivosConectados,
  };
};

exports.sendMessage = async (deviceId, numero, mensaje, imagen) => {
  const connectionResult = await this.connectOrReconnect(deviceId, true);
  const sock = socketManager.getSocket(deviceId);

  if (connectionResult.status === 200) {
    return {
      error: `El ID del dispositivo no se encuentra registrado`,
      status: 404,
    };
  }

  if (!numero) {
    return {
      error: `El número de teléfono es requerido`,
      status: 404,
    };
  }

  if (!mensaje && !imagen) {
    return {
      error: `El mensaje o la imagen es requerido`,
      status: 404,
    };
  }

  const numeroWhatsApp = `${numero}@s.whatsapp.net`;

  if (imagen) {
    await sock.sendMessage(numeroWhatsApp, {
      image: { url: imagen },
      caption: mensaje || "",
    });
  } else {
    await sock.sendMessage(numeroWhatsApp, { text: mensaje });
  }

  return { mensaje: "Mensaje enviado con éxito", status: 200 };
};

exports.getUserInfo = async (deviceId) => {
  const sock = socketManager.getSocket(deviceId);

  if (!sock || !sock.user) {
    return {
      mensaje: "Usuario no encontrado o no esta vinculado",
      status: 404,
    };
  }

  const userInfo = {
    deviceId,
    nombreUsuario: sock.user.name,
    idUsuario: sock.user.id,
  };

  return {
    mensaje: "Información del usuario obtenida con éxito",
    status: 200,
    usuario: userInfo,
  };
};
