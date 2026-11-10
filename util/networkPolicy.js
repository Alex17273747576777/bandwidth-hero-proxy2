const dns = require("node:dns");
const ipaddr = require("ipaddr.js");

function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(({ address }) => {
      try { return ipaddr.process(address).range() !== "unicast"; }
      catch { return true; }
    })) return callback(new Error("Destination is not a public IP address"));
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function allowedUrl(value, allowedHosts) {
  if (typeof value !== "string") throw new Error("Invalid URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443") || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Destination not allowed");
  }
  return url;
}
module.exports = { publicLookup, allowedUrl };
