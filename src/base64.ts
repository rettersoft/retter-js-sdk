/*
 * base64.js: An extremely simple implementation of base64 encoding / decoding using node.js Buffers
 *
 * (C) 2010, Nodejitsu Inc.
 * (C) 2011, Cull TV, Inc.
 *
 */

var Buffer = require('buffer/').Buffer

var base64Helpers:any = {}

base64Helpers.encode = function(unencoded:string) {
  return Buffer.from(unencoded || '').toString('base64');
};

base64Helpers.decode = function(encoded:string) {
  return Buffer.from(encoded || '', 'base64').toString('utf8');
};

base64Helpers.urlEncode = function(unencoded:string) {
  var encoded = base64Helpers.encode(unencoded);
  return encoded.replace('+', '-').replace('/', '_').replace(/=+$/, '');
};

base64Helpers.urlDecode = function(encoded:string) {
  encoded = encoded.replace('-', '+').replace('_', '/');
  while (encoded.length % 4)
    encoded += '=';
  return base64Helpers.decode(encoded);
};

export default base64Helpers