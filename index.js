const app = require("./src/app");
const { PORT } = require("./src/config/constans");

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto: ${PORT}`);
});
