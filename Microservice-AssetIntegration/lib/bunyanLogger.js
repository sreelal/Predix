#!/usr/bin/env node
/*jslint node: true */
"use strict";
// --- imports
var bunyan      = require('bunyan');
module.exports = {
      logger : getLogger
};

function getLogger()
{
  return bunyan.createLogger({name: "PM-PA", src:true, level:'TRACE'});
}
