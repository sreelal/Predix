#!/usr/bin/env node

/*jslint node: true */
"use strict";

// --- imports
var request = require('request');
var express = require('express');
var bodyParser = require('body-parser');
var Logging = require('./lib/bunyanLogger.js');
var logger = Logging.logger();

var pmConfig = require("./lib/PMConfig.js")();
var paService = require("./lib/PAsset-Service.js")(logger, pmConfig);



var PORT = 8080;


(function() {
    if (!pmConfig.isEnvCF()) {
        PORT = pmConfig.requireConfig('PORT');
    } else {
        PORT = process.env.PORT;
    }
    logger.info('using port: ' + PORT);
})();

// starts Express server -- TODO: will be used to act as cmd-processor for Asset service
function startServer() {
    var app = express();
    app.use(bodyParser.json()); // support json encoded bodies
    app.use(bodyParser.urlencoded({
        extended: true
    })); // support encoded bodies

    app.get('/*', simpleRequest);
    app.put('/*', simpleRequest);
    app.post('/*', simpleRequest);

    function simpleRequest(req, res) {

        logger.info("Default Request Received: Returning simple response.");
        logger.info("BODY: " + req.body);
        res.json({
            TS: new Date().getTime()
        });
    }

    var server = app.listen(PORT, function() {
        var host = server.address().address;
        var port = server.address().port;
        logger.info('Server listening at http://%s:%s', host, port);
    });

}

// starts a deamon process which runs every t1-seconds - configured in config.json / manifest.yml
function daemon() {
    var interval = pmConfig.requireConfig('DATA_REFRESH_TIME') * 1000;
    setInterval(function() {
        logger.info("Daemon: Starting sync process ...");
        paService.getAllAssets(); //trying to get data from asset service. If found then it will be pushed to Mobile service.
        // TODO: update CB document
    }, interval);
}

// my main
(function() {
    startServer();
    paService.authorize()
        .then(function(isAuthorized) {
            logger.trace("We are authorized with Asset and PM services, starting daemon worker...");
            daemon();
        })
        .catch(function(error) {
            logger.fatal({
                error: error
            }, "Error while autorizing!!! shutting down now :-( ");
            process.exit(1);
        });
})();
