#!/usr/bin/env node

/*jslint node: true */
"use strict";

// This file communicates with Mobile service and pushes data received from Asset Service to Mobile service
// --- imports
var BPromise    = require('bluebird'); BPromise.longStackTraces();
var request = require('request');
var pmUAA = require("./Auth.js")();
var logger;
var pmConfig = require("./PMConfig.js")();
var PMSERVICE = null;
var isInProgress = false;
var DB = null;
var pmNano = null;

module.exports = function(log) {
    logger = log;
    if (null === PMSERVICE) {
      pmNano = require('./pm-nano.js');
        pmUAA.init({
            logger: logger,
            config: pmConfig
        });

        PMSERVICE = {
            init       : initialize,
            // pmAuthorize: getOauthFromPM,
            checDoc: checkDocExisitsNew,
            updateDoc: updateAssetsDoc
        };
    }
    return PMSERVICE;
};

var PM_OAUTH_TOKEN = null;
var URL_PM_EP = null; //"https://778517.run.aws-usw02-pr.ice.predix.io/";
var PM_UAA_URL = null;
var USERNAME = null;
var PASSWORD = null;

(function() {
    readConfig();
})();


function readConfig() {
    URL_PM_EP = pmConfig.requireConfig('PM_EP_URL');
    USERNAME = pmConfig.requireConfig('PM_USERNAME');
    PASSWORD = pmConfig.requireConfig('PM_PASSWORD');
    PM_UAA_URL = pmConfig.requireConfig('PM_UAA_URL');
}

function initialize() {
  return new BPromise(function (resolve, reject) {
    pmNano.getDatabase(pmConfig, logger)
    .then(function(pmNanoResp) {
        DB = pmNanoResp.pmDb;
        logger.debug({database: DB},"pm nano initialized :-)");
        resolve(true);
    })
    .catch(function(err) {
        logger.error(err);
        reject(err);
    });
  });
}

// TODO: <excercise: What if auth token expires. DB will respond with 401 status code.
//        Check for that and cache the promise response i.e resolve/reject after trying by calling
//        `pmNano.getDatabase()` again.>
// Checks if a doc exists in Mobile service
function checkDocExisitsNew(docID) {
    return new BPromise(function(resolve, reject) {
      // README: https://github.com/apache/couchdb-nano#dbgetdocname-params-callback
        DB.get(docID, { revs_info: true }, function (err, body) {
          if (err) {
            resolve({
              isPresent : false,
              error : err
            });
          } else {
            resolve({
              isPresent : true,
              doc : body
            });
          }
        });
        }
    );
}

// pushes a doc to Mobile service
function putDocument(doc) {
    return new BPromise(function(resolve, reject) {
      // README: https://github.com/apache/couchdb-nano#dbinsertdoc-params-callback
      DB.insert(doc, function (err, body) {
        if (err) {
          logger.error('Error in put document: ', err);
            reject(err);
        } else {
          logger.trace({put_response : body}, 'PUT document success.');
            resolve(body);
        }
      });
    }
  );
}

//Creates/Updates document containing Asset service results and push this to Mobile service
function updateAssetsDoc(results) {
    return new BPromise(function(resolve, reject) {
        var doc = null;
        createJsonDoc()
            .then(function(createdDoc) {
                doc = createdDoc;
                return checkDocExisitsNew(doc._id);
            })
            .then(function(checkDocResp) {
              if (checkDocResp.isPresent) {
                var exisitingDoc = checkDocResp.doc//JSON.parse(checkDocResp.doc);
                logger.debug("exisiting document in PM service:->> ", exisitingDoc);

                if (exisitingDoc && exisitingDoc.hasOwnProperty('_id') && exisitingDoc.hasOwnProperty('_rev')) {
                    //get revision ID and add to document
                    doc._rev = exisitingDoc['_rev'];
                }

                doc.asset_results = results;
                logger.debug('about to push:-->', doc);
              }
              else {
                logger.debug({doc_id: doc._id},'new doc is getting pushed');
              }
              return putDocument(doc);
            })
            .then(function(putDoc) {
                logger.info('Updated document in PM service.');
                logger.debug('PUT success:', putDoc);
                resolve(putDoc);
            })
            .catch(function(err) {
                logger.error(err);
                reject(err);
            });
    });
}

//Creates a document which will hold asset service results.
function createJsonDoc() {
    return new BPromise(function(resolve, reject) {

        getWebAppChannels()
            .then(function(webAppDoc) {
                // webAppDoc = JSON.parse(webAppDoc);
                var webAppChannels = webAppDoc.channels; // will assign document to these channles
                // webAppChannels.push('entity_'+USERNAME.replace(/[@#\.]/g, '_'));
                var assetDoc = {};
                var assetDocID = USERNAME.replace(/[@#\.]/g, '_'); // as of now we have to replace '.' & '@' with '_'

                //generating document id as a combination of username+tag+asset zone id
                assetDocID = assetDocID + '_' + 'predix_asset' + '_' + pmConfig.requireConfig('PA_PREDIX_ZONE_ID');
                logger.debug('assetDocID:-->', assetDocID);
                assetDoc._id = assetDocID;
                assetDoc.channels = webAppChannels; // assigining channels to document.
                // assetDoc.channels.push("user-user1");
                // assetDoc.channels.push("entity_user1");
                // assetDoc.channels.push("role-user");

                assetDoc.title = "assets document";
                assetDoc.type = "asset";
                resolve(assetDoc);
            })
            .catch(function(err) {
                reject(err);
            });

    });
}

//I'll get webapp document (created by `pm publish` command)
// TODO: OPTIMIZE -- Don't call on each new insertion <left as excercise.>
function getWebAppChannels() {
    return new BPromise(function(resolve, reject) {
        // webapps documents are combination of webapp tag + web app name + web app version
        var webappID = 'webapp-' + pmConfig.requireConfig('WEB_APP_NAME') + '_' + pmConfig.requireConfig('WEB_APP_VERSION').replace(/\./g, '_');
        checkDocExisitsNew(webappID)
            .then(function(checkDocResp) {
              if (checkDocResp.isPresent) {
                logger.debug('webapp Document:', checkDocResp.doc);
                resolve(checkDocResp.doc);
              }
              else{
                logger.error('Missing webapp document! Check your configurations again.', checkDocResp.error);
                reject(checkDocResp.error);
              }

            })
            .catch(function(err) {
                logger.error('Missing webapp! Check your configurations again.', err);
                reject(err);
            });
    });
}
