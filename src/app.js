const express = require("express");
const whatsappRoutes = require("./routes/whatsappRoutes");
const socketManager = require("./utils/socketManager");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/", whatsappRoutes);

socketManager.loadSockets();

module.exports = app;
