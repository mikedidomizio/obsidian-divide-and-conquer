"use strict";
// An inert plugin. It exists only so Divide and Conquer has something real to
// enable, disable, and bisect against inside the test vault.
const { Plugin } = require("obsidian");

class DacTestPlugin extends Plugin {}

module.exports = DacTestPlugin;
module.exports.default = DacTestPlugin;
