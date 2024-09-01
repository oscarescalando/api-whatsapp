const fs = require("fs");

exports.loadFromFile = (filePath) => {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    console.log(
      "El archivo está vacío o no existe. Iniciando con un objeto vacío."
    );
    return {};
  }
  const socketsData = JSON.parse(fs.readFileSync(filePath));

  return Object.keys(socketsData).reduce((acc, key) => {
    acc[key] = {
      deviceId: socketsData[key].deviceId,
      user: socketsData[key].user,
      logout: eval("(" + socketsData[key].logout + ")"),
      sendMessage: eval("(" + socketsData[key].sendMessage + ")"),
    };
    return acc;
  }, {});
};

exports.saveToFile = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};
