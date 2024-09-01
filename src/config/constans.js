const path = require("path");

module.exports = {
  PORT: 8000,
  SOCKETS_FILE: path.join(__dirname, "..", "..", "sockets.json"),
};
