const express = require('express');
require('dotenv').config();

const routes = require('./src/routes/ScraperRoute');

const app = express();
const port = process.env.SERVER_PORT || 3000;
const host = process.env.SERVER_HOST || 'localhost'

app.get("/", (req, res) => {
  res.send("---- Scraper API ----");
});

// register all route under '/api/v1'
app.use('/api', routes);


app.listen(3000, '0.0.0.0', () => {
    console.log(`🚀 Server started, listening on http://${host}:${port}`);
});