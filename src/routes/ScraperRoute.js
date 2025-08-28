const { Router } = require('express');
const express = require("express");

const routes = Router();


const ScraperController = require("../controller/ScraperController");

const scraperController = new ScraperController();
const router = express.Router();

router.get("/getData", scraperController.getScrapedData);
routes.use('/scraper', router);
module.exports = routes;