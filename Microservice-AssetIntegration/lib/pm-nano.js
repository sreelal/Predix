#!/usr/bin/env node

/*jslint node: true */
"use strict";

var BPromise    = require('bluebird'); BPromise.longStackTraces();
var pmUAA       = require("./Auth.js")();
var request     = require('request');
var nano        = require('nano');
var logger      = null;

module.exports = {
      getDatabase : init
};

function init(pmConfig, myLogger) {
  return new BPromise(function(resolve, reject) {
    var pmURL = pmConfig.requireConfig('PM_EP_URL');
    var bucketName = pmConfig.requireConfig('PM_BUCKET');

    if (null === pmURL || null === bucketName || null === myLogger) {
      console.error('Invalid parameters sent to initialize pm-nano module!');
      reject('Invalid parameters sent to initialize pm-nano module!');
      return;
    }

    logger = myLogger;
    pmURL = ensureSlashAtEnd(pmURL);

    pmUAA.init({
        logger: logger,
        config: pmConfig
    });
    pmUAA.authorize()
    .then(function(token) {
      var nonoConfig = {
        "url": pmURL,
        "request": customizeRequest,
        "logger": myLogger
      };
      var myNano = nano(nonoConfig);
      myNano.config.url = pmURL + 'pg/api/admin/data/';
      // logger.trace(myNano);
      resolve({
          nano: myNano,
          pmDb: myNano.use(bucketName)
      });
    })
    .catch(function(err) {
      logger.error(err);
      reject(err);
    });

  });

}

function ensureSlashAtEnd(uri) {
    var regX = new RegExp("/$", "");
    if (!regX.test(uri)) {
        return uri + "/";
    }
    return uri;
}


function customizeRequest(options, callback) {
  //1.  get current token from auth.js
  var authToken = pmUAA.authtoken();

  //2. add to options
  options.headers.Authorization = authToken;
  if ((options.method == "POST") && (options.uri == "https://d1eark.run.aws-usw02-pr.ice.predix.io/pg/api/admin/data/pm")){
    options.method = "PUT"
    //documentID 
    var documentID = JSON.parse(options.body)._id
    options.uri  = options.uri + "/" + documentID
  }
  //3. return valid request
  return request(options, function(error,response,body){
      correctSyncGatewayErrorResponse(error, response, body); //TODO: Check on this
      callback(error, response, body);
  });

}


function correctNanoRequestForOptions(options, bucketName) {
    var regX = new RegExp("/" + bucketName + "$", "");
    // Note: The SyncGateway uses a more strict REST interaction.  We filter for, and correct the default nano requests here.
    if (regX.test(options.uri)) {
        options.uri += "/";
        changePostToPutIfDocumentUpdate(options);
    }
}

function changePostToPutIfDocumentUpdate(options) {
    if (options.method === "POST") {
        // Note: For the SyncGateway, A POST to the bucket does not currently allow updating a document (A 404 response is returned, where the existing document is not found.)  We correct for this here, by translating the POST to a PUT to the actual document ID.
        // This may be corrected in sync-gateway versions newer than v1.1.0.
        var revKeyExists = options.body.indexOf('"_rev"') > -1;
        var idKeyExists = options.body.indexOf('"_id"') > -1;
        if ( revKeyExists || idKeyExists ) {
            // We have what appears to be a document with an existing revision;  Translate to PUT.
            options.method = "PUT";
            var documentID = options.body.match(/"_id"\s*:\s*"(.*?)"/)[1];
            if (!documentID) {
                logger.error("Nano Request: Unable to re-route POST to PUT: document _id not found in document content:", options);
            }
            options.uri += documentID;
        }
    }
}

function correctSyncGatewayErrorResponse(error, response, body) {
    // Note: The SyncGateway returns some CB Server error codes as 500.  We filter for, and correct these types here.
    if (response && (response.statusCode.valueOf() === 500)
    ) {
        // {"error": "Internal Server Error", "reason": "Internal error: Error reading view: 404 Object Not Found / {\"error\":\"not_found\",\"reason\":\"missing\"}\n"}
        var parsedBody = null;
        try { parsedBody = JSON.parse(body); } catch (err) { }
        if (parsedBody && parsedBody.reason) {
            var reason = parsedBody.reason;
            if (reason.indexOf("404 Object Not Found") > -1) {
                response.statusCode = 404;
            }

            // sync-gateway v1.1.0, when querying for design document existance:
            // This may be corrected in sync-gateway v1.2.0 or newer.
            // {"error":"Internal Server Error","reason":"Internal error: http: read on closed response body"}
            if (reason.indexOf("Internal error: http: read on closed response body") === 0) {
                response.statusCode = 200;
            }

        }

    }
}
