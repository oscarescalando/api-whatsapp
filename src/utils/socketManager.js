const { SOCKETS_FILE } = require("../config/constans");
const fileManager = require("./fileManager");

let sockets = {};

exports.loadSockets = () => {
  sockets = fileManager.loadFromFile(SOCKETS_FILE);
};

exports.saveSockets = () => {
  const socketsData = Object.keys(sockets).reduce((acc, key) => {
    acc[key] = {
      deviceId: sockets[key].deviceId,
      user: sockets[key].user,
      logout: sockets[key].logout.toString(),
      sendMessage: sockets[key].sendMessage.toString(),
    };
    return acc;
  }, {});

  fileManager.saveToFile(SOCKETS_FILE, socketsData);
};

exports.getSocket = (deviceId) => sockets[deviceId];

exports.setSocket = (deviceId, socket) => {
  sockets[deviceId] = socket;
};

exports.removeSocket = (deviceId) => {
  delete sockets[deviceId];
};

exports.getAllSockets = () => sockets;
