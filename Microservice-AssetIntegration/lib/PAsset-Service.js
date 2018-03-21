#!/usr/bin/env node

/*jslint node: true */

"use strict";

//This file hold logic to communicate with Asset service, gets relevant data.
// --- imports
var BPromise    = require('bluebird'); BPromise.longStackTraces();
var request = require('request');
var logger;
var pmConfig = require("./PMConfig.js")();
var pmService = null;
// var DB = null;
// var pmNano = null;

module.exports = function(log, config) {
  log.debug('initializing Asset.js...');
    logger = log;
    pmService = require("./PM-SG-Service.js")(logger);
    return {
        authorize: getAuthorization,
        getAllAssets: callAsset
    };
};


var ACCESS_TOKEN = null;
var PREDIX_ZONE_ID = null;
var URL_ASSET = null;
var URL_UAA = null;
var USERNAME = null;
var PASSWORD = null;
var ARR_ASSET_URL = null;
(function() {
    readConfig();
})();


function readConfig() {
    PREDIX_ZONE_ID = pmConfig.requireConfig('PA_PREDIX_ZONE_ID');
    URL_ASSET = pmConfig.requireConfig('PA_URL_ASSET'); //'https://predix-asset.run.aws-usw02-pr.ice.predix.io/locomotives?filter=model=3GS21B:serial_no=0019'; //
    URL_UAA = pmConfig.requireConfig('PA_URL_UAA');
    USERNAME = pmConfig.requireConfig('PA_USERNAME');
    PASSWORD = pmConfig.requireConfig('PA_PASSWORD');
    // Few random urls (filters) to get different type of results.
    ARR_ASSET_URL = [URL_ASSET,
        URL_ASSET + '?pageSize=5',
        URL_ASSET + '?filter=partnumber=002:serialnumber=AKLOIF001',
    ];
}

//Returns a random url for asset service
function getRandomAssetURL() {
    return ARR_ASSET_URL[Math.floor(Math.random() * (ARR_ASSET_URL.length - 1))];
}

function getBasic() {
    return new Buffer(USERNAME + ':' + PASSWORD).toString('base64');
}

// gets auth token for Assets service instance
function getAuthorization() {
    return new BPromise(function(resolve, reject) {

        var options = {
            url: URL_UAA,
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + getBasic(),
                /*'Basic YXNzZXRfY2xpZW50XzM6YWJjMTIz'*/
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'client_id=' + USERNAME + '&grant_type=client_credentials&client_secret=' + PASSWORD
        };

        function callback(error, response, body) {
            if ((!error && response.statusCode == 200)) {
                var info = JSON.parse(body);
                ACCESS_TOKEN = info.access_token;
                logger.debug("got the Asset service oauth token.");

                pmService.init()
                    .then(function(arr) {
                        logger.debug("pm service intialized.");
                        resolve(true);
                    })
                    .catch(function(err) {
                        logger.error(err);
                        reject(err);
                    });
            } else {
                logger.error({
                    error: error
                }, "Error while trying to authenticate with Asset service!");
                reject(JSON.stringify(response));
            }
        }
        request(options, callback);
    });
}

// gets data from assest service
function callAsset() {
    return new BPromise(function(resolve, reject) {
        var authToken = 'bearer ' + ACCESS_TOKEN;
        var assetUrlSelected = getRandomAssetURL();
        logger.trace('Calling assets with URL: ', assetUrlSelected);
        var assets_Options = {
            url: assetUrlSelected,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json;charSet=utf-8',
                'Authorization': authToken,
                'Cache-Control': 'no-cache',
                'Predix-Zone-Id': PREDIX_ZONE_ID
            }
        };

        function assets_callback(error, response, body) {
            if (!error && (response.statusCode >= 200 && response.statusCode <= 299)) {
                var assetsResults = JSON.parse(body);
                logger.info('received predix-asset service data successfully.');
                logger.debug("ASSET DATA: ", assetsResults);
                // sending this data to Mobile service so that it can be created/updated there. Once it is there it will be replicated to relevant clients.
                pmService.updateDoc((assetsResults))
                    .then(function(document) {
                        logger.debug("put document result: ", document);
                        resolve(true);
                    })
                    .catch(function(err) {
                        logger.error(err);
                        reject(err);
                    });
            } else {
                //TODO: Retry for Asset Authorization or some other error handling
                logger.error({
                    error: error,
                    status: response.statusCode,
                    response: body
                }, "Error while getting Assets from URL: " + assetUrlSelected);
                reject(JSON.stringify(response));
            }
        }
        logger.debug('Calling asset service instance now...');
        request(assets_Options, assets_callback);
    });
}
